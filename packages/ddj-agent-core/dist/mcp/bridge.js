/**
 * MCP Bridge — converts MCP tools to DDJ AgentTool format
 */
/** Convert a JSON Schema-like object to TypeBox-like schema (minimal) */
function jsonSchemaToTypeBoxParameters(schema) {
    // MCP uses JSON Schema, DDJ uses TypeBox.
    // For now, pass through the schema shape — TypeBox accepts plain objects enough for tool calling.
    // The LLM sees the property descriptions and types from the JSON Schema.
    if (!schema || typeof schema !== "object") {
        return { type: "object", properties: {} };
    }
    // Deep clone to avoid mutation
    return JSON.parse(JSON.stringify(schema));
}
/** Convert MCP content array to DDJ ContentBlock array */
function mcpContentToDDJ(content) {
    return content.map((item) => {
        if (item.type === "text" && item.text !== undefined) {
            return { type: "text", text: item.text };
        }
        if (item.type === "image" && item.data !== undefined) {
            return {
                type: "text",
                text: `[Image: ${item.mimeType || "unknown"}, data length: ${item.data.length}]`,
            };
        }
        if (item.type === "resource") {
            return {
                type: "text",
                text: item.text || `[Resource: ${item.mimeType || "unknown"}]`,
            };
        }
        return { type: "text", text: `[${item.type}]` };
    });
}
/** Create a DDJ AgentTool from an MCP tool schema */
export function mcpToAgentTool(mcpTool, client) {
    const fullName = `mcp__${client.serverName}__${mcpTool.name}`;
    return {
        name: fullName,
        description: mcpTool.description ||
            `MCP tool "${mcpTool.name}" from server "${client.serverName}"`,
        parameters: jsonSchemaToTypeBoxParameters(mcpTool.inputSchema || { type: "object", properties: {} }),
        async execute({ args }) {
            try {
                const result = await client.callTool(mcpTool.name, args || {});
                const content = mcpContentToDDJ(result.content || []);
                if (result.isError) {
                    return {
                        content: content.length > 0
                            ? content
                            : [{ type: "text", text: "MCP tool returned an error" }],
                        details: { mcpServer: client.serverName, mcpTool: mcpTool.name, isError: true },
                    };
                }
                if (content.length === 0) {
                    return {
                        content: [{ type: "text", text: "Tool completed (no output)" }],
                        details: { mcpServer: client.serverName, mcpTool: mcpTool.name },
                    };
                }
                return {
                    content,
                    details: { mcpServer: client.serverName, mcpTool: mcpTool.name },
                };
            }
            catch (err) {
                return {
                    content: [{
                            type: "text",
                            text: `MCP tool error (${client.serverName}/${mcpTool.name}): ${err.message}`,
                        }],
                    details: { mcpServer: client.serverName, mcpTool: mcpTool.name, error: String(err) },
                };
            }
        },
    };
}
/** Convert all tools from an MCP server to DDJ AgentTool[] */
export function mcpServerToAgentTools(client) {
    return client.tools.map((tool) => mcpToAgentTool(tool, client));
}
//# sourceMappingURL=bridge.js.map