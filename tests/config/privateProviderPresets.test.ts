import { describe, expect, it } from "vitest";
import { claudeDesktopProviderPresets } from "@/config/claudeDesktopProviderPresets";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { hermesProviderPresets } from "@/config/hermesProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";

describe("private provider presets", () => {
  it("keeps only official first-party entry points visible", () => {
    expect(providerPresets.map((preset) => preset.name)).toEqual([
      "Claude Official",
    ]);
    expect(codexProviderPresets.map((preset) => preset.name)).toEqual([
      "OpenAI Official",
    ]);
    expect(geminiProviderPresets.map((preset) => preset.name)).toEqual([
      "Google Official",
    ]);
    expect(claudeDesktopProviderPresets.map((preset) => preset.name)).toEqual([
      "Claude Desktop Official",
    ]);
  });

  it("does not ship third-party provider catalogs for other clients", () => {
    expect(opencodeProviderPresets).toEqual([]);
    expect(openclawProviderPresets).toEqual([]);
    expect(hermesProviderPresets).toEqual([]);
  });

  it("does not expose partner promotions from built-in presets", () => {
    const presets = [
      ...providerPresets,
      ...codexProviderPresets,
      ...geminiProviderPresets,
      ...claudeDesktopProviderPresets,
      ...opencodeProviderPresets,
      ...openclawProviderPresets,
      ...hermesProviderPresets,
    ];

    expect(presets.filter((preset) => preset.isPartner)).toEqual([]);
    expect(presets.filter((preset) => preset.primePartner)).toEqual([]);
  });
});
