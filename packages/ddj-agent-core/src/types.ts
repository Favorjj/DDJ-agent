/**
 * Type definitions for @ddj-ai/agent-core
 * Built on top of @ddj-ai/core, adds agent-specific concepts.
 */

import type { Static, TSchema } from "typebox";
import type {
  AssistantMessage,
  Context as LlmContext,
  Message,
  Model,
  StopReason,
  ThinkingLevel,
  Tool,
} from "@ddj-ai/core";

/* ============================================================
 * AgentMessage - extended message type with optional custom roles
 * ============================================================ */

export type AgentMessage =
  | AgentUserMessage
  | AgentAssistantMessage
  | AgentToolResultMessage
  | { role: string; [key: string]: unknown };

export interface AgentUserMessage {
  role: "user";
  content: string | import("@ddj-ai/core").ContentBlock[];
  timestamp?: number;
}

export interface AgentAssistantMessage extends Omit<AssistantMessage, "role" | "stopReason"> {
  role: "assistant";
  stopReason: StopReason | "unknown";
  /** DeepSeek thinking/reasoning content */
  reasoning_content?: string;
}

export interface AgentToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: import("@ddj-ai/core").ContentBlock[];
  isError?: boolean;
  timestamp?: number;
}

/* ============================================================
 * Tools
 * ============================================================ */

export type AgentToolExecuteOptions = {
  toolCallId: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  onUpdate?: (partial: unknown) => void;
};

export interface AgentTool<T extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: T;
  /** Tool-specific execution mode. If "sequential", forces entire batch to run serially. */
  executionMode?: "parallel" | "sequential";
  execute(opts: AgentToolExecuteOptions): Promise<{ content: import("@ddj-ai/core").ContentBlock[]; details?: Record<string, unknown>; terminate?: boolean }>;
}

/* ============================================================
 * AgentContext - what the agent loop operates on
 * ============================================================ */

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool[];
}

/* ============================================================
 * Agent Events
 * ============================================================ */

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentAssistantMessage; toolResults: AgentToolResultMessage[]; cumulativeUsage?: import("@ddj-ai/core").TokenUsage }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "message_update"; assistantMessageEvent: import("@ddj-ai/core").StreamEvent; message: AgentAssistantMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_update"; toolCallId: string; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown }
  | { type: "error"; error: unknown };

/* ============================================================
 * AgentState
 * ============================================================ */

export interface AgentState {
  systemPrompt: string;
  model: Model;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingMessage?: AgentAssistantMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
  /** Cumulative token usage across all turns */
  cumulativeUsage?: import("@ddj-ai/core").TokenUsage;
  /** Workspace root directory for permission checks */
  workspaceRoot?: string;
  /** Project structure map from /scan command */
  projectMap?: string;
}

/* ============================================================
 * Hooks
 * ============================================================ */

export interface BeforeToolCallHookParams {
  toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  args: Record<string, unknown>;
  context: AgentContext;
}

export interface AfterToolCallHookParams {
  toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  result: { content: import("@ddj-ai/core").ContentBlock[]; details?: Record<string, unknown> };
  isError: boolean;
  context: AgentContext;
}

export interface ShouldStopAfterTurnParams {
  message: AgentAssistantMessage;
  toolResults: AgentToolResultMessage[];
  context: AgentContext;
  newMessages: AgentMessage[];
}

export interface PrepareNextTurnParams {
  message: AgentAssistantMessage;
  toolResults: AgentToolResultMessage[];
  context: AgentContext;
  newMessages: AgentMessage[];
}

export interface PrepareNextTurnResult {
  context?: AgentContext;
  model?: Model;
  thinkingLevel?: ThinkingLevel;
}

/* ============================================================
 * AgentConfig
 * ============================================================ */

export interface AgentConfig {
  initialState: {
    systemPrompt: string;
    model: Model;
    thinkingLevel?: ThinkingLevel;
    tools?: AgentTool[];
    messages?: AgentMessage[];
    workspaceRoot?: string;
    /** Project map injected after /scan — gives model full codebase overview */
    projectMap?: string;
  };
  /** Required: convert AgentMessage[] to LLM-compatible Message[] */
  convertToLlm(messages: AgentMessage[]): Message[] | Promise<Message[]>;
  /** Optional: transform context before each LLM call (pruning, compaction) */
  transformContext?(messages: AgentMessage[], signal?: AbortSignal): AgentMessage[] | Promise<AgentMessage[]>;
  /** Parallel or sequential tool execution */
  toolExecution?: "parallel" | "sequential";
  /** Run before each tool call; return { block: true, reason } to prevent execution */
  beforeToolCall?(params: BeforeToolCallHookParams): { block: boolean; reason?: string } | void | Promise<{ block: boolean; reason?: string } | void>;
  /** Run after each tool; can mutate result or set terminate */
  afterToolCall?(params: AfterToolCallHookParams): { details?: Record<string, unknown>; terminate?: boolean } | void | Promise<{ details?: Record<string, unknown>; terminate?: boolean } | void>;
  /** Called after each turn; return true to stop the loop early */
  shouldStopAfterTurn?(params: ShouldStopAfterTurnParams): boolean | Promise<boolean>;
  /** Called after turn_end; can modify context or model for next turn */
  prepareNextTurn?(params: PrepareNextTurnParams): PrepareNextTurnResult | Promise<PrepareNextTurnResult>;
  /** Resolve API key dynamically (for expiring tokens) */
  getApiKey?(provider: string): string | Promise<string>;
  /** Steering messages queued externally (e.g. from UI) */
  getSteeringMessages?(): AgentMessage[] | Promise<AgentMessage[]>;
  /** Follow-up messages queued externally */
  getFollowUpMessages?(): AgentMessage[] | Promise<AgentMessage[]>;
  /** Steering mode: how steering messages are delivered */
  steeringMode?: "one-at-a-time" | "all";
  /** Follow-up mode: how follow-up messages are delivered */
  followUpMode?: "one-at-a-time" | "all";
}

/* ============================================================
 * Streaming options for LLM calls
 * ============================================================ */

export interface LlmCallOptions {
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevel;
}