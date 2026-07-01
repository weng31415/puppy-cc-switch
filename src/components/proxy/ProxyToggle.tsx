/**
 * 代理模式切换开关组件
 *
 * 放置在主界面头部，用于一键启用/关闭代理模式
 * 启用时自动接管 Live 配置，关闭时恢复原始配置
 */

import { Radio, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";

interface ProxyToggleProps {
  className?: string;
  activeApp: AppId;
}

export function ProxyToggle({ className, activeApp }: ProxyToggleProps) {
  const { t } = useTranslation();
  const { isRunning, takeoverStatus, setTakeoverForApp, isPending, status } =
    useProxyStatus();

  const handleToggle = async (checked: boolean) => {
    try {
      await setTakeoverForApp({ appType: activeApp, enabled: checked });
    } catch (error) {
      console.error("[ProxyToggle] Toggle takeover failed:", error);
    }
  };

  const takeoverEnabled = takeoverStatus?.[activeApp] || false;

  const appLabel =
    activeApp === "claude"
      ? "Claude"
      : activeApp === "codex"
        ? "Codex"
        : activeApp === "gemini"
          ? "Gemini"
          : "OpenCode";

  const tooltipText = takeoverEnabled
    ? isRunning
      ? t("proxy.takeover.tooltip.active", {
          appLabel,
          address: status?.address,
          port: status?.port,
          defaultValue: `${appLabel} 已接管 - ${status?.address}:${status?.port}\n切换该应用供应商为热切换`,
        })
      : t("proxy.takeover.tooltip.broken", {
          appLabel,
          defaultValue: `${appLabel} 已接管，但代理服务未运行`,
        })
    : t("proxy.takeover.tooltip.inactive", {
        appLabel,
        defaultValue: `接管 ${appLabel} 的 Live 配置，让该应用请求走本地代理`,
      });

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex h-8 items-center gap-1 rounded-lg border border-border bg-muted/70 px-1.5 transition-all hover:border-primary/35 hover:bg-primary/10",
              takeoverEnabled && "border-primary/45 bg-primary/10",
              className,
            )}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Radio
                className={cn(
                  "h-4 w-4 transition-colors",
                  takeoverEnabled
                    ? "animate-pulse text-emerald-500"
                    : "text-muted-foreground",
                )}
              />
            )}
            <Switch
              checked={takeoverEnabled}
              onCheckedChange={handleToggle}
              disabled={isPending}
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
