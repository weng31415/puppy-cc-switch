/**
 * 故障转移切换开关组件
 *
 * 放置在主界面头部，用于一键启用/关闭自动故障转移
 */

import { Shuffle, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAutoFailoverEnabled,
  useSetAutoFailoverEnabled,
} from "@/lib/query/failover";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";

interface FailoverToggleProps {
  className?: string;
  activeApp: AppId;
}

export function FailoverToggle({ className, activeApp }: FailoverToggleProps) {
  const { t } = useTranslation();
  const { data: isEnabled = false, isLoading } =
    useAutoFailoverEnabled(activeApp);
  const setEnabled = useSetAutoFailoverEnabled();
  const { takeoverStatus } = useProxyStatus();
  const takeoverEnabled = takeoverStatus?.[activeApp] ?? false;

  const handleToggle = (checked: boolean) => {
    if (checked && !takeoverEnabled) return;
    setEnabled.mutate({ appType: activeApp, enabled: checked });
  };

  const appLabel =
    activeApp === "claude"
      ? "Claude"
      : activeApp === "codex"
        ? "Codex"
        : "Gemini";

  const tooltipText = !takeoverEnabled
    ? t("failover.tooltip.takeoverRequired", {
        app: appLabel,
        defaultValue: `请先接管 ${appLabel}，再启用故障转移`,
      })
    : isEnabled
      ? t("failover.tooltip.enabled", {
          app: appLabel,
          defaultValue: `${appLabel} 故障转移已启用\n按队列优先级（P1→P2→...）选择供应商`,
        })
      : t("failover.tooltip.disabled", {
          app: appLabel,
          defaultValue: `启用 ${appLabel} 故障转移\n将立即切换到队列 P1，并在失败时自动切换到下一个`,
        });

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex h-8 items-center gap-1 rounded-lg border border-border bg-muted/70 px-1.5 transition-all hover:border-primary/35 hover:bg-primary/10",
              isEnabled && "border-primary/45 bg-primary/10",
              !takeoverEnabled && "opacity-75",
              className,
            )}
          >
            {setEnabled.isPending || isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Shuffle
                className={cn(
                  "h-4 w-4 transition-colors",
                  isEnabled
                    ? "animate-pulse text-emerald-500"
                    : "text-muted-foreground",
                )}
              />
            )}
            <Switch
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={setEnabled.isPending || isLoading || !takeoverEnabled}
              aria-label={tooltipText}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
