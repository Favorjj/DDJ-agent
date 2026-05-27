/**
 * Agent runtime: drives the LLM <-> tool loop with full event streaming.
 *
 * Architecture:
 *   prompt() → LLM stream → tool execution → LLM stream → ... → done
 *   Each turn: one LLM call + zero or more tool executions
 */
import { stream } from "@ddj-ai/core";
import { EventStream } from "./event-stream.js";
export class Agent {
    _state;
    _config;
    _eventStream;
    _signal;
    _steeringQueue = [];
    _followUpQueue = [];
    constructor(config) {
        this._config = config;
        this._state = {
            systemPrompt: config.initialState.systemPrompt,
            model: config.initialState.model,
            thinkingLevel: config.initialState.thinkingLevel || "off",
            tools: config.initialState.tools || [],
            messages: config.initialState.messages || [],
            isStreaming: false,
            pendingToolCalls: new Set(),
        };
        this._eventStream = new EventStream((event) => event.type === "agent_end", (event) => (event.type === "agent_end" ? event.messages : []));
    }
    /* ============================================================
     * Public API
     * ============================================================ */
    get state() {
        return this._state;
    }
    get streamingMessage() {
        return this._state.streamingMessage;
    }
    /** Subscribe to agent events. Returns unsubscribe function. */
    subscribe(listener) {
        return this._eventStream.subscribe(listener);
    }
    /** Abort the current operation */
    abort() {
        this._signal?.abort();
    }
    /** Wait for the current operation to finish */
    async waitForIdle() {
        return this._eventStream.wait();
    }
    /** Send a steering message (interrupts during tool execution, delivered after current turn) */
    steer(message) {
        this._steeringQueue.push(message);
    }
    /** Queue a follow-up message (delivered after all tool calls finish) */
    followUp(message) {
        this._followUpQueue.push(message);
    }
    clearSteeringQueue() {
        this._steeringQueue = [];
    }
    clearFollowUpQueue() {
        this._followUpQueue = [];
    }
    clearAllQueues() {
        this._steeringQueue = [];
        this._followUpQueue = [];
    }
    get steeringMode() {
        return this._config.steeringMode || "one-at-a-time";
    }
    get followUpMode() {
        return this._config.followUpMode || "one-at-a-time";
    }
    /**
     * Main entry: send a prompt to the agent.
     * Accepts a text string, or a full AgentMessage.
     */
    async prompt(input) {
        let userMessage;
        if (typeof input === "string") {
            userMessage = {
                role: "user",
                content: input,
                timestamp: Date.now(),
            };
        }
        else {
            userMessage = input;
        }
        this._state.messages.push(userMessage);
        this._emit({ type: "message_start", message: userMessage });
        this._emit({ type: "message_end", message: userMessage });
        return this._run();
    }
    /**
     * Continue from current context (last message must be user or toolResult).
     * Used for retries after errors.
     */
    async continue() {
        return this._run();
    }
    /** Reset agent state */
    reset() {
        this._state.messages = [];
        this._state.isStreaming = false;
        this._state.pendingToolCalls = new Set();
        this._state.streamingMessage = undefined;
        this._signal = undefined;
        this._steeringQueue = [];
        this._followUpQueue = [];
        this._eventStream = new EventStream((event) => event.type === "agent_end", (event) => (event.type === "agent_end" ? event.messages : []));
    }
    /* ============================================================
     * Internal: the main agent loop
     * ============================================================ */
    async _run() {
        if (this._state.isStreaming) {
            throw new Error("Agent is already streaming");
        }
        this._state.isStreaming = true;
        this._signal = new AbortController();
        this._emit({ type: "agent_start" });
        try {
            await this._agentLoop();
        }
        catch (err) {
            this._state.errorMessage = String(err);
            this._emit({ type: "error", error: err });
            this._state.isStreaming = false;
            throw err;
        }
        this._state.isStreaming = false;
        const finalMessages = [...this._state.messages];
        this._emit({ type: "agent_end", messages: finalMessages });
        return finalMessages;
    }
    async _agentLoop() {
        let consecutiveEmptyTurns = 0;
        const MAX_EMPTY_TURNS = 5;
        while (true) {
            // Check for steering messages
            if (this._steeringQueue.length > 0) {
                const mode = this.steeringMode;
                while (this._steeringQueue.length > 0) {
                    const msg = this._steeringQueue.shift();
                    this._state.messages.push(msg);
                    this._emit({ type: "message_start", message: msg });
                    this._emit({ type: "message_end", message: msg });
                }
                if (mode === "one-at-a-time") {
                    // Deliver one and let the LLM respond
                }
            }
            this._emit({ type: "turn_start" });
            // 1. Transform context (pruning, compaction)
            let contextMessages = [...this._state.messages];
            if (this._config.transformContext) {
                contextMessages = await this._config.transformContext(contextMessages, this._signal?.signal);
            }
            // 2. Convert AgentMessage[] to LLM Message[]
            const llmMessages = await this._config.convertToLlm(contextMessages);
            // 3. Build LLM context
            const llmContext = {
                systemPrompt: this._state.systemPrompt,
                messages: llmMessages,
                tools: this._state.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                })),
            };
            // 4. Call LLM
            const options = {
                signal: this._signal?.signal,
                thinkingLevel: this._state.thinkingLevel,
            };
            const assistantMessage = await this._callLlm(llmContext, options);
            // 5. Add assistant message to state + track usage
            const agentAssistantMsg = {
                role: "assistant",
                content: assistantMessage.content,
                stopReason: assistantMessage.stopReason || "unknown",
                usage: assistantMessage.usage,
                reasoning_content: assistantMessage.reasoning_content,
                timestamp: Date.now(),
            };
            this._state.messages.push(agentAssistantMsg);
            this._emit({ type: "message_start", message: agentAssistantMsg });
            this._emit({ type: "message_end", message: agentAssistantMsg });
            // Track cumulative token usage
            if (assistantMessage.usage) {
                const prev = this._state.cumulativeUsage;
                this._state.cumulativeUsage = {
                    input: (prev?.input || 0) + assistantMessage.usage.input,
                    output: (prev?.output || 0) + assistantMessage.usage.output,
                    total: (prev?.total || 0) + assistantMessage.usage.total,
                };
            }
            // 6. Extract tool calls
            const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
            // 7. Execute tools (if any)
            const toolResults = [];
            if (toolCalls.length > 0) {
                // Determine execution mode
                const hasSequentialTool = toolCalls.some((tc) => {
                    const toolDef = this._state.tools.find((t) => t.name === tc.name);
                    return toolDef?.executionMode === "sequential";
                });
                const isSequential = this._config.toolExecution === "sequential" || hasSequentialTool;
                if (isSequential) {
                    for (const tc of toolCalls) {
                        const result = await this._executeTool(tc);
                        toolResults.push(result);
                    }
                }
                else {
                    const results = await Promise.all(toolCalls.map((tc) => this._executeTool(tc)));
                    toolResults.push(...results);
                }
                // Add tool results to state (in the order the LLM called them, not execution order)
                const resultMap = new Map(toolResults.map((r) => [r.toolCallId, r]));
                const orderedResults = toolCalls.map((tc) => {
                    return (resultMap.get(tc.id) || {
                        role: "toolResult",
                        toolCallId: tc.id,
                        toolName: tc.name,
                        content: [{ type: "text", text: "Tool result not found" }],
                        isError: true,
                        timestamp: Date.now(),
                    });
                });
                for (const tr of orderedResults) {
                    this._state.messages.push(tr);
                    this._emit({ type: "message_start", message: tr });
                    this._emit({ type: "message_end", message: tr });
                }
                // Check shouldStopAfterTurn
                if (this._config.shouldStopAfterTurn) {
                    const shouldStop = await this._config.shouldStopAfterTurn({
                        message: agentAssistantMsg,
                        toolResults: orderedResults,
                        context: {
                            systemPrompt: this._state.systemPrompt,
                            messages: this._state.messages,
                            tools: this._state.tools,
                        },
                        newMessages: [agentAssistantMsg, ...orderedResults],
                    });
                    if (shouldStop) {
                        this._emit({ type: "turn_end", message: agentAssistantMsg, toolResults: orderedResults });
                        break;
                    }
                }
                // Check if all tools returned terminate
                const allTerminate = orderedResults.every((r) => {
                    const toolDef = this._state.tools.find((t) => t.name === r.toolName);
                    // terminate flag is handled via afterToolCall
                    return false; // We'll handle this via the hook
                });
                consecutiveEmptyTurns = 0;
            }
            else {
                // No tool calls → done with this prompt
                consecutiveEmptyTurns++;
            }
            this._emit({
                type: "turn_end",
                message: agentAssistantMsg,
                toolResults,
                cumulativeUsage: this._state.cumulativeUsage,
            });
            // 8. Check follow-up queue
            if (toolCalls.length === 0) {
                // Check if there are follow-up messages
                while (this._followUpQueue.length > 0) {
                    const msg = this._followUpQueue.shift();
                    this._state.messages.push(msg);
                    this._emit({ type: "message_start", message: msg });
                    this._emit({ type: "message_end", message: msg });
                }
            }
            // 9. Prepare next turn if configured
            if (this._config.prepareNextTurn && toolCalls.length > 0) {
                const nextConfig = await this._config.prepareNextTurn({
                    message: agentAssistantMsg,
                    toolResults,
                    context: {
                        systemPrompt: this._state.systemPrompt,
                        messages: this._state.messages,
                        tools: this._state.tools,
                    },
                    newMessages: [agentAssistantMsg, ...toolResults],
                });
                if (nextConfig) {
                    if (nextConfig.context) {
                        if (nextConfig.context.systemPrompt !== undefined) {
                            this._state.systemPrompt = nextConfig.context.systemPrompt;
                        }
                    }
                    if (nextConfig.model) {
                        this._state.model = nextConfig.model;
                    }
                    if (nextConfig.thinkingLevel !== undefined) {
                        this._state.thinkingLevel = nextConfig.thinkingLevel;
                    }
                }
            }
            // 10. Decide whether to continue
            if (toolCalls.length === 0) {
                // No more tool calls → done
                break;
            }
            // Safety valve: prevent infinite loops
            if (consecutiveEmptyTurns >= MAX_EMPTY_TURNS) {
                break;
            }
            // Check if signal was aborted
            if (this._signal?.signal.aborted) {
                break;
            }
        }
    }
    async _callLlm(llmContext, options) {
        const model = this._state.model;
        const streamGen = stream(model, llmContext, {
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
        // Streaming: emit events and build the final message
        let finalMessage;
        const partialMsg = {
            role: "assistant",
            content: [],
            stopReason: "unknown",
        };
        this._state.streamingMessage = partialMsg;
        for await (const event of streamGen) {
            switch (event.type) {
                case "thinking_start":
                    this._emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: this._state.streamingMessage,
                    });
                    break;
                case "thinking_delta":
                    partialMsg.reasoning_content = (partialMsg.reasoning_content || "") + event.delta;
                    this._state.streamingMessage = { ...partialMsg };
                    this._emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: this._state.streamingMessage,
                    });
                    break;
                case "thinking_end":
                    this._emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: this._state.streamingMessage,
                    });
                    break;
                case "text_delta":
                    this._state.streamingMessage = {
                        ...partialMsg,
                        content: event.partial.content,
                    };
                    this._emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: this._state.streamingMessage,
                    });
                    break;
                case "toolcall_start":
                case "toolcall_delta":
                case "toolcall_end":
                    this._state.streamingMessage = {
                        ...partialMsg,
                        content: event.partial.content,
                    };
                    this._emit({
                        type: "message_update",
                        assistantMessageEvent: event,
                        message: this._state.streamingMessage,
                    });
                    break;
                case "done":
                    finalMessage = event.message;
                    this._state.streamingMessage = undefined;
                    break;
                case "error":
                    throw event.error;
            }
        }
        if (!finalMessage) {
            throw new Error("LLM stream ended without a final message");
        }
        return finalMessage;
    }
    async _executeTool(toolCall) {
        const toolDef = this._state.tools.find((t) => t.name === toolCall.name);
        // Emit tool execution start
        this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls, toolCall.id]);
        this._emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        // BeforeToolCall hook
        if (this._config.beforeToolCall) {
            const hookResult = await this._config.beforeToolCall({
                toolCall,
                args: toolCall.arguments,
                context: {
                    systemPrompt: this._state.systemPrompt,
                    messages: this._state.messages,
                    tools: this._state.tools,
                },
            });
            if (hookResult?.block) {
                this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls].filter((id) => id !== toolCall.id));
                this._emit({
                    type: "tool_execution_end",
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    result: { error: hookResult.reason || "Blocked" },
                });
                return {
                    role: "toolResult",
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    content: [{ type: "text", text: `Tool execution blocked: ${hookResult.reason || "no reason"}` }],
                    isError: true,
                    timestamp: Date.now(),
                };
            }
        }
        // If tool not found, return error
        if (!toolDef) {
            this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls].filter((id) => id !== toolCall.id));
            this._emit({
                type: "tool_execution_end",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: { error: `Unknown tool: ${toolCall.name}` },
            });
            return {
                role: "toolResult",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: [{ type: "text", text: `Unknown tool: ${toolCall.name}. Available tools: ${this._state.tools.map((t) => t.name).join(", ")}` }],
                isError: true,
                timestamp: Date.now(),
            };
        }
        try {
            const result = await toolDef.execute({
                toolCallId: toolCall.id,
                args: toolCall.arguments,
                signal: this._signal?.signal,
                onUpdate: (partial) => {
                    this._emit({
                        type: "tool_execution_update",
                        toolCallId: toolCall.id,
                        partialResult: partial,
                    });
                },
            });
            // AfterToolCall hook
            let finalResult = result;
            let terminate = false;
            if (this._config.afterToolCall) {
                const hookResult = await this._config.afterToolCall({
                    toolCall,
                    result: finalResult,
                    isError: false,
                    context: {
                        systemPrompt: this._state.systemPrompt,
                        messages: this._state.messages,
                        tools: this._state.tools,
                    },
                });
                if (hookResult) {
                    if (hookResult.details) {
                        finalResult = { ...finalResult, details: hookResult.details };
                    }
                    if (hookResult.terminate) {
                        terminate = true;
                    }
                }
            }
            this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls].filter((id) => id !== toolCall.id));
            this._emit({
                type: "tool_execution_end",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: finalResult,
            });
            return {
                role: "toolResult",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: finalResult.content,
                isError: false,
                timestamp: Date.now(),
            };
        }
        catch (err) {
            this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls].filter((id) => id !== toolCall.id));
            this._emit({
                type: "tool_execution_end",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result: { error: String(err) },
            });
            return {
                role: "toolResult",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: [{ type: "text", text: `Error executing ${toolCall.name}: ${String(err)}` }],
                isError: true,
                timestamp: Date.now(),
            };
        }
    }
    _emit(event) {
        this._eventStream.push(event);
    }
}
//# sourceMappingURL=agent.js.map