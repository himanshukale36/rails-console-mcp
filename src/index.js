#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RailsConsole } from './console.js';
import { JSON_BEGIN, JSON_END, extractJson } from './json-io.js';

const RAILS_CWD =
  process.env.RAILS_CONSOLE_MCP_CWD ||
  process.env.RAILS_ROOT ||
  process.cwd();

const RAILS_COMMAND = process.env.RAILS_CONSOLE_MCP_COMMAND || 'bin/rails c';
const RAILS_ENV = process.env.RAILS_CONSOLE_MCP_RAILS_ENV || 'development';

// Any RAILS_CONSOLE_MCP_ENV_<KEY>=<value> on the server env is passed through
// to `rails c` with the prefix stripped.
const DEFAULT_EXTRA_ENV = {};
const EXTRA_ENV_PREFIX = 'RAILS_CONSOLE_MCP_ENV_';
const EXTRA_ENV = {
  ...DEFAULT_EXTRA_ENV,
  ...Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.startsWith(EXTRA_ENV_PREFIX))
      .map(([k, v]) => [k.slice(EXTRA_ENV_PREFIX.length), v])
  ),
};

const console_ = new RailsConsole({
  cwd: RAILS_CWD,
  command: RAILS_COMMAND,
  railsEnv: RAILS_ENV,
  extraEnv: EXTRA_ENV,
});

const server = new Server(
  { name: 'rails-console-mcp', version: '1.0.1' },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: 'rails_eval',
    description:
      'Evaluate Ruby code in a persistent Rails console. ' +
      'The console boots once on first call (seconds to a few minutes depending on app size) and stays warm ' +
      'for the life of this MCP server, so subsequent evaluations return in milliseconds. ' +
      'Returns the captured STDOUT plus the last expression\'s inspected value. Multi-line code, heredocs, ' +
      'and strings containing `;` all work. Rails env, console command, and any pass-through env vars are ' +
      'configured via the RAILS_CONSOLE_MCP_* server env — call rails_status to see the resolved config.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Ruby code to evaluate. Use `puts` for streamed output; the last expression\'s => value is also captured.',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1_000,
          maximum: 3_600_000,
          description: 'Max time to wait for the eval to finish, in ms. Default 120000. Range: 1000 – 3600000.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'rails_tables',
    description:
      'List database tables in this Rails app. Prefer this over guessing table names. ' +
      'Large Rails databases can have many tables, so pass a case-insensitive regex `pattern` to filter (e.g. "user", "^purchase_", "invoice|bill"). ' +
      'Without a pattern, returns the first `limit` tables (default 500) plus the total count. Output is JSON. ' +
      'Requires the console to be booted — call rails_eval first (e.g. `1+1`) if not already warm.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Case-insensitive regex to filter table names. Omit to list everything (capped by `limit`).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 5000,
          description: 'Max tables to return. Default 500. Range: 1 – 5000.',
        },
      },
    },
  },
  {
    name: 'rails_schema',
    description:
      'Return the schema for a single table: columns (name, sql_type, null, default), indices, and foreign keys. ' +
      'Use this before writing an ActiveRecord query so you know the exact column names and types. Output is JSON. ' +
      'Requires the console to be booted — call rails_eval first (e.g. `1+1`) if not already warm.',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'The exact table name (e.g. "users", "purchase_orders"). Use rails_tables to find it first.',
        },
      },
      required: ['table'],
    },
  },
  {
    name: 'rails_models',
    description:
      'List ActiveRecord model classes, their backing table, and their associations. ' +
      'For each matching table, tries to resolve the model class via `table.classify.safe_constantize`; ' +
      'if the class exists and is AR, returns its associations (has_many/belongs_to/etc). ' +
      'Pass a `pattern` regex to filter tables — required in large schemas. Output is JSON. ' +
      'Requires the console to be booted — call rails_eval first (e.g. `1+1`) if not already warm.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Case-insensitive regex to filter tables (and therefore models). Omit to list everything (slow on large schemas).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 2000,
          description: 'Max models to return. Default 100. Range: 1 – 2000.',
        },
      },
    },
  },
  {
    name: 'rails_status',
    description:
      'Report whether the underlying rails console is running, booting, or ready, plus pid, queue depth, and the last boot error if startup failed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'rails_reload',
    description:
      'Run `reload!` in the warm rails console so the next rails_eval picks up recent app-code changes (models, controllers, services, initializers). ' +
      'Fast (~1–5 s) because it does not re-boot Rails. Use this after editing Ruby source files. ' +
      'For gem installs, schema migrations, or a wedged console, use rails_restart instead. ' +
      'Requires the console to be booted — call rails_eval first (e.g. `1+1`) if not already warm; otherwise this returns an error immediately (does NOT trigger a cold boot).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'rails_restart',
    description:
      'Kill and re-spawn the underlying rails console (pays the full boot cost again — seconds to minutes). ' +
      'Use only when the console is wedged, or after a gem install / schema migration where `reload!` is not enough. ' +
      'For plain code edits, prefer rails_reload.',
    inputSchema: { type: 'object', properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

function rubyLiteralString(s) {
  return `%q(${Buffer.from(String(s), 'utf8').toString('base64')}).unpack1(%q(m0))`;
}

function rubyLiteralOrNil(v) {
  return v == null ? 'nil' : rubyLiteralString(v);
}

function clampInt(v, { def, min, max }) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function buildJsonRuby(body) {
  return `
    require 'json'
    _prev_ar = ActiveRecord::Base.logger
    _prev_rl = (Rails.logger if defined?(Rails))
    ActiveRecord::Base.logger = nil
    Rails.logger = Logger.new(IO::NULL) if defined?(Rails)
    begin
      _result = begin
        ${body}
      end
      STDOUT.print("${JSON_BEGIN}")
      STDOUT.print(JSON.pretty_generate(_result))
      STDOUT.print("${JSON_END}\\n")
      STDOUT.flush
    ensure
      ActiveRecord::Base.logger = _prev_ar
      Rails.logger = _prev_rl if defined?(Rails)
    end
    nil
  `;
}

function notBootedResult(tool) {
  return textResult(
    JSON.stringify(
      {
        error: 'console_not_ready',
        tool,
        hint: 'The rails console is not booted yet. Call rails_eval (e.g. `1+1`) once to boot it, then retry this tool.',
      },
      null,
      2
    ),
    true
  );
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'rails_eval') {
      const code = args.code;
      if (typeof code !== 'string' || !code.trim()) {
        return textResult('Error: `code` must be a non-empty string.', true);
      }
      const timeoutMs = clampInt(args.timeout_ms, { def: 120_000, min: 1_000, max: 3_600_000 });
      const output = await console_.evalCode(code, { timeoutMs });
      return textResult(output || '(no output)');
    }
    if (name === 'rails_tables') {
      if (!console_.isReady()) return notBootedResult('rails_tables');
      const pattern = rubyLiteralOrNil(args.pattern);
      const limit = clampInt(args.limit, { def: 500, min: 1, max: 5000 });
      const ruby = buildJsonRuby(`
        _pat = ${pattern}
        _rx  = _pat ? Regexp.new(_pat, Regexp::IGNORECASE) : nil
        _all = ActiveRecord::Base.connection.tables.sort
        _filtered = _rx ? _all.grep(_rx) : _all
        _limit = ${limit}
        {
          total_tables_in_db: _all.size,
          matched: _filtered.size,
          returned: [_filtered.size, _limit].min,
          truncated: _filtered.size > _limit,
          tables: _filtered.first(_limit)
        }
      `);
      const output = await console_.evalCode(ruby, { timeoutMs: 60_000 });
      return textResult(extractJson(output) || '(no output)');
    }
    if (name === 'rails_schema') {
      if (!args.table || typeof args.table !== 'string') {
        return textResult('Error: `table` is required and must be a string.', true);
      }
      if (!console_.isReady()) return notBootedResult('rails_schema');
      const table = rubyLiteralString(args.table);
      const ruby = buildJsonRuby(`
        _t = ${table}
        _conn = ActiveRecord::Base.connection
        if !_conn.tables.include?(_t)
          { error: "table not found", table: _t }
        else
          _cols = _conn.columns(_t).map { |c|
            { name: c.name, sql_type: c.sql_type, type: c.type.to_s, null: c.null, default: c.default }
          }
          _pk  = (_conn.primary_key(_t) rescue nil)
          _idx = (_conn.indexes(_t) rescue []).map { |i|
            { name: i.name, columns: Array(i.columns), unique: i.unique }
          }
          _fks = (_conn.foreign_keys(_t) rescue []).map { |f|
            { from_column: f.column, to_table: f.to_table, to_column: (f.primary_key rescue nil) }
          }
          {
            table: _t,
            primary_key: _pk,
            columns: _cols,
            indices: _idx,
            foreign_keys: _fks
          }
        end
      `);
      const output = await console_.evalCode(ruby, { timeoutMs: 60_000 });
      return textResult(extractJson(output) || '(no output)');
    }
    if (name === 'rails_models') {
      if (!console_.isReady()) return notBootedResult('rails_models');
      const pattern = rubyLiteralOrNil(args.pattern);
      const limit = clampInt(args.limit, { def: 100, min: 1, max: 2000 });
      const ruby = buildJsonRuby(`
        _pat = ${pattern}
        _rx  = _pat ? Regexp.new(_pat, Regexp::IGNORECASE) : nil
        _all_matched = ActiveRecord::Base.connection.tables.sort
        _all_matched = _all_matched.grep(_rx) if _rx
        _limit = ${limit}
        _truncated = _all_matched.size > _limit
        _tables = _all_matched.first(_limit)
        _out = _tables.map { |t|
          _klass = (t.classify.safe_constantize rescue nil)
          _is_ar = (_klass && _klass.respond_to?(:ancestors) && _klass.ancestors.include?(ActiveRecord::Base)) rescue false
          if _is_ar
            _assocs = (_klass.reflect_on_all_associations.map { |a|
              { name: a.name.to_s, kind: a.macro.to_s, class_name: (a.class_name rescue nil), through: (a.options[:through].to_s if a.options[:through]) }.compact
            } rescue [])
            { table: t, class: _klass.name, associations: _assocs }
          else
            { table: t, class: nil, associations: [] }
          end
        }
        {
          matched: _all_matched.size,
          returned: _out.size,
          truncated: _truncated,
          models: _out
        }
      `);
      const output = await console_.evalCode(ruby, { timeoutMs: 120_000 });
      return textResult(extractJson(output) || '(no output)');
    }
    if (name === 'rails_status') {
      return textResult(JSON.stringify(console_.status(), null, 2));
    }
    if (name === 'rails_reload') {
      if (!console_.isReady()) return notBootedResult('rails_reload');
      const t0 = Date.now();
      const ruby = buildJsonRuby(`
        _err = nil
        _reloaded = false
        begin
          reload!
          _reloaded = true
        rescue NoMethodError, NameError => e
          if defined?(Rails) && Rails.respond_to?(:application) && Rails.application.respond_to?(:reloader)
            Rails.application.reloader.reload!
            _reloaded = true
          else
            _err = "reload! not available and Rails reloader missing"
          end
        rescue => e
          _err = "#{e.class}: #{e.message}"
        end
        { reloaded: _reloaded, error: _err }
      `);
      const output = await console_.evalCode(ruby, { timeoutMs: 60_000 });
      const elapsed_ms = Date.now() - t0;
      const payload = extractJson(output);
      try {
        const parsed = JSON.parse(payload);
        return textResult(JSON.stringify({ ...parsed, elapsed_ms }, null, 2));
      } catch {
        return textResult(payload || `(no output, ${elapsed_ms} ms)`);
      }
    }
    if (name === 'rails_restart') {
      await console_.restart();
      return textResult('rails console restarted; ready.');
    }
    return textResult(`Unknown tool: ${name}`, true);
  } catch (err) {
    return textResult(`Error: ${err?.message ?? String(err)}`, true);
  }
});

function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

const shutdown = () => {
  console_.shutdown();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
