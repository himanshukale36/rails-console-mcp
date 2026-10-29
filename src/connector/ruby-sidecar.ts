import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { Config } from "../types/config.js";
import { getLogger } from "../utils/logger.js";
import {
  ModelSummary,
  ModelSchema,
  TableSchema,
  QueryResult,
  ModelCount,
  AssociationGraph,
} from "../types/tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find project root by looking for package.json
function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== "/") {
    if (existsSync(resolve(current, "package.json"))) {
      return current;
    }
    current = dirname(current);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot(__dirname);
const SIDECAR_SCRIPT = resolve(PROJECT_ROOT, "ruby/sidecar.rb");

/**
 * Request/Response types for Ruby sidecar communication
 */
interface SidecarRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface SidecarResponse {
  id: number;
  result?: unknown;
  error?: { message: string; code: number; data?: unknown };
}

/**
 * Ruby sidecar connector - manages the Ruby subprocess that loads Rails
 */
export class RubySidecar {
  private process: ChildProcessWithoutNullStreams | null = null;
  private config: Config;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  private buffer = "";
  private logger = getLogger().child({ component: "RubySidecar" });
  private started = false;
  private startPromise: Promise<void> | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Start the Ruby sidecar process
   */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    const rubyPath = this.config.sidecar?.rubyPath || "ruby";
    const bundleExec = "bundle";

    this.logger.info("Starting Ruby sidecar", {
      rubyPath,
      script: SIDECAR_SCRIPT,
      railsAppPath: this.config.railsAppPath,
      environment: this.config.environment,
    });

    // Build command - use bundle exec to ensure correct gem versions
    const args = [
      "exec",
      rubyPath,
      SIDECAR_SCRIPT,
      this.config.railsAppPath,
      this.config.environment,
      JSON.stringify({
        readOnly: this.config.readOnly,
        maxRows: this.config.maxRows,
        queryTimeoutSeconds: this.config.queryTimeoutSeconds,
      }),
    ];

    this.process = spawn(bundleExec, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.railsAppPath,
      env: {
        ...process.env,
        BUNDLE_GEMFILE: resolve(this.config.railsAppPath, "Gemfile"),
        RAILS_ROOT: this.config.railsAppPath,
        RAILS_ENV: this.config.environment,
      },
    });

    // Handle stdout - JSON responses
    this.process.stdout.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr
    this.process.stderr.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (this.config.sidecar?.logStderr) {
        this.logger.debug("Sidecar stderr", { message: msg });
      }
      // Check for startup messages
      if (msg.includes("SIDECAR_READY")) {
        this.logger.info("Ruby sidecar ready");
        this.started = true;
      } else if (msg.includes("SIDECAR_ERROR")) {
        this.logger.error("Sidecar startup error", { message: msg });
      }
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      this.logger.warn("Sidecar process exited", { code, signal });
      this.started = false;
      this.process = null;
      // Reject all pending requests
      for (const [, { reject }] of this.pendingRequests) {
        reject(new Error(`Sidecar process exited (code: ${code}, signal: ${signal})`));
      }
      this.pendingRequests.clear();
    });

    this.process.on("error", (error) => {
      this.logger.error("Sidecar process error", { error: error.message });
      this.started = false;
    });

    // Wait for ready signal
    await this.waitForReady();
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Sidecar startup timeout"));
      }, (this.config.sidecar?.startupTimeoutSeconds || 30) * 1000);

      const checkReady = () => {
        if (this.started) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for startup signals
      if (trimmed === "SIDECAR_READY") {
        this.logger.info("Ruby sidecar ready (from stdout)");
        this.started = true;
        continue;
      } else if (trimmed === "SIDECAR_ERROR") {
        this.logger.error("Sidecar startup error (from stdout)");
        continue;
      }

      try {
        const response: SidecarResponse = JSON.parse(trimmed);
        this.handleResponse(response);
      } catch (e) {
        // Not JSON, might be a log line
        if (this.config.sidecar?.logStderr) {
          this.logger.debug("Sidecar output (non-JSON)", { line: trimmed });
        }
      }
    }
  }

  private handleResponse(response: SidecarResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn("Received response for unknown request", { id: response.id });
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(`Sidecar error (${response.error.code}): ${response.error.message}`)
      );
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Send a request to the sidecar and wait for response
   */
  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.started || !this.process) {
      throw new Error("Sidecar not started");
    }

    const id = ++this.requestId;
    const request: SidecarRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject });

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, (this.config.queryTimeoutSeconds || 30) * 1000);

      // Override resolve/reject to clear timeout
      const originalResolve = this.pendingRequests.get(id)!.resolve;
      const originalReject = this.pendingRequests.get(id)!.reject;
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          originalReject(error);
        },
      });

      try {
        this.process!.stdin.write(JSON.stringify(request) + "\n");
      } catch (e) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  // ============ Tool Methods ============

  async listModels(pattern?: string, includeAbstract = false): Promise<ModelSummary[]> {
    return this.request<ModelSummary[]>("list_models", { pattern, includeAbstract });
  }

  async getModelSchema(
    modelName: string,
    options: {
      includeColumns?: boolean;
      includeAssociations?: boolean;
      includeValidations?: boolean;
      includeScopes?: boolean;
      includeEnums?: boolean;
      includeCallbacks?: boolean;
    } = {}
  ): Promise<ModelSchema> {
    return this.request<ModelSchema>("get_model_schema", { modelName, ...options });
  }

  async getTableSchema(tableName: string): Promise<TableSchema> {
    return this.request<TableSchema>("get_table_schema", { tableName });
  }

  async executeQuery(
    sql: string,
    params: unknown[] = [],
    limit?: number
  ): Promise<QueryResult> {
    return this.request<QueryResult>("execute_query", { sql, params, limit });
  }

  async reloadEnvironment(force = false): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>("reload_environment", { force });
  }

  async getModelCounts(
    modelNames?: string[],
    where?: Record<string, unknown>,
    limit?: number
  ): Promise<ModelCount[]> {
    return this.request<ModelCount[]>("get_model_counts", { modelNames, where, limit });
  }

  async searchModels(pattern: string, includeColumns = false): Promise<ModelSummary[]> {
    return this.request<ModelSummary[]>("search_models", { pattern, includeColumns });
  }

  async getAssociationsGraph(
    modelNames?: string[],
    direction: "all" | "outgoing" | "incoming" = "all"
  ): Promise<AssociationGraph> {
    return this.request<AssociationGraph>("get_associations_graph", { modelNames, direction });
  }

  /**
   * Stop the sidecar process
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.logger.info("Stopping Ruby sidecar");
      this.process.kill("SIGTERM");

      // Wait for exit
      await new Promise<void>((resolve) => {
        if (!this.process) {
          resolve();
          return;
        }
        this.process.on("exit", () => resolve());
        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.process) {
            this.process.kill("SIGKILL");
          }
          resolve();
        }, 5000);
      });

      this.process = null;
      this.started = false;
    }
  }

  /**
   * Check if sidecar is running
   */
  isRunning(): boolean {
    return this.started && this.process !== null;
  }
}