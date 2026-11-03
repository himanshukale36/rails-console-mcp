import { z } from "zod";

/**
 * Configuration schema for the Rails Console MCP Server
 * Works with ANY Rails application via config file
 */
export const ConfigSchema = z.object({
  /** PostgreSQL connection URL (Rails DATABASE_URL format) */
  databaseUrl: z.string().url("databaseUrl must be a PostgreSQL URL").optional(),

  /** Maximum rows returned by execute_query */
  maxRows: z.number().int().positive().default(100),

  /** Query timeout in seconds */
  queryTimeoutSeconds: z.number().int().positive().default(30),

  /** Database schema used for Rails tables */
  databaseSchema: z.string().default("public"),

  /** Logging configuration */
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      includeTimestamps: z.boolean().default(true),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<Config> = {
  maxRows: 100,
  queryTimeoutSeconds: 30,
  databaseSchema: "public",
  logging: {
    level: "info",
    includeTimestamps: true,
  },
};

/**
 * Configuration file paths (in order of precedence)
 */
export const CONFIG_PATHS = [
  "./config.json",
  "./config.local.json",
  `${process.env.HOME || ""}/.config/rails-console-mcp/config.json`,
  "/etc/rails-console-mcp/config.json",
] as const;
