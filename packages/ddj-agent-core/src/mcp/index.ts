/**
 * MCP Manager — starts/connects MCP servers and collects tools
 */

import { MCPClient } from "./client.js";
import { mcpServerToAgentTools } from "./bridge.js";
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
export async function connectMCPServers(
  config: MCPConfig,
  signal?: AbortSignal
): Promise<MCPManagerState> {
  const clients = new Map<string, MCPClient>();
  const allTools: AgentTool[] = [];
  const failures: string[] = [];

  const entries = Object.entries(config.mcpServers || {});
  if (entries.length === 0) {
    return { clients, tools: [], failures: [] };
  }

  // Connect to all servers in parallel
  const results = await Promise.allSettled(
    entries.map(async ([name, serverConfig]) => {
      if (signal?.aborted) return;

      const client = new MCPClient(name);

      await client.connect(
        serverConfig.command,
        serverConfig.args || [],
        serverConfig.env || {}
      );

      await client.listTools();

      return client;
    })
  );

  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i];
    const result = results[i];

    if (result.status === "fulfilled" && result.value) {
      const client = result.value;
      clients.set(name, client);
      const tools = mcpServerToAgentTools(client);
      allTools.push(...tools);
    } else {
      const reason = result.status === "rejected"
        ? (result.reason as Error).message
        : "Unknown error";
      failures.push(`${name}: ${reason}`);
    }
  }

  return { clients, tools: allTools, failures };
}

/** Close all MCP server connections */
export function disconnectMCPServers(clients: Map<string, MCPClient>): void {
  for (const client of clients.values()) {
    client.close();
  }
  clients.clear();
}

export { MCPClient } from "./client.js";
export { mcpToAgentTool, mcpServerToAgentTools } from "./bridge.js";
