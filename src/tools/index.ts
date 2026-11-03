import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PostgresConnector } from "../connector/postgres.js";
import { Config } from "../types/config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger().child({ component: "Tools" });
const tableInput = z.object({ tableName: z.string().min(1) });
const queryInput = z.object({ sql: z.string().min(1), params: z.array(z.unknown()).optional(), limit: z.number().int().positive().optional() });
const tableListInput = z.object({ pattern: z.string().optional() });
const tools = [
  { name: "list_tables", description: "List database tables in the configured schema.", inputSchema: { type: "object", properties: { pattern: { type: "string" } } } },
  { name: "get_table_schema", description: "Get columns, indexes, primary key, and foreign keys for a table.", inputSchema: { type: "object", properties: { tableName: { type: "string" } }, required: ["tableName"] } },
  { name: "execute_query", description: "Run one read-only SELECT query. Parameters use PostgreSQL $1, $2 placeholders.", inputSchema: { type: "object", properties: { sql: { type: "string" }, params: { type: "array" }, limit: { type: "integer", minimum: 1 } }, required: ["sql"] } },
  { name: "get_table_count", description: "Count rows in a table.", inputSchema: { type: "object", properties: { tableName: { type: "string" } }, required: ["tableName"] } },
];

export function registerTools(server: Server, db: PostgresConnector, _config: Config): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      let data: unknown;
      switch (params.name) {
        case "list_tables": {
          const { pattern } = tableListInput.parse(params.arguments || {});
          data = await db.listTables(pattern); break;
        }
        case "get_table_schema": {
          const { tableName } = tableInput.parse(params.arguments);
          data = await db.getTableSchema(tableName); break;
        }
        case "get_table_count": {
          const { tableName } = tableInput.parse(params.arguments);
          data = await db.count(tableName); break;
        }
        case "execute_query": {
          const { sql, params: values, limit } = queryInput.parse(params.arguments);
          // Only a single SELECT statement is accepted; PostgreSQL also enforces read-only transactions.
          if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*|\*\/|\b(WITH|INTO|FOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE))\b/i.test(sql)) throw new Error("Only a single plain SELECT query is allowed");
          data = await db.query(sql, values as unknown[], limit); break;
        }
        default: throw new Error(`Unknown tool: ${params.name}`);
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }] };
    } catch (error) {
      logger.error(`Tool ${params.name} failed`, { error: String(error) });
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }, null, 2) }], isError: true };
    }
  });
}
