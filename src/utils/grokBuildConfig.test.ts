import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  buildGrokBuildConfig,
  extractGrokBuildApiKey,
  extractGrokBuildBaseUrl,
  parseGrokBuildConfig,
  validateGrokBuildConfig,
} from "./grokBuildConfig";

describe("Grok Build config", () => {
  it("builds the expected Responses-compatible TOML", () => {
    const config = buildGrokBuildConfig({
      model: "grok-4.5",
      baseUrl: "https://puppyrouter.com/v1/",
      name: "PuppyRouter",
      apiKey: "sk-selected",
      apiBackend: "responses",
      contextWindow: 500000,
    });
    const parsed = parseToml(config) as {
      models: { default: string };
      model: Record<string, Record<string, unknown>>;
    };

    expect(parsed.models.default).toBe("grok-4.5");
    expect(parsed.model["grok-4.5"]).toEqual({
      model: "grok-4.5",
      base_url: "https://puppyrouter.com/v1",
      name: "PuppyRouter",
      api_key: "sk-selected",
      api_backend: "responses",
      context_window: 500000,
    });
    expect(validateGrokBuildConfig(config)).toBeNull();
  });

  it("reads the selected profile and its inline credential", () => {
    const config = buildGrokBuildConfig({
      model: "grok-custom",
      baseUrl: "https://relay.example.com/v1",
      name: "Relay",
      apiKey: "sk-relay",
      apiBackend: "responses",
      contextWindow: 320000,
    });

    expect(parseGrokBuildConfig(config)).toEqual({
      model: "grok-custom",
      baseUrl: "https://relay.example.com/v1",
      name: "Relay",
      apiKey: "sk-relay",
      apiBackend: "responses",
      contextWindow: 320000,
    });
    expect(extractGrokBuildBaseUrl(config)).toBe(
      "https://relay.example.com/v1",
    );
    expect(extractGrokBuildApiKey(config)).toBe("sk-relay");
  });

  it("rejects environment-key fallback configurations", () => {
    const config = `[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://relay.example.com/v1"
name = "Relay"
api_key = "sk-relay"
env_key = "XAI_API_KEY"
api_backend = "responses"
context_window = 500000
`;

    expect(validateGrokBuildConfig(config)).toBe(
      "env_key is not supported; use an inline api_key",
    );
  });
});
