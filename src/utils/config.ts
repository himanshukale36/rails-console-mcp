import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { ConfigSchema, Config, DEFAULT_CONFIG, CONFIG_PATHS } from "../types/config.js";


/**
 * Load configuration from file with fallback paths
 */
export function loadConfig(configPath?: string): Config {
  const envConfig = process.env.RAILS_CONSOLE_MCP_CONFIG;
  const pathsToTry = configPath
    ? [configPath]
    : envConfig
      ? [envConfig]
      : CONFIG_PATHS.map((p) => resolve(process.cwd(), p));

  let rawConfig: Record<string, unknown> = {};

  for (const path of pathsToTry) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        rawConfig = JSON.parse(content);
        console.error(`[Config] Loaded configuration from: ${path}`);
        break;
      } catch (e) {
        console.error(`[Config] Failed to parse ${path}: ${e}`);
      }
    }
  }

  // Merge with defaults
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(rawConfig.logging as Record<string, unknown>),
    },
  };

  // Validate with Zod
  const result = ConfigSchema.safeParse(mergedConfig);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  if (!result.data.databaseUrl && !process.env.DATABASE_URL) {
    throw new Error("Set databaseUrl in the config file or DATABASE_URL in the environment");
  }
  return result.data;
}

/**
 * Create example configuration file
 */
export function createExampleConfig(outputPath: string): void {
  const example = {
    databaseUrl: "postgresql://user:password@localhost:5432/rails_app",
    maxRows: 100,
    queryTimeoutSeconds: 30,
    databaseSchema: "public",
    logging: {
      level: "info",
      includeTimestamps: true,
    },
  };

  const content = JSON.stringify(example, null, 2);
  // Note: In actual implementation, you'd write this file
  console.error(`Example config:\n${content}`);
}
