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

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface DeepSeekConfig {
  apiKey?: string;
  signal?: AbortSignal;
  thinkingLevel?: ThinkingLevel;
}

/* ============================================================
 * Thinking level mapping
 * ============================================================ */

/** DeepSeek only supports "high" and "max". low/medium → high, xhigh → max */
function reasoningEffort(level: ThinkingLevel): string {
  if (level === "xhigh") return "max";
  if (level === "off") return "high";
  return "high";
}

/* ============================================================
 * Message converter (DeepSeek-specific)
 * ============================================================ */

function convertMessages(context: Context): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  if (context.systemPrompt) {
    result.push({ role: "system", content: context.systemPrompt });
  }

  for (const m of context.messages) {
    if (m.role === "toolResult") {
      const textContent = m.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      result.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: textContent,
      });
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

    // Assistant message: preserve reasoning_content (required for multi-turn tool calls)
    if (m.role === "assistant") {
      if (m.reasoning_content) {
        base.reasoning_content = m.reasoning_content;
      }

      const tcs = m.content.filter(
        (c): c is ToolCallContent => c.type === "toolCall"
      );
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
 * Request body builder (DeepSeek-specific)
 * ============================================================ */

function buildBody(
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
    max_tokens: 8192,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
  };

  // DeepSeek thinking mode
  if (thinkingLevel && thinkingLevel !== "off") {
    body.reasoning_effort = reasoningEffort(thinkingLevel);
    body.thinking = { type: "enabled" };
    body.max_tokens = 32768; // higher for thinking-heavy tasks
  }

  return body;
}

/* ============================================================
 * Streaming
 * ============================================================ */

export async function* streamDeepSeek(
  model: Model<string>,
  context: Context,
  config: DeepSeekConfig
): AsyncGenerator<StreamEvent, AssistantMessage, undefined> {
  const apiKey = config.apiKey || process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");

  const messages = convertMessages(context);
  const body = buildBody(model, messages, context, config.thinkingLevel, true);

  const signal = config.signal
    ? AbortSignal.any([config.signal, AbortSignal.timeout(300_000)])
    : AbortSignal.timeout(300_000);

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${text}`);
  }

  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    stopReason: "unknown",
    reasoning_content: "",
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
        if (isThinking) {
          yield { type: "thinking_end", partial: { ...partial } };
        }
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

      // reasoning_content delta — DeepSeek sends reasoning BEFORE text content
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

      // End thinking when text or tool calls arrive
      if (isThinking && (delta?.content !== undefined || delta?.tool_calls)) {
        isThinking = false;
        yield { type: "thinking_end", partial: { ...partial } };
      }

      // Text content
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
              // Incomplete JSON
            }
            yield { type: "toolcall_delta", partial: { ...partial }, contentIndex: idx };
          }
        }
      }

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

export async function completeDeepSeek(
  model: Model<string>,
  context: Context,
  config: DeepSeekConfig
): Promise<AssistantMessage> {
  const apiKey = config.apiKey || process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");

  const messages = convertMessages(context);
  const body = buildBody(model, messages, context, config.thinkingLevel, false);

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
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
    throw new Error(`DeepSeek API error ${response.status}: ${text}`);
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
      try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
      content.push({
        type: "toolCall",
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      });
    }
  }

  return {
    role: "assistant",
    content,
    stopReason: mapFinishReason(data.choices[0]?.finish_reason || "stop"),
    reasoning_content: choice.reasoning_content || undefined,
    usage: data.usage
      ? {
          input: data.usage.prompt_tokens,
          output: data.usage.completion_tokens,
          total: data.usage.prompt_tokens + data.usage.completion_tokens,
        }
      : undefined,
  };
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case "stop": return "stop";
    case "tool_calls": return "toolCalls";
    case "length": return "unknown";
    default: return "unknown";
  }
}
