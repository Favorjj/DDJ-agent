/**
 * Unified streaming API — dispatches to the right provider.
 *
 * Routes:
 *   deepseek   → deepseek.ts   (first-class, full optimizations)
 *   anthropic  → anthropic.ts  (Claude)
 *   all others → openai-compatible.ts (OpenAI, Groq, Ollama, MiniMax, etc.)
 */
import { getProviderApiKey, getProviderBaseUrl } from "./models.js";
export async function* stream(model, context, options = {}) {
    // DeepSeek — first-class provider
    if (model.provider === "deepseek") {
        const { streamDeepSeek } = await import("./providers/deepseek.js");
        return yield* streamDeepSeek(model, context, {
            apiKey: options.apiKey || getProviderApiKey(model.provider),
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
    }
    // Anthropic — Claude
    if (model.provider === "anthropic") {
        const { streamAnthropic } = await import("./providers/anthropic.js");
        return yield* streamAnthropic(model, context, {
            apiKey: options.apiKey || getProviderApiKey(model.provider),
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
    }
    // OpenAI-compatible for all other providers
    const { streamOpenAI } = await import("./providers/openai-compatible.js");
    return yield* streamOpenAI(model, context, {
        apiKey: options.apiKey || getProviderApiKey(model.provider),
        baseUrl: getProviderBaseUrl(model.provider),
        signal: options.signal,
        thinkingLevel: options.thinkingLevel,
    });
}
export async function complete(model, context, options = {}) {
    if (model.provider === "deepseek") {
        const { completeDeepSeek } = await import("./providers/deepseek.js");
        return completeDeepSeek(model, context, {
            apiKey: options.apiKey || getProviderApiKey(model.provider),
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
    }
    if (model.provider === "anthropic") {
        const { completeAnthropic } = await import("./providers/anthropic.js");
        return completeAnthropic(model, context, {
            apiKey: options.apiKey || getProviderApiKey(model.provider),
            signal: options.signal,
            thinkingLevel: options.thinkingLevel,
        });
    }
    const { completeOpenAI } = await import("./providers/openai-compatible.js");
    return completeOpenAI(model, context, {
        apiKey: options.apiKey || getProviderApiKey(model.provider),
        baseUrl: getProviderBaseUrl(model.provider),
        signal: options.signal,
        thinkingLevel: options.thinkingLevel,
    });
}
//# sourceMappingURL=stream.js.map