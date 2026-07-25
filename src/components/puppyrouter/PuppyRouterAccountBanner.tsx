import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  CreditCard,
  KeyRound,
  Activity,
  Loader2,
  LogIn,
  LogOut,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import {
  puppyrouterAccountApi,
  providersApi,
  settingsApi,
  type AppId,
  type PuppyRouterAccountStatus,
  type PuppyRouterApiKey,
  type PuppyRouterLoginStart,
  vscodeApi,
} from "@/lib/api";
import {
  clearPuppyRouterAccountCache,
  markPuppyRouterApiKeyActive,
  puppyrouterAccountKeys,
  updateAllPuppyRouterApiKeyGroupCaches,
  usePuppyRouterAccountBalance,
  usePuppyRouterAccountGroups,
  usePuppyRouterAccountStatus,
  usePuppyRouterApiKeys,
} from "@/lib/query/puppyrouterAccount";
import { extractErrorMessage } from "@/utils/errorUtils";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { APP_ICON_MAP } from "@/config/appConfig";
import { PUPPYROUTER_PROVIDER_IDS } from "@/utils/lockedProviders";
import {
  extractCodexBaseUrl,
  getApiKeyFromConfig,
} from "@/utils/providerConfigUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PuppyRouterAccountBannerProps {
  activeApp: AppId;
}

const AUTO_APPLY_APP_IDS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
];

const MANUAL_ONLY_APP_IDS: AppId[] = ["openclaw", "hermes"];
const PUPPYROUTER_WALLET_URL = "https://www.puppyrouter.com/console/topup";

type DiagnoseFixAction = "cloud" | "live";

interface DiagnoseIssue {
  id: string;
  message: string;
  fixAction?: DiagnoseFixAction;
}

interface DiagnoseResult {
  appLabel: string;
  providerId?: string;
  selectedTokenId?: number;
  issues: DiagnoseIssue[];
}

function keyStatusLabel(t: TFunction, status: number) {
  switch (status) {
    case 1:
      return t("puppyrouterAccount.keyStatus.enabled");
    case 2:
      return t("puppyrouterAccount.keyStatus.disabled");
    case 3:
      return t("puppyrouterAccount.keyStatus.expired");
    case 4:
      return t("puppyrouterAccount.keyStatus.exhausted");
    default:
      return t("puppyrouterAccount.keyStatus.unknown");
  }
}

function formatUsdAmount(value: number) {
  const formatted = Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(4);
  const trimmed = formatted.replace(/\.?0+$/, "");
  return `$${trimmed === "-0" ? "0" : trimmed}`;
}

function formatQuotaUsd(quota: number, quotaPerUnit: number) {
  const safeQuotaPerUnit = quotaPerUnit > 0 ? quotaPerUnit : 500000;
  return formatUsdAmount(quota / safeQuotaPerUnit);
}

function chooseAutoApplyKey(keys: PuppyRouterApiKey[]) {
  return (
    keys.find((key) => key.active) ??
    keys.find((key) => key.recommended && key.usable) ??
    keys.find((key) => key.usable)
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function readStringPath(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function sameNonEmptyString(a: string, b: string) {
  return Boolean(a && b && a === b);
}

function sameUrl(a: string, b: string) {
  return Boolean(a && b && normalizeUrl(a) === normalizeUrl(b));
}

function isPuppyRouterUrl(value: string) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === "puppyrouter.com";
  } catch {
    return value.includes("puppyrouter.com");
  }
}

function resolveOpenCodeProviderSettings(
  settings: unknown,
  providerId?: string,
): unknown {
  if (!providerId || !isRecord(settings)) return settings;
  const providers = settings.provider;
  if (!isRecord(providers)) return settings;
  return providers[providerId] ?? settings;
}

function readBaseUrlFromSettings(
  appId: AppId,
  settings: unknown,
  providerId?: string,
) {
  if (appId === "codex") {
    return extractCodexBaseUrl(readStringPath(settings, ["config"])) ?? "";
  }
  if (appId === "gemini") {
    return readStringPath(settings, ["env", "GOOGLE_GEMINI_BASE_URL"]);
  }
  if (appId === "opencode") {
    return readStringPath(
      resolveOpenCodeProviderSettings(settings, providerId),
      ["options", "baseURL"],
    );
  }
  return readStringPath(settings, ["env", "ANTHROPIC_BASE_URL"]);
}

function readApiKeyFromSettings(
  appId: AppId,
  settings: unknown,
  providerId?: string,
) {
  if (appId === "opencode") {
    return readStringPath(
      resolveOpenCodeProviderSettings(settings, providerId),
      ["options", "apiKey"],
    );
  }
  if (!isRecord(settings)) return "";
  return getApiKeyFromConfig(JSON.stringify(settings), appId);
}

export function PuppyRouterAccountBanner({
  activeApp,
}: PuppyRouterAccountBannerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const {
    data: account,
    isLoading: isLoadingAccount,
    isError: isAccountError,
  } = usePuppyRouterAccountStatus();
  const effectiveAccount =
    account ?? (isAccountError ? { loggedIn: false } : null);
  const isLoggedIn = effectiveAccount?.loggedIn ?? false;
  const { data: balance, isFetching: isBalanceFetching } =
    usePuppyRouterAccountBalance(isLoggedIn);
  const { data: accountGroups, isFetching: isGroupsFetching } =
    usePuppyRouterAccountGroups(isLoggedIn);
  const { data: keyList, isFetching: isKeysFetching } = usePuppyRouterApiKeys(
    isLoggedIn,
    activeApp,
  );
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [isRefreshingKeys, setIsRefreshingKeys] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginStart, setLoginStart] = useState<PuppyRouterLoginStart | null>(
    null,
  );
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isCopyingLoginLink, setIsCopyingLoginLink] = useState(false);
  const [isPollingLogin, setIsPollingLogin] = useState(false);
  const [loginPollMessage, setLoginPollMessage] = useState("");
  const [applyingKeyId, setApplyingKeyId] = useState<number | null>(null);
  const [changingGroupKeyId, setChangingGroupKeyId] = useState<number | null>(
    null,
  );
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isDiagnoseOpen, setIsDiagnoseOpen] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(
    null,
  );
  const [fixingDiagnoseAction, setFixingDiagnoseAction] =
    useState<DiagnoseFixAction | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isLoadingBalance = isBalanceFetching || isRefreshingBalance;
  const isLoadingKeys = isKeysFetching || isRefreshingKeys;

  const isManualOnlyApp = MANUAL_ONLY_APP_IDS.includes(activeApp);
  const quotaPerUnit =
    balance?.quotaPerUnit && balance.quotaPerUnit > 0
      ? balance.quotaPerUnit
      : 500000;

  const supportedApps = useMemo(
    () =>
      AUTO_APPLY_APP_IDS.map((appId) => ({
        id: appId,
        label: APP_ICON_MAP[appId].label,
        icon: APP_ICON_MAP[appId].icon,
      })),
    [],
  );

  const loadKeys = useCallback(
    async (options?: { autoApplyDefault?: boolean }) => {
      setIsRefreshingKeys(true);
      try {
        const result = await puppyrouterAccountApi.listApiKeys(activeApp);
        queryClient.setQueryData(
          puppyrouterAccountKeys.apiKeys(activeApp),
          result,
        );

        if (options?.autoApplyDefault && !isManualOnlyApp) {
          const target = chooseAutoApplyKey(result.keys);
          if (target && !target.active && target.usable) {
            setApplyingKeyId(target.id);
            const applied = await puppyrouterAccountApi.applyApiKey(
              target.id,
              activeApp,
            );
            queryClient.setQueryData(
              puppyrouterAccountKeys.apiKeys(activeApp),
              markPuppyRouterApiKeyActive(result, target.id),
            );
            void queryClient.invalidateQueries({
              queryKey: ["providers"],
            });
            toast.success(
              t("puppyrouterAccount.autoSyncSuccess", {
                name: applied.name,
                app: APP_ICON_MAP[activeApp].label,
              }),
            );
          }
        }
      } catch (error) {
        console.error("[PuppyRouterAccountBanner] Failed to load keys", error);
        toast.error(
          t("puppyrouterAccount.loadKeysFailed", {
            error: extractErrorMessage(error),
          }),
        );
      } finally {
        setIsRefreshingKeys(false);
        setApplyingKeyId(null);
      }
    },
    [activeApp, isManualOnlyApp, queryClient, t],
  );

  const loadBalance = useCallback(async () => {
    setIsRefreshingBalance(true);
    try {
      const result = await puppyrouterAccountApi.getBalance();
      queryClient.setQueryData(puppyrouterAccountKeys.balance(), result);
    } catch (error) {
      console.error("[PuppyRouterAccountBanner] Failed to load balance", error);
      toast.error(
        t("puppyrouterAccount.loadBalanceFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsRefreshingBalance(false);
    }
  }, [queryClient, t]);

  const handleOpenWallet = async () => {
    try {
      await settingsApi.openExternal(PUPPYROUTER_WALLET_URL);
    } catch (error) {
      toast.error(
        t("puppyrouterAccount.openWalletFailed", {
          error: extractErrorMessage(error),
        }),
      );
    }
  };

  const resetLoginState = useCallback(() => {
    setLoginStart(null);
    setLoginPollMessage("");
    setIsPollingLogin(false);
  }, []);

  const finishApprovedLogin = useCallback(
    async (accountStatus: PuppyRouterAccountStatus) => {
      setIsLoginOpen(false);
      resetLoginState();
      toast.success(t("puppyrouterAccount.loginSuccess"));
      try {
        await loadKeys({ autoApplyDefault: true });
        await loadBalance();
      } finally {
        queryClient.setQueryData(
          puppyrouterAccountKeys.status(),
          accountStatus,
        );
      }
    },
    [loadBalance, loadKeys, queryClient, resetLoginState, t],
  );

  const handleStartBrowserLogin = async () => {
    if (loginStart?.authorizeUrl) {
      try {
        await settingsApi.openExternal(loginStart.authorizeUrl);
      } catch (error) {
        toast.error(
          t("puppyrouterAccount.openBrowserFailed", {
            error: extractErrorMessage(error),
          }),
        );
      }
      return;
    }

    setIsStartingLogin(true);
    try {
      const start = await puppyrouterAccountApi.beginLogin();
      setLoginStart(start);
      setLoginPollMessage(t("puppyrouterAccount.waitingForBrowser"));
      await settingsApi.openExternal(start.authorizeUrl);
    } catch (error) {
      console.error(
        "[PuppyRouterAccountBanner] Failed to start browser login",
        error,
      );
      toast.error(
        t("puppyrouterAccount.loginFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsStartingLogin(false);
    }
  };

  const handleCopyLoginLink = async () => {
    setIsCopyingLoginLink(true);
    try {
      let authorizeUrl = loginStart?.authorizeUrl;
      if (!authorizeUrl) {
        const start = await puppyrouterAccountApi.beginLogin();
        setLoginStart(start);
        setLoginPollMessage(t("puppyrouterAccount.waitingForBrowser"));
        authorizeUrl = start.authorizeUrl;
      }

      await copyText(authorizeUrl);
      toast.success(t("puppyrouterAccount.copyLoginLinkSuccess"));
    } catch (error) {
      console.error(
        "[PuppyRouterAccountBanner] Failed to copy login link",
        error,
      );
      toast.error(
        t("puppyrouterAccount.copyLoginLinkFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsCopyingLoginLink(false);
    }
  };

  useEffect(() => {
    if (!isLoginOpen || !loginStart?.deviceCode) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      setIsPollingLogin(true);
      try {
        const result = await puppyrouterAccountApi.pollLogin(
          loginStart.deviceCode,
        );
        if (cancelled) return;

        if (result.status === "approved") {
          setIsPollingLogin(false);
          await finishApprovedLogin(result.account);
          return;
        }

        if (result.status === "pending") {
          setLoginPollMessage(
            result.message || t("puppyrouterAccount.waitingForApproval"),
          );
          timer = window.setTimeout(
            poll,
            Math.max(1, result.interval || loginStart.interval || 2) * 1000,
          );
          return;
        }

        setIsPollingLogin(false);
        setLoginPollMessage("");
        setLoginStart(null);
        toast.error(
          t(`puppyrouterAccount.loginStatus.${result.status}`, {
            defaultValue:
              result.message || t("puppyrouterAccount.loginExpired"),
          }),
        );
      } catch (error) {
        if (cancelled) return;
        console.error("[PuppyRouterAccountBanner] Login polling failed", error);
        setIsPollingLogin(false);
        toast.error(
          t("puppyrouterAccount.loginFailed", {
            error: extractErrorMessage(error),
          }),
        );
      }
    };

    timer = window.setTimeout(poll, 800);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [finishApprovedLogin, isLoginOpen, loginStart, t]);

  const handleApplyKey = async (key: PuppyRouterApiKey) => {
    if (isManualOnlyApp || !key.usable || applyingKeyId !== null) {
      return;
    }

    setApplyingKeyId(key.id);
    try {
      const result = await puppyrouterAccountApi.applyApiKey(key.id, activeApp);
      queryClient.setQueryData(
        puppyrouterAccountKeys.apiKeys(activeApp),
        markPuppyRouterApiKeyActive(keyList, key.id),
      );
      toast.success(
        t("puppyrouterAccount.syncSuccess", {
          name: result.name,
          app: APP_ICON_MAP[activeApp].label,
        }),
      );
      await queryClient.invalidateQueries({
        queryKey: ["providers", activeApp],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers", activeApp],
        type: "all",
      });
    } catch (error) {
      console.error("[PuppyRouterAccountBanner] Apply key failed", error);
      toast.error(
        t("puppyrouterAccount.syncFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setApplyingKeyId(null);
    }
  };

  const handleChangeKeyGroup = async (
    key: PuppyRouterApiKey,
    group: string,
  ) => {
    if (
      changingGroupKeyId !== null ||
      group === key.group ||
      group.trim() === ""
    ) {
      return;
    }

    setChangingGroupKeyId(key.id);
    try {
      const result = await puppyrouterAccountApi.updateApiKeyGroup(
        key.id,
        group,
      );
      updateAllPuppyRouterApiKeyGroupCaches(
        queryClient,
        result.tokenId,
        result.group,
        result.crossGroupRetry,
      );
      toast.success(
        t("puppyrouterAccount.groupChangeSuccess", {
          name: key.name,
          group: result.group,
        }),
      );
    } catch (error) {
      console.error(
        "[PuppyRouterAccountBanner] Change key group failed",
        error,
      );
      toast.error(
        t("puppyrouterAccount.groupChangeFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setChangingGroupKeyId(null);
    }
  };

  const handleDiagnosePuppyRouterConfig = async () => {
    if (isDiagnosing) return;

    const providerId = PUPPYROUTER_PROVIDER_IDS[activeApp];
    if (!providerId || isManualOnlyApp) {
      setDiagnoseResult({
        appLabel: APP_ICON_MAP[activeApp].label,
        issues: [
          {
            id: "manual-only",
            message: t("puppyrouterAccount.diagnoseManualOnly", {
              app: APP_ICON_MAP[activeApp].label,
            }),
          },
        ],
      });
      setIsDiagnoseOpen(true);
      return;
    }

    setIsDiagnosing(true);
    try {
      const providers = await providersApi.getAll(activeApp);
      const provider = providers[providerId];
      if (!provider) {
        setDiagnoseResult({
          appLabel: APP_ICON_MAP[activeApp].label,
          providerId,
          issues: [
            {
              id: "provider-missing",
              message: t("puppyrouterAccount.diagnoseProviderMissing", {
                app: APP_ICON_MAP[activeApp].label,
              }),
            },
          ],
        });
        setIsDiagnoseOpen(true);
        return;
      }

      const issues: DiagnoseIssue[] = [];
      const cloudKeys = await puppyrouterAccountApi.listApiKeys(activeApp);
      const selectedCloudKey =
        cloudKeys.selectedTokenId != null
          ? cloudKeys.keys.find((key) => key.id === cloudKeys.selectedTokenId)
          : undefined;
      const providerMatchesCloud = selectedCloudKey
        ? selectedCloudKey.providerKeyMatch
        : cloudKeys.keys.some((key) => key.providerKeyMatch);
      if (cloudKeys.selectedTokenId != null && !selectedCloudKey) {
        issues.push({
          id: "cloud-key-missing",
          message: t("puppyrouterAccount.diagnoseCloudKeyMissing"),
        });
      } else if (!providerMatchesCloud) {
        issues.push({
          id: "cloud-key-mismatch",
          message: t("puppyrouterAccount.diagnoseCloudKeyMismatch"),
          fixAction: cloudKeys.selectedTokenId != null ? "cloud" : undefined,
        });
      }

      if (activeApp !== "opencode") {
        const currentId = await providersApi
          .getCurrent(activeApp)
          .catch(() => "");
        if (currentId !== providerId) {
          issues.push({
            id: "provider-not-current",
            message: t("puppyrouterAccount.diagnoseProviderNotCurrent", {
              app: APP_ICON_MAP[activeApp].label,
            }),
            fixAction: "live",
          });
        }
      }

      const expectedBaseUrl = readBaseUrlFromSettings(
        activeApp,
        provider.settingsConfig,
        providerId,
      );
      const expectedApiKey = readApiKeyFromSettings(
        activeApp,
        provider.settingsConfig,
        providerId,
      );

      if (activeApp === "claude-desktop") {
        const status = await providersApi.getClaudeDesktopStatus();
        const liveBaseUrl = status.actualBaseUrl ?? "";
        const expectedDesktopBaseUrl =
          status.expectedBaseUrl || expectedBaseUrl;

        if (!status.supported) {
          issues.push({
            id: "claude-desktop-unsupported",
            message: t("claudeDesktop.statusUnsupported", {
              defaultValue: "当前平台暂不支持 Claude Desktop 3P 配置写入。",
            }),
          });
        } else if (!isPuppyRouterUrl(liveBaseUrl)) {
          issues.push({
            id: "endpoint-not-puppyrouter",
            message: t("puppyrouterAccount.diagnoseEndpointNotPuppyRouter", {
              app: APP_ICON_MAP[activeApp].label,
            }),
            fixAction: "live",
          });
        } else if (
          expectedDesktopBaseUrl &&
          !sameUrl(expectedDesktopBaseUrl, liveBaseUrl)
        ) {
          issues.push({
            id: "endpoint-mismatch",
            message: t("puppyrouterAccount.diagnoseEndpointMismatch"),
            fixAction: "live",
          });
        }

        if (status.supported) {
          if (!status.profileGatewayKeyConfigured) {
            issues.push({
              id: "key-missing",
              message: t("puppyrouterAccount.diagnoseKeyMissing"),
              fixAction: "live",
            });
          } else if (expectedApiKey && !status.gatewayTokenMatchesProvider) {
            issues.push({
              id: "key-mismatch",
              message: t("puppyrouterAccount.diagnoseKeyMismatch"),
              fixAction: "live",
            });
          }
        }

        setDiagnoseResult({
          appLabel: APP_ICON_MAP[activeApp].label,
          providerId,
          selectedTokenId: cloudKeys.selectedTokenId,
          issues,
        });
        setIsDiagnoseOpen(true);
        return;
      }

      let liveSettings: unknown;
      try {
        liveSettings = await vscodeApi.getLiveProviderSettings(activeApp);
      } catch (error) {
        setDiagnoseResult({
          appLabel: APP_ICON_MAP[activeApp].label,
          providerId,
          selectedTokenId: cloudKeys.selectedTokenId,
          issues: [
            {
              id: "live-read-failed",
              message: extractErrorMessage(error),
            },
          ],
        });
        setIsDiagnoseOpen(true);
        return;
      }

      const liveBaseUrl = readBaseUrlFromSettings(
        activeApp,
        liveSettings,
        providerId,
      );
      const liveApiKey = readApiKeyFromSettings(
        activeApp,
        liveSettings,
        providerId,
      );

      if (!isPuppyRouterUrl(liveBaseUrl)) {
        issues.push({
          id: "endpoint-not-puppyrouter",
          message: t("puppyrouterAccount.diagnoseEndpointNotPuppyRouter", {
            app: APP_ICON_MAP[activeApp].label,
          }),
          fixAction: "live",
        });
      } else if (expectedBaseUrl && !sameUrl(expectedBaseUrl, liveBaseUrl)) {
        issues.push({
          id: "endpoint-mismatch",
          message: t("puppyrouterAccount.diagnoseEndpointMismatch"),
          fixAction: "live",
        });
      }

      if (!liveApiKey) {
        issues.push({
          id: "key-missing",
          message: t("puppyrouterAccount.diagnoseKeyMissing"),
          fixAction: "live",
        });
      } else if (
        expectedApiKey &&
        !sameNonEmptyString(expectedApiKey, liveApiKey)
      ) {
        issues.push({
          id: "key-mismatch",
          message: t("puppyrouterAccount.diagnoseKeyMismatch"),
          fixAction: "live",
        });
      }

      setDiagnoseResult({
        appLabel: APP_ICON_MAP[activeApp].label,
        providerId,
        selectedTokenId: cloudKeys.selectedTokenId,
        issues,
      });
      setIsDiagnoseOpen(true);
    } catch (error) {
      setDiagnoseResult({
        appLabel: APP_ICON_MAP[activeApp].label,
        providerId,
        issues: [
          {
            id: "diagnose-failed",
            message: extractErrorMessage(error),
          },
        ],
      });
      setIsDiagnoseOpen(true);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleFixDiagnoseIssue = async (action: DiagnoseFixAction) => {
    if (!diagnoseResult || fixingDiagnoseAction) return;

    setFixingDiagnoseAction(action);
    try {
      if (action === "cloud") {
        if (diagnoseResult.selectedTokenId == null) {
          throw new Error(t("puppyrouterAccount.diagnoseCloudKeyMissing"));
        }
        await puppyrouterAccountApi.applyApiKey(
          diagnoseResult.selectedTokenId,
          activeApp,
        );
        await queryClient.invalidateQueries({
          queryKey: puppyrouterAccountKeys.apiKeys(activeApp),
        });
      } else {
        const providerId =
          diagnoseResult.providerId ?? PUPPYROUTER_PROVIDER_IDS[activeApp];
        if (!providerId) {
          throw new Error(
            t("puppyrouterAccount.diagnoseManualOnly", {
              app: APP_ICON_MAP[activeApp].label,
            }),
          );
        }
        await providersApi.switch(providerId, activeApp);
      }

      await queryClient.invalidateQueries({
        queryKey: ["providers", activeApp],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers", activeApp],
        type: "all",
      });
      await handleDiagnosePuppyRouterConfig();
    } catch (error) {
      toast.error(t("puppyrouterAccount.diagnoseFixFailed"), {
        description: extractErrorMessage(error),
        closeButton: true,
      });
    } finally {
      setFixingDiagnoseAction(null);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await puppyrouterAccountApi.logout();
      clearPuppyRouterAccountCache(queryClient);
      toast.success(t("puppyrouterAccount.logoutSuccess"));
    } catch (error) {
      toast.error(
        t("puppyrouterAccount.logoutFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (isLoadingAccount) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-card/80 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        {t("puppyrouterAccount.loading")}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      {!effectiveAccount?.loggedIn ? (
        <motion.div
          className="relative overflow-hidden rounded-lg border border-amber-400/40 bg-[linear-gradient(110deg,#080808,#15120a_52%,#2a1d06)] px-4 py-4 text-amber-50 shadow-[0_0_28px_rgba(245,158,11,0.16)]"
          animate={{
            boxShadow: [
              "0 0 18px rgba(245,158,11,0.14)",
              "0 0 36px rgba(245,158,11,0.28)",
              "0 0 18px rgba(245,158,11,0.14)",
            ],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.div
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-amber-200/20 to-transparent"
            animate={{ x: ["0%", "430%"] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
          />
          <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 rounded-lg border border-amber-300/35 bg-amber-300/10 p-2 text-amber-200">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {t("puppyrouterAccount.notLoggedInTitle")}
                </div>
                <div className="mt-1 max-w-3xl text-xs leading-5 text-amber-100/78">
                  {t("puppyrouterAccount.notLoggedInDescription")}
                </div>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => setIsLoginOpen(true)}
              className="shrink-0 border border-amber-300/40 bg-amber-300 text-black hover:bg-amber-200"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {t("puppyrouterAccount.loginCta")}
            </Button>
          </div>
        </motion.div>
      ) : (
        <div className="rounded-lg border border-primary/25 bg-[linear-gradient(110deg,rgba(10,10,10,0.94),rgba(24,20,12,0.92))] px-4 py-4 shadow-sm shadow-primary/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-primary/30 bg-primary/15 text-primary hover:bg-primary/20">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {t("puppyrouterAccount.loggedIn")}
                </Badge>
                <span className="truncate text-sm font-medium text-foreground">
                  {effectiveAccount.user?.displayName ||
                    effectiveAccount.user?.username}
                </span>
                {effectiveAccount.user?.group && (
                  <Badge variant="outline" className="border-primary/30">
                    {t("puppyrouterAccount.group", {
                      group: effectiveAccount.user.group,
                    })}
                  </Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t("puppyrouterAccount.syncTargets")}</span>
                {supportedApps.map((app) => (
                  <span
                    key={app.id}
                    className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-1"
                  >
                    {app.icon}
                    {app.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="flex min-h-8 max-w-full items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 text-xs text-muted-foreground">
                <WalletCards className="h-4 w-4 text-primary" />
                <span>{t("puppyrouterAccount.balance")}</span>
                <span className="font-mono font-semibold text-foreground">
                  {isLoadingBalance && !balance
                    ? t("puppyrouterAccount.balanceLoading")
                    : balance?.formattedBalance || "--"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void loadBalance()}
                  disabled={isLoadingBalance}
                  title={t("puppyrouterAccount.refreshBalance")}
                  aria-label={t("puppyrouterAccount.refreshBalance")}
                  className="h-6 w-6 rounded-md"
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      isLoadingBalance && "animate-spin",
                    )}
                  />
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleOpenWallet()}
                title={t("puppyrouterAccount.openWallet")}
                aria-label={t("puppyrouterAccount.openWallet")}
                className="border-primary/35 bg-primary/12 text-primary hover:bg-primary/20"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {t("puppyrouterAccount.topUp")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadKeys()}
                disabled={isLoadingKeys}
              >
                {isLoadingKeys ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t("common.refresh", { defaultValue: "刷新" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleDiagnosePuppyRouterConfig()}
                disabled={isDiagnosing}
                title={t("puppyrouterAccount.diagnose")}
                aria-label={t("puppyrouterAccount.diagnose")}
                className="border-amber-300/35 bg-amber-300/10 text-amber-100 hover:bg-amber-300/18"
              >
                {isDiagnosing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Activity className="mr-2 h-4 w-4" />
                )}
                {isDiagnosing
                  ? t("puppyrouterAccount.diagnosing")
                  : t("puppyrouterAccount.diagnose")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" />
                )}
                {t("puppyrouterAccount.logout")}
              </Button>
            </div>
          </div>

          {isManualOnlyApp && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>
                {t("puppyrouterAccount.manualOnly", {
                  app: APP_ICON_MAP[activeApp].label,
                })}
              </span>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-primary" />
                {t("puppyrouterAccount.keysTitle")}
              </div>
              {keyList && (
                <span className="text-xs text-muted-foreground">
                  {t("puppyrouterAccount.keysCount", {
                    count: keyList.keys.length,
                  })}
                </span>
              )}
            </div>

            {isLoadingKeys ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {t("puppyrouterAccount.loadingKeys")}
              </div>
            ) : keyList && keyList.keys.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {keyList.keys.map((apiKey) => (
                  <div
                    key={apiKey.id}
                    className={cn(
                      "group flex min-h-[180px] flex-col items-start justify-between rounded-lg border px-3 py-3 text-left transition",
                      apiKey.active
                        ? "border-primary/60 bg-primary/12 shadow-[0_0_18px_rgba(245,158,11,0.16)]"
                        : "border-border/70 bg-background/35 hover:border-primary/45 hover:bg-primary/8",
                      !apiKey.usable && "opacity-55",
                    )}
                  >
                    <div className="flex w-full min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {apiKey.name}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {apiKey.maskedKey}
                        </div>
                      </div>
                      {applyingKeyId === apiKey.id ||
                      changingGroupKeyId === apiKey.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : apiKey.active ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-border/70 text-[11px]",
                          apiKey.status === 1 &&
                            "border-emerald-500/35 text-emerald-300",
                        )}
                      >
                        {keyStatusLabel(t, apiKey.status)}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={
                              isGroupsFetching ||
                              !accountGroups?.length ||
                              changingGroupKeyId !== null
                            }
                            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-primary/30 bg-primary/8 px-2 text-[11px] text-primary outline-none transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-55"
                            title={t("puppyrouterAccount.changeCloudGroup")}
                            aria-label={t(
                              "puppyrouterAccount.changeCloudGroup",
                            )}
                          >
                            <span className="truncate">
                              {apiKey.group
                                ? t("puppyrouterAccount.cloudGroup", {
                                    group: apiKey.group,
                                  })
                                : t("puppyrouterAccount.noGroup")}
                            </span>
                            {changingGroupKeyId === apiKey.id ||
                            isGroupsFetching ? (
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="w-64 border-primary/25"
                        >
                          <DropdownMenuLabel>
                            {t("puppyrouterAccount.selectCloudGroup")}
                          </DropdownMenuLabel>
                          {accountGroups?.map((group) => (
                            <DropdownMenuItem
                              key={group.name}
                              disabled={changingGroupKeyId !== null}
                              onSelect={() =>
                                void handleChangeKeyGroup(apiKey, group.name)
                              }
                              className="items-start"
                            >
                              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                                {apiKey.group === group.name && (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="block font-medium">
                                  {group.name}
                                </span>
                                {group.description && (
                                  <span className="mt-0.5 block text-xs text-muted-foreground">
                                    {group.description}
                                  </span>
                                )}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {apiKey.recommended && (
                        <Badge className="bg-primary/15 text-primary hover:bg-primary/20">
                          {t("puppyrouterAccount.defaultKey")}
                        </Badge>
                      )}
                      {apiKey.active && (
                        <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20">
                          {t("puppyrouterAccount.activeKey")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-3 grid w-full grid-cols-2 gap-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                      <div className="min-w-0">
                        <div>{t("puppyrouterAccount.keyRemainingQuota")}</div>
                        <div className="mt-0.5 truncate font-mono font-semibold text-foreground">
                          {apiKey.unlimitedQuota
                            ? t("puppyrouterAccount.keyUnlimitedQuota")
                            : formatQuotaUsd(apiKey.remainQuota, quotaPerUnit)}
                        </div>
                      </div>
                      <div className="min-w-0 text-right">
                        <div>{t("puppyrouterAccount.keyUsedQuota")}</div>
                        <div className="mt-0.5 truncate font-mono font-semibold text-foreground">
                          {formatQuotaUsd(apiKey.usedQuota, quotaPerUnit)}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        isManualOnlyApp ||
                        !apiKey.usable ||
                        applyingKeyId !== null
                      }
                      onClick={() => void handleApplyKey(apiKey)}
                      className={cn(
                        "mt-3 w-full shadow-none",
                        apiKey.active
                          ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300/75 hover:border-emerald-500/35 hover:bg-emerald-500/10 hover:text-emerald-300"
                          : "border-emerald-500/45 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-500/16 hover:text-emerald-200",
                      )}
                    >
                      {applyingKeyId === apiKey.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : apiKey.active ? (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      ) : (
                        <KeyRound className="mr-2 h-4 w-4" />
                      )}
                      {isManualOnlyApp
                        ? t("puppyrouterAccount.manualApplyUnavailable")
                        : apiKey.active
                          ? t("puppyrouterAccount.appliedToApp", {
                              app: APP_ICON_MAP[activeApp].label,
                            })
                          : t("puppyrouterAccount.applyToApp", {
                              app: APP_ICON_MAP[activeApp].label,
                            })}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                {t("puppyrouterAccount.noKeys")}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={isDiagnoseOpen} onOpenChange={setIsDiagnoseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("puppyrouterAccount.diagnoseTitle")}</DialogTitle>
            <DialogDescription>
              {t("puppyrouterAccount.diagnoseDescription", {
                app: diagnoseResult?.appLabel ?? APP_ICON_MAP[activeApp].label,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-5">
            {diagnoseResult && diagnoseResult.issues.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-3 py-3 text-sm text-emerald-50">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div>
                  <div className="font-medium">
                    {t("puppyrouterAccount.diagnoseHealthy")}
                  </div>
                  <div className="mt-1 text-xs text-emerald-50/75">
                    {t("puppyrouterAccount.diagnoseSuccess", {
                      app:
                        diagnoseResult?.appLabel ??
                        APP_ICON_MAP[activeApp].label,
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                  {t("puppyrouterAccount.diagnoseIssuesTitle")}
                </div>
                {(diagnoseResult?.issues ?? []).map((issue) => (
                  <div
                    key={issue.id}
                    className="flex flex-col gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <span className="min-w-0 whitespace-pre-line">
                        {issue.message}
                      </span>
                    </div>
                    {issue.fixAction && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void handleFixDiagnoseIssue(issue.fixAction!)
                        }
                        disabled={fixingDiagnoseAction !== null || isDiagnosing}
                        className="shrink-0 border-primary/35 bg-primary/12 text-primary hover:bg-primary/20"
                      >
                        {fixingDiagnoseAction === issue.fixAction ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        {issue.fixAction === "cloud"
                          ? t("puppyrouterAccount.diagnoseFixCloudKey")
                          : t("puppyrouterAccount.diagnoseFixLiveConfig")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border-default bg-muted/20 px-6 py-5 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsDiagnoseOpen(false)}
              disabled={fixingDiagnoseAction !== null}
            >
              {t("common.close", { defaultValue: "关闭" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleDiagnosePuppyRouterConfig()}
              disabled={isDiagnosing || fixingDiagnoseAction !== null}
            >
              {isDiagnosing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Activity className="mr-2 h-4 w-4" />
              )}
              {t("puppyrouterAccount.diagnoseRecheck")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isLoginOpen}
        onOpenChange={(open) => {
          setIsLoginOpen(open);
          if (!open) resetLoginState();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("puppyrouterAccount.loginTitle")}</DialogTitle>
            <DialogDescription>
              {t("puppyrouterAccount.loginDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border border-primary/25 bg-primary/8 px-3 py-3 text-sm text-muted-foreground">
              {t("puppyrouterAccount.browserLoginHint")}
            </div>

            {loginStart && (
              <div className="space-y-3 rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-200">
                  {t("puppyrouterAccount.browserAuthCode")}
                </div>
                <div className="font-mono text-lg font-semibold text-amber-100">
                  {loginStart.userCode}
                </div>
                <div className="flex items-center gap-2 text-xs text-amber-100/75">
                  {isPollingLogin && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <span>
                    {loginPollMessage ||
                      t("puppyrouterAccount.waitingForApproval")}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border-default bg-muted/20 px-6 py-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsLoginOpen(false)}
              disabled={isStartingLogin || isCopyingLoginLink}
              className="w-full"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCopyLoginLink()}
              disabled={isStartingLogin || isCopyingLoginLink}
              className="w-full"
            >
              {isCopyingLoginLink ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {t("puppyrouterAccount.copyLoginLink")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleStartBrowserLogin()}
              disabled={isStartingLogin || isCopyingLoginLink}
              className="w-full"
            >
              {isStartingLogin ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : loginStart ? (
                <ExternalLink className="mr-2 h-4 w-4" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              {loginStart
                ? t("puppyrouterAccount.openBrowserAgain")
                : t("puppyrouterAccount.login")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
