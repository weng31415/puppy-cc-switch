import { Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { cn } from "@/lib/utils";

interface ClaudeDesktopRouteToggleProps {
  className?: string;
}

export function ClaudeDesktopRouteToggle({
  className,
}: ClaudeDesktopRouteToggleProps) {
  const { t } = useTranslation();
  const {
    isRunning,
    status,
    takeoverStatus,
    startProxyServer,
    stopProxyServer,
    isStarting,
    isStoppingServer,
  } = useProxyStatus();

  const isBusy = isStarting || isStoppingServer;
  const otherTakeoverActive = Boolean(
    takeoverStatus?.claude || takeoverStatus?.codex || takeoverStatus?.gemini,
  );
  const routeAddress = status?.address ?? "127.0.0.1";
  const routePort = status?.port ?? 15721;

  const handleToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await startProxyServer();
        return;
      }

      if (otherTakeoverActive) {
        toast.warning(
          t("claudeDesktop.route.stopBlockedByTakeover", {
            defaultValue:
              "其它应用正在使用代理接管。请先在设置中关闭对应应用接管，再停止本地路由。",
          }),
          { duration: 5000 },
        );
        return;
      }

      await stopProxyServer();
    } catch (error) {
      console.error("[ClaudeDesktopRouteToggle] Toggle route failed:", error);
    }
  };

  const tooltipText = isRunning
    ? t("claudeDesktop.route.tooltip.active", {
        address: routeAddress,
        port: routePort,
        defaultValue: `Claude Desktop 本地路由已开启 - ${routeAddress}:${routePort}`,
      })
    : t("claudeDesktop.route.tooltip.inactive", {
        address: routeAddress,
        port: routePort,
        defaultValue: `开启 Claude Desktop 本地路由，用于需要模型映射或格式转换的供应商。当前配置地址：${routeAddress}:${routePort}`,
      });

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex h-8 items-center gap-1 rounded-lg border border-border bg-muted/70 px-1.5 transition-all hover:border-primary/35 hover:bg-primary/10",
              isRunning && "border-primary/45 bg-primary/10",
              className,
            )}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Radio
                className={cn(
                  "h-4 w-4 transition-colors",
                  isRunning
                    ? "animate-pulse text-emerald-500"
                    : "text-muted-foreground",
                )}
              />
            )}
            <Switch
              checked={isRunning}
              onCheckedChange={handleToggle}
              disabled={isBusy}
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
