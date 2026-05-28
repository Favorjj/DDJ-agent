/**
 * MCP Bridge — converts MCP tools to DDJ AgentTool format
 */
import type { AgentTool } from "../types.js";
import type { MCPClient, MCPToolSchema } from "./client.js";
/** Create a DDJ AgentTool from an MCP tool schema */
export declare function mcpToAgentTool(mcpTool: MCPToolSchema, client: MCPClient): AgentTool;
/** Convert all tools from an MCP server to DDJ AgentTool[] */
export declare function mcpServerToAgentTools(client: MCPClient): AgentTool[];
//# sourceMappingURL=bridge.d.ts.map