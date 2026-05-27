/**
 * Agent runtime: drives the LLM <-> tool loop with full event streaming.
 *
 * Architecture:
 *   prompt() → LLM stream → tool execution → LLM stream → ... → done
 *   Each turn: one LLM call + zero or more tool executions
 */
import type { AgentConfig, AgentEvent, AgentMessage, AgentState, AgentAssistantMessage } from "./types.js";
export declare class Agent {
    private _state;
    private _config;
    private _eventStream;
    private _signal?;
    private _steeringQueue;
    private _followUpQueue;
    constructor(config: AgentConfig);
    get state(): AgentState;
    get streamingMessage(): AgentAssistantMessage | undefined;
    /** Subscribe to agent events. Returns unsubscribe function. */
    subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void;
    /** Abort the current operation */
    abort(): void;
    /** Wait for the current operation to finish */
    waitForIdle(): Promise<AgentMessage[]>;
    /** Send a steering message (interrupts during tool execution, delivered after current turn) */
    steer(message: AgentMessage): void;
    /** Queue a follow-up message (delivered after all tool calls finish) */
    followUp(message: AgentMessage): void;
    clearSteeringQueue(): void;
    clearFollowUpQueue(): void;
    clearAllQueues(): void;
    get steeringMode(): string;
    get followUpMode(): string;
    /**
     * Main entry: send a prompt to the agent.
     * Accepts a text string, or a full AgentMessage.
     */
    prompt(input: string | AgentMessage): Promise<AgentMessage[]>;
    /**
     * Continue from current context (last message must be user or toolResult).
     * Used for retries after errors.
     */
    continue(): Promise<AgentMessage[]>;
    /** Reset agent state */
    reset(): void;
    private _run;
    private _agentLoop;
    private _callLlm;
    private _executeTool;
    private _emit;
}
//# sourceMappingURL=agent.d.ts.map