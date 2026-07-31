import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  Monitor,
  MoreHorizontal,
  Terminal,
} from "lucide-react";

const APP_BADGE_ICON: Partial<
  Record<AppId, { icon: typeof Terminal; offsetY?: number }>
> = {
  claude: { icon: Terminal },
  "claude-desktop": { icon: Monitor, offsetY: 0.5 },
};

interface AppSwitcherProps {
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
  visibleApps?: VisibleApps;
}

const ALL_APPS: AppId[] = [
  "codex",
  "claude",
  "claude-desktop",
  "grokbuild",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];
const PRIMARY_APPS: AppId[] = [
  "codex",
  "claude",
  "claude-desktop",
  "grokbuild",
];
const APP_FALLBACK_NAME: Record<AppId, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini",
  grokbuild: "Grok Build",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
};
const STORAGE_KEY = "puppyrouter-app-last-app";

export function AppSwitcher({
  activeApp,
  onSwitch,
  visibleApps,
}: AppSwitcherProps) {
  const { t } = useTranslation();

  const handleSwitch = (app: AppId) => {
    if (app === activeApp) return;
    localStorage.setItem(STORAGE_KEY, app);
    onSwitch(app);
  };
  const iconSize = 20;
  const appIconName: Record<AppId, string> = {
    claude: "claude",
    "claude-desktop": "claude",
    codex: "openai",
    gemini: "gemini",
    grokbuild: "grok",
    opencode: "opencode",
    openclaw: "openclaw",
    hermes: "hermes",
  };
  const appNameKey: Record<AppId, string> = {
    claude: "apps.claudeCode",
    "claude-desktop": "apps.claudeDesktop",
    codex: "apps.codex",
    gemini: "apps.gemini",
    grokbuild: "apps.grokbuild",
    opencode: "apps.opencode",
    openclaw: "apps.openclaw",
    hermes: "apps.hermes",
  };

  const appsToShow = ALL_APPS.filter((app) => {
    if (!visibleApps) return true;
    return visibleApps[app];
  });
  const primaryApps = PRIMARY_APPS.filter((app) => appsToShow.includes(app));
  const additionalApps = appsToShow.filter(
    (app) => !PRIMARY_APPS.includes(app),
  );

  const renderAppIcon = (app: AppId, isActive: boolean) => {
    const badgeConfig = APP_BADGE_ICON[app];
    const BadgeIcon = badgeConfig?.icon;
    const appName = t(appNameKey[app], {
      defaultValue: APP_FALLBACK_NAME[app],
    });

    return (
      <span className="relative inline-flex shrink-0" aria-hidden="true">
        <ProviderIcon icon={appIconName[app]} name={appName} size={iconSize} />
        {BadgeIcon && (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 flex h-[11px] w-[11px] items-center justify-center rounded-[3px] border",
              isActive
                ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground"
                : "border-border bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            <BadgeIcon
              className="h-[8px] w-[8px]"
              strokeWidth={2.5}
              style={
                badgeConfig?.offsetY
                  ? {
                      transform: `translateY(${badgeConfig.offsetY}px)`,
                    }
                  : undefined
              }
            />
          </span>
        )}
      </span>
    );
  };

  const renderAppButton = (app: AppId) => {
    const isActive = activeApp === app;
    const appName = t(appNameKey[app], {
      defaultValue: APP_FALLBACK_NAME[app],
    });

    return (
      <Tooltip key={app}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={appName}
            aria-current={isActive ? "page" : undefined}
            onClick={() => handleSwitch(app)}
            className={cn(
              "group inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-medium",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
            )}
            data-testid={`app-switcher-${app}`}
          >
            {renderAppIcon(app, isActive)}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{appName}</TooltipContent>
      </Tooltip>
    );
  };

  const moreLabel = t("common.more", { defaultValue: "More apps" });
  const activeAdditionalApp = additionalApps.includes(activeApp)
    ? activeApp
    : null;

  return (
    <TooltipProvider delayDuration={180}>
      <div
        className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-muted/80 p-1"
        data-testid="app-switcher"
      >
        {primaryApps.map(renderAppButton)}
        {additionalApps.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={moreLabel}
                title={moreLabel}
                className={cn(
                  "inline-flex h-8 w-9 shrink-0 items-center justify-center gap-0.5 rounded-md",
                  activeAdditionalApp
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
                data-testid="app-switcher-more"
              >
                {activeAdditionalApp ? (
                  renderAppIcon(activeAdditionalApp, true)
                ) : (
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                )}
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              collisionPadding={12}
              className="z-[120] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-48 overflow-y-auto border-primary/25"
            >
              {additionalApps.map((app) => {
                const isActive = activeApp === app;
                const appName = t(appNameKey[app], {
                  defaultValue: APP_FALLBACK_NAME[app],
                });

                return (
                  <DropdownMenuItem
                    key={app}
                    onSelect={() => handleSwitch(app)}
                    className="gap-2"
                  >
                    {renderAppIcon(app, false)}
                    <span className="min-w-0 flex-1 truncate">{appName}</span>
                    {isActive && <Check className="h-4 w-4 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </TooltipProvider>
  );
}
