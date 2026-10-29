#!/usr/bin/env node
/**
 * Test client for Rails Console MCP Server
 * Sends JSON-RPC requests via stdin/stdout
 */

import { spawn } from "child_process";

interface MCPRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let requestId = 0;

function sendRequest(server: ReturnType<typeof spawn>, method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
  const id = ++requestId;
  const request: MCPRequest = { jsonrpc: "2.0", id, method, params };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request timeout: ${method}`));
    }, 30000);

    const onData = (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: MCPResponse = JSON.parse(line);
          if (response.id === id) {
            clearTimeout(timeout);
            server.stdout.removeListener("data", onData);
            resolve(response);
            return;
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    };

    server.stdout.on("data", onData);
    server.stdin.write(JSON.stringify(request) + "\n");
  });
}

async function main() {
  console.error("Starting MCP server...");

  const server = spawn("node", ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: "/home/himanshu/projects/rails-console-mcp",
  });

  // Log stderr
  server.stderr.on("data", (data) => {
    console.error("[SERVER]", data.toString().trim());
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    // Initialize
    console.error("\n=== Testing initialize ===");
    const initResponse = await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    console.log("Initialize:", JSON.stringify(initResponse, null, 2));

    // List tools
    console.error("\n=== Testing tools/list ===");
    const toolsResponse = await sendRequest(server, "tools/list", {});
    console.log("Tools:", JSON.stringify(toolsResponse, null, 2));

    // Test list_models
    console.error("\n=== Testing list_models ===");
    const listModelsResponse = await sendRequest(server, "tools/call", {
      name: "list_models",
      arguments: { pattern: "Transcription", includeAbstract: false },
    });
    console.log("List Models:", JSON.stringify(listModelsResponse, null, 2));

    // Test get_model_schema
    console.error("\n=== Testing get_model_schema ===");
    const schemaResponse = await sendRequest(server, "tools/call", {
      name: "get_model_schema",
      arguments: {
        modelName: "Transcription",
        includeColumns: true,
        includeAssociations: true,
        includeValidations: true,
        includeScopes: true,
        includeEnums: true,
        includeCallbacks: false,
      },
    });
    console.log("Model Schema:", JSON.stringify(schemaResponse, null, 2));

    // Test execute_query
    console.error("\n=== Testing execute_query ===");
    const queryResponse = await sendRequest(server, "tools/call", {
      name: "execute_query",
      arguments: {
        sql: "SELECT id, title, status, created_at FROM transcriptions ORDER BY created_at DESC LIMIT 5",
        limit: 5,
      },
    });
    console.log("Query:", JSON.stringify(queryResponse, null, 2));

    // Test get_model_counts
    console.error("\n=== Testing get_model_counts ===");
    const countsResponse = await sendRequest(server, "tools/call", {
      name: "get_model_counts",
      arguments: {
        modelNames: ["Transcription", "User", "Speaker"],
        where: { status: "completed" },
      },
    });
    console.log("Model Counts:", JSON.stringify(countsResponse, null, 2));

    // Test search_models
    console.error("\n=== Testing search_models ===");
    const searchResponse = await sendRequest(server, "tools/call", {
      name: "search_models",
      arguments: { pattern: "transcrip", includeColumns: false },
    });
    console.log("Search Models:", JSON.stringify(searchResponse, null, 2));

    // Test get_associations_graph
    console.error("\n=== Testing get_associations_graph ===");
    const graphResponse = await sendRequest(server, "tools/call", {
      name: "get_associations_graph",
      arguments: {
        modelNames: ["Transcription", "User", "Speaker", "Sentence"],
        direction: "all",
      },
    });
    console.log("Associations Graph:", JSON.stringify(graphResponse, null, 2));

    console.error("\n=== All tests passed! ===");
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch(console.error);