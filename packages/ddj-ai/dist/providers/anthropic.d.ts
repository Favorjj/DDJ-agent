/**
 * Anthropic API provider (Claude).
 */
import type { AssistantMessage, Context, Model, StreamEvent, ThinkingLevel } from "../types.js";
export interface AnthropicConfig {
    apiKey?: string;
    baseUrl?: string;
}
export declare function streamAnthropic(model: Model<string>, context: Context, config: AnthropicConfig & {
    signal?: AbortSignal;
    thinkingLevel?: ThinkingLevel;
}): AsyncGenerator<StreamEvent, AssistantMessage, undefined>;
export declare function completeAnthropic(model: Model<string>, context: Context, config: AnthropicConfig & {
    signal?: AbortSignal;
    thinkingLevel?: ThinkingLevel;
}): Promise<AssistantMessage>;
//# sourceMappingURL=anthropic.d.ts.map