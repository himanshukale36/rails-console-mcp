#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./utils/config.js";
import { initLogger, getLogger } from "./utils/logger.js";
import { PostgresConnector } from "./connector/postgres.js";
import { registerTools } from "./tools/index.js";
import { Config } from "./types/config.js";

/**
 * Rails Console MCP Server
 * JavaScript-only MCP server for PostgreSQL-backed Rails applications
 */

class RailsConsoleMCPServer {
  private server: Server;
  private db: PostgresConnector;
  private config: Config;
  private logger = getLogger().child({ component: "MCPServer" });

  constructor(config: Config) {
    this.config = config;

    // Initialize logger
    initLogger(config.logging);

    // Create MCP server
    this.server = new Server(
      {
        name: "rails-console-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.db = new PostgresConnector(config);

    // Register tools
    registerTools(this.server, this.db, config);

    // Setup shutdown handlers
    this.setupShutdownHandlers();
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down...`);

      await this.db.stop();

      // Close MCP server
      await this.server.close();

      this.logger.info("Shutdown complete");
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      this.logger.error("Uncaught exception", { error: error.message, stack: error.stack });
      shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      this.logger.error("Unhandled rejection", { reason: String(reason) });
      shutdown("unhandledRejection");
    });
  }

  async start(): Promise<void> {
    this.logger.info("Starting Rails Console MCP Server", {
      databaseSchema: this.config.databaseSchema,
    });

    await this.db.start();

    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info("Rails Console MCP Server started successfully");
    this.logger.info("Ready to accept connections from MCP clients (Claude Desktop, Cursor, etc.)");
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" || args[i] === "-c") {
      configPath = args[i + 1];
      break;
    }
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Rails Console MCP Server - PostgreSQL database inspection

Usage:
  rails-console-mcp [options]

Options:
  -c, --config <path>    Path to config.json file
  -h, --help             Show this help message

Configuration:
  The server looks for config.json in these locations (in order):
  1. ./config.json
  2. ./config.local.json
  3. ~/.config/rails-console-mcp/config.json
  4. /etc/rails-console-mcp/config.json

  Or specify with --config flag.

Example config.json:
{
  "databaseUrl": "postgresql://user:password@localhost:5432/rails_app",
  "databaseSchema": "public",
  "maxRows": 100,
  "queryTimeoutSeconds": 30
}

MCP Client Configuration (Claude Desktop, Cursor, etc.):
{
  "mcpServers": {
    "rails-console": {
      "command": "node",
      "args": ["/path/to/rails-console-mcp/dist/index.js"]
    }
  }
}
      `);
      process.exit(0);
    }
  }

  try {
    // Load configuration
    const config = loadConfig(configPath);

    // Create and start server
    const server = new RailsConsoleMCPServer(config);
    await server.start();
  } catch (error) {
    const logger = getLogger();
    logger.error("Failed to start server", { error: String(error) });
    process.exit(1);
  }
}

// Run if this is the main module
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
