import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { generateThirdPartyConfig } from "@/config/codexProviderPresets";
import { getCodexCustomTemplate as getCodexTemplate } from "@/config/codexTemplates";

describe("Codex custom templates", () => {
  it("does not force Codex Goal mode in the custom provider template", () => {
    const template = getCodexTemplate();
    const parsed = parseToml(template.config) as {
      features?: { goals?: boolean };
      model_providers?: Record<string, unknown>;
    };

    expect(template.auth).toEqual({ OPENAI_API_KEY: "" });
    expect(parsed.features?.goals).toBeUndefined();
    expect(parsed.model_providers?.custom).toBeDefined();
    expect(
      (parsed.model_providers?.custom as { requires_openai_auth?: boolean })
        .requires_openai_auth,
    ).toBe(true);
  });

  it("includes the OpenAI auth requirement in generated third-party config", () => {
    const parsed = parseToml(
      generateThirdPartyConfig(
        "PuppyRouter",
        "https://puppyrouter.com/v1",
        "gpt-5.6",
      ),
    ) as {
      model_providers?: Record<string, { requires_openai_auth?: boolean }>;
    };

    expect(parsed.model_providers?.custom?.requires_openai_auth).toBe(true);
  });
});
