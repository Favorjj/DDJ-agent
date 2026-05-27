/**
 * Type definitions for @ddj-ai/core
 * Shared across all packages, no external dependencies.
 */

import type { Static, TSchema } from "typebox";

/** Provider identifiers */
export type Provider =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "google"
  | "mistral"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel"
  | "minimax"
  | "ollama";

/** Content block types */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError?: boolean;
}

export type ContentBlock = TextContent | ToolCallContent | ToolResultContent;

/** Message roles */
export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  stopReason: StopReason;
  usage?: TokenUsage;
  timestamp?: number;
  /** DeepSeek thinking/reasoning content. Must be included in assistant messages for tool-call turns. */
  reasoning_content?: string;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError?: boolean;
  timestamp?: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** Stop reasons from LLM */
export type StopReason =
  | "stop"
  | "toolCalls"
  | "error"
  | "aborted"
  | "unknown";

/** Token usage */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
  cost?: { total: number; inputCost?: number; outputCost?: number; cacheReadCost?: number };
}

/** Cost tracking */
export interface CostUsage {
  total: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
  cost: CostUsage;
}

/** Tool definition using TypeBox */
export interface Tool {
  name: string;
  description: string;
  parameters: TSchema;
}

/** Context for LLM calls */
export interface Context {
  systemPrompt: string;
  messages: Message[];
  tools?: Tool[];
}

/** Model specification */
export interface Model<P extends string = string> {
  provider: P;
  id: string;
  label?: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsThinking?: boolean;
  maxTokens?: number;
  thinkingBudgets?: Partial<Record<ThinkingLevel, number>>;
}

/** Thinking levels */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

/** Image content for vision */
export interface ImageContentBlock {
  type: "image";
  data: string; // base64
  mimeType: string;
}

/* ============================================================
 * Event types for streaming
 * ============================================================ */

export interface EventStart {
  type: "start";
  partial: AssistantMessage;
}

export interface EventTextStart {
  type: "text_start";
  partial: AssistantMessage;
}

export interface EventTextDelta {
  type: "text_delta";
  delta: string;
  partial: AssistantMessage;
}

export interface EventTextEnd {
  type: "text_end";
  partial: AssistantMessage;
}

export interface EventThinkingStart {
  type: "thinking_start";
  partial: AssistantMessage;
}

export interface EventThinkingDelta {
  type: "thinking_delta";
  delta: string;
  partial: AssistantMessage;
}

export interface EventThinkingEnd {
  type: "thinking_end";
  partial: AssistantMessage;
}

export interface EventToolCallStart {
  type: "toolcall_start";
  partial: AssistantMessage;
  contentIndex: number;
}

export interface EventToolCallDelta {
  type: "toolcall_delta";
  partial: AssistantMessage;
  contentIndex: number;
}

export interface EventToolCallEnd {
  type: "toolcall_end";
  toolCall: ToolCallContent;
  partial: AssistantMessage;
}

export interface EventDone {
  type: "done";
  reason: StopReason;
  message: AssistantMessage;
}

export interface EventError {
  type: "error";
  error: unknown;
}

export type StreamEvent =
  | EventStart
  | EventTextStart
  | EventTextDelta
  | EventTextEnd
  | EventThinkingStart
  | EventThinkingDelta
  | EventThinkingEnd
  | EventToolCallStart
  | EventToolCallDelta
  | EventToolCallEnd
  | EventDone
  | EventError;