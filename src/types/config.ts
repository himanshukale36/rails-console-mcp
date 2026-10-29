import { z } from "zod";

/**
 * Configuration schema for the Rails Console MCP Server
 * Works with ANY Rails application via config file
 */
export const ConfigSchema = z.object({
  /** Absolute path to the Rails application root directory */
  railsAppPath: z.string().min(1, "railsAppPath is required"),

  /** Rails environment to load (development, test, production) */
  environment: z
    .enum(["development", "test", "production"])
    .default("development"),

  /** Whether to enforce read-only mode (blocks DDL/DML) */
  readOnly: z.boolean().default(true),

  /** Maximum rows returned by execute_query */
  maxRows: z.number().int().positive().default(100),

  /** Query timeout in seconds */
  queryTimeoutSeconds: z.number().int().positive().default(30),

  /** Allowed environments (production requires explicit opt-in) */
  allowedEnvironments: z
    .array(z.enum(["development", "test", "production"]))
    .default(["development", "test"]),

  /** Ruby sidecar configuration */
  sidecar: z
    .object({
      /** Path to ruby executable (auto-detected if not specified) */
      rubyPath: z.string().optional(),
      /** Timeout for sidecar startup in seconds */
      startupTimeoutSeconds: z.number().int().positive().default(30),
      /** Log sidecar stderr to MCP server logs */
      logStderr: z.boolean().default(true),
    })
    .default({}),

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
  environment: "development",
  readOnly: true,
  maxRows: 100,
  queryTimeoutSeconds: 30,
  allowedEnvironments: ["development", "test"],
  sidecar: {
    startupTimeoutSeconds: 30,
    logStderr: true,
  },
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
  `${process.env.HOME}/.config/rails-console-mcp/config.json`,
  "/etc/rails-console-mcp/config.json",
] as const;