/**
 * OpenAI-compatible API provider.
 * Works for OpenAI, Groq, Ollama, MiniMax, Google, Cerebras, etc.
 *
 * Note: DeepSeek has been split into its own provider (deepseek.ts).
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