/**
 * OpenAI-compatible API provider.
 * Works for OpenAI, DeepSeek, Groq, Ollama, MiniMax, etc.
 *
 * DeepSeek-specific thinking/reasoning support:
 * - Uses `reasoning_content` field in delta/message (not standard OpenAI)
 * - Requires `extra_body.thinking = { type: "enabled" }` + `reasoning_effort`
 * - reasoning_content must be included in assistant messages for tool-call turns
 */

import type {
  AssistantMessage,
  ContentBlock,
  Context,
  Model,
  StopReason,
  StreamEvent,
  TextContent,
  ThinkingLevel,
  ToolCallContent,
} from "../types.js";

export interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevel;
}

/* ============================================================
 * DeepSeek-specific helpers
 * ============================================================ */

/** Map our thinking levels to DeepSeek's reasoning_effort.
 * Pi's mapping: all standard levels → "high", only xhigh → "max".
 * DeepSeek only supports "high" and "max" as reasoning_effort values. */
function deepseekReasoningEffort(level: ThinkingLevel): string {
  const map: Record<string, string> = {
    off: "high",
    minimal: "high",
    low: "high",
    medium: "high",
    high: "high",
    xhigh: "max",
  };
  return map[level] || "high";
}

function isDeepSeek(model: Model<string>): boolean {
  return model.provider === "deepseek";
}

/* ============================================================
 * Request body builder
 * ============================================================ */

function buildRequestBody(
  model: Model<string>,
  messages: Record<string, unknown>[],
  context: Context,
  thinkingLevel?: ThinkingLevel,
  stream: boolean = true
): Record<string, unknown> {
  const tools = context.tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const body: Record<string, unknown> = {
    model: model.id,
    messages,
    ...(stream ? { stream: true } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
  };

  // DeepSeek thinking mode
  if (isDeepSeek(model)) {
    // DeepSeek V4 has thinking enabled by default; explicitly control it
    if (thinkingLevel && thinkingLevel !== "off") {
      body.reasoning_effort = deepseekReasoningEffort(thinkingLevel);
      body.thinking = { type: "enabled" };
    } else {
      body.thinking = { type: "disabled" };
    }
  }

  return body;
}

/* ============================================================
 * Message converter
 * ============================================================ */

function convertMessages(context: Context): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  // Include system prompt as a system message (required by DeepSeek API)
  if (context.systemPrompt) {
    const sysMsg: Record<string, unknown> = { role: "system", content: context.systemPrompt };
    result.push(sysMsg);
  }

  for (const m of context.messages) {
    if (m.role === "toolResult") {
      const textContent = m.content.map((c) =>
        c.type === "text" ? c.text : ""
      ).join("");
      result.push({
        role: "tool" as const,
        tool_call_id: m.toolCallId,
        content: textContent,
      } as Record<string, unknown>);
      continue;
    }

    const base: Record<string, unknown> = { role: m.role };

    if (typeof m.content === "string") {
      base.content = m.content;
    } else {
      base.content = m.content
        .filter((c) => c.type === "text")
        .map((c) => (c as TextContent).text)
        .join("");
    }

    // Assistant-specific fields
    if (m.role === "assistant") {
      const tcs = m.content.filter((c): c is ToolCallContent => c.type === "toolCall");

      // DeepSeek: preserve reasoning_content for tool-call turns
      if (m.reasoning_content) {
        base.reasoning_content = m.reasoning_content;
      }

      if (tcs.length > 0) {
        base.tool_calls = tcs.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
    }

    result.push(base);
  }

  return result;
}

/* ============================================================
 * Streaming
 * ============================================================ */

export async function* streamOpenAI(
  model: Model<string>,
  context: Context,
  config: ProviderConfig
): AsyncGenerator<StreamEvent, AssistantMessage, undefined> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const apiKey = config.apiKey || process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("No API key provided");

  const messages = convertMessages(context);
  const body = buildRequestBody(model, messages, context, config.thinkingLevel, true);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (model.provider === "cerebras") {
    headers["cerebras-version"] = "2024-12-01";
  }

  const signal = config.signal
    ? AbortSignal.any([config.signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    stopReason: "unknown",
    reasoning_content: "", // DeepSeek: accumulate reasoning content
  };

  const toolCallAccum: Record<number, { id: string; name: string; argsBuffer: string }> = {};
  let hasStarted = false;
  let isThinking = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6).trim();
      if (data === "[DONE]") {
        yield { type: "done", reason: partial.stopReason, message: partial };
        return partial;
      }

      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            role?: string;
            reasoning_content?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>;
      };

      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      if (!hasStarted && (delta?.content !== undefined || delta?.reasoning_content || delta?.tool_calls || choice.finish_reason)) {
        hasStarted = true;
        yield { type: "start", partial };
      }

      // DeepSeek thinking: reasoning_content comes as separate delta
      if (delta?.reasoning_content) {
        if (!isThinking) {
          isThinking = true;
          yield { type: "thinking_start", partial: { ...partial } };
        }
        partial.reasoning_content = (partial.reasoning_content || "") + delta.reasoning_content;
        yield {
          type: "thinking_delta",
          delta: delta.reasoning_content,
          partial: { ...partial },
        };
        continue;
      }

      // End thinking block if we were in one and now get text or tool calls
      if (isThinking && (delta?.content !== undefined || delta?.tool_calls)) {
        isThinking = false;
        yield { type: "thinking_end", partial: { ...partial } };
      }

      // Standard text content
      if (delta?.content !== undefined && delta.content !== null) {
        const textDelta = delta.content;
        const lastBlock = partial.content[partial.content.length - 1];
        if (lastBlock?.type === "text") {
          (lastBlock as TextContent).text += textDelta;
        } else {
          partial.content.push({ type: "text", text: textDelta });
          yield { type: "text_start", partial: { ...partial } };
          yield { type: "text_end", partial: { ...partial } };
        }
        yield { type: "text_delta", delta: textDelta, partial: { ...partial } };
      }

      // Tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;

          if (!toolCallAccum[idx]) {
            toolCallAccum[idx] = { id: tc.id || `call_${Date.now()}_${idx}`, name: "", argsBuffer: "" };

            const tcBlock: ToolCallContent = {
              type: "toolCall",
              id: toolCallAccum[idx].id,
              name: "",
              arguments: {},
            };
            partial.content.push(tcBlock);
            yield { type: "toolcall_start", partial: { ...partial }, contentIndex: idx };
          }

          if (tc.function?.name) {
            toolCallAccum[idx].name = tc.function.name;
            const block = partial.content[idx] as ToolCallContent | undefined;
            if (block) block.name = tc.function.name;
          }

          if (tc.function?.arguments) {
            toolCallAccum[idx].argsBuffer += tc.function.arguments;
            try {
              const block = partial.content[idx] as ToolCallContent;
              block.arguments = JSON.parse(toolCallAccum[idx].argsBuffer);
            } catch {
              // Incomplete JSON, keep buffering
            }
            yield { type: "toolcall_delta", partial: { ...partial }, contentIndex: idx };
          }
        }
      }

      // Finish reason
      if (choice.finish_reason) {
        partial.stopReason = mapFinishReason(choice.finish_reason);
      }
    }
  }

  if (isThinking) {
    yield { type: "thinking_end", partial: { ...partial } };
  }
  yield { type: "done", reason: partial.stopReason, message: partial };
  return partial;
}

/* ============================================================
 * Non-streaming
 * ============================================================ */

export async function completeOpenAI(
  model: Model<string>,
  context: Context,
  config: ProviderConfig
): Promise<AssistantMessage> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const apiKey = config.apiKey || process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("No API key provided");

  const messages = convertMessages(context);
  const body = buildRequestBody(model, messages, context, config.thinkingLevel, false);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([
      ...(config.signal ? [config.signal] : []),
      AbortSignal.timeout(120_000),
    ]),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: {
        role: string;
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };

  const choice = data.choices[0]?.message;
  if (!choice) throw new Error("No response choice");

  const content: ContentBlock[] = [];

  if (choice.content) {
    content.push({ type: "text", text: choice.content });
  }

  if (choice.tool_calls) {
    for (const tc of choice.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // ignore malformed JSON
      }
      content.push({
        type: "toolCall",
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      });
    }
  }

  const finishReason = data.choices[0]?.finish_reason || "stop";

  return {
    role: "assistant",
    content,
    stopReason: mapFinishReason(finishReason),
    reasoning_content: choice.reasoning_content || undefined, // DeepSeek-specific
    usage: data.usage
      ? {
          input: data.usage.prompt_tokens,
          output: data.usage.completion_tokens,
          total: data.usage.prompt_tokens + data.usage.completion_tokens,
        }
      : undefined,
  };
}

/* ============================================================
 * Helpers
 * ============================================================ */

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case "stop": return "stop";
    case "tool_calls": return "toolCalls";
    case "length": return "unknown";
    default: return "unknown";
  }
}
