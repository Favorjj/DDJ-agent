/**
 * MCP Client — JSON-RPC 2.0 over stdio
 * Manages a single MCP server connection.
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
export class MCPClient {
    serverName;
    _process = null;
    _nextId = 1;
    _pending = new Map();
    _buffer = "";
    _initialized = false;
    _tools = [];
    constructor(serverName) {
        this.serverName = serverName;
    }
    get tools() {
        return this._tools;
    }
    get initialized() {
        return this._initialized;
    }
    /** Start the MCP server process and initialize */
    async connect(command, args = [], env = {}) {
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
            this._process.stdout?.on("data", (chunk) => {
                this._buffer += chunk.toString();
                this._processBuffer();
            });
            this._process.stderr?.on("data", (chunk) => {
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
    async listTools() {
        const result = await this._sendRequest("tools/list", {});
        this._tools = result.tools || [];
        return this._tools;
    }
    /** Call a tool on the MCP server */
    async callTool(name, args) {
        const result = await this._sendRequest("tools/call", {
            name,
            arguments: args,
        });
        return result;
    }
    /** Close the connection */
    close() {
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
    _sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const request = {
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
    _sendNotification(method, params) {
        const notification = {
            jsonrpc: "2.0",
            method,
            params: params || {},
        };
        if (this._process?.stdin) {
            this._process.stdin.write(JSON.stringify(notification) + "\n");
        }
    }
    _processBuffer() {
        const lines = this._buffer.split("\n");
        this._buffer = lines.pop() || "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch {
                continue; // skip malformed JSON
            }
            // Handle notifications (no id)
            if (!("id" in parsed) || parsed.id === undefined) {
                continue;
            }
            const pending = this._pending.get(parsed.id);
            if (!pending)
                continue;
            this._pending.delete(parsed.id);
            if (parsed.error) {
                pending.reject(new Error(`MCP error: ${parsed.error.message}`));
            }
            else {
                pending.resolve(parsed.result);
            }
        }
    }
}
//# sourceMappingURL=client.js.map