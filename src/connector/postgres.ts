import { Pool, QueryResult as PgResult } from "pg";
import { Config } from "../types/config.js";

export class PostgresConnector {
  private pool: Pool;

  constructor(private config: Config) {
    const connectionString = config.databaseUrl || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Set databaseUrl in config or DATABASE_URL in the environment");
    this.pool = new Pool({ connectionString, connectionTimeoutMillis: config.queryTimeoutSeconds * 1000,
      statement_timeout: config.queryTimeoutSeconds * 1000, options: "-c default_transaction_read_only=on" });
  }

  async start(): Promise<void> { await this.pool.query("SELECT 1"); }
  async stop(): Promise<void> { await this.pool.end(); }

  async listTables(pattern?: string) {
    const { rows } = await this.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      [this.config.databaseSchema]);
    return rows.map((r) => ({ name: r.table_name as string, tableName: r.table_name as string }))
      .filter((r) => !pattern || new RegExp(pattern, "i").test(r.name));
  }

  async getTableSchema(tableName: string) {
    const { rows: cols } = await this.pool.query(`SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
      c.character_maximum_length, c.numeric_precision, c.numeric_scale,
      EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints t
       ON t.constraint_name=k.constraint_name AND t.table_schema=k.table_schema
       WHERE t.constraint_type='PRIMARY KEY' AND k.table_schema=c.table_schema AND k.table_name=c.table_name AND k.column_name=c.column_name) AS primary_key
      FROM information_schema.columns c WHERE c.table_schema=$1 AND c.table_name=$2 ORDER BY c.ordinal_position`,
      [this.config.databaseSchema, tableName]);
    if (!cols.length) throw new Error(`Table not found: ${tableName}`);
    const { rows: indexes } = await this.pool.query(`SELECT i.relname AS name, array_agg(a.attname ORDER BY x.n) AS columns,
      ix.indisunique AS unique FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_index ix ON ix.indrelid=t.oid
      JOIN pg_class i ON i.oid=ix.indexrelid JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY x(attnum,n) ON true
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=x.attnum WHERE n.nspname=$1 AND t.relname=$2 GROUP BY i.relname,ix.indisunique`,
      [this.config.databaseSchema, tableName]);
    const { rows: foreignKeys } = await this.pool.query(`SELECT tc.constraint_name AS name, kcu.column_name AS column,
      ccu.table_name AS "referencedTable", ccu.column_name AS "referencedColumn" FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu USING (constraint_name,table_schema,table_name)
      JOIN information_schema.constraint_column_usage ccu USING (constraint_name,table_schema)
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2`, [this.config.databaseSchema, tableName]);
    return { tableName, columns: cols.map((c) => ({ name: c.column_name, type: c.udt_name, sqlType: c.data_type,
      null: c.is_nullable === "YES", default: c.column_default, limit: c.character_maximum_length,
      precision: c.numeric_precision, scale: c.numeric_scale, primaryKey: c.primary_key,
      autoIncrement: String(c.column_default || "").includes("nextval("), indexed: indexes.some((i) => i.columns.includes(c.column_name)) })),
      indexes, foreignKeys, primaryKeys: cols.filter((c) => c.primary_key).map((c) => c.column_name) };
  }

  async query(sql: string, params: unknown[] = [], limit = this.config.maxRows) {
    const safeLimit = Math.max(1, Math.min(limit, this.config.maxRows));
    const limitedSql = /\blimit\s+\d+\s*$/i.test(sql) ? sql : `${sql} LIMIT ${safeLimit}`;
    const start = Date.now();
    const result: PgResult = await this.pool.query(limitedSql, params);
    return { columns: result.fields.map((f) => f.name), rows: result.rows, rowCount: result.rowCount || 0,
      truncated: (result.rowCount || 0) >= safeLimit, executionTimeMs: Date.now() - start };
  }

  async count(tableName: string) {
    // Quote identifier safely; table must exist in configured schema.
    const exists = await this.pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2", [this.config.databaseSchema, tableName]);
    if (!exists.rowCount) throw new Error(`Table not found: ${tableName}`);
    const { rows } = await this.pool.query(`SELECT count(*)::bigint AS count FROM "${this.config.databaseSchema.replaceAll('"','""')}"."${tableName.replaceAll('"','""')}"`);
    return { tableName, count: Number(rows[0].count) };
  }
}
