import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";

export const PUPPYROUTER_UNIVERSAL_ID = "puppyrouter";
export const PUPPYROUTER_PROVIDER_IDS: Partial<Record<AppId, string>> = {
  claude: "universal-claude-puppyrouter",
  "claude-desktop": "universal-claude-desktop-puppyrouter",
  codex: "universal-codex-puppyrouter",
  gemini: "universal-gemini-puppyrouter",
};

export const OFFICIAL_PROVIDER_IDS: Partial<Record<AppId, string>> = {
  claude: "claude-official",
  "claude-desktop": "claude-desktop-official",
  codex: "codex-official",
  gemini: "gemini-official",
};

export const LOCKED_PROVIDER_APP_IDS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
];

export function isLockedProviderApp(appId: AppId): boolean {
  return LOCKED_PROVIDER_APP_IDS.includes(appId);
}

export function isPuppyRouterProvider(
  provider: Provider | undefined | null,
  appId?: AppId,
): boolean {
  if (!provider) return false;
  if (appId && PUPPYROUTER_PROVIDER_IDS[appId] === provider.id) {
    return true;
  }
  return Object.values(PUPPYROUTER_PROVIDER_IDS).includes(provider.id);
}

export function isPuppyRouterProviderId(providerId: string, appId: AppId) {
  return PUPPYROUTER_PROVIDER_IDS[appId] === providerId;
}

export function isOfficialProviderId(providerId: string, appId: AppId) {
  return OFFICIAL_PROVIDER_IDS[appId] === providerId;
}

export function isOfficialProvider(provider: Provider | undefined | null) {
  return provider?.category === "official";
}

export function isLockedProvider(
  provider: Provider | undefined | null,
  appId?: AppId,
): boolean {
  return isOfficialProvider(provider) || isPuppyRouterProvider(provider, appId);
}

export function getLockedProviderRank(
  provider: Provider,
  appId: AppId,
): number | null {
  if (isPuppyRouterProvider(provider, appId)) return 0;
  if (isOfficialProvider(provider)) return 1;
  return null;
}
