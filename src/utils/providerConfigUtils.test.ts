import { afterEach, describe, expect, it } from "vitest";
import {
  hasCommonConfigSnippet,
  isCodexRemoteCompactionEnabled,
  setCodexRemoteCompaction,
  updateCommonConfigSnippet,
} from "./providerConfigUtils";

describe("Codex remote compaction config helpers", () => {
  it("enables remote compaction by naming the active custom provider OpenAI", () => {
    const input = `model_provider = "custom"
model = "gpt-5.4"

[model_providers.custom]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"

[model_providers.backup]
name = "Backup"
base_url = "https://backup.example/v1"
`;

    const result = setCodexRemoteCompaction(input, true, "AIHubMix");

    expect(isCodexRemoteCompactionEnabled(result)).toBe(true);
    expect(result).toContain(`[model_providers.custom]\nname = "OpenAI"`);
    expect(result).toContain(`[model_providers.backup]\nname = "Backup"`);
  });

  it("disables remote compaction by restoring the provider display name", () => {
    const input = `model_provider = "custom"

[model_providers.custom]
name = "OpenAI"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"
`;

    const result = setCodexRemoteCompaction(input, false, "AIHubMix");

    expect(isCodexRemoteCompactionEnabled(result)).toBe(false);
    expect(result).toContain(`name = "AIHubMix"`);
  });

  it("does not rewrite reserved built-in providers", () => {
    const input = `model_provider = "openai"
model = "gpt-5"
`;

    expect(setCodexRemoteCompaction(input, true, "OpenAI")).toBe(input);
    expect(isCodexRemoteCompactionEnabled(input)).toBe(false);
  });
});

describe("common config snippet prototype-pollution guards", () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it("does not let a merged snippet reach Object.prototype", () => {
    const snippet = JSON.stringify({
      env: { SHARED_TIMEOUT_MS: "1000" },
      ["__proto__"]: { polluted: "YES" },
    });

    const result = updateCommonConfigSnippet("{}", snippet, true);

    expect(result.error).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.parse(result.updatedConfig).env.SHARED_TIMEOUT_MS).toBe("1000");
  });

  it("does not report a __proto__-only snippet as already applied", () => {
    expect(hasCommonConfigSnippet("{}", '{"__proto__":{}}')).toBe(false);
    expect(
      hasCommonConfigSnippet('{"env":{"A":"1"}}', '{"__proto__":{"x":1}}'),
    ).toBe(false);
  });

  it("keeps merge and applied-state consistent for a mixed snippet", () => {
    const snippet = JSON.stringify({
      env: { A: "1" },
      ["__proto__"]: { polluted: "YES" },
    });

    const merged = updateCommonConfigSnippet("{}", snippet, true).updatedConfig;

    expect(JSON.parse(merged).env.A).toBe("1");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(hasCommonConfigSnippet(merged, snippet)).toBe(true);
  });

  it("does not let an unmerged snippet delete from Object.prototype", () => {
    (Object.prototype as Record<string, unknown>).polluted = "YES";

    const result = updateCommonConfigSnippet(
      "{}",
      '{"__proto__":{"polluted":"YES"}}',
      false,
    );

    expect(result.error).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBe("YES");
  });
});
