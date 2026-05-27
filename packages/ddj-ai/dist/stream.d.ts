/**
 * Unified streaming API - dispatches to the right provider.
 */
import type { AssistantMessage, Context, Model, StreamEvent, ThinkingLevel } from "./types.js";
export interface StreamOptions {
    apiKey?: string;
    signal?: AbortSignal;
    thinkingLevel?: ThinkingLevel;
}
export declare function stream(model: Model<string>, context: Context, options?: StreamOptions): AsyncGenerator<StreamEvent, AssistantMessage, undefined>;
export declare function complete(model: Model<string>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
//# sourceMappingURL=stream.d.ts.map