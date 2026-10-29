import { z } from "zod";

/**
 * Base response type for all tools
 */
export const ToolResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  meta: z
    .object({
      executionTimeMs: z.number().optional(),
      rowCount: z.number().optional(),
      truncated: z.boolean().optional(),
    })
    .optional(),
});

export type ToolResponse = z.infer<typeof ToolResponseSchema>;

/**
 * Model summary (lightweight, for list_models)
 */
export const ModelSummarySchema = z.object({
  name: z.string(),
  tableName: z.string(),
  columnCount: z.number().int(),
  associationCount: z.number().int(),
  hasScopes: z.boolean(),
  hasEnums: z.boolean(),
  hasCallbacks: z.boolean(),
});

export type ModelSummary = z.infer<typeof ModelSummarySchema>;

/**
 * Column definition
 */
export const ColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  sqlType: z.string(),
  null: z.boolean(),
  default: z.unknown().nullable(),
  limit: z.number().int().nullable(),
  precision: z.number().int().nullable(),
  scale: z.number().int().nullable(),
  primaryKey: z.boolean(),
  autoIncrement: z.boolean(),
  indexed: z.boolean(),
  comment: z.string().nullable().optional(),
});

export type Column = z.infer<typeof ColumnSchema>;

/**
 * Association definition
 */
export const AssociationSchema = z.object({
  name: z.string(),
  macro: z.enum([
    "has_many",
    "has_one",
    "belongs_to",
    "has_and_belongs_to_many",
    "has_many_through",
  ]),
  className: z.string(),
  foreignKey: z.string().nullable(),
  primaryKey: z.string().nullable(),
  through: z.string().nullable(),
  source: z.string().nullable(),
  dependent: z.string().nullable(),
  inverseOf: z.string().nullable(),
  counterCache: z.union([z.boolean(), z.string()]).nullable(),
  polymorphic: z.boolean(),
  as: z.string().nullable(),
  scope: z.string().nullable().optional(),
  options: z.record(z.unknown()).optional(),
});

export type Association = z.infer<typeof AssociationSchema>;

/**
 * Validation definition
 */
export const ValidationSchema = z.object({
  name: z.string(),
  kind: z.string(),
  attributes: z.array(z.string()),
  options: z.record(z.unknown()),
  message: z.string().nullable().optional(),
});

export type Validation = z.infer<typeof ValidationSchema>;

/**
 * Scope definition
 */
export const ScopeSchema = z.object({
  name: z.string(),
  type: z.enum(["scope", "default_scope"]),
  body: z.string().nullable().optional(),
  whereValues: z.record(z.unknown()).optional(),
  orderValues: z.array(z.string()).optional(),
  limitValue: z.number().int().nullable().optional(),
  offsetValue: z.number().int().nullable().optional(),
  joinsValues: z.array(z.string()).optional(),
  includesValues: z.array(z.string()).optional(),
});

export type Scope = z.infer<typeof ScopeSchema>;

/**
 * Enum definition
 */
export const EnumSchema = z.object({
  name: z.string(),
  values: z.record(z.string(), z.number().int()),
  suffix: z.boolean().nullable().optional(),
  prefix: z.boolean().nullable().optional(),
});

export type Enum = z.infer<typeof EnumSchema>;

/**
 * Callback definition
 */
export const CallbackSchema = z.object({
  name: z.string(),
  kind: z.enum([
    "before_validation",
    "after_validation",
    "before_save",
    "after_save",
    "before_create",
    "after_create",
    "before_update",
    "after_update",
    "before_destroy",
    "after_destroy",
    "after_initialize",
    "after_find",
    "after_touch",
    "after_commit",
    "after_rollback",
  ]),
  method: z.string(),
  conditions: z.record(z.unknown()).optional(),
});

export type Callback = z.infer<typeof CallbackSchema>;

/**
 * Full model schema (for get_model_schema)
 */
export const ModelSchemaSchema = z.object({
  name: z.string(),
  tableName: z.string(),
  primaryKey: z.string(),
  columns: z.array(ColumnSchema),
  associations: z.array(AssociationSchema),
  validations: z.array(ValidationSchema),
  scopes: z.array(ScopeSchema),
  enums: z.array(EnumSchema),
  callbacks: z.array(CallbackSchema),
  inheritanceColumn: z.string().nullable().optional(),
  abstractClass: z.boolean(),
  anonymous: z.boolean().optional(),
});

export type ModelSchema = z.infer<typeof ModelSchemaSchema>;

/**
 * Table schema (raw database, for get_table_schema)
 */
export const TableSchemaSchema = z.object({
  tableName: z.string(),
  columns: z.array(ColumnSchema),
  indexes: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.string()),
      unique: z.boolean(),
      type: z.string().optional(),
      where: z.string().nullable().optional(),
    })
  ),
  foreignKeys: z.array(
    z.object({
      name: z.string(),
      column: z.string(),
      referencedTable: z.string(),
      referencedColumn: z.string(),
      onDelete: z.string().nullable().optional(),
      onUpdate: z.string().nullable().optional(),
    })
  ),
  primaryKeys: z.array(z.string()),
});

export type TableSchema = z.infer<typeof TableSchemaSchema>;

/**
 * Query result (for execute_query)
 */
export const QueryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  rowCount: z.number().int(),
  truncated: z.boolean(),
  executionTimeMs: z.number(),
});

export type QueryResult = z.infer<typeof QueryResultSchema>;

/**
 * Model count result (for get_model_counts)
 */
export const ModelCountSchema = z.object({
  modelName: z.string(),
  tableName: z.string(),
  count: z.number().int(),
  whereClause: z.string().nullable().optional(),
});

export type ModelCount = z.infer<typeof ModelCountSchema>;

/**
 * Association graph (for get_associations_graph)
 */
export const AssociationGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      tableName: z.string(),
      columnCount: z.number().int(),
    })
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string(),
      macro: z.string(),
      foreignKey: z.string().nullable(),
    })
  ),
});

export type AssociationGraph = z.infer<typeof AssociationGraphSchema>;

/**
 * Tool input schemas (for MCP tool definitions)
 */
export const ListModelsInputSchema = z.object({
  pattern: z.string().optional(),
  includeAbstract: z.boolean().default(false),
});

export const GetModelSchemaInputSchema = z.object({
  modelName: z.string(),
  includeColumns: z.boolean().default(true),
  includeAssociations: z.boolean().default(true),
  includeValidations: z.boolean().default(true),
  includeScopes: z.boolean().default(true),
  includeEnums: z.boolean().default(true),
  includeCallbacks: z.boolean().default(false),
});

export const GetTableSchemaInputSchema = z.object({
  tableName: z.string(),
});

export const ExecuteQueryInputSchema = z.object({
  sql: z.string(),
  params: z.array(z.unknown()).optional(),
  limit: z.number().int().positive().optional(),
});

export const ReloadEnvironmentInputSchema = z.object({
  force: z.boolean().default(false),
});

export const GetModelCountsInputSchema = z.object({
  modelNames: z.array(z.string()).optional(),
  where: z.record(z.unknown()).optional(),
  limit: z.number().int().positive().optional(),
});

export const SearchModelsInputSchema = z.object({
  pattern: z.string(),
  includeColumns: z.boolean().default(false),
});

export const GetAssociationsGraphInputSchema = z.object({
  modelNames: z.array(z.string()).optional(),
  direction: z.enum(["all", "outgoing", "incoming"]).default("all"),
});