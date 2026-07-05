import {
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Settings,
  ArrowLeft,
  Minus,
  Maximize2,
  Minimize2,
  X,
  Book,
  Brain,
  Wrench,
  History,
  BarChart2,
  Download,
  FolderArchive,
  Search,
  FolderOpen,
  KeyRound,
  Shield,
  Cpu,
  LayoutDashboard,
  AlertTriangle,
  RefreshCw,
  ArrowUpCircle,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Provider, VisibleApps } from "@/types";
import type { EnvConflict } from "@/types/env";
import { useProvidersQuery, useSettingsQuery } from "@/lib/query";
import {
  providersApi,
  settingsApi,
  vscodeApi,
  type AppId,
  type ProviderSwitchEvent,
} from "@/lib/api";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useProviderActions } from "@/hooks/useProviderActions";
import { openclawKeys, useOpenClawHealth } from "@/hooks/useOpenClaw";
import { hermesKeys, useOpenHermesWebUI } from "@/hooks/useHermes";
import { hermesApi } from "@/lib/api/hermes";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useAutoCompact } from "@/hooks/useAutoCompact";
import { useUsageCacheBridge } from "@/hooks/useUsageCacheBridge";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import { useScanUnmanagedSkills } from "@/hooks/useSkills";
import { useUpdate } from "@/contexts/UpdateContext";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { deepClone } from "@/utils/deepClone";
import { cn } from "@/lib/utils";
import {
  isWindows,
  isMac,
  isLinux,
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
} from "@/lib/platform";
import { AppSwitcher } from "@/components/AppSwitcher";
import { ProviderList } from "@/components/providers/ProviderList";
import { PuppyRouterAccountBanner } from "@/components/puppyrouter/PuppyRouterAccountBanner";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import { ProxyToggle } from "@/components/proxy/ProxyToggle";
import { ClaudeDesktopRouteToggle } from "@/components/proxy/ClaudeDesktopRouteToggle";
import { FailoverToggle } from "@/components/proxy/FailoverToggle";
import UsageScriptModal from "@/components/UsageScriptModal";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import {
  SkillsPage,
  getSkillsPageHeaderActions,
  type SkillsPageSource,
} from "@/components/skills/SkillsPage";
import UnifiedSkillsPanel from "@/components/skills/UnifiedSkillsPanel";
import { DeepLinkImportDialog } from "@/components/DeepLinkImportDialog";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { UniversalProviderPanel } from "@/components/universal";
import { McpIcon } from "@/components/BrandIcons";
import PuppyRouterLogo from "@/assets/icons/app-icon.png";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import WorkspaceFilesPanel from "@/components/workspace/WorkspaceFilesPanel";
import EnvPanel from "@/components/openclaw/EnvPanel";
import ToolsPanel from "@/components/openclaw/ToolsPanel";
import AgentsDefaultsPanel from "@/components/openclaw/AgentsDefaultsPanel";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesMemoryPanel from "@/components/hermes/HermesMemoryPanel";
import {
  isLockedProvider,
  isLockedProviderApp,
  isOfficialProviderId,
  isPuppyRouterProviderId,
} from "@/utils/lockedProviders";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";

type View =
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "skillsDiscovery"
  | "mcp"
  | "agents"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawAgents"
  | "hermesMemory";

interface SyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

const DEFAULT_DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px
const HEADER_HEIGHT = 64; // px

const STORAGE_KEY = "puppyrouter-app-last-app";
const VALID_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && VALID_APPS.includes(saved)) {
    return saved;
  }
  return "claude";
};

const VIEW_STORAGE_KEY = "puppyrouter-app-last-view";
const VALID_VIEWS: View[] = [
  "providers",
  "settings",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "agents",
  "universal",
  "sessions",
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawAgents",
  "hermesMemory",
];

const PUPPYROUTER_HOST = "puppyrouter.com";
const PUPPYROUTER_CONFIG_STATUS_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
];

const getInitialView = (): View => {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
  if (saved && VALID_VIEWS.includes(saved)) {
    return saved;
  }
  return "providers";
};

const isPuppyRouterUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  try {
    const host = new URL(normalized).hostname.replace(/^www\./, "");
    return host === PUPPYROUTER_HOST;
  } catch {
    return normalized.includes(PUPPYROUTER_HOST);
  }
};

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null;

const readStringPath = (value: unknown, path: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
};

const isSupportedPuppyRouterConfigStatusApp = (appId: AppId): boolean =>
  PUPPYROUTER_CONFIG_STATUS_APPS.includes(appId);

async function readPuppyRouterLiveConfigured(appId: AppId): Promise<boolean> {
  if (appId === "claude-desktop") {
    const status = await providersApi.getClaudeDesktopStatus();
    return isPuppyRouterUrl(status.actualBaseUrl);
  }

  if (appId === "opencode") {
    const liveProviderIds = await providersApi.getOpenCodeLiveProviderIds();
    return liveProviderIds.includes("puppyrouter");
  }

  const settings = await vscodeApi.getLiveProviderSettings(appId);
  if (appId === "claude") {
    return isPuppyRouterUrl(
      readStringPath(settings, ["env", "ANTHROPIC_BASE_URL"]),
    );
  }
  if (appId === "codex") {
    return isPuppyRouterUrl(
      extractCodexBaseUrl(readStringPath(settings, ["config"])),
    );
  }
  if (appId === "gemini") {
    return isPuppyRouterUrl(
      readStringPath(settings, ["env", "GOOGLE_GEMINI_BASE_URL"]),
    );
  }

  return true;
}

function App() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const sharedFeatureApp: AppId =
    activeApp === "claude-desktop" ? "claude" : activeApp;
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [skillsDiscoverySource, setSkillsDiscoverySource] =
    useState<SkillsPageSource>("repos");
  const [settingsDefaultTab, setSettingsDefaultTab] = useState("general");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const {
    hasUpdate: hasAppUpdate,
    updateInfo: appUpdateInfo,
    checkUpdate: checkAppUpdate,
    isChecking: isCheckingAppUpdate,
  } = useUpdate();

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  useEffect(() => {
    let active = true;

    void getVersion()
      .then((version) => {
        if (active) {
          setAppVersion(version);
        }
      })
      .catch((error) => {
        console.error("[App] Failed to load app version", error);
      });

    return () => {
      active = false;
    };
  }, []);

  const { data: settingsData } = useSettingsQuery();
  const useAppWindowControls =
    isLinux() && (settingsData?.useAppWindowControls ?? false);
  const dragBarHeight = useAppWindowControls ? 32 : DEFAULT_DRAG_BAR_HEIGHT;
  const contentTopOffset = dragBarHeight + HEADER_HEIGHT;
  const visibleApps: VisibleApps = settingsData?.visibleApps ?? {
    claude: true,
    "claude-desktop": true,
    codex: true,
    gemini: true,
    opencode: true,
    openclaw: true,
    hermes: true,
  };

  const getFirstVisibleApp = (): AppId => {
    if (visibleApps.claude) return "claude";
    if (visibleApps["claude-desktop"]) return "claude-desktop";
    if (visibleApps.codex) return "codex";
    if (visibleApps.gemini) return "gemini";
    if (visibleApps.opencode) return "opencode";
    if (visibleApps.openclaw) return "openclaw";
    if (visibleApps.hermes) return "hermes";
    return "claude"; // fallback
  };

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  // Fallback from sessions view when switching to an app without session support
  useEffect(() => {
    if (
      currentView === "sessions" &&
      sharedFeatureApp !== "claude" &&
      sharedFeatureApp !== "codex" &&
      sharedFeatureApp !== "opencode" &&
      sharedFeatureApp !== "openclaw" &&
      sharedFeatureApp !== "gemini" &&
      sharedFeatureApp !== "hermes"
    ) {
      setCurrentView("providers");
    }
  }, [sharedFeatureApp, currentView]);

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<EnvConflict[]>([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);
  const [restartNotice, setRestartNotice] = useState<{
    appId: AppId;
    providerName: string;
  } | null>(null);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const isToolbarCompact = useAutoCompact(toolbarRef);

  useUsageCacheBridge();

  const promptPanelRef = useRef<any>(null);
  const mcpPanelRef = useRef<any>(null);
  const skillsPageRef = useRef<any>(null);
  const unifiedSkillsPanelRef = useRef<any>(null);
  // 订阅未管理 Skill 的共享缓存（实际扫描由 UnifiedSkillsPanel 进入页面时触发）。
  // 这里 enabled 默认 false，仅用于「导入」按钮的绿点提示，不主动发起扫描。
  const { data: unmanagedSkills } = useScanUnmanagedSkills();
  const hasUnmanagedSkills = (unmanagedSkills?.length ?? 0) > 0;
  const addActionButtonClass =
    "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30 rounded-full w-8 h-8";
  const headerButtonClass =
    "text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 border border-transparent";
  const compactHeaderButtonClass = `${headerButtonClass} w-8 px-2`;
  const windowControlButtonClass =
    "h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10";
  const renderHeaderTooltip = (
    label: ReactNode,
    child: ReactElement,
    tooltipKey?: string,
  ) => (
    <Tooltip key={tooltipKey}>
      <TooltipTrigger asChild>{child}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );

  const {
    isRunning: isProxyRunning,
    takeoverStatus,
    status: proxyStatus,
  } = useProxyStatus();
  const isCurrentAppTakeoverActive = takeoverStatus?.[activeApp] || false;
  const activeProviderId = useMemo(() => {
    const target = proxyStatus?.active_targets?.find(
      (t) => t.app_type === activeApp,
    );
    return target?.provider_id;
  }, [proxyStatus?.active_targets, activeApp]);

  const { data, isLoading, refetch } = useProvidersQuery(activeApp, {
    isProxyRunning,
  });
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const puppyRouterConfigStatusEnabled =
    currentView === "providers" &&
    isSupportedPuppyRouterConfigStatusApp(activeApp);
  const { data: isPuppyRouterLiveConfigured } = useQuery({
    queryKey: ["puppyrouterLiveConfigStatus", activeApp],
    queryFn: async () => {
      try {
        return await readPuppyRouterLiveConfigured(activeApp);
      } catch (error) {
        console.warn(
          "[App] Failed to read live PuppyRouter config status",
          activeApp,
          error,
        );
        return false;
      }
    },
    enabled: puppyRouterConfigStatusEnabled,
    staleTime: 0,
    retry: false,
  });
  const showPuppyRouterConfigWarning =
    puppyRouterConfigStatusEnabled &&
    isPuppyRouterLiveConfigured === false &&
    !(
      isProxyRunning &&
      isCurrentAppTakeoverActive &&
      activeProviderId !== undefined &&
      isPuppyRouterProviderId(activeProviderId, activeApp)
    );
  const isOpenClawView =
    activeApp === "openclaw" &&
    (currentView === "providers" ||
      currentView === "workspace" ||
      currentView === "sessions" ||
      currentView === "openclawEnv" ||
      currentView === "openclawTools" ||
      currentView === "openclawAgents");
  const { data: openclawHealthWarnings = [] } =
    useOpenClawHealth(isOpenClawView);
  const hasSkillsSupport = sharedFeatureApp !== "openclaw";
  const hasSessionSupport =
    sharedFeatureApp === "claude" ||
    sharedFeatureApp === "codex" ||
    sharedFeatureApp === "opencode" ||
    sharedFeatureApp === "openclaw" ||
    sharedFeatureApp === "gemini" ||
    sharedFeatureApp === "hermes";

  const shouldShowRestartNotice = (appId: AppId) =>
    appId === "claude" || appId === "codex" || appId === "claude-desktop";

  const openRestartNoticeForProvider = (provider: Provider, appId: AppId) => {
    if (!shouldShowRestartNotice(appId) || !isLockedProvider(provider, appId)) {
      return;
    }
    setRestartNotice({ appId, providerName: provider.name });
  };

  const openRestartNoticeForSwitchEvent = (event: ProviderSwitchEvent) => {
    if (!shouldShowRestartNotice(event.appType)) {
      return;
    }
    if (
      !isPuppyRouterProviderId(event.providerId, event.appType) &&
      !isOfficialProviderId(event.providerId, event.appType)
    ) {
      return;
    }
    setRestartNotice({
      appId: event.appType,
      providerName: isPuppyRouterProviderId(event.providerId, event.appType)
        ? "PuppyRouter"
        : "Official",
    });
  };

  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(
    activeApp,
    isProxyRunning,
    isProxyRunning && isCurrentAppTakeoverActive,
    openRestartNoticeForProvider,
  );

  const disableOmoMutation = useDisableCurrentOmo();
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim();
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupListener = async () => {
      try {
        const off = await providersApi.onSwitched(
          async (event: ProviderSwitchEvent) => {
            openRestartNoticeForSwitchEvent(event);
            if (event.appType === activeApp) {
              await refetch();
            }
            await queryClient.invalidateQueries({
              queryKey: ["puppyrouterLiveConfigStatus", event.appType],
            });
          },
        );
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
      } catch (error) {
        console.error("[App] Failed to subscribe provider switch event", error);
      }
    };

    void setupListener();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [activeApp, refetch]);

  useTauriEvent("universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    await queryClient.invalidateQueries({
      queryKey: ["puppyrouterLiveConfigStatus"],
    });
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to update tray menu", error);
    }
  });

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "webdav-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.webdavSync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "s3-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.s3Sync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<{ appType: string; providerName: string }>(
    "proxy-official-warning",
    (payload) => {
      toast.warning(
        t("notifications.proxyOfficialWarning", {
          name: payload.providerName,
          defaultValue: `当前供应商 ${payload.providerName} 是官方供应商，建议切换到第三方供应商后再使用代理接管`,
        }),
        { duration: 8000 },
      );
    },
  );

  useEffect(() => {
    let active = true;
    let unlistenResize: (() => void) | undefined;

    const setupWindowStateSync = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const syncWindowMaximizedState = async () => {
          const maximized = await currentWindow.isMaximized();
          if (active) {
            setIsWindowMaximized(maximized);
          }
        };

        await syncWindowMaximizedState();
        unlistenResize = await currentWindow.onResized(() => {
          void syncWindowMaximizedState();
        });
      } catch (error) {
        console.error("[App] Failed to sync window maximized state", error);
      }
    };

    void setupWindowStateSync();
    return () => {
      active = false;
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    // settingsData 未加载时跳过，避免用 fallback false 覆盖 Rust 侧已设好的装饰状态
    if (!settingsData) return;

    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };

    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    checkEnvOnStartup();
  }, []);

  useEffect(() => {
    const checkMigration = async () => {
      try {
        const migrated = await invoke<boolean>("get_migration_result");
        if (migrated) {
          toast.success(
            t("migration.success", { defaultValue: "配置迁移成功" }),
            { closeButton: true },
          );
        }
      } catch (error) {
        console.error("[App] Failed to check migration result:", error);
      }
    };

    checkMigration();
  }, [t]);

  useEffect(() => {
    const checkSkillsMigration = async () => {
      try {
        const result = await invoke<{ count: number; error?: string } | null>(
          "get_skills_migration_result",
        );
        if (result?.error) {
          toast.error(t("migration.skillsFailed"), {
            description: t("migration.skillsFailedDescription"),
            closeButton: true,
          });
          console.error("[App] Skills SSOT migration failed:", result.error);
          return;
        }
        if (result && result.count > 0) {
          toast.success(t("migration.skillsSuccess", { count: result.count }), {
            closeButton: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["skills"] });
        }
      } catch (error) {
        console.error("[App] Failed to check skills migration result:", error);
      }
    };

    checkSkillsMigration();
  }, [t, queryClient]);

  useEffect(() => {
    const checkEnvOnSwitch = async () => {
      try {
        const conflicts = await checkEnvConflicts(activeApp);

        if (conflicts.length > 0) {
          setEnvConflicts((prev) => {
            const existingKeys = new Set(
              prev.map((c) => `${c.varName}:${c.sourcePath}`),
            );
            const newConflicts = conflicts.filter(
              (c) => !existingKeys.has(`${c.varName}:${c.sourcePath}`),
            );
            return [...prev, ...newConflicts];
          });
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    checkEnvOnSwitch();
  }, [activeApp]);

  const currentViewRef = useRef(currentView);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCurrentView("settings");
        return;
      }

      if (event.key !== "Escape" || event.defaultPrevented) return;

      if (document.body.style.overflow === "hidden") return;

      const view = currentViewRef.current;
      if (view === "providers") return;

      if (isTextEditableTarget(event.target)) return;

      event.preventDefault();
      setCurrentView(view === "skillsDiscovery" ? "skills" : "providers");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const formatVersion = (version: string | null | undefined) => {
    if (!version) return "v...";
    return version.startsWith("v") ? version : `v${version}`;
  };

  const currentAppVersionLabel = formatVersion(appVersion);
  const availableAppVersionLabel = appUpdateInfo
    ? formatVersion(appUpdateInfo.availableVersion)
    : null;
  const headerVersionTooltip = isCheckingAppUpdate
    ? t("header.versionChecking", {
        defaultValue: "正在检查版本更新",
      })
    : hasAppUpdate && availableAppVersionLabel
      ? t("header.versionUpdateAvailable", {
          current: currentAppVersionLabel,
          latest: availableAppVersionLabel,
          defaultValue: "当前版本 {{current}}，可更新到 {{latest}}",
        })
      : t("header.versionCurrent", {
          version: currentAppVersionLabel,
          defaultValue: "当前版本 {{version}}",
        });

  const handleHeaderVersionCheck = async () => {
    if (isCheckingAppUpdate) return;

    if (hasAppUpdate && appUpdateInfo) {
      setSettingsDefaultTab("about");
      setCurrentView("settings");
      return;
    }

    try {
      const available = await checkAppUpdate();
      if (available) {
        toast.success(
          t("header.versionCheckUpdateFound", {
            defaultValue: "发现新版本，可在关于页面升级",
          }),
          { closeButton: true },
        );
        setSettingsDefaultTab("about");
        setCurrentView("settings");
        return;
      }
      toast.success(t("settings.upToDate"), { closeButton: true });
    } catch (error) {
      console.error("[App] Check update failed", error);
      toast.error(t("settings.checkUpdateFailed"), {
        description: extractErrorMessage(error) || undefined,
        closeButton: true,
      });
    }
  };

  const handleEditProvider = async ({
    provider,
    originalId,
  }: {
    provider: Provider;
    originalId?: string;
  }) => {
    await updateProvider(provider, originalId);
    setEditingProvider(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      await providersApi.removeFromLiveConfig(provider.id, activeApp);
      // Invalidate queries to refresh the isInConfig state
      if (activeApp === "opencode") {
        await queryClient.invalidateQueries({
          queryKey: ["opencodeLiveProviderIds"],
        });
        await queryClient.invalidateQueries({
          queryKey: ["opencodeCurrentModel"],
        });
      } else if (activeApp === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds,
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
      } else if (activeApp === "hermes") {
        await queryClient.invalidateQueries({
          queryKey: hermesKeys.liveProviderIds,
        });
      }
      toast.success(
        t("notifications.removeFromConfigSuccess", {
          defaultValue: "已从配置移除",
        }),
        { closeButton: true },
      );
    } else {
      await deleteProvider(provider.id);
    }
    setConfirmAction(null);
  };

  const generateUniqueProviderCopyKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    const newSortIndex =
      provider.sortIndex !== undefined ? provider.sortIndex + 1 : undefined;

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
      addToLive?: boolean;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: deepClone(provider.settingsConfig),
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      sortIndex: newSortIndex, // 复制原 sortIndex + 1
      meta: provider.meta ? deepClone(provider.meta) : undefined,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (
      activeApp === "opencode" ||
      activeApp === "openclaw" ||
      activeApp === "hermes"
    ) {
      let liveProviderIds: string[] = [];
      try {
        liveProviderIds =
          activeApp === "opencode"
            ? await queryClient.ensureQueryData({
                queryKey: ["opencodeLiveProviderIds"],
                queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
              })
            : activeApp === "openclaw"
              ? await queryClient.ensureQueryData({
                  queryKey: openclawKeys.liveProviderIds,
                  queryFn: () => providersApi.getOpenClawLiveProviderIds(),
                })
              : await queryClient.ensureQueryData({
                  queryKey: hermesKeys.liveProviderIds,
                  queryFn: () => providersApi.getHermesLiveProviderIds(),
                });
      } catch (error) {
        console.error(
          "[App] Failed to load live provider IDs for duplication",
          error,
        );
        const errorMessage = extractErrorMessage(error);
        toast.error(
          t("provider.duplicateLiveIdsLoadFailed", {
            defaultValue: "读取配置中的供应商标识失败，请先修复配置后再试",
          }) + (errorMessage ? `: ${errorMessage}` : ""),
        );
        return;
      }
      const existingKeys = Array.from(
        new Set([...Object.keys(providers), ...liveProviderIds]),
      );
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        existingKeys,
      );
      duplicatedProvider.addToLive = false;
    }

    if (provider.sortIndex !== undefined) {
      const updates = Object.values(providers)
        .filter(
          (p) =>
            p.sortIndex !== undefined &&
            p.sortIndex >= newSortIndex! &&
            p.id !== provider.id,
        )
        .map((p) => ({
          id: p.id,
          sortIndex: p.sortIndex! + 1,
        }));

      if (updates.length > 0) {
        try {
          await providersApi.updateSortOrder(updates, activeApp);
        } catch (error) {
          console.error("[App] Failed to update sort order", error);
          toast.error(
            t("provider.sortUpdateFailed", {
              defaultValue: "排序更新失败",
            }),
          );
          return; // 如果排序更新失败，不继续添加
        }
      }
    }

    await addProvider(duplicatedProvider);
  };

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      const selectedDir = await settingsApi.pickDirectory();
      if (!selectedDir) {
        return;
      }

      await providersApi.openTerminal(provider.id, activeApp, {
        cwd: selectedDir,
      });
      toast.success(
        t("provider.terminalOpened", {
          defaultValue: "终端已打开",
        }),
      );
    } catch (error) {
      console.error("[App] Failed to open terminal", error);
      const errorMessage = extractErrorMessage(error);
      toast.error(
        t("provider.terminalOpenFailed", {
          defaultValue: "打开终端失败",
        }) + (errorMessage ? `: ${errorMessage}` : ""),
      );
    }
  };

  const handleImportSuccess = async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: ["providers"],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers"],
        type: "all",
      });
    } catch (error) {
      console.error("[App] Failed to refresh providers after import", error);
      await refetch();
    }
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to refresh tray menu", error);
    }
  };

  const notifyWindowControlError = (error: unknown) => {
    toast.error(
      t("notifications.windowControlFailed", {
        defaultValue: "窗口控制失败：{{error}}",
        error: extractErrorMessage(error),
      }),
    );
  };

  const handleWindowMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("[App] Failed to minimize window", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowToggleMaximize = async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.toggleMaximize();
      setIsWindowMaximized(await currentWindow.isMaximized());
    } catch (error) {
      console.error("[App] Failed to toggle maximize", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("[App] Failed to close window", error);
      notifyWindowControlError(error);
    }
  };

  const handleOpenSkillsDiscovery = () => {
    setSkillsDiscoverySource("repos");
    setCurrentView("skillsDiscovery");
  };

  const renderContent = () => {
    const content = (() => {
      switch (currentView) {
        case "settings":
          return (
            <SettingsPage
              open={true}
              onOpenChange={() => setCurrentView("providers")}
              onImportSuccess={handleImportSuccess}
              defaultTab={settingsDefaultTab}
            />
          );
        case "prompts":
          return (
            <PromptPanel
              ref={promptPanelRef}
              open={true}
              onOpenChange={() => setCurrentView("providers")}
              appId={sharedFeatureApp}
            />
          );
        case "hermesMemory":
          return <HermesMemoryPanel />;
        case "skills":
          return (
            <UnifiedSkillsPanel
              ref={unifiedSkillsPanelRef}
              onOpenDiscovery={handleOpenSkillsDiscovery}
              currentApp={
                sharedFeatureApp === "openclaw" ? "claude" : sharedFeatureApp
              }
            />
          );
        case "skillsDiscovery":
          return (
            <SkillsPage
              ref={skillsPageRef}
              initialApp={
                sharedFeatureApp === "openclaw" ? "claude" : sharedFeatureApp
              }
              onSourceChange={setSkillsDiscoverySource}
            />
          );
        case "mcp":
          return (
            <UnifiedMcpPanel
              ref={mcpPanelRef}
              onOpenChange={() => setCurrentView("providers")}
            />
          );
        case "agents":
          return (
            <AgentsPanel onOpenChange={() => setCurrentView("providers")} />
          );
        case "universal":
          return (
            <div className="px-6 pt-4">
              <UniversalProviderPanel />
            </div>
          );

        case "sessions":
          return (
            <SessionManagerPage
              key={sharedFeatureApp}
              appId={sharedFeatureApp}
            />
          );
        case "workspace":
          return <WorkspaceFilesPanel />;
        case "openclawEnv":
          return <EnvPanel />;
        case "openclawTools":
          return <ToolsPanel />;
        case "openclawAgents":
          return <AgentsDefaultsPanel />;
        default:
          return (
            <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-12 px-1">
                <div className="space-y-4">
                  <PuppyRouterAccountBanner activeApp={activeApp} />
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeApp}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <ProviderList
                        providers={providers}
                        currentProviderId={currentProviderId}
                        appId={activeApp}
                        isLoading={isLoading}
                        isProxyRunning={isProxyRunning}
                        isProxyTakeover={
                          isProxyRunning && isCurrentAppTakeoverActive
                        }
                        activeProviderId={activeProviderId}
                        onSwitch={switchProvider}
                        onEdit={(provider) => {
                          setEditingProvider(provider);
                        }}
                        onDelete={(provider) =>
                          setConfirmAction({ provider, action: "delete" })
                        }
                        onRemoveFromConfig={
                          activeApp === "opencode" ||
                          activeApp === "openclaw" ||
                          activeApp === "hermes"
                            ? (provider) =>
                                setConfirmAction({ provider, action: "remove" })
                            : undefined
                        }
                        onDisableOmo={
                          activeApp === "opencode"
                            ? handleDisableOmo
                            : undefined
                        }
                        onDisableOmoSlim={
                          activeApp === "opencode"
                            ? handleDisableOmoSlim
                            : undefined
                        }
                        onDuplicate={handleDuplicateProvider}
                        onConfigureUsage={setUsageProvider}
                        onOpenWebsite={handleOpenWebsite}
                        onOpenTerminal={
                          activeApp === "claude"
                            ? handleOpenTerminal
                            : undefined
                        }
                        onCreate={() => setIsAddOpen(true)}
                        onSetAsDefault={
                          activeApp === "openclaw"
                            ? setAsDefaultModel
                            : activeApp === "hermes"
                              ? switchProvider
                              : undefined
                        }
                      />
                    </motion.div>
                  </AnimatePresence>
                  <AnimatePresence>
                    {showPuppyRouterConfigWarning && (
                      <motion.div
                        key={`puppyrouter-config-warning-${activeApp}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="sticky bottom-3 z-20 rounded-lg border border-red-400/70 bg-red-950/95 px-4 py-3 text-sm font-semibold text-red-50 shadow-2xl shadow-red-950/40 backdrop-blur"
                      >
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 shrink-0 text-red-200" />
                          <span>
                            {t(
                              "puppyrouterAccount.clientNotConfiguredWarning",
                              {
                                app: t(`apps.${activeApp}`),
                                defaultValue:
                                  "{{app}} 暂未配置到 PuppyRouter，你正在使用官方或其他渠道。",
                              },
                            )}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          );
      }
    })();

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          className="flex-1 min-h-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    );
  };

  const restartNoticeAppName =
    restartNotice?.appId === "codex"
      ? "Codex"
      : restartNotice?.appId === "claude-desktop"
        ? "Claude Desktop"
        : "Claude Code";
  const restartNoticeManager = isWindows()
    ? t("providerRestartNotice.taskManager", {
        defaultValue: "任务管理器",
      })
    : isMac()
      ? t("providerRestartNotice.activityMonitor", {
          defaultValue: "活动监视器",
        })
      : t("providerRestartNotice.processManager", {
          defaultValue: "系统进程管理器",
        });
  const windowToggleLabel = isWindowMaximized
    ? t("header.windowRestore")
    : t("header.windowMaximize");

  return (
    <div
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30 pb-4"
      style={{ overflowX: "hidden", paddingTop: contentTopOffset }}
    >
      {(dragBarHeight > 0 || useAppWindowControls) && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-end px-2"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag", height: dragBarHeight } as any}
        >
          {useAppWindowControls && (
            <TooltipProvider delayDuration={180}>
              <div
                className="flex items-center gap-1"
                style={{ WebkitAppRegion: "no-drag" } as any}
              >
                {renderHeaderTooltip(
                  t("header.windowMinimize"),
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("header.windowMinimize")}
                    onClick={() => void handleWindowMinimize()}
                    className={windowControlButtonClass}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>,
                )}
                {renderHeaderTooltip(
                  windowToggleLabel,
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={windowToggleLabel}
                    onClick={() => void handleWindowToggleMaximize()}
                    className={windowControlButtonClass}
                  >
                    {isWindowMaximized ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </Button>,
                )}
                {renderHeaderTooltip(
                  t("header.windowClose"),
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("header.windowClose")}
                    onClick={() => void handleWindowClose()}
                    className="h-7 w-7 text-muted-foreground hover:bg-red-500/15 hover:text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </Button>,
                )}
              </div>
            </TooltipProvider>
          )}
        </div>
      )}
      {showEnvBanner && envConflicts.length > 0 && (
        <EnvWarningBanner
          conflicts={envConflicts}
          onDismiss={() => {
            setShowEnvBanner(false);
            sessionStorage.setItem("env_banner_dismissed", "true");
          }}
          onDeleted={async () => {
            try {
              const allConflicts = await checkAllEnvConflicts();
              const flatConflicts = Object.values(allConflicts).flat();
              setEnvConflicts(flatConflicts);
              if (flatConflicts.length === 0) {
                setShowEnvBanner(false);
              }
            } catch (error) {
              console.error(
                "[App] Failed to re-check conflicts after deletion:",
                error,
              );
            }
          }}
        />
      )}

      <header
        className="glass-header fixed z-50 w-full transition-all duration-300"
        {...DRAG_REGION_ATTR}
        style={
          {
            ...DRAG_REGION_STYLE,
            top: dragBarHeight,
            height: HEADER_HEIGHT,
          } as any
        }
      >
        <TooltipProvider delayDuration={180}>
          <div
            className="flex h-full items-center justify-between gap-2 px-6"
            {...DRAG_REGION_ATTR}
            style={{ ...DRAG_REGION_STYLE } as any}
          >
            <div
              className="flex items-center gap-1"
              style={{ WebkitAppRegion: "no-drag" } as any}
            >
              {currentView !== "providers" ? (
                <div className="flex items-center gap-2">
                  <img
                    src={PuppyRouterLogo}
                    alt=""
                    aria-hidden="true"
                    className="h-8 w-8 select-none rounded-lg border border-primary/25 bg-white object-cover shadow-sm shadow-primary/15"
                  />
                  {renderHeaderTooltip(
                    t("common.back", { defaultValue: "返回" }),
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("common.back", { defaultValue: "返回" })}
                      onClick={() =>
                        setCurrentView(
                          currentView === "skillsDiscovery"
                            ? "skills"
                            : "providers",
                        )
                      }
                      className="mr-2 rounded-lg"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>,
                  )}
                  <h1 className="text-lg font-semibold">
                    {currentView === "settings" && t("settings.title")}
                    {currentView === "prompts" &&
                      t("prompts.title", {
                        appName: t(`apps.${sharedFeatureApp}`),
                      })}
                    {currentView === "skills" && t("skills.title")}
                    {currentView === "skillsDiscovery" && t("skills.title")}
                    {currentView === "mcp" && t("mcp.unifiedPanel.title")}
                    {currentView === "agents" && t("agents.title")}
                    {currentView === "universal" &&
                      t("universalProvider.title", {
                        defaultValue: "统一供应商",
                      })}
                    {currentView === "sessions" && t("sessionManager.title")}
                    {currentView === "workspace" && t("workspace.title")}
                    {currentView === "openclawEnv" && t("openclaw.env.title")}
                    {currentView === "openclawTools" &&
                      t("openclaw.tools.title")}
                    {currentView === "openclawAgents" &&
                      t("openclaw.agents.title")}
                    {currentView === "hermesMemory" && t("hermes.memory.title")}
                  </h1>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="relative inline-flex items-center">
                    <a
                      href="https://puppyrouter.com"
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        "inline-flex items-center gap-2 text-xl font-semibold transition-colors",
                        isProxyRunning && isCurrentAppTakeoverActive
                          ? "text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
                          : "text-primary hover:text-primary/85",
                      )}
                    >
                      <img
                        src={PuppyRouterLogo}
                        alt=""
                        aria-hidden="true"
                        className="h-9 w-9 select-none rounded-lg border border-primary/25 bg-white object-cover shadow-sm shadow-primary/15"
                      />
                      <span>puppyrouter app</span>
                    </a>
                  </div>
                  {renderHeaderTooltip(
                    t("common.settings"),
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.settings")}
                      onClick={() => {
                        setSettingsDefaultTab("general");
                        setCurrentView("settings");
                      }}
                      className={headerButtonClass}
                    >
                      <Settings className="w-4 h-4" />
                    </Button>,
                  )}
                  {isCurrentAppTakeoverActive &&
                    renderHeaderTooltip(
                      t("usage.title", {
                        defaultValue: "使用统计",
                      }),
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("usage.title", {
                          defaultValue: "使用统计",
                        })}
                        onClick={() => {
                          setSettingsDefaultTab("usage");
                          setCurrentView("settings");
                        }}
                        className={headerButtonClass}
                      >
                        <BarChart2 className="w-4 h-4" />
                      </Button>,
                    )}
                </div>
              )}
            </div>

            <div className="flex flex-1 min-w-0 items-center justify-end gap-1.5">
              {currentView === "providers" &&
                activeApp !== "opencode" &&
                activeApp !== "openclaw" &&
                activeApp !== "hermes" && (
                  <div
                    className="flex shrink-0 items-center gap-1.5"
                    style={{ WebkitAppRegion: "no-drag" } as any}
                  >
                    {activeApp === "claude-desktop" ? (
                      <ClaudeDesktopRouteToggle />
                    ) : (
                      settingsData?.enableLocalProxy && (
                        <ProxyToggle activeApp={activeApp} />
                      )
                    )}
                    {activeApp !== "claude-desktop" &&
                      settingsData?.enableFailoverToggle && (
                        <FailoverToggle activeApp={activeApp} />
                      )}
                  </div>
                )}
              <div
                ref={toolbarRef}
                className="flex flex-1 min-w-0 overflow-x-hidden items-center py-4 pr-2"
              >
                <div
                  className="flex shrink-0 items-center gap-1.5 ml-auto"
                  style={{ WebkitAppRegion: "no-drag" } as any}
                >
                  {renderHeaderTooltip(
                    headerVersionTooltip,
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={headerVersionTooltip}
                      aria-busy={isCheckingAppUpdate}
                      onClick={() => void handleHeaderVersionCheck()}
                      className={cn(
                        "h-8 shrink-0 gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-sm transition-all",
                        hasAppUpdate && appUpdateInfo
                          ? "border-primary/50 bg-primary/15 text-primary shadow-primary/20 hover:bg-primary/25 hover:text-primary"
                          : "border-primary/30 bg-primary/10 text-primary/90 shadow-primary/10 hover:bg-primary/20 hover:text-primary",
                      )}
                    >
                      {isCheckingAppUpdate ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : hasAppUpdate && appUpdateInfo ? (
                        <ArrowUpCircle className="h-3.5 w-3.5" />
                      ) : null}
                      <span>{currentAppVersionLabel}</span>
                      {hasAppUpdate && availableAppVersionLabel && (
                        <span className="hidden xl:inline text-primary/80">
                          -&gt; {availableAppVersionLabel}
                        </span>
                      )}
                    </Button>,
                  )}
                  {currentView === "prompts" &&
                    renderHeaderTooltip(
                      t("prompts.add"),
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => promptPanelRef.current?.openAdd()}
                        className={headerButtonClass}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {t("prompts.add")}
                      </Button>,
                    )}
                  {currentView === "mcp" && (
                    <>
                      {renderHeaderTooltip(
                        t("mcp.importExisting"),
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => mcpPanelRef.current?.openImport()}
                          className={headerButtonClass}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          {t("mcp.importExisting")}
                        </Button>,
                      )}
                      {renderHeaderTooltip(
                        t("mcp.addMcp"),
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => mcpPanelRef.current?.openAdd()}
                          className={headerButtonClass}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          {t("mcp.addMcp")}
                        </Button>,
                      )}
                    </>
                  )}
                  {currentView === "skills" && (
                    <>
                      {renderHeaderTooltip(
                        t("skills.restoreFromBackup.button"),
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("skills.restoreFromBackup.button")}
                          onClick={() =>
                            unifiedSkillsPanelRef.current?.openRestoreFromBackup()
                          }
                          className={headerButtonClass}
                        >
                          <History className="w-4 h-4 mr-2" />
                          {t("skills.restoreFromBackup.button")}
                        </Button>,
                      )}
                      {renderHeaderTooltip(
                        t("skills.installFromZip.button"),
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("skills.installFromZip.button")}
                          onClick={() =>
                            unifiedSkillsPanelRef.current?.openInstallFromZip()
                          }
                          className={headerButtonClass}
                        >
                          <FolderArchive className="w-4 h-4 mr-2" />
                          {t("skills.installFromZip.button")}
                        </Button>,
                      )}
                      {renderHeaderTooltip(
                        hasUnmanagedSkills
                          ? `${t("skills.import")} - ${t("skills.unmanagedAvailable")}`
                          : t("skills.import"),
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("skills.import")}
                          onClick={() =>
                            unifiedSkillsPanelRef.current?.openImport()
                          }
                          className={cn("relative", headerButtonClass)}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          {t("skills.import")}
                          {hasUnmanagedSkills && (
                            <span
                              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-500"
                              aria-hidden="true"
                            />
                          )}
                        </Button>,
                      )}
                      {renderHeaderTooltip(
                        t("skills.discover"),
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("skills.discover")}
                          onClick={handleOpenSkillsDiscovery}
                          className={headerButtonClass}
                        >
                          <Search className="w-4 h-4 mr-2" />
                          {t("skills.discover")}
                        </Button>,
                      )}
                    </>
                  )}
                  {currentView === "skillsDiscovery" && (
                    <>
                      {getSkillsPageHeaderActions(skillsDiscoverySource).map(
                        ({ key, labelKey, Icon, execute }) =>
                          renderHeaderTooltip(
                            t(labelKey),
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t(labelKey)}
                              onClick={() => execute(skillsPageRef.current)}
                              className={headerButtonClass}
                            >
                              <Icon className="w-4 h-4 mr-2" />
                              {t(labelKey)}
                            </Button>,
                            key,
                          ),
                      )}
                    </>
                  )}
                  {currentView === "providers" && (
                    <>
                      <AppSwitcher
                        activeApp={activeApp}
                        onSwitch={setActiveApp}
                        visibleApps={visibleApps}
                        compact={isToolbarCompact}
                      />

                      <div className="flex items-center gap-1 p-1 rounded-xl border border-border bg-muted/80">
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={
                              activeApp === "openclaw"
                                ? "openclaw"
                                : activeApp === "hermes"
                                  ? "hermes"
                                  : "default"
                            }
                            className="flex items-center gap-1"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            {activeApp === "hermes" ? (
                              <>
                                {renderHeaderTooltip(
                                  t("skills.manage"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("skills.manage")}
                                    onClick={() => setCurrentView("skills")}
                                    className={compactHeaderButtonClass}
                                  >
                                    <Wrench className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("hermes.memory.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("hermes.memory.title")}
                                    onClick={() =>
                                      setCurrentView("hermesMemory")
                                    }
                                    className={compactHeaderButtonClass}
                                  >
                                    <Brain className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("hermes.webui.open"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("hermes.webui.open")}
                                    onClick={() => void openHermesWebUI()}
                                    className={compactHeaderButtonClass}
                                  >
                                    <LayoutDashboard className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("mcp.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("mcp.title")}
                                    onClick={() => setCurrentView("mcp")}
                                    className={compactHeaderButtonClass}
                                  >
                                    <McpIcon size={16} />
                                  </Button>,
                                )}
                              </>
                            ) : activeApp === "openclaw" ? (
                              <>
                                {renderHeaderTooltip(
                                  t("workspace.manage"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("workspace.manage")}
                                    onClick={() => setCurrentView("workspace")}
                                    className={compactHeaderButtonClass}
                                  >
                                    <FolderOpen className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("openclaw.env.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("openclaw.env.title")}
                                    onClick={() =>
                                      setCurrentView("openclawEnv")
                                    }
                                    className={compactHeaderButtonClass}
                                  >
                                    <KeyRound className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("openclaw.tools.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("openclaw.tools.title")}
                                    onClick={() =>
                                      setCurrentView("openclawTools")
                                    }
                                    className={compactHeaderButtonClass}
                                  >
                                    <Shield className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("openclaw.agents.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("openclaw.agents.title")}
                                    onClick={() =>
                                      setCurrentView("openclawAgents")
                                    }
                                    className={compactHeaderButtonClass}
                                  >
                                    <Cpu className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("sessionManager.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("sessionManager.title")}
                                    onClick={() => setCurrentView("sessions")}
                                    className={compactHeaderButtonClass}
                                  >
                                    <History className="w-4 h-4" />
                                  </Button>,
                                )}
                              </>
                            ) : (
                              <>
                                {renderHeaderTooltip(
                                  t("skills.manage"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("skills.manage")}
                                    onClick={() => setCurrentView("skills")}
                                    className={cn(
                                      headerButtonClass,
                                      "transition-all duration-200 ease-in-out overflow-hidden",
                                      hasSkillsSupport
                                        ? "opacity-100 w-8 scale-100 px-2"
                                        : "opacity-0 w-0 scale-75 pointer-events-none px-0 -ml-1",
                                    )}
                                  >
                                    <Wrench className="flex-shrink-0 w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("prompts.manage"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("prompts.manage")}
                                    onClick={() => setCurrentView("prompts")}
                                    className={compactHeaderButtonClass}
                                  >
                                    <Book className="w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("sessionManager.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("sessionManager.title")}
                                    onClick={() => setCurrentView("sessions")}
                                    className={cn(
                                      headerButtonClass,
                                      "transition-all duration-200 ease-in-out overflow-hidden",
                                      hasSessionSupport
                                        ? "opacity-100 w-8 scale-100 px-2"
                                        : "opacity-0 w-0 scale-75 pointer-events-none px-0 -ml-1",
                                    )}
                                  >
                                    <History className="flex-shrink-0 w-4 h-4" />
                                  </Button>,
                                )}
                                {renderHeaderTooltip(
                                  t("mcp.title"),
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("mcp.title")}
                                    onClick={() => setCurrentView("mcp")}
                                    className={compactHeaderButtonClass}
                                  >
                                    <McpIcon size={16} />
                                  </Button>,
                                )}
                              </>
                            )}
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      {!isLockedProviderApp(activeApp) &&
                        renderHeaderTooltip(
                          t("provider.addNewProvider"),
                          <Button
                            aria-label={t("provider.addNewProvider")}
                            onClick={() => setIsAddOpen(true)}
                            size="icon"
                            className={`ml-2 ${addActionButtonClass}`}
                          >
                            <Plus className="w-5 h-5" />
                          </Button>,
                        )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </header>

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in">
        {isOpenClawView && openclawHealthWarnings.length > 0 && (
          <OpenClawHealthBanner warnings={openclawHealthWarnings} />
        )}
        {renderContent()}
      </main>

      <AddProviderDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        appId={activeApp}
        onSubmit={addProvider}
      />

      <EditProviderDialog
        open={Boolean(editingProvider)}
        provider={effectiveEditingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null);
          }
        }}
        onSubmit={handleEditProvider}
        appId={activeApp}
        isProxyTakeover={isCurrentAppTakeoverActive}
      />

      {effectiveUsageProvider && (
        <UsageScriptModal
          key={effectiveUsageProvider.id}
          provider={effectiveUsageProvider}
          appId={activeApp}
          isOpen={Boolean(usageProvider)}
          onClose={() => setUsageProvider(null)}
          onSave={(script) => {
            if (usageProvider) {
              void saveUsageScript(usageProvider, script);
            }
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.action === "remove"
            ? t("confirm.removeProvider")
            : t("confirm.deleteProvider")
        }
        message={
          confirmAction
            ? confirmAction.action === "remove"
              ? t("confirm.removeProviderMessage", {
                  name: confirmAction.provider.name,
                })
              : t("confirm.deleteProviderMessage", {
                  name: confirmAction.provider.name,
                })
            : ""
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        isOpen={launchDashboardOpen}
        title={t("hermes.webui.launchConfirmTitle")}
        message={t("hermes.webui.launchConfirmMessage")}
        confirmText={t("hermes.webui.launchConfirmAction")}
        variant="info"
        onConfirm={() => {
          setLaunchDashboardOpen(false);
          void (async () => {
            try {
              await hermesApi.launchDashboard();
              toast.success(t("hermes.webui.launching"));
            } catch (error) {
              toast.error(t("hermes.webui.launchFailed"), {
                description: extractErrorMessage(error) || undefined,
              });
            }
          })();
        }}
        onCancel={() => setLaunchDashboardOpen(false)}
      />

      <Dialog
        open={Boolean(restartNotice)}
        onOpenChange={(open) => {
          if (!open) return;
        }}
      >
        <DialogContent className="max-w-md" zIndex="top">
          <DialogHeader className="space-y-3 border-b-0 bg-transparent pb-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("providerRestartNotice.title", {
                defaultValue: "需要彻底重启应用",
              })}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line text-sm leading-relaxed">
              {t("providerRestartNotice.message", {
                provider: restartNotice?.providerName ?? "",
                appName: restartNoticeAppName,
                manager: restartNoticeManager,
                defaultValue:
                  "已切换到 {{provider}}。\n\n请打开{{manager}}，彻底退出关闭 {{appName}}，然后重新打开。重新打开后本次切换才会生效。",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t-0 bg-transparent pt-2">
            <Button onClick={() => setRestartNotice(null)}>
              {t("providerRestartNotice.confirm", {
                defaultValue: "确认已经重启app",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeepLinkImportDialog />
      <FirstRunNoticeDialog />
    </div>
  );
}

export default App;
