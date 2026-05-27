/**
 * Unified streaming API - dispatches to the right provider.
 */
import { getProviderApiKey, getProviderBaseUrl } from "./models.js";
export async function* stream(model, context, options = {}) {
    if (model.provider === "anthropic") {
        const { streamAnthropic } = await import("./providers/anthropic.js");
        return yield* streamAnthropic(model, context, {
            apiKey: options.apiKey || getProviderApiKey(model.provider),
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
    }
    // OpenAI-compatible for all other providers (DeepSeek, MiniMax, Groq, etc.)
    const { streamOpenAI } = await import("./providers/openai-compatible.js");
    return yield* streamOpenAI(model, context, {
        apiKey: options.apiKey || getProviderApiKey(model.provider),
        baseUrl: getProviderBaseUrl(model.provider),
        signal: options.signal,
        thinkingLevel: options.thinkingLevel,
    });
}
export async function complete(model, context, options = {}) {
    if (model.provider === "anthropic") {
        const { completeAnthropic } = await import("./providers/anthropic.js");
        return completeAnthropic(model, context, {
            apiKey: options.apiKey || getProviderApiKey(model.provider),
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
    }
    // OpenAI-compatible for all other providers
    const { completeOpenAI } = await import("./providers/openai-compatible.js");
    return completeOpenAI(model, context, {
        apiKey: options.apiKey || getProviderApiKey(model.provider),
        baseUrl: getProviderBaseUrl(model.provider),
        signal: options.signal,
        thinkingLevel: options.thinkingLevel,
    });
}
//# sourceMappingURL=stream.js.map