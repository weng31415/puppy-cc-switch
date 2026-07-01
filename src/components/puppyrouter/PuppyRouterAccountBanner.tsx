import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  puppyrouterAccountApi,
  type AppId,
  type PuppyRouterAccountStatus,
  type PuppyRouterApiKey,
  type PuppyRouterApiKeyList,
  type PuppyRouterLoginResult,
} from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";
import { cn } from "@/lib/utils";
import { APP_ICON_MAP } from "@/config/appConfig";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFaCode, setTwoFaCode] = useState("");
  const [requires2fa, setRequires2fa] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
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

  const resetLoginForm = useCallback(() => {
    setPassword("");
    setTwoFaCode("");
    setRequires2fa(false);
  }, []);

  const finishLogin = useCallback(
    async (result: PuppyRouterLoginResult) => {
      if (result.status === "requires_2fa") {
        setRequires2fa(true);
        setUsername(result.username);
        toast.info(t("puppyrouterAccount.twoFaRequired"));
        return;
      }

      setAccount(result.account);
      setIsLoginOpen(false);
      resetLoginForm();
      toast.success(t("puppyrouterAccount.loginSuccess"));
      await loadKeys({ autoApplyDefault: true });
    },
    [loadKeys, resetLoginForm, t],
  );

  const handleLoginSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmittingLogin(true);
    try {
      const result = requires2fa
        ? await puppyrouterAccountApi.verify2fa(twoFaCode)
        : await puppyrouterAccountApi.login(username, password);
      await finishLogin(result);
    } catch (error) {
      console.error("[PuppyRouterAccountBanner] Login failed", error);
      toast.error(
        t("puppyrouterAccount.loginFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsSubmittingLogin(false);
    }
  };

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
          if (!open) resetLoginForm();
        }}
      >
        <DialogContent className="max-w-md">
          <form onSubmit={handleLoginSubmit}>
            <DialogHeader>
              <DialogTitle>{t("puppyrouterAccount.loginTitle")}</DialogTitle>
              <DialogDescription>
                {requires2fa
                  ? t("puppyrouterAccount.twoFaDescription")
                  : t("puppyrouterAccount.loginDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 px-6 py-5">
              {!requires2fa ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="puppyrouter-username">
                      {t("puppyrouterAccount.username")}
                    </Label>
                    <Input
                      id="puppyrouter-username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      disabled={isSubmittingLogin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="puppyrouter-password">
                      {t("puppyrouterAccount.password")}
                    </Label>
                    <Input
                      id="puppyrouter-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      disabled={isSubmittingLogin}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="puppyrouter-2fa">
                    {t("puppyrouterAccount.twoFaCode")}
                  </Label>
                  <Input
                    id="puppyrouter-2fa"
                    value={twoFaCode}
                    onChange={(event) => setTwoFaCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    disabled={isSubmittingLogin}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsLoginOpen(false)}
                disabled={isSubmittingLogin}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmittingLogin}>
                {isSubmittingLogin ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-4 w-4" />
                )}
                {requires2fa
                  ? t("puppyrouterAccount.verifyAndLogin")
                  : t("puppyrouterAccount.login")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
