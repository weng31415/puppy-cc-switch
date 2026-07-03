import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Monitor, Terminal } from "lucide-react";

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
  compact?: boolean;
}

const ALL_APPS: AppId[] = [
  "codex",
  "claude",
  "claude-desktop",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];
const STORAGE_KEY = "puppyrouter-app-last-app";

export function AppSwitcher({
  activeApp,
  onSwitch,
  visibleApps,
  compact,
}: AppSwitcherProps) {
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
    opencode: "opencode",
    openclaw: "openclaw",
    hermes: "hermes",
  };
  const appDisplayName: Record<AppId, string> = {
    claude: "Claude Code",
    "claude-desktop": "Claude Desktop",
    codex: "Codex",
    gemini: "Gemini",
    opencode: "OpenCode",
    openclaw: "OpenClaw",
    hermes: "Hermes",
  };

  // Filter apps based on visibility settings (default all visible)
  const appsToShow = ALL_APPS.filter((app) => {
    if (!visibleApps) return true;
    return visibleApps[app];
  });

  return (
    <TooltipProvider delayDuration={180}>
      <div className="inline-flex gap-1 rounded-xl border border-border bg-muted/80 p-1">
        {appsToShow.map((app) => {
          const badgeConfig = APP_BADGE_ICON[app];
          const BadgeIcon = badgeConfig?.icon;
          const isActive = activeApp === app;
          const appName = appDisplayName[app];
          return (
            <Tooltip key={app}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={appName}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => handleSwitch(app)}
                  className={cn(
                    "group inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <span className="relative inline-flex shrink-0">
                    <ProviderIcon
                      icon={appIconName[app]}
                      name={appName}
                      size={iconSize}
                    />
                    {BadgeIcon && (
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 flex h-[11px] w-[11px] items-center justify-center rounded-[3px] border",
                          isActive
                            ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground"
                            : "border-border bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
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
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap transition-all duration-200",
                      compact
                        ? "ml-0 max-w-0 opacity-0"
                        : "ml-2 max-w-[120px] opacity-100",
                    )}
                  >
                    {appName}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{appName}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
