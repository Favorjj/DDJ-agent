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
export declare const PROVIDERS: Record<string, ProviderEntry>;
export declare function getModel<P extends string>(provider: P, modelId: string): Model<P>;
export declare function listProviders(): Array<{
    id: string;
    label: string;
}>;
export declare function listModels(provider: string): Array<{
    id: string;
    label: string;
    supportsTools: boolean;
}>;
export declare function getProviderApiKey(provider: string): string | undefined;
export declare function getProviderBaseUrl(provider: string): string | undefined;
//# sourceMappingURL=models.d.ts.map