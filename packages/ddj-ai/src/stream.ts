/**
 * Unified streaming API - dispatches to the right provider.
 */

import type {
  AssistantMessage,
  Context,
  Model,
  StreamEvent,
  ThinkingLevel,
} from "./types.js";
import { getProviderApiKey, getProviderBaseUrl } from "./models.js";

export interface StreamOptions {
  apiKey?: string;
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevel;
}

export async function* stream(
  model: Model<string>,
  context: Context,
  options: StreamOptions = {}
): AsyncGenerator<StreamEvent, AssistantMessage, undefined> {
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

export async function complete(
  model: Model<string>,
  context: Context,
  options: StreamOptions = {}
): Promise<AssistantMessage> {
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
