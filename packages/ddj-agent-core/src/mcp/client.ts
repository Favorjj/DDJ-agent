/**
 * MCP Client — JSON-RPC 2.0 over stdio
 * Manages a single MCP server connection.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

export interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class MCPClient {
  readonly serverName: string;
  private _process: ChildProcess | null = null;
  private _nextId = 1;
  private _pending = new Map<number, PendingRequest>();
  private _buffer = "";
  private _initialized = false;
  private _tools: MCPToolSchema[] = [];

  constructor(serverName: string) {
    this.serverName = serverName;
  }

  get tools(): MCPToolSchema[] {
    return this._tools;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /** Start the MCP server process and initialize */
  async connect(command: string, args: string[] = [], env: Record<string, string> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`MCP server "${this.serverName}" startup timed out`));
      }, 10_000);

      this._process = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
        windowsHide: true,
      });

      this._process.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`MCP server "${this.serverName}" failed to start: ${err.message}`));
      });

      this._process.on("exit", (code) => {
        this._initialized = false;
      });

      this._process.stdout?.on("data", (chunk: Buffer) => {
        this._buffer += chunk.toString();
        this._processBuffer();
      });

      this._process.stderr?.on("data", (chunk: Buffer) => {
        // MCP servers log to stderr, not used for protocol
      });

      // Send initialize
      this._sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        clientInfo: { name: "ddj-agent", version: "1.0.0" },
      }).then(() => {
        // Send initialized notification (no response expected)
        this._sendNotification("notifications/initialized", {});
        this._initialized = true;
        clearTimeout(timeout);
        resolve();
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /** List tools from the MCP server */
  async listTools(): Promise<MCPToolSchema[]> {
    const result = await this._sendRequest("tools/list", {}) as {
      tools: MCPToolSchema[];
    };
    this._tools = result.tools || [];
    return this._tools;
  }

  /** Call a tool on the MCP server */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }> {
    const result = await this._sendRequest("tools/call", {
      name,
      arguments: args,
    }) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };
    return result;
  }

  /** Close the connection */
  close(): void {
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
    this._initialized = false;
    this._tools = [];
    this._pending.clear();
  }

  /* ============================================================
   * Internal
   * ============================================================ */

  private _sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const request: JSONRPCRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params: params || {},
      };

      this._pending.set(id, { resolve, reject });

      // Set a 60s timeout for tool calls
      if (method === "tools/call") {
        setTimeout(() => {
          if (this._pending.has(id)) {
            this._pending.delete(id);
            reject(new Error(`MCP tool call "${params?.name}" timed out`));
          }
        }, 60_000);
      }

      if (!this._process?.stdin) {
        reject(new Error("MCP server not connected"));
        return;
      }

      this._process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  private _sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification = {
      jsonrpc: "2.0",
      method,
      params: params || {},
    };
    if (this._process?.stdin) {
      this._process.stdin.write(JSON.stringify(notification) + "\n");
    }
  }

  private _processBuffer(): void {
    const lines = this._buffer.split("\n");
    this._buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: JSONRPCResponse;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue; // skip malformed JSON
      }

      // Handle notifications (no id)
      if (!("id" in parsed) || parsed.id === undefined) {
        continue;
      }

      const pending = this._pending.get(parsed.id);
      if (!pending) continue;

      this._pending.delete(parsed.id);

      if (parsed.error) {
        pending.reject(new Error(`MCP error: ${parsed.error.message}`));
      } else {
        pending.resolve(parsed.result);
      }
    }
  }
}
