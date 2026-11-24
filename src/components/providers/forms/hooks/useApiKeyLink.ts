import { puppyRouterKeyPage } from "@/lib/puppyrouterLinks";
import type { AppId } from "@/lib/api";
import type { ProviderCategory } from "@/types";
import type { ProviderPreset } from "@/config/claudeProviderPresets";
import type { CodexProviderPreset } from "@/config/codexProviderPresets";
import type { GeminiProviderPreset } from "@/config/geminiProviderPresets";
import type { OpenCodeProviderPreset } from "@/config/opencodeProviderPresets";
import type { ClaudeDesktopProviderPreset } from "@/config/claudeDesktopProviderPresets";

type PresetEntry = {
  id: string;
  preset:
    | ProviderPreset
    | CodexProviderPreset
    | GeminiProviderPreset
    | OpenCodeProviderPreset
    | ClaudeDesktopProviderPreset;
};

interface UseApiKeyLinkProps {
  appId: AppId;
  category?: ProviderCategory;
  selectedPresetId: string | null;
  presetEntries: PresetEntry[];
  formWebsiteUrl: string;
  /** 表单当前的请求地址；没选预设（编辑已有供应商）时按它反查预设 */
  formBaseUrl?: string;
}

export function useApiKeyLink({
  appId,
  category,
  formWebsiteUrl,
}: UseApiKeyLinkProps) {
  const websiteUrl = puppyRouterKeyPage(formWebsiteUrl);
  return {
    shouldShowApiKeyLink: Boolean(websiteUrl) && category !== "official",
    websiteUrl: websiteUrl ?? "",
    isPartner: false,
    partnerPromotionKey:
      appId === "gemini" && category === "official"
        ? "google-official"
        : undefined,
  };
}
