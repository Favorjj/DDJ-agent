/**
 * DeepSeek API provider — first-class citizen with full optimizations.
 *
 * DeepSeek-specific features:
 * - reasoning_content in delta/message for thinking visibility
 * - reasoning_effort: low/medium/high/max (mapped from ThinkingLevel)
 * - thinking.type: "enabled" for all non-off levels
 * - reasoning_content MUST be preserved in assistant messages for tool-call turns
 * - 1M context window (1000000 tokens)
 * - max_completion_tokens auto-set when thinking is enabled
 */
import type { AssistantMessage, Context, Model, StreamEvent, ThinkingLevel } from "../types.js";
export interface DeepSeekConfig {
    apiKey?: string;
    signal?: AbortSignal;
    thinkingLevel?: ThinkingLevel;
}
export declare function streamDeepSeek(model: Model<string>, context: Context, config: DeepSeekConfig): AsyncGenerator<StreamEvent, AssistantMessage, undefined>;
export declare function completeDeepSeek(model: Model<string>, context: Context, config: DeepSeekConfig): Promise<AssistantMessage>;
//# sourceMappingURL=deepseek.d.ts.map