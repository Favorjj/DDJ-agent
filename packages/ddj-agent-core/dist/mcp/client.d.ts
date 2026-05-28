/**
 * MCP Client — JSON-RPC 2.0 over stdio
 * Manages a single MCP server connection.
 */
export interface MCPToolSchema {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}
export declare class MCPClient {
    readonly serverName: string;
    private _process;
    private _nextId;
    private _pending;
    private _buffer;
    private _initialized;
    private _tools;
    constructor(serverName: string);
    get tools(): MCPToolSchema[];
    get initialized(): boolean;
    /** Start the MCP server process and initialize */
    connect(command: string, args?: string[], env?: Record<string, string>): Promise<void>;
    /** List tools from the MCP server */
    listTools(): Promise<MCPToolSchema[]>;
    /** Call a tool on the MCP server */
    callTool(name: string, args: Record<string, unknown>): Promise<{
        content: Array<{
            type: string;
            text?: string;
            data?: string;
            mimeType?: string;
        }>;
        isError?: boolean;
    }>;
    /** Close the connection */
    close(): void;
    private _sendRequest;
    private _sendNotification;
    private _processBuffer;
}
//# sourceMappingURL=client.d.ts.map