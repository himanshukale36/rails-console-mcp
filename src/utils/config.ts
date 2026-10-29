import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ConfigSchema, Config, DEFAULT_CONFIG, CONFIG_PATHS } from "../types/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load configuration from file with fallback paths
 */
export function loadConfig(configPath?: string): Config {
  const pathsToTry = configPath
    ? [configPath]
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
    sidecar: {
      ...DEFAULT_CONFIG.sidecar,
      ...(rawConfig.sidecar as Record<string, unknown>),
    },
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

  // Validate railsAppPath exists
  const railsAppPath = resolve(result.data.railsAppPath);
  if (!existsSync(railsAppPath)) {
    throw new Error(`Rails app path does not exist: ${railsAppPath}`);
  }

  // Validate environment is allowed
  if (!result.data.allowedEnvironments.includes(result.data.environment)) {
    throw new Error(
      `Environment "${result.data.environment}" is not allowed. ` +
        `Allowed: ${result.data.allowedEnvironments.join(", ")}`
    );
  }

  // Warn if production with readOnly=false
  if (result.data.environment === "production" && !result.data.readOnly) {
    console.error(
      "[Config] WARNING: Running in production with readOnly=false. " +
        "This allows destructive operations!"
    );
  }

  return {
    ...result.data,
    railsAppPath,
  };
}

/**
 * Create example configuration file
 */
export function createExampleConfig(outputPath: string): void {
  const example = {
    railsAppPath: "/path/to/your/rails/app",
    environment: "development",
    readOnly: true,
    maxRows: 100,
    queryTimeoutSeconds: 30,
    allowedEnvironments: ["development", "test"],
    sidecar: {
      rubyPath: undefined,
      startupTimeoutSeconds: 30,
      logStderr: true,
    },
    logging: {
      level: "info",
      includeTimestamps: true,
    },
  };

  const content = JSON.stringify(example, null, 2);
  // Note: In actual implementation, you'd write this file
  console.error(`Example config:\n${content}`);
}