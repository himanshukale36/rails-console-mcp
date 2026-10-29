import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RubySidecar } from "../connector/ruby-sidecar.js";
import { Config } from "../types/config.js";
import { getLogger } from "../utils/logger.js";
import {
  ListModelsInputSchema,
  GetModelSchemaInputSchema,
  GetTableSchemaInputSchema,
  ExecuteQueryInputSchema,
  ReloadEnvironmentInputSchema,
  GetModelCountsInputSchema,
  SearchModelsInputSchema,
  GetAssociationsGraphInputSchema,
  ModelSummary,
  ModelSchema,
  TableSchema,
  QueryResult,
  ModelCount,
  AssociationGraph,
} from "../types/tools.js";

const logger = getLogger().child({ component: "Tools" });

/**
 * Tool definitions for MCP
 */
const TOOL_DEFINITIONS = [
  {
    name: "list_models",
    title: "List Rails Models",
    description:
      "List all ActiveRecord models in the Rails application with summary metadata. " +
      "Supports filtering by name pattern.",
    inputSchema: ListModelsInputSchema.shape,
  },
  {
    name: "get_model_schema",
    title: "Get Model Schema",
    description:
      "Get complete ActiveRecord model definition including columns, associations, " +
      "validations, scopes, enums, and callbacks. All sections optional for token efficiency.",
    inputSchema: GetModelSchemaInputSchema.shape,
  },
  {
    name: "get_table_schema",
    title: "Get Table Schema",
    description:
      "Get raw database table schema including columns, indexes, foreign keys, " +
      "and primary keys. Does not require ActiveRecord model to exist.",
    inputSchema: GetTableSchemaInputSchema.shape,
  },
  {
    name: "execute_query",
    title: "Execute Read-Only Query",
    description:
      "Execute a read-only SELECT query against the Rails database. " +
      "Automatically enforces LIMIT and blocks DDL/DML operations. " +
      "Use parameterized queries with params array for safety.",
    inputSchema: ExecuteQueryInputSchema.shape,
  },
  {
    name: "reload_environment",
    title: "Reload Rails Environment",
    description:
      "Reload the Rails application code (Zeitwerk autoloader). " +
      "Only works in development/test environments unless forced. " +
      "Use after making code changes to see updated model definitions.",
    inputSchema: ReloadEnvironmentInputSchema.shape,
  },
  {
    name: "get_model_counts",
    title: "Get Model Row Counts",
    description:
      "Get row counts for one or more models with optional WHERE clause. " +
      "Useful for quick data volume checks without full queries.",
    inputSchema: GetModelCountsInputSchema.shape,
  },
  {
    name: "search_models",
    title: "Search Models",
    description:
      "Search for models by name or table name pattern (case-insensitive regex). " +
      "Optionally include column details in results.",
    inputSchema: SearchModelsInputSchema.shape,
  },
  {
    name: "get_associations_graph",
    title: "Get Associations Graph",
    description:
      "Get a graph representation of model associations for visualization. " +
      "Returns nodes (models) and edges (associations). " +
      "Filter by model names and direction (all/outgoing/incoming).",
    inputSchema: GetAssociationsGraphInputSchema.shape,
  },
] as const;

/**
 * Register all MCP tools with the server
 */
export function registerTools(server: Server, sidecar: RubySidecar, config: Config): void {
  // Handle ListTools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // Handle CallTool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "list_models": {
          const models = await sidecar.listModels(
            args?.pattern as string | undefined,
            args?.includeAbstract as boolean | undefined
          );
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: models }, null, 2) }],
          };
        }

        case "get_model_schema": {
          const schema = await sidecar.getModelSchema(args?.modelName as string, {
            includeColumns: args?.includeColumns as boolean | undefined,
            includeAssociations: args?.includeAssociations as boolean | undefined,
            includeValidations: args?.includeValidations as boolean | undefined,
            includeScopes: args?.includeScopes as boolean | undefined,
            includeEnums: args?.includeEnums as boolean | undefined,
            includeCallbacks: args?.includeCallbacks as boolean | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: schema }, null, 2) }],
          };
        }

        case "get_table_schema": {
          const schema = await sidecar.getTableSchema(args?.tableName as string);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: schema }, null, 2) }],
          };
        }

        case "execute_query": {
          const sql = (args?.sql as string)?.trim();
          if (!sql || !/^\s*SELECT\s+/i.test(sql)) {
            throw new Error("Only SELECT queries are allowed");
          }
          if (/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)\b/i.test(sql)) {
            throw new Error("DDL/DML operations are not allowed");
          }

          const result = await sidecar.executeQuery(
            sql,
            (args?.params as unknown[]) || [],
            args?.limit as number | undefined
          );
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: result }, null, 2) }],
          };
        }

        case "reload_environment": {
          const result = await sidecar.reloadEnvironment(args?.force as boolean | undefined);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: result }, null, 2) }],
          };
        }

        case "get_model_counts": {
          const counts = await sidecar.getModelCounts(
            args?.modelNames as string[] | undefined,
            args?.where as Record<string, unknown> | undefined,
            args?.limit as number | undefined
          );
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: counts }, null, 2) }],
          };
        }

        case "search_models": {
          const models = await sidecar.searchModels(
            args?.pattern as string,
            args?.includeColumns as boolean | undefined
          );
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: models }, null, 2) }],
          };
        }

        case "get_associations_graph": {
          const graph = await sidecar.getAssociationsGraph(
            args?.modelNames as string[] | undefined,
            args?.direction as "all" | "outgoing" | "incoming" | undefined
          );
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, data: graph }, null, 2) }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      logger.error(`Tool ${name} failed`, { error: String(error) });
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }, null, 2) }],
        isError: true,
      };
    }
  });

  logger.info("All MCP tools registered", { count: TOOL_DEFINITIONS.length });
}