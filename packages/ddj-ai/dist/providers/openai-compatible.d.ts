/**
 * OpenAI-compatible API provider.
 * Works for OpenAI, DeepSeek, Groq, Ollama, MiniMax, etc.
 *
 * DeepSeek-specific thinking/reasoning support:
 * - Uses `reasoning_content` field in delta/message (not standard OpenAI)
 * - Requires `extra_body.thinking = { type: "enabled" }` + `reasoning_effort`
 * - reasoning_content must be included in assistant messages for tool-call turns
 */
import type { AssistantMessage, Context, Model, StreamEvent, ThinkingLevel } from "../types.js";
export interface ProviderConfig {
    baseUrl?: string;
    apiKey?: string;
    signal?: AbortSignal;
    thinkingLevel?: ThinkingLevel;
}
export declare function streamOpenAI(model: Model<string>, context: Context, config: ProviderConfig): AsyncGenerator<StreamEvent, AssistantMessage, undefined>;
export declare function completeOpenAI(model: Model<string>, context: Context, config: ProviderConfig): Promise<AssistantMessage>;
//# sourceMappingURL=openai-compatible.d.ts.map