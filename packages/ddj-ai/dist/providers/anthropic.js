/**
 * Anthropic API provider (Claude).
 */
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export async function* streamAnthropic(model, context, config) {
    const apiKey = config.apiKey || process.env["ANTHROPIC_API_KEY"];
    if (!apiKey)
        throw new Error("ANTHROPIC_API_KEY is not set");
    const tools = context.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
    // Convert messages to Anthropic format
    const anthropicMessages = context.messages
        .filter((m) => m.role !== "assistant" || m.content.some((c) => c.type === "text" || c.type === "toolCall"))
        .map((m) => {
        if (m.role === "toolResult") {
            return {
                role: "user",
                content: m.content.map((c) => {
                    if (c.type === "text")
                        return { type: "text", text: c.text };
                    if (c.type === "toolResult") {
                        return {
                            type: "tool_result",
                            tool_use_id: c.toolCallId,
                            content: c.isError ? `Error: ${formatToolResult(c.content)}` : formatToolResult(c.content),
                        };
                    }
                    return null;
                }).filter(Boolean),
            };
        }
        return {
            role: m.role === "assistant" ? "assistant" : "user",
            content: Array.isArray(m.content)
                ? m.content.map((c) => {
                    if (c.type === "text")
                        return { type: "text", text: c.text };
                    if (c.type === "toolCall") {
                        return {
                            type: "tool_use",
                            id: c.id,
                            name: c.name,
                            input: c.arguments,
                        };
                    }
                    return null;
                }).filter(Boolean)
                : [{ type: "text", text: String(m.content) }],
        };
    });
    const body = {
        model: model.id,
        messages: anthropicMessages,
        stream: true,
        ...(tools && tools.length > 0 ? { tools } : {}),
    };
    // Add thinking budget if enabled
    const thinkingLevel = config.thinkingLevel;
    if (thinkingLevel && thinkingLevel !== "off") {
        const budgets = {
            minimal: 1024,
            low: 4096,
            medium: 10240,
            high: 20480,
        };
        const budget = budgets[thinkingLevel];
        if (budget) {
            body.thinking = {
                type: "enabled",
                budget_tokens: budget,
            };
        }
    }
    const response = await fetch(`${config.baseUrl || ANTHROPIC_BASE_URL}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "interleaved-thinking-2025-05-14",
            ...(body.thinking ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
        },
        body: JSON.stringify(body),
        signal: config.signal,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }
    if (!response.body)
        throw new Error("No response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const partial = {
        role: "assistant",
        content: [],
        stopReason: "unknown",
    };
    let currentToolCallIndex = -1;
    let isThinking = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data: "))
                continue;
            const data = line.slice(6).trim();
            if (data === "" || data === "e2e Parry started")
                continue;
            let event;
            try {
                event = JSON.parse(data);
            }
            catch {
                continue;
            }
            const eventType = event.type;
            switch (eventType) {
                case "message_start": {
                    yield { type: "start", partial };
                    break;
                }
                case "content_block_start": {
                    const blockType = event.content_block_type;
                    if (blockType === "text") {
                        partial.content.push({ type: "text", text: "" });
                    }
                    else if (blockType === "tool_use") {
                        currentToolCallIndex++;
                        const tc = {
                            type: "toolCall",
                            id: event.id,
                            name: event.name,
                            arguments: {},
                        };
                        partial.content.push(tc);
                        yield { type: "toolcall_start", partial: { ...partial }, contentIndex: currentToolCallIndex };
                    }
                    break;
                }
                case "content_block_delta": {
                    const deltaType = event.delta_type;
                    if (deltaType === "text_delta") {
                        if (isThinking) {
                            isThinking = false;
                            yield { type: "thinking_end", partial: { ...partial } };
                        }
                        const text = event.text;
                        const last = partial.content[partial.content.length - 1];
                        if (last && last.type === "text") {
                            last.text += text;
                        }
                        else {
                            partial.content.push({ type: "text", text });
                        }
                        yield { type: "text_delta", delta: text, partial: { ...partial } };
                    }
                    else if (deltaType === "thinking_delta") {
                        if (!isThinking) {
                            isThinking = true;
                            yield { type: "thinking_start", partial: { ...partial } };
                        }
                        yield { type: "thinking_delta", delta: event.text, partial: { ...partial } };
                    }
                    else if (deltaType === "input_json_delta") {
                        if (isThinking) {
                            isThinking = false;
                            yield { type: "thinking_end", partial: { ...partial } };
                        }
                        if (currentToolCallIndex >= 0) {
                            const tc = partial.content.find((c) => c.type === "toolCall" && c.id === event.id);
                            if (tc) {
                                // Accumulate partial JSON args
                                tc.arguments = JSON.parse(JSON.stringify(tc.arguments).replace(/}$/, "," + event.partial_json + "}").replace(/^{,/, "{"));
                            }
                            yield { type: "toolcall_delta", partial: { ...partial }, contentIndex: currentToolCallIndex };
                        }
                    }
                    break;
                }
                case "content_block_stop": {
                    const cb = event.content_block;
                    if (cb?.type === "tool_use") {
                        yield { type: "toolcall_end", toolCall: partial.content[partial.content.length - 1], partial: { ...partial } };
                    }
                    else {
                        yield { type: "text_end", partial: { ...partial } };
                    }
                    break;
                }
                case "message_delta": {
                    if (event.stop_reason) {
                        partial.stopReason = mapAnthropicStopReason(event.stop_reason);
                    }
                    break;
                }
                case "message_stop": {
                    if (isThinking) {
                        yield { type: "thinking_end", partial: { ...partial } };
                    }
                    yield { type: "done", reason: partial.stopReason, message: partial };
                    return partial;
                }
            }
        }
    }
    if (isThinking) {
        yield { type: "thinking_end", partial: { ...partial } };
    }
    yield { type: "done", reason: partial.stopReason, message: partial };
    return partial;
}
function formatToolResult(content) {
    return content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
}
function mapAnthropicStopReason(reason) {
    switch (reason) {
        case "end_turn": return "stop";
        case "max_tokens": return "unknown";
        case "stop_sequence": return "stop";
        default: return "unknown";
    }
}
export async function completeAnthropic(model, context, config) {
    const apiKey = config.apiKey || process.env["ANTHROPIC_API_KEY"];
    if (!apiKey)
        throw new Error("ANTHROPIC_API_KEY is not set");
    const tools = context.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
    const anthropicMessages = context.messages
        .filter((m) => m.role !== "assistant" || m.content.some((c) => c.type === "text" || c.type === "toolCall"))
        .map((m) => {
        if (m.role === "toolResult") {
            return {
                role: "user",
                content: m.content.map((c) => {
                    if (c.type === "text")
                        return { type: "text", text: c.text };
                    if (c.type === "toolResult") {
                        return {
                            type: "tool_result",
                            tool_use_id: c.toolCallId,
                            content: c.isError ? `Error: ${formatToolResult(c.content)}` : formatToolResult(c.content),
                        };
                    }
                    return null;
                }).filter(Boolean),
            };
        }
        return {
            role: m.role === "assistant" ? "assistant" : "user",
            content: Array.isArray(m.content)
                ? m.content.map((c) => {
                    if (c.type === "text")
                        return { type: "text", text: c.text };
                    if (c.type === "toolCall") {
                        return {
                            type: "tool_use",
                            id: c.id,
                            name: c.name,
                            input: c.arguments,
                        };
                    }
                    return null;
                }).filter(Boolean)
                : [{ type: "text", text: String(m.content) }],
        };
    });
    const body = {
        model: model.id,
        messages: anthropicMessages,
        ...(tools && tools.length > 0 ? { tools } : {}),
    };
    const thinkingLevel = config.thinkingLevel;
    if (thinkingLevel && thinkingLevel !== "off") {
        const budgets = {
            minimal: 1024,
            low: 4096,
            medium: 10240,
            high: 20480,
        };
        const budget = budgets[thinkingLevel];
        if (budget) {
            body.thinking = { type: "enabled", budget_tokens: budget };
        }
    }
    const response = await fetch(`${config.baseUrl || ANTHROPIC_BASE_URL}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            ...(body.thinking ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
        },
        body: JSON.stringify(body),
        signal: config.signal,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }
    const data = await response.json();
    const content = [];
    for (const block of data.content) {
        if (block.type === "text" && block.text) {
            content.push({ type: "text", text: block.text });
        }
        else if (block.type === "tool_use" && block.id && block.name) {
            content.push({
                type: "toolCall",
                id: block.id,
                name: block.name,
                arguments: block.input || {},
            });
        }
    }
    return {
        role: "assistant",
        content,
        stopReason: mapAnthropicStopReason(data.stop_reason || "end_turn"),
        usage: data.usage
            ? {
                input: data.usage.input_tokens,
                output: data.usage.output_tokens,
                total: data.usage.input_tokens + data.usage.output_tokens,
            }
            : undefined,
    };
}
//# sourceMappingURL=anthropic.js.map