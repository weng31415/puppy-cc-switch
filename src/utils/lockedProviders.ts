import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";

export const PUPPYROUTER_PROVIDER_IDS: Record<AppId, string> = {
  claude: "universal-claude-puppyrouter",
  "claude-desktop": "universal-claude-desktop-puppyrouter",
  codex: "universal-codex-puppyrouter",
  gemini: "universal-gemini-puppyrouter",
  grokbuild: "universal-grokbuild-puppyrouter",
  opencode: "puppyrouter",
  openclaw: "puppyrouter-cloud",
  hermes: "puppyrouter-cloud",
  pi: "puppyrouter-cloud",
  mcode: "puppyrouter-cloud",
  kimi: "puppyrouter-cloud",
  dsh: "puppyrouter-cloud",
  agy: "puppyrouter-cloud",
  omp: "puppyrouter-cloud",
  copilot: "puppyrouter-cloud",
  workbuddy: "puppyrouter-cloud",
};

const OFFICIAL_PROVIDER_IDS: Partial<Record<AppId, string>> = {
  claude: "claude-official",
  "claude-desktop": "claude-desktop-official",
  codex: "codex-official",
  gemini: "gemini-official",
  grokbuild: "grokbuild-official",
};

export function isPuppyRouterProvider(
  provider: Provider | undefined | null,
  appId?: AppId,
): boolean {
  if (
    !provider ||
    (provider.id === "puppyrouter-cloud" &&
      provider.meta?.providerType !== "puppyrouter")
  )
    return false;
  if (appId) return PUPPYROUTER_PROVIDER_IDS[appId] === provider.id;
  return Object.values(PUPPYROUTER_PROVIDER_IDS).includes(provider.id);
}

export function isLockedProvider(
  provider: Provider | undefined | null,
  appId?: AppId,
): boolean {
  return Boolean(
    provider &&
      ((appId
        ? OFFICIAL_PROVIDER_IDS[appId] === provider.id
        : Object.values(OFFICIAL_PROVIDER_IDS).includes(provider.id)) ||
        isPuppyRouterProvider(provider, appId)),
  );
}

export function getLockedProviderRank(
  provider: Provider,
  appId: AppId,
): number | null {
  if (isPuppyRouterProvider(provider, appId)) return 0;
  if (OFFICIAL_PROVIDER_IDS[appId] === provider.id) return 1;
  return null;
}

/** Running sessions of these four applications need a restart after switching a built-in card in direct mode. */
export function restartNoticeProvider(app: AppId, id: string): string | null {
  if (!["claude", "claude-desktop", "codex", "grokbuild"].includes(app))
    return null;
  if (PUPPYROUTER_PROVIDER_IDS[app] === id) return "PuppyRouter";
  return OFFICIAL_PROVIDER_IDS[app] === id ? "Official" : null;
}
