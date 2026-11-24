import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useApiKeyLink } from "@/components/providers/forms/hooks/useApiKeyLink";

type Props = Parameters<typeof useApiKeyLink>[0];
type Entries = Props["presetEntries"];

const claudePreset = (
  id: string,
  baseUrl: string,
  apiKeyUrl: string,
  partnerPromotionKey?: string,
) =>
  ({
    id,
    preset: {
      name: id,
      websiteUrl: `https://${id}.example`,
      apiKeyUrl,
      category: "aggregator",
      isPartner: Boolean(partnerPromotionKey),
      partnerPromotionKey,
      settingsConfig: { env: { ANTHROPIC_BASE_URL: baseUrl } },
    },
  }) as unknown as Entries[number];

const render = (props: Partial<Props>) =>
  renderHook(() =>
    useApiKeyLink({
      appId: "claude",
      category: "aggregator",
      selectedPresetId: null,
      presetEntries: [],
      formWebsiteUrl: "",
      ...props,
    }),
  ).result.current;

describe("useApiKeyLink", () => {
  const entries = [
    claudePreset(
      "hub",
      "https://hub.example.com",
      "https://hub.example/key?ref=cc",
      "hub",
    ),
    claudePreset(
      "other",
      "https://other.example.com/api",
      "https://other.example/key",
    ),
  ];

  it("does not supply a referral when adding or editing a known provider", () => {
    for (const selectedPresetId of [null, "hub"]) {
      const link = render({
        presetEntries: entries,
        selectedPresetId,
        formBaseUrl: "https://hub.example.com",
        formWebsiteUrl: "https://hub.example",
      });
      expect(link.shouldShowApiKeyLink).toBe(false);
      expect(link.websiteUrl).toBe("");
      expect(link.partnerPromotionKey).toBeUndefined();
    }
  });

  it("maps PuppyRouter websites to the account key page", () => {
    for (const website of [
      "https://puppyrouter.com",
      "https://www.puppyrouter.com/path?ref=example",
    ]) {
      const link = render({ formWebsiteUrl: website });
      expect(link.shouldShowApiKeyLink).toBe(true);
      expect(link.websiteUrl).toBe("https://puppyrouter.com/console/token");
    }
  });

  it.each([
    "",
    "https://puppyrouter.com.example",
    "https://puppyrouter.com@outside.example",
    "http://puppyrouter.com",
    "https://puppyrouter.com:444",
  ])("omits other destinations: %s", (website) => {
    expect(render({ formWebsiteUrl: website }).shouldShowApiKeyLink).toBe(
      false,
    );
  });

  it("preserves the official Gemini login hint", () => {
    const link = render({ appId: "gemini", category: "official" });
    expect(link.partnerPromotionKey).toBe("google-official");
    expect(link.shouldShowApiKeyLink).toBe(false);
  });
});
