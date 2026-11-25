import { APP_IDS } from "@/config/appSpecs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  PUPPYROUTER_SESSION_EXPIRED_EVENT,
  providersApi,
  settingsApi,
  isPuppyRouterSessionExpiredError,
  type AppId,
  type PuppyRouterAccountStatus,
  type PuppyRouterApiKey,
  type PuppyRouterApiKeyList,
  type PuppyRouterLoginStart,
  type PuppyRouterConfigReport,
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
import { useSettingsQuery } from "@/lib/query";
import { extractErrorMessage } from "@/utils/errorUtils";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  formatDisplayAmountFromUsd,
  formatQuotaForDisplay,
} from "@/utils/displayCurrency";
import { APP_ICON_MAP } from "@/config/appConfig";
import { PUPPYROUTER_PROVIDER_IDS } from "@/utils/lockedProviders";
import {
  needsClientRestart,
  routeSwitchNotification,
} from "@/utils/routeSwitchNotification";
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

const AUTO_APPLY_APP_IDS: AppId[] = [...APP_IDS];
const MANUAL_ONLY_APP_IDS: AppId[] = [];
const PUPPYROUTER_WALLET_URL = "https://puppyrouter.com/console/topup";

type DiagnoseFixAction = "cloud" | "live" | "enable";

interface DiagnoseIssue {
  id: string;
  fixAction?: DiagnoseFixAction;
}

interface DiagnoseResult {
  app: AppId;
  scope: PuppyRouterConfigReport["scope"];
  selectedTokenId?: number;
  issues: DiagnoseIssue[];
}

function localFix(
  issue: PuppyRouterConfigReport["issues"][number],
  scope: PuppyRouterConfigReport["scope"],
): DiagnoseFixAction | undefined {
  if (issue === "ProviderNotCurrent" || issue === "NativeMissing")
    return "enable";
  if (scope !== "direct" && scope !== "native") return;
  switch (issue) {
    case "EndpointMismatch":
    case "KeyMismatch":
    case "KeyMissing":
    case "CodexProviderTableMissing":
    case "CodexWireApiNotResponses":
    case "AuthSource":
    case "DesktopProfile":
    case "GeminiAuthMode":
    case "ModelConfigMismatch":
      return "live";
  }
}

function keyUsageFor(report?: PuppyRouterConfigReport) {
  if (!report) return;
  if (
    report.issues.length === 0 ||
    (report.scope === "staged" &&
      report.issues.every(
        (issue) =>
          issue === "ProviderNotCurrent" ||
          issue === "NativeMissing" ||
          issue === "ProxyNotSelected",
      ))
  )
    return report.scope;
}

function cloudIssue(
  list: PuppyRouterApiKeyList,
): { id: string; fixAction?: DiagnoseFixAction } | undefined {
  const selected = list.keys.find((key) => key.id === list.selectedTokenId);
  if (!list.keys.length || (list.selectedTokenId != null && !selected))
    return { id: "CloudKeyMissing" };
  const candidates = selected ? [selected] : list.keys;
  if (!candidates.some((key) => key.usable)) return { id: "CloudKeyUnusable" };
  if (candidates.some((key) => key.providerKeyMatch && key.usable)) return;
  if (candidates.some((key) => key.providerKeyMatch))
    return { id: "CloudKeyUnusable" };
  if (candidates.some((key) => key.usable && key.providerKeyMatch == null))
    return { id: "CloudUnverified" };
  return { id: "CloudKeyMismatch", fixAction: selected ? "cloud" : undefined };
}

async function readDiagnosis(app: AppId): Promise<DiagnoseResult> {
  const [local, cloud] = await Promise.allSettled([
    puppyrouterAccountApi.diagnoseConfig(app),
    puppyrouterAccountApi.listApiKeys(app),
  ]);
  if (
    cloud.status === "rejected" &&
    isPuppyRouterSessionExpiredError(cloud.reason)
  )
    throw cloud.reason;
  const report: PuppyRouterConfigReport =
    local.status === "fulfilled"
      ? local.value
      : { scope: "staged", issues: ["ReadFailed"] };
  const cloudProblem: DiagnoseIssue | undefined =
    cloud.status === "fulfilled"
      ? cloudIssue(cloud.value)
      : { id: "CloudUnverified" };
  const protectedConfig = report.issues.some(
    (id) =>
      id === "ProviderMissing" ||
      id === "SavedConfigInvalid" ||
      id === "ExternalAuth" ||
      id === "NativeProfileConflict" ||
      id === "NativeDisabled" ||
      id === "ReadFailed" ||
      id === "CodexConfigInvalid" ||
      id === "DesktopUnsupported",
  );
  const savedKeyMissing = report.issues.includes("SavedKeyMissing");
  const issues = report.issues.map((id): DiagnoseIssue => {
    const action = localFix(id, report.scope);
    // Offline, an existing client can still be restored from its saved key.
    const usableSource =
      !cloudProblem ||
      (action === "live" && cloudProblem.id === "CloudUnverified");
    return {
      id,
      fixAction:
        !protectedConfig && !savedKeyMissing && usableSource
          ? action
          : undefined,
    };
  });
  if (cloudProblem)
    issues.unshift({
      id: cloudProblem.id,
      fixAction: protectedConfig ? undefined : cloudProblem.fixAction,
    });
  return {
    app,
    scope: report.scope,
    issues,
    selectedTokenId:
      cloud.status === "fulfilled" ? cloud.value.selectedTokenId : undefined,
  };
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

export function PuppyRouterAccountBanner({
  activeApp,
}: PuppyRouterAccountBannerProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: localConfig } = useQuery({
    queryKey: ["providers", activeApp, "puppyrouterLiveConfig"],
    queryFn: () => puppyrouterAccountApi.diagnoseConfig(activeApp),
    retry: false,
  });
  const keyUsage = keyUsageFor(localConfig);
  const { data: settings } = useSettingsQuery();
  const {
    data: account,
    isLoading: isLoadingAccount,
    isError: isAccountError,
    isFetching: isCheckingAccount,
    refetch: refetchAccountStatus,
  } = usePuppyRouterAccountStatus();
  const effectiveAccount =
    account ??
    (isAccountError
      ? { loggedIn: false, sessionState: "server_error" as const }
      : null);
  const sessionState = effectiveAccount?.sessionState ?? "signed_out";
  const isLoggedIn = effectiveAccount?.loggedIn ?? false;
  const canLoadAccountData = isLoggedIn && sessionState === "authenticated";
  const {
    data: balance,
    isFetching: isLoadingBalance,
    refetch: refetchBalance,
  } = usePuppyRouterAccountBalance(canLoadAccountData);
  const { data: accountGroups, isFetching: isGroupsFetching } =
    usePuppyRouterAccountGroups(canLoadAccountData);
  const {
    data: keyList,
    isFetching: isLoadingKeys,
    refetch: refetchKeys,
    isError: keysUnavailable,
  } = usePuppyRouterApiKeys(canLoadAccountData, activeApp);
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
  const diagnoseGeneration = useRef(0);
  useEffect(() => {
    setIsDiagnoseOpen(false);
    setDiagnoseResult(null);
    setIsDiagnosing(false);
    setFixingDiagnoseAction(null);
    return () => {
      diagnoseGeneration.current++;
    };
  }, [activeApp, sessionState, effectiveAccount?.user?.id]);
  const activeGrant = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeGrant.current)
        void puppyrouterAccountApi
          .cancelLogin(activeGrant.current)
          .catch(() => {});
    };
  }, []);

  const pollRequest = useRef<{
    code: string;
    result: ReturnType<typeof puppyrouterAccountApi.pollLogin>;
  } | null>(null);

  useEffect(() => {
    const handleSessionExpired = () => {
      const current = queryClient.getQueryData<PuppyRouterAccountStatus>(
        puppyrouterAccountKeys.status(),
      );
      if (current?.sessionState === "expired") return;

      void queryClient.cancelQueries({
        queryKey: puppyrouterAccountKeys.all,
      });
      clearPuppyRouterAccountCache(queryClient, {
        loggedIn: false,
        sessionState: "expired",
      });
      toast.error(t("puppyrouterAccount.sessionExpiredTitle"), {
        description: t("puppyrouterAccount.sessionExpiredDescription"),
        closeButton: true,
      });
    };

    window.addEventListener(
      PUPPYROUTER_SESSION_EXPIRED_EVENT,
      handleSessionExpired,
    );
    return () => {
      window.removeEventListener(
        PUPPYROUTER_SESSION_EXPIRED_EVENT,
        handleSessionExpired,
      );
    };
  }, [queryClient, t]);

  const isManualOnlyApp = MANUAL_ONLY_APP_IDS.includes(activeApp);
  const quotaPerUnit =
    balance?.quotaPerUnit && balance.quotaPerUnit > 0
      ? balance.quotaPerUnit
      : 500000;
  const displayCurrency = settings?.displayCurrency ?? "auto";
  const displayLanguage = i18n.resolvedLanguage || i18n.language || "en";
  const usdExchangeRate = balance?.usdExchangeRate;

  const supportedApps = useMemo(
    () =>
      AUTO_APPLY_APP_IDS.map((appId) => ({
        id: appId,
        label: APP_ICON_MAP[appId].label,
        icon: APP_ICON_MAP[appId].icon,
      })),
    [],
  );

  const loadKeys = useCallback(async () => {
    try {
      await refetchKeys({ throwOnError: true });
    } catch (error) {
      if (isPuppyRouterSessionExpiredError(error)) return;
      console.error("[PuppyRouterAccountBanner] Failed to load keys", error);
      toast.error(
        t("puppyrouterAccount.loadKeysFailed", {
          error: extractErrorMessage(error),
        }),
      );
    }
  }, [refetchKeys, t]);

  const loadBalance = useCallback(async () => {
    try {
      await refetchBalance({ throwOnError: true });
    } catch (error) {
      if (isPuppyRouterSessionExpiredError(error)) return;
      console.error("[PuppyRouterAccountBanner] Failed to load balance", error);
      toast.error(
        t("puppyrouterAccount.loadBalanceFailed", {
          error: extractErrorMessage(error),
        }),
      );
    }
  }, [refetchBalance, t]);

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
    activeGrant.current = null;
    setLoginStart(null);
    setLoginPollMessage("");
    setIsPollingLogin(false);
  }, []);

  const finishApprovedLogin = useCallback(
    (accountStatus: PuppyRouterAccountStatus) => {
      void queryClient.cancelQueries({ queryKey: puppyrouterAccountKeys.all });
      clearPuppyRouterAccountCache(queryClient, accountStatus);
      setIsLoginOpen(false);
      resetLoginState();
      toast.success(t("puppyrouterAccount.loginSuccess"));
    },
    [queryClient, resetLoginState, t],
  );

  const changeLoginOpen = (open: boolean) => {
    if (!open && (isStartingLogin || isCopyingLoginLink)) return;
    setIsLoginOpen(open);
    if (!open) {
      if (activeGrant.current)
        void puppyrouterAccountApi
          .cancelLogin(activeGrant.current)
          .catch(() => {});
      resetLoginState();
    }
  };

  const newGrant = async () => {
    const start = await puppyrouterAccountApi.beginLogin();
    if (!mounted.current) {
      await puppyrouterAccountApi.cancelLogin(start.deviceCode);
      return;
    }
    activeGrant.current = start.deviceCode;
    setLoginStart(start);
    setLoginPollMessage(t("puppyrouterAccount.waitingForBrowser"));
    return start;
  };

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
      const start = await newGrant();
      if (!start) return;
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
        const start = await newGrant();
        if (!start) return;
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

    const expiresAt = loginStart.expiresAt * 1000;
    let retryDelay = Math.max(1, loginStart.interval) * 1000;
    const schedule = (delay: number) => {
      timer = window.setTimeout(
        poll,
        Math.max(0, Math.min(delay, expiresAt - Date.now())),
      );
    };
    const poll = async () => {
      if (Date.now() >= expiresAt) {
        resetLoginState();
        toast.error(t("puppyrouterAccount.loginExpired"));
        return;
      }
      setIsPollingLogin(true);
      try {
        if (pollRequest.current?.code !== loginStart.deviceCode) {
          pollRequest.current = {
            code: loginStart.deviceCode,
            result: puppyrouterAccountApi.pollLogin(loginStart.deviceCode),
          };
        }
        const request = pollRequest.current;
        const result = await request.result.finally(() => {
          if (pollRequest.current === request) pollRequest.current = null;
        });
        if (cancelled) {
          if (result.status === "approved") {
            void queryClient.invalidateQueries({
              queryKey: puppyrouterAccountKeys.status(),
              exact: true,
            });
          }
          return;
        }

        if (result.status === "approved") {
          setIsPollingLogin(false);
          finishApprovedLogin(result.account);
          return;
        }

        if (result.status === "pending") {
          setLoginPollMessage(t("puppyrouterAccount.waitingForApproval"));
          retryDelay =
            Math.max(1, result.interval || loginStart.interval) * 1000;
          schedule(retryDelay);
          return;
        }

        resetLoginState();
        toast.error(
          t(`puppyrouterAccount.loginStatus.${result.status}`, {
            defaultValue:
              result.message || t("puppyrouterAccount.loginExpired"),
          }),
        );
      } catch {
        if (cancelled) return;
        setLoginPollMessage(t("puppyrouterAccount.loginReconnecting"));
        schedule(retryDelay);
        retryDelay = Math.min(10000, retryDelay * 2);
      }
    };

    schedule(800);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [
    finishApprovedLogin,
    isLoginOpen,
    loginStart,
    queryClient,
    resetLoginState,
    t,
  ]);

  const handleApplyKey = async (key: PuppyRouterApiKey) => {
    if (isManualOnlyApp || !key.usable || applyingKeyId !== null) {
      return;
    }

    setApplyingKeyId(key.id);
    try {
      const result = await puppyrouterAccountApi.applyApiKey(key.id, activeApp);
      queryClient.setQueryData<PuppyRouterApiKeyList>(
        puppyrouterAccountKeys.apiKeys(activeApp),
        (current) => markPuppyRouterApiKeyActive(current, key.id),
      );
      await queryClient.invalidateQueries({
        queryKey: ["providers", activeApp],
        refetchType: "all",
      });
      const usage = queryClient.getQueryState<PuppyRouterConfigReport>([
        "providers",
        activeApp,
        "puppyrouterLiveConfig",
      ]);
      const app = APP_ICON_MAP[activeApp].label;
      const scope =
        usage?.status === "success" ? keyUsageFor(usage.data) : undefined;
      toast.success(
        t("puppyrouterAccount.syncSuccess", { name: result.name, app }),
        {
          description:
            scope === "direct" && needsClientRestart(activeApp)
              ? t("mode.toast.restartHint", { app })
              : scope
                ? t(`puppyrouterAccount.keyUsage.${scope}`, { app })
                : undefined,
        },
      );
    } catch (error) {
      if (isPuppyRouterSessionExpiredError(error)) return;
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
      if (isPuppyRouterSessionExpiredError(error)) return;
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
    if (isDiagnosing || !canLoadAccountData) return;
    const generation = diagnoseGeneration.current;
    setIsDiagnosing(true);
    try {
      const result = await readDiagnosis(activeApp);
      if (generation !== diagnoseGeneration.current) return;
      setDiagnoseResult(result);
      setIsDiagnoseOpen(true);
    } catch (error) {
      if (!isPuppyRouterSessionExpiredError(error)) throw error;
    } finally {
      if (generation === diagnoseGeneration.current) setIsDiagnosing(false);
    }
  };

  const handleFixDiagnoseIssue = async (issue: DiagnoseIssue) => {
    const action = issue.fixAction;
    if (
      !action ||
      !diagnoseResult ||
      diagnoseResult.app !== activeApp ||
      fixingDiagnoseAction ||
      !canLoadAccountData
    )
      return;
    const generation = diagnoseGeneration.current;
    setFixingDiagnoseAction(action);
    let attemptedWrite = false;
    try {
      const fresh = await readDiagnosis(activeApp);
      if (generation !== diagnoseGeneration.current) return;
      setDiagnoseResult(fresh);
      if (
        fresh.scope !== diagnoseResult.scope ||
        fresh.selectedTokenId !== diagnoseResult.selectedTokenId ||
        !fresh.issues.some((i) => i.id === issue.id && i.fixAction === action)
      )
        return;

      attemptedWrite = true;
      if (action === "cloud") {
        if (fresh.selectedTokenId == null) return;
        await puppyrouterAccountApi.applyApiKey(
          fresh.selectedTokenId,
          activeApp,
          fresh.scope,
        );
        if (
          generation === diagnoseGeneration.current &&
          fresh.scope === "direct" &&
          needsClientRestart(activeApp)
        ) {
          toast.info(
            t("mode.toast.restartHint", { app: APP_ICON_MAP[activeApp].label }),
          );
        }
      } else if (action === "live") {
        const applied = await puppyrouterAccountApi.reapplyConfig(activeApp);
        if (
          applied &&
          generation === diagnoseGeneration.current &&
          fresh.scope === "direct" &&
          needsClientRestart(activeApp)
        ) {
          toast.info(
            t("mode.toast.restartHint", { app: APP_ICON_MAP[activeApp].label }),
          );
        }
      } else {
        const id = PUPPYROUTER_PROVIDER_IDS[activeApp];
        if (activeApp === "kimi" || activeApp === "copilot") {
          await providersApi.addToLiveConfig(id, activeApp);
        } else {
          const result = await providersApi.switch(
            id,
            activeApp,
            issue.id === "ProviderNotCurrent",
          );
          if (generation === diagnoseGeneration.current) {
            if (result?.route) {
              toast.success(
                routeSwitchNotification(
                  result.route,
                  activeApp,
                  "PuppyRouter",
                  t,
                ),
              );
            } else if (needsClientRestart(activeApp)) {
              toast.info(
                t("mode.toast.restartHint", {
                  app: APP_ICON_MAP[activeApp].label,
                }),
              );
            }
          }
        }
      }
    } catch (error) {
      if (
        generation === diagnoseGeneration.current &&
        !isPuppyRouterSessionExpiredError(error)
      )
        toast.error(t("puppyrouterAccount.diagnoseFixFailed"), {
          closeButton: true,
        });
    } finally {
      try {
        if (attemptedWrite && generation === diagnoseGeneration.current) {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["providers", activeApp],
              refetchType: "all",
            }),
            queryClient.invalidateQueries({
              queryKey: puppyrouterAccountKeys.apiKeys(activeApp),
            }),
          ]);
          if (generation === diagnoseGeneration.current)
            await handleDiagnosePuppyRouterConfig();
        }
      } finally {
        if (generation === diagnoseGeneration.current)
          setFixingDiagnoseAction(null);
      }
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await puppyrouterAccountApi.logout();
      void queryClient.cancelQueries({ queryKey: puppyrouterAccountKeys.all });
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
    <section className="mt-2 space-y-3">
      {keyUsage === "staged" && (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          {t("puppyrouterAccount.clientNotConfiguredWarning", {
            app: APP_ICON_MAP[activeApp].label,
          })}
        </p>
      )}
      {(sessionState === "offline" || sessionState === "server_error") && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 dark:border-amber-400/35 bg-amber-400/10 px-4 py-3 text-amber-950 dark:text-amber-50 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {t(
                  sessionState === "offline"
                    ? "puppyrouterAccount.offlineTitle"
                    : "puppyrouterAccount.serverUnavailableTitle",
                )}
              </div>
              <div className="mt-1 text-xs leading-5 text-amber-900/70 dark:text-amber-100/75">
                {t(
                  sessionState === "offline"
                    ? "puppyrouterAccount.offlineDescription"
                    : "puppyrouterAccount.serverUnavailableDescription",
                )}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetchAccountStatus()}
            disabled={isCheckingAccount}
            className="shrink-0 border-amber-500/30 dark:border-amber-300/35 bg-amber-500/10 dark:bg-amber-300/10 text-amber-900 dark:text-amber-100 hover:bg-amber-500/15 dark:hover:bg-amber-300/18"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                isCheckingAccount && "animate-spin",
              )}
            />
            {t("puppyrouterAccount.retryStatusCheck")}
          </Button>
        </div>
      )}

      {!effectiveAccount?.loggedIn && sessionState !== "server_error" ? (
        <motion.div
          className="relative overflow-hidden rounded-lg border border-primary/30 bg-[linear-gradient(110deg,#FDFEFF,#EFF5FC_52%,#DFEDFA)] px-4 py-4 text-foreground shadow-[0_0_28px_rgba(13,114,210,0.15)] dark:border-amber-300/45 dark:bg-[linear-gradient(110deg,#080808,#171208_52%,#302006)] dark:text-amber-50"
          animate={{
            boxShadow: [
              "0 0 18px rgba(13,114,210,0.14)",
              "0 0 38px rgba(13,114,210,0.26)",
              "0 0 18px rgba(13,114,210,0.14)",
            ],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.div
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/15 to-transparent dark:via-amber-200/20"
            animate={{ x: ["0%", "430%"] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
          />
          <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary dark:border-amber-300/35 dark:bg-amber-300/10 dark:text-amber-200">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {t(
                    sessionState === "expired"
                      ? "puppyrouterAccount.sessionExpiredTitle"
                      : "puppyrouterAccount.notLoggedInTitle",
                  )}
                </div>
                <div className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground dark:text-amber-100/78">
                  {t(
                    sessionState === "expired"
                      ? "puppyrouterAccount.sessionExpiredDescription"
                      : "puppyrouterAccount.notLoggedInDescription",
                  )}
                </div>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => setIsLoginOpen(true)}
              className="shrink-0 border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90 dark:border-amber-300/40 dark:bg-amber-300 dark:text-black dark:hover:bg-amber-200"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {t("puppyrouterAccount.loginCta")}
            </Button>
          </div>
        </motion.div>
      ) : effectiveAccount?.loggedIn ? (
        <div className="rounded-lg border border-primary/25 bg-[linear-gradient(110deg,rgba(253,254,255,0.96),rgba(239,245,252,0.94))] px-4 py-4 shadow-sm shadow-primary/10 dark:bg-[linear-gradient(110deg,rgba(10,10,10,0.94),rgba(24,20,12,0.92))]">
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
                    : balance
                      ? formatDisplayAmountFromUsd(
                          balance.balanceUsd,
                          displayCurrency,
                          displayLanguage,
                          usdExchangeRate,
                        )
                      : "--"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void loadBalance()}
                  disabled={isLoadingBalance || !canLoadAccountData}
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
                disabled={isLoadingKeys || !canLoadAccountData}
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
                disabled={isDiagnosing || !canLoadAccountData}
                title={t("puppyrouterAccount.diagnose")}
                aria-label={t("puppyrouterAccount.diagnose")}
                className="border-primary/35 bg-primary/12 text-primary hover:bg-primary/20"
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
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 dark:border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
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
                        ? "border-primary/60 bg-primary/12 shadow-[0_0_18px_rgba(13,114,210,0.18)] dark:shadow-[0_0_18px_rgba(249,148,42,0.2)]"
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
                            "border-emerald-600/35 dark:border-emerald-500/35 text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {keyStatusLabel(t, apiKey.status)}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={
                              !canLoadAccountData ||
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
                          collisionPadding={12}
                          className="z-[120] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(20rem,calc(100vw-1.5rem))] overflow-x-hidden overflow-y-auto overscroll-contain border-primary/25"
                        >
                          <DropdownMenuLabel>
                            {t("puppyrouterAccount.selectCloudGroup")}
                          </DropdownMenuLabel>
                          {accountGroups?.map((group) => (
                            <DropdownMenuItem
                              key={group.name}
                              disabled={
                                changingGroupKeyId !== null ||
                                apiKey.group === group.name
                              }
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
                              <span className="min-w-0 flex-1">
                                <span className="block break-words font-medium">
                                  {group.name}
                                </span>
                                {group.description && (
                                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">
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
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20">
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
                            : formatQuotaForDisplay(
                                apiKey.remainQuota,
                                quotaPerUnit,
                                displayCurrency,
                                displayLanguage,
                                usdExchangeRate,
                              )}
                        </div>
                      </div>
                      <div className="min-w-0 text-right">
                        <div>{t("puppyrouterAccount.keyUsedQuota")}</div>
                        <div className="mt-0.5 truncate font-mono font-semibold text-foreground">
                          {formatQuotaForDisplay(
                            apiKey.usedQuota,
                            quotaPerUnit,
                            displayCurrency,
                            displayLanguage,
                            usdExchangeRate,
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        isManualOnlyApp ||
                        !canLoadAccountData ||
                        !apiKey.usable ||
                        applyingKeyId !== null
                      }
                      onClick={() => void handleApplyKey(apiKey)}
                      className={cn(
                        "mt-3 w-full shadow-none",
                        apiKey.active
                          ? "border-emerald-600/25 dark:border-emerald-500/25 bg-emerald-500/5 text-emerald-700/75 dark:text-emerald-300/75 hover:border-emerald-500/35 hover:bg-emerald-500/10 hover:text-emerald-300"
                          : "border-emerald-600/40 dark:border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:border-emerald-500/60 dark:hover:border-emerald-400/60 hover:bg-emerald-500/16 hover:text-emerald-800 dark:hover:text-emerald-200",
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
            ) : !canLoadAccountData || keysUnavailable ? (
              <div className="rounded-lg border border-amber-500/25 dark:border-amber-400/25 bg-amber-400/8 px-3 py-3 text-sm text-amber-900/70 dark:text-amber-100/75">
                {t("puppyrouterAccount.accountDataUnavailable")}
              </div>
            ) : (
              <div className="rounded-lg border border-border/70 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                {t("puppyrouterAccount.noKeys")}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <Dialog open={isDiagnoseOpen} onOpenChange={setIsDiagnoseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("puppyrouterAccount.diagnoseTitle")}</DialogTitle>
            <DialogDescription>
              {t("puppyrouterAccount.diagnoseDescription", {
                app: APP_ICON_MAP[activeApp].label,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-5">
            {diagnoseResult && diagnoseResult.issues.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-emerald-600/30 dark:border-emerald-400/35 bg-emerald-400/10 px-3 py-3 text-sm text-emerald-900 dark:text-emerald-50">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                <div>
                  <div className="font-medium">
                    {t(
                      diagnoseResult.scope === "direct"
                        ? "puppyrouterAccount.diagnoseHealthy"
                        : "puppyrouterAccount.diagnoseChecked",
                    )}
                  </div>
                  <div className="mt-1 text-xs text-emerald-800/75 dark:text-emerald-50/75">
                    {t(
                      `puppyrouterAccount.diagnoseScope.${diagnoseResult.scope}`,
                      { app: APP_ICON_MAP[activeApp].label },
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-200">
                  {t("puppyrouterAccount.diagnoseIssuesTitle")}
                </div>
                {(diagnoseResult?.issues ?? []).map((issue) => (
                  <div
                    key={issue.id}
                    className="flex flex-col gap-3 rounded-lg border border-amber-500/30 dark:border-amber-400/30 bg-amber-400/10 px-3 py-3 text-sm text-amber-950 dark:text-amber-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                      <span className="min-w-0 whitespace-pre-line">
                        {t(`puppyrouterAccount.diagnose${issue.id}`, {
                          app: APP_ICON_MAP[activeApp].label,
                        })}
                      </span>
                    </div>
                    {issue.fixAction && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleFixDiagnoseIssue(issue)}
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
                          : issue.fixAction === "enable"
                            ? t("puppyrouterAccount.diagnoseEnable")
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

      <Dialog open={isLoginOpen} onOpenChange={changeLoginOpen}>
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
              <div className="space-y-3 rounded-lg border border-amber-500/30 dark:border-amber-400/35 bg-amber-400/10 px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-200">
                  {t("puppyrouterAccount.browserAuthCode")}
                </div>
                <div className="font-mono text-lg font-semibold text-amber-900 dark:text-amber-100">
                  {loginStart.userCode}
                </div>
                <div className="flex items-center gap-2 text-xs text-amber-900/70 dark:text-amber-100/75">
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
              onClick={() => changeLoginOpen(false)}
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
