import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  puppyrouterAccountApi,
  settingsApi,
  type AppId,
  type PuppyRouterAccountStatus,
  type PuppyRouterApiKey,
  type PuppyRouterApiKeyList,
  type PuppyRouterLoginStart,
} from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { APP_ICON_MAP } from "@/config/appConfig";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function chooseAutoApplyKey(keys: PuppyRouterApiKey[]) {
  return (
    keys.find((key) => key.active) ??
    keys.find((key) => key.recommended && key.usable) ??
    keys.find((key) => key.usable)
  );
}

export function PuppyRouterAccountBanner({
  activeApp,
}: PuppyRouterAccountBannerProps) {
  const { t } = useTranslation();
  const [account, setAccount] = useState<PuppyRouterAccountStatus | null>(null);
  const [keyList, setKeyList] = useState<PuppyRouterApiKeyList | null>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(true);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginStart, setLoginStart] = useState<PuppyRouterLoginStart | null>(
    null,
  );
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isCopyingLoginLink, setIsCopyingLoginLink] = useState(false);
  const [isPollingLogin, setIsPollingLogin] = useState(false);
  const [loginPollMessage, setLoginPollMessage] = useState("");
  const [applyingKeyId, setApplyingKeyId] = useState<number | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isManualOnlyApp = MANUAL_ONLY_APP_IDS.includes(activeApp);

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
      setIsLoadingKeys(true);
      try {
        const result = await puppyrouterAccountApi.listApiKeys();
        setKeyList(result);

        if (options?.autoApplyDefault) {
          const target = chooseAutoApplyKey(result.keys);
          if (target && !target.active && target.usable) {
            setApplyingKeyId(target.id);
            const applied = await puppyrouterAccountApi.applyApiKey(target.id);
            const refreshed = await puppyrouterAccountApi.listApiKeys();
            setKeyList(refreshed);
            toast.success(
              t("puppyrouterAccount.autoSyncSuccess", {
                name: applied.name,
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
        setIsLoadingKeys(false);
        setApplyingKeyId(null);
      }
    },
    [t],
  );

  const loadAccount = useCallback(async () => {
    setIsLoadingAccount(true);
    try {
      const status = await puppyrouterAccountApi.getStatus();
      setAccount(status);
    } catch (error) {
      console.error("[PuppyRouterAccountBanner] Failed to load account", error);
      setAccount({ loggedIn: false });
    } finally {
      setIsLoadingAccount(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (account?.loggedIn) {
      void loadKeys();
    } else {
      setKeyList(null);
    }
  }, [account?.loggedIn, loadKeys]);

  const resetLoginState = useCallback(() => {
    setLoginStart(null);
    setLoginPollMessage("");
    setIsPollingLogin(false);
  }, []);

  const finishApprovedLogin = useCallback(
    async (accountStatus: PuppyRouterAccountStatus) => {
      setAccount(accountStatus);
      setIsLoginOpen(false);
      resetLoginState();
      toast.success(t("puppyrouterAccount.loginSuccess"));
      await loadKeys({ autoApplyDefault: true });
    },
    [loadKeys, resetLoginState, t],
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
            defaultValue: result.message || t("puppyrouterAccount.loginExpired"),
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
    if (!key.usable || applyingKeyId !== null) {
      return;
    }

    setApplyingKeyId(key.id);
    try {
      const result = await puppyrouterAccountApi.applyApiKey(key.id);
      toast.success(
        t("puppyrouterAccount.syncSuccess", {
          name: result.name,
        }),
      );
      await loadKeys();
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await puppyrouterAccountApi.logout();
      setAccount({ loggedIn: false });
      setKeyList(null);
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
      {!account?.loggedIn ? (
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
                  {account.user?.displayName || account.user?.username}
                </span>
                {account.user?.group && (
                  <Badge variant="outline" className="border-primary/30">
                    {t("puppyrouterAccount.group", {
                      group: account.user.group,
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
            <div className="flex shrink-0 items-center gap-2">
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
                  <button
                    key={apiKey.id}
                    type="button"
                    disabled={!apiKey.usable || applyingKeyId !== null}
                    onClick={() => void handleApplyKey(apiKey)}
                    className={cn(
                      "group flex min-h-[104px] flex-col items-start justify-between rounded-lg border px-3 py-3 text-left transition",
                      apiKey.active
                        ? "border-primary/60 bg-primary/12 shadow-[0_0_18px_rgba(245,158,11,0.16)]"
                        : "border-border/70 bg-background/35 hover:border-primary/45 hover:bg-primary/8",
                      !apiKey.usable && "cursor-not-allowed opacity-55",
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
                      {applyingKeyId === apiKey.id ? (
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
                      <Badge
                        variant="outline"
                        className="border-primary/30 text-[11px]"
                      >
                        {apiKey.group
                          ? t("puppyrouterAccount.group", {
                              group: apiKey.group,
                            })
                          : t("puppyrouterAccount.noGroup")}
                      </Badge>
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
                  </button>
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
