import { beforeEach, describe, expect, it, vi } from "vitest";

const poolMock = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({ Pool: vi.fn(() => poolMock) }));

import { PostgresConnector } from "./postgres.js";
import { Config } from "../types/config.js";

const config = {
  databaseUrl: "postgresql://user:pass@localhost/db",
  databaseSchema: "public",
  maxRows: 50,
  queryTimeoutSeconds: 5,
  logging: { level: "info", includeTimestamps: true },
} as Config;

describe("PostgresConnector", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("uses a read-only PostgreSQL session and configured timeouts", async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [{ value: 1 }] });
    const connector = new PostgresConnector(config);
    await connector.start();
    const { Pool } = await import("pg");
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      options: "-c default_transaction_read_only=on",
    }));
    expect(poolMock.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("lists tables and applies an optional regex filter", async () => {
    poolMock.query.mockResolvedValue({ rows: [{ table_name: "users" }, { table_name: "invoices" }] });
    const result = await new PostgresConnector(config).listTables("user");
    expect(result).toEqual([{ name: "users", tableName: "users" }]);
    expect(poolMock.query.mock.calls[0][1]).toEqual(["public"]);
  });

  it("maps columns, indexes and foreign keys into table schema", async () => {
    poolMock.query
      .mockResolvedValueOnce({ rows: [{ column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO", column_default: "nextval('users_id_seq')", primary_key: true }] })
      .mockResolvedValueOnce({ rows: [{ name: "users_pkey", columns: ["id"], unique: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await new PostgresConnector(config).getTableSchema("users");
    expect(result.primaryKeys).toEqual(["id"]);
    expect(result.columns[0]).toMatchObject({ name: "id", primaryKey: true, autoIncrement: true, indexed: true });
    expect(result.indexes[0].unique).toBe(true);
  });

  it("fails for missing tables", async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [] });
    await expect(new PostgresConnector(config).getTableSchema("missing")).rejects.toThrow("Table not found: missing");
  });

  it("adds and caps row limits, returning query metadata", async () => {
    poolMock.query.mockResolvedValueOnce({ fields: [{ name: "id" }], rows: [{ id: 1 }], rowCount: 1 });
    const result = await new PostgresConnector(config).query("SELECT id FROM users", [], 500);
    expect(poolMock.query).toHaveBeenCalledWith("SELECT id FROM users LIMIT 50", []);
    expect(result).toMatchObject({ columns: ["id"], rows: [{ id: 1 }], rowCount: 1, truncated: false });
  });

  it("quotes table and schema identifiers and verifies existence for count", async () => {
    poolMock.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }).mockResolvedValueOnce({ rows: [{ count: "7" }] });
    const result = await new PostgresConnector({ ...config, databaseSchema: 'odd"schema' }).count('user"data');
    expect(poolMock.query.mock.calls[1][0]).toContain('"odd""schema"."user""data"');
    expect(result.count).toBe(7);
  });

  it("requires a connection URL", () => {
    const prior = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => new PostgresConnector({ ...config, databaseUrl: undefined })).toThrow("Set databaseUrl");
    if (prior !== undefined) process.env.DATABASE_URL = prior;
  });
});
