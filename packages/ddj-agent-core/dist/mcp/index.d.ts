/**
 * MCP Manager — starts/connects MCP servers and collects tools
 */
import { MCPClient } from "./client.js";
import type { AgentTool } from "../types.js";
export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export interface MCPConfig {
    mcpServers: Record<string, MCPServerConfig>;
}
export interface MCPManagerState {
    clients: Map<string, MCPClient>;
    tools: AgentTool[];
    failures: string[];
}
/** Connect to all configured MCP servers and collect their tools */
export declare function connectMCPServers(config: MCPConfig, signal?: AbortSignal): Promise<MCPManagerState>;
/** Close all MCP server connections */
export declare function disconnectMCPServers(clients: Map<string, MCPClient>): void;
export { MCPClient } from "./client.js";
export { mcpToAgentTool, mcpServerToAgentTools } from "./bridge.js";
//# sourceMappingURL=index.d.ts.map