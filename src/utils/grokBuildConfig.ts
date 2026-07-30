import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export const GROK_BUILD_DEFAULT_MODEL = "grok-4.5";
export const GROK_BUILD_DEFAULT_API_BACKEND = "responses";
export const GROK_BUILD_DEFAULT_CONTEXT_WINDOW = 500000;

export interface GrokBuildConfigValues {
  model: string;
  baseUrl: string;
  name: string;
  apiKey: string;
  apiBackend: string;
  contextWindow: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const normalizeBaseUrl = (value: string) =>
  value.trim().replace(/\/+$/, "");

function selectedModelConfig(configToml: string) {
  const root = asRecord(parseToml(configToml));
  const models = asRecord(root?.models);
  const profile = asString(models?.default);
  const modelTables = asRecord(root?.model);
  const selected = profile ? asRecord(modelTables?.[profile]) : undefined;

  return { profile, selected };
}

export function parseGrokBuildConfig(
  configToml: string | undefined,
  fallbackName = "",
): GrokBuildConfigValues {
  const fallback: GrokBuildConfigValues = {
    model: GROK_BUILD_DEFAULT_MODEL,
    baseUrl: "",
    name: fallbackName,
    apiKey: "",
    apiBackend: GROK_BUILD_DEFAULT_API_BACKEND,
    contextWindow: GROK_BUILD_DEFAULT_CONTEXT_WINDOW,
  };

  if (!configToml?.trim()) return fallback;

  try {
    const { profile, selected } = selectedModelConfig(configToml);
    const contextWindow = selected?.context_window;

    return {
      model: asString(selected?.model, profile || GROK_BUILD_DEFAULT_MODEL),
      baseUrl: normalizeBaseUrl(asString(selected?.base_url)),
      name: asString(selected?.name, fallbackName),
      apiKey: asString(selected?.api_key),
      apiBackend: asString(
        selected?.api_backend,
        GROK_BUILD_DEFAULT_API_BACKEND,
      ),
      contextWindow:
        typeof contextWindow === "number" &&
        Number.isInteger(contextWindow) &&
        contextWindow > 0
          ? contextWindow
          : GROK_BUILD_DEFAULT_CONTEXT_WINDOW,
    };
  } catch {
    return fallback;
  }
}

export function buildGrokBuildConfig(values: GrokBuildConfigValues): string {
  const model = values.model.trim() || GROK_BUILD_DEFAULT_MODEL;
  const contextWindow =
    Number.isInteger(values.contextWindow) && values.contextWindow > 0
      ? values.contextWindow
      : GROK_BUILD_DEFAULT_CONTEXT_WINDOW;

  return `${stringifyToml({
    models: { default: model },
    model: {
      [model]: {
        model,
        base_url: normalizeBaseUrl(values.baseUrl),
        name: values.name.trim(),
        api_key: values.apiKey.trim(),
        api_backend:
          values.apiBackend.trim() || GROK_BUILD_DEFAULT_API_BACKEND,
        context_window: contextWindow,
      },
    },
  }).trim()}\n`;
}

export function validateGrokBuildConfig(configToml: string): string | null {
  if (!configToml.trim()) return "config.toml must not be empty";

  try {
    const { profile, selected } = selectedModelConfig(configToml);
    if (!profile || !selected) return "Missing [models] default model table";
    if (Object.prototype.hasOwnProperty.call(selected, "env_key")) {
      return "env_key is not supported; use an inline api_key";
    }

    for (const field of [
      "model",
      "base_url",
      "name",
      "api_key",
      "api_backend",
    ]) {
      if (!asString(selected[field])) return `Missing ${field}`;
    }

    const contextWindow = selected.context_window;
    if (
      typeof contextWindow !== "number" ||
      !Number.isInteger(contextWindow) ||
      contextWindow <= 0
    ) {
      return "context_window must be a positive integer";
    }

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid TOML";
  }
}

export function extractGrokBuildBaseUrl(configToml: string | undefined): string {
  return parseGrokBuildConfig(configToml).baseUrl;
}

export function extractGrokBuildApiKey(configToml: string | undefined): string {
  return parseGrokBuildConfig(configToml).apiKey;
}
