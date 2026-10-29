#!/usr/bin/env ruby
# frozen_string_literal: true

# Ruby Sidecar for Rails Console MCP Server
# Loads Rails environment and provides model introspection via JSON-RPC over stdio

require "json"
require "active_record"
require "active_support/all"

# ============================================================================
# Configuration from command line arguments
# ============================================================================

RAILS_APP_PATH = ARGV[0]
RAILS_ENV = ARGV[1] || "development"
OPTIONS = JSON.parse(ARGV[2] || "{}", symbolize_names: true)

READ_ONLY = OPTIONS[:readOnly] != false
MAX_ROWS = OPTIONS[:maxRows] || 100
QUERY_TIMEOUT = OPTIONS[:queryTimeoutSeconds] || 30

# ============================================================================
# Load Rails Environment
# ============================================================================

ENV["BUNDLE_GEMFILE"] = File.join(RAILS_APP_PATH, "Gemfile")
ENV["RAILS_ROOT"] = RAILS_APP_PATH
ENV["RAILS_ENV"] = RAILS_ENV

require "bundler/setup"
require File.join(RAILS_APP_PATH, "config/environment")

Rails.application.eager_load!

# Signal ready
$stdout.puts("SIDECAR_READY")
$stdout.flush

# ============================================================================
# Introspection Helpers
# ============================================================================

module Introspection
  # Get all ActiveRecord models
  def self.all_models(include_abstract = false)
    models = ActiveRecord::Base.descendants.select do |m|
      m.table_exists? && (include_abstract || !m.abstract_class?)
    end
    models.sort_by(&:name)
  end

  # Get model by name (handles namespaces)
  def self.find_model(name)
    name.camelize.constantize
  rescue NameError
    nil
  end

  # Column information
  def self.column_info(model)
    return [] unless model.table_exists?

    model.columns.map do |col|
      {
        name: col.name,
        type: col.type.to_s,
        sqlType: col.sql_type,
        null: col.null,
        default: col.default,
        limit: col.limit,
        precision: col.precision,
        scale: col.scale,
        primaryKey: col.name == model.primary_key,
        autoIncrement: col.name == model.primary_key && col.type == :integer,
        indexed: model.connection.index_exists?(model.table_name, col.name),
        comment: col.comment,
      }
    end
  end

  # Association information
  def self.association_info(model)
    model.reflect_on_all_associations.map do |assoc|
      {
        name: assoc.name.to_s,
        macro: assoc.macro.to_s,
        className: assoc.class_name,
        foreignKey: assoc.foreign_key,
        primaryKey: assoc.active_record_primary_key,
        through: assoc.through_reflection&.name&.to_s,
        source: assoc.source_reflection&.name&.to_s,
        dependent: assoc.options[:dependent]&.to_s,
        inverseOf: assoc.inverse_of&.to_s,
        counterCache: assoc.options[:counter_cache] == true ? true : (assoc.options[:counter_cache] || false),
        polymorphic: assoc.polymorphic?,
        as: assoc.options[:as]&.to_s,
        scope: assoc.scope&.to_s,
        options: assoc.options.except(:dependent, :counter_cache, :inverse_of, :polymorphic, :as, :through, :source),
      }
    end
  end

  # Validation information
  def self.validation_info(model)
    model.validators.map do |validator|
      {
        name: validator.class.name.demodulize.underscore,
        kind: validator.kind.to_s,
        attributes: validator.attributes.map(&:to_s),
        options: validator.options,
        message: validator.options[:message],
      }
    end
  end

  # Scope information
  def self.scope_info(model)
    scopes = []

    # Named scopes - ScopeRegistry stores scopes in @scopes instance variable
    scope_registry = model.send(:scope_registry)
    if scope_registry
      scope_hash = scope_registry.instance_variable_get(:@scopes)
      if scope_hash.is_a?(Hash)
        scope_hash.each do |name, scope_proc|
          scopes << {
            name: name.to_s,
            type: "scope",
            body: scope_proc.source_location&.join(":")&.to_s,
            whereValues: nil,
            orderValues: nil,
            limitValue: nil,
            offsetValue: nil,
            joinsValues: nil,
            includesValues: nil,
          }
        end
      end
    end

    # Default scope
    if model.default_scopes.any?
      model.default_scopes.each do |ds|
        scopes << {
          name: "default_scope",
          type: "default_scope",
          body: ds.respond_to?(:source_location) ? ds.source_location&.join(":")&.to_s : nil,
          whereValues: ds.respond_to?(:where_values_hash) ? ds.where_values_hash : nil,
          orderValues: ds.respond_to?(:order_values) ? ds.order_values&.map(&:to_sql) : nil,
          limitValue: ds.respond_to?(:limit_value) ? ds.limit_value : nil,
          offsetValue: ds.respond_to?(:offset_value) ? ds.offset_value : nil,
          joinsValues: ds.respond_to?(:joins_values) ? ds.joins_values&.map(&:to_sql) : nil,
          includesValues: ds.respond_to?(:includes_values) ? ds.includes_values&.map(&:to_s) : nil,
        }
      end
    end

    scopes
  end

  # Enum information
  def self.enum_info(model)
    return [] unless model.respond_to?(:defined_enums)

    model.defined_enums.map do |name, values|
      {
        name: name.to_s,
        values: values.transform_values(&:to_i),
        suffix: nil,  # enum_suffixes? not available on model class
        prefix: nil,  # enum_prefixes? not available on model class
      }
    end
  end

  # Callback information
  def self.callback_info(model)
    callbacks = []
    [:before_validation, :after_validation, :before_save, :after_save,
     :before_create, :after_create, :before_update, :after_update,
     :before_destroy, :after_destroy, :after_initialize, :after_find,
     :after_touch, :after_commit, :after_rollback].each do |kind|
      model.send("_#{kind}_callbacks").each do |cb|
        callbacks << {
          name: cb.filter.to_s,
          kind: kind.to_s,
          method: cb.filter.to_s,
          conditions: cb.instance_variable_get(:@if) || cb.instance_variable_get(:@unless),
        }
      end
    end
    callbacks
  end

  # Table schema (raw database)
  def self.table_schema(table_name)
    connection = ActiveRecord::Base.connection
    return nil unless connection.table_exists?(table_name)

    columns = connection.columns(table_name).map do |col|
      {
        name: col.name,
        type: col.type.to_s,
        sqlType: col.sql_type,
        null: col.null,
        default: col.default,
        limit: col.limit,
        precision: col.precision,
        scale: col.scale,
        primaryKey: col.name == connection.primary_key(table_name),
        autoIncrement: col.name == connection.primary_key(table_name) && col.type == :integer,
        indexed: connection.index_exists?(table_name, col.name),
        comment: col.comment,
      }
    end

    indexes = connection.indexes(table_name).map do |idx|
      {
        name: idx.name,
        columns: idx.columns,
        unique: idx.unique,
        type: idx.type,
        where: idx.where,
      }
    end

    foreign_keys = connection.foreign_keys(table_name).map do |fk|
      {
        name: fk.name,
        column: fk.column,
        referencedTable: fk.to_table,
        referencedColumn: fk.primary_key,
        onDelete: fk.on_delete,
        onUpdate: fk.on_update,
      }
    end

    primary_keys = [connection.primary_key(table_name)].compact

    {
      tableName: table_name,
      columns: columns,
      indexes: indexes,
      foreignKeys: foreign_keys,
      primaryKeys: primary_keys,
    }
  end

  # Execute read-only query
  def self.execute_query(sql, params = [], limit = MAX_ROWS)
    return { error: "Only SELECT queries allowed" } unless READ_ONLY
    return { error: "Query must be a SELECT statement" } unless sql.strip =~ /\A\s*SELECT/i

    connection = ActiveRecord::Base.connection

    # Add LIMIT if not present and limit is set
    if limit && sql !~ /LIMIT\s+\d+/i
      sql = "#{sql} LIMIT #{limit}"
    end

    start_time = Time.now
    result = connection.exec_query(sql, "MCP Query", params)
    execution_time = ((Time.now - start_time) * 1000).round

    rows = result.rows
    truncated = rows.size >= (limit || MAX_ROWS)

    {
      columns: result.columns,
      rows: rows,
      rowCount: rows.size,
      truncated: truncated,
      executionTimeMs: execution_time,
    }
  rescue ActiveRecord::StatementInvalid => e
    { error: "Query error: #{e.message}" }
  end

  # Model counts
  def self.model_counts(model_names = nil, where = nil, limit = nil)
    models = model_names ? model_names.map { |n| find_model(n) }.compact : all_models

    models.map do |model|
      scope = model.all
      scope = scope.where(where) if where
      scope = scope.limit(limit) if limit

      {
        modelName: model.name,
        tableName: model.table_name,
        count: scope.count,
        whereClause: where&.to_json,
      }
    end
  end

  # Search models by pattern
  def self.search_models(pattern, include_columns = false)
    regex = Regexp.new(pattern, Regexp::IGNORECASE)
    models = all_models.select { |m| m.name =~ regex || m.table_name =~ regex }

    models.map do |model|
      scope_registry = model.send(:scope_registry)
      scope_hash = scope_registry&.instance_variable_get(:@scopes)
      has_scopes = scope_hash.is_a?(Hash) && scope_hash.any?
      summary = {
        name: model.name,
        tableName: model.table_name,
        columnCount: model.columns.size,
        associationCount: model.reflect_on_all_associations.size,
        hasScopes: has_scopes,
        hasEnums: model.respond_to?(:defined_enums) && model.defined_enums.any?,
        hasCallbacks: model._save_callbacks.any? || model._destroy_callbacks.any?,
      }
      summary[:columns] = column_info(model) if include_columns
      summary
    end
  end

  # Association graph
  def self.associations_graph(model_names = nil, direction = "all")
    models = model_names ? model_names.map { |n| find_model(n) }.compact : all_models
    model_set = models.to_set

    nodes = models.map do |model|
      {
        id: model.name,
        label: model.name,
        tableName: model.table_name,
        columnCount: model.columns.size,
      }
    end

    edges = []
    models.each do |model|
      model.reflect_on_all_associations.each do |assoc|
        target_name = assoc.class_name
        next unless direction == "all" || direction == "outgoing"

        if model_set.include?(assoc.klass) || model_names.nil?
          edges << {
            source: model.name,
            target: target_name,
            label: assoc.name.to_s,
            macro: assoc.macro.to_s,
            foreignKey: assoc.foreign_key,
          }
        end
      end
    end

    { nodes: nodes, edges: edges }
  end

  # Reload Rails environment
  def self.reload_environment(force = false)
    if Rails.env.production? && !force
      return { success: false, message: "Reload not allowed in production without force=true" }
    end

    # Reload application code
    Rails.application.reloader.reload!

    # Re-eager load
    Rails.application.eager_load!

    { success: true, message: "Rails environment reloaded" }
  rescue StandardError => e
    { success: false, message: "Reload failed: #{e.message}" }
  end
end

# ============================================================================
# JSON-RPC Request Handler
# ============================================================================

def handle_request(request)
  id = request["id"]
  method = request["method"]
  params = request["params"] || {}

  begin
    result = case method
    when "list_models"
      Introspection.all_models(params["includeAbstract"] == true)
    when "get_model_schema"
      model = Introspection.find_model(params["modelName"])
      raise "Model not found: #{params['modelName']}" unless model

      {
        name: model.name,
        tableName: model.table_name,
        primaryKey: model.primary_key,
        columns: params["includeColumns"] != false ? Introspection.column_info(model) : [],
        associations: params["includeAssociations"] != false ? Introspection.association_info(model) : [],
        validations: params["includeValidations"] != false ? Introspection.validation_info(model) : [],
        scopes: params["includeScopes"] != false ? Introspection.scope_info(model) : [],
        enums: params["includeEnums"] != false ? Introspection.enum_info(model) : [],
        callbacks: params["includeCallbacks"] == true ? Introspection.callback_info(model) : [],
        inheritanceColumn: model.inheritance_column,
        abstractClass: model.abstract_class?,
      }
    when "get_table_schema"
      Introspection.table_schema(params["tableName"])
    when "execute_query"
      Introspection.execute_query(params["sql"], params["params"] || [], params["limit"])
    when "reload_environment"
      Introspection.reload_environment(params["force"] == true)
    when "get_model_counts"
      Introspection.model_counts(params["modelNames"], params["where"], params["limit"])
    when "search_models"
      Introspection.search_models(params["pattern"], params["includeColumns"] == true)
    when "get_associations_graph"
      Introspection.associations_graph(params["modelNames"], params["direction"] || "all")
    else
      raise "Unknown method: #{method}"
    end

    { id: id, result: result }.to_json
  rescue StandardError => e
    { id: id, error: { code: -32603, message: e.message, data: e.backtrace&.first(5) } }.to_json
  end
end

# ============================================================================
# Main Loop - Read stdin, process requests, write stdout
# ============================================================================

$stdin.each_line do |line|
  line = line.strip
  next if line.empty?

  begin
    request = JSON.parse(line)
    response = handle_request(request)
    $stdout.puts(response)
    $stdout.flush
  rescue JSON::ParserError => e
    $stdout.puts({ id: nil, error: { code: -32700, message: "Parse error: #{e.message}" } }.to_json)
    $stdout.flush
  rescue StandardError => e
    $stdout.puts({ id: nil, error: { code: -32603, message: "Internal error: #{e.message}" } }.to_json)
    $stdout.flush
  end
end