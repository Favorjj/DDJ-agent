/**
 * Model registry - available models per provider.
 * Mirrors pi's approach: curated list of tool-capable models.
 */

import type { Model } from "./types.js";

export interface ModelEntry {
  modelId: string;
  label: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsThinking?: boolean;
  maxTokens?: number;
}

export interface ProviderEntry {
  label: string;
  apiKeyEnv: string;
  baseUrl?: string;
  models: ModelEntry[];
}

export const PROVIDERS: Record<string, ProviderEntry> = {
  anthropic: {
    label: "Anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: [
      {
        modelId: "claude-sonnet-4-20250514",
        label: "Claude Sonnet 4",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
        maxTokens: 8192,
      },
      {
        modelId: "claude-3-5-sonnet-20241022",
        label: "Claude 3.5 Sonnet",
        supportsTools: true,
        supportsStreaming: true,
        maxTokens: 8192,
      },
      {
        modelId: "claude-3-5-haiku-20241022",
        label: "Claude 3.5 Haiku",
        supportsTools: true,
        supportsStreaming: true,
        maxTokens: 8192,
      },
    ],
  },
  openai: {
    label: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    models: [
      {
        modelId: "gpt-4o",
        label: "GPT-4o",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
      },
      {
        modelId: "gpt-4o-mini",
        label: "GPT-4o Mini",
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        modelId: "o4-mini",
        label: "o4-mini",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
      },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
    models: [
      {
        modelId: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
        maxTokens: 1000000,
      },
      {
        modelId: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
        maxTokens: 1000000,
      },
      {
        modelId: "deepseek-chat",
        label: "DeepSeek Chat (legacy)",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
      },
    ],
  },
  google: {
    label: "Google Gemini",
    apiKeyEnv: "GOOGLE_API_KEY",
    models: [
      {
        modelId: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        modelId: "gemini-2.5-flash-preview-05-20",
        label: "Gemini 2.5 Flash",
        supportsTools: true,
        supportsStreaming: true,
        supportsThinking: true,
      },
    ],
  },
  groq: {
    label: "Groq",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      {
        modelId: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B",
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        modelId: "mixtral-8x7b-32768",
        label: "Mixtral 8x7B",
        supportsTools: true,
        supportsStreaming: true,
      },
    ],
  },
  ollama: {
    label: "Ollama (Local)",
    apiKeyEnv: "OLLAMA_HOST",
    baseUrl: process.env["OLLAMA_HOST"] || "http://localhost:11434/v1",
    models: [
      {
        modelId: "llama3.2",
        label: "Llama 3.2",
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        modelId: "qwen2.5",
        label: "Qwen 2.5",
        supportsTools: true,
        supportsStreaming: true,
      },
    ],
  },
  minimax: {
    label: "MiniMax",
    apiKeyEnv: "MINIMAX_API_KEY",
    baseUrl: "https://api.minimax.chat/v1",
    models: [
      {
        modelId: "MiniMax-Text-01",
        label: "MiniMax Text 01",
        supportsTools: true,
        supportsStreaming: true,
      },
    ],
  },
};

export function getModel<P extends string>(
  provider: P,
  modelId: string
): Model<P> {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  const entry = p.models.find((m) => m.modelId === modelId);
  if (!entry) throw new Error(`Unknown model: ${provider}/${modelId}`);
  return {
    provider,
    id: modelId,
    label: entry.label,
    supportsTools: entry.supportsTools,
    supportsStreaming: entry.supportsStreaming,
    supportsThinking: entry.supportsThinking,
    maxTokens: entry.maxTokens,
  } as Model<P>;
}

export function listProviders(): Array<{ id: string; label: string }> {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label }));
}

export function listModels(
  provider: string
): Array<{ id: string; label: string; supportsTools: boolean }> {
  const p = PROVIDERS[provider];
  if (!p) return [];
  return p.models.map((m) => ({
    id: m.modelId,
    label: m.label,
    supportsTools: m.supportsTools,
  }));
}

export function getProviderApiKey(provider: string): string | undefined {
  const p = PROVIDERS[provider];
  if (!p) return undefined;
  return process.env[p.apiKeyEnv];
}

export function getProviderBaseUrl(provider: string): string | undefined {
  return PROVIDERS[provider]?.baseUrl;
}