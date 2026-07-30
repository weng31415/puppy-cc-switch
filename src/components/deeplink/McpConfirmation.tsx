import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { DeepLinkImportRequest } from "../../lib/api/deeplink";
import { decodeBase64Utf8 } from "../../lib/utils/base64";
import {
  classifyCommand,
  classifyEndpoint,
  classifyEnvKey,
  maskValue,
  riskI18nKey,
  type RiskKind,
} from "@/utils/deeplinkRisk";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function McpConfirmation({
  request,
}: {
  request: DeepLinkImportRequest;
}) {
  const { t } = useTranslation();

  const mcpServers = useMemo(() => {
    if (!request.config) return null;
    try {
      const decoded = decodeBase64Utf8(request.config);
      const parsed = asRecord(JSON.parse(decoded));
      return asRecord(parsed.mcpServers);
    } catch (e) {
      console.error("Failed to parse MCP config:", e);
      return null;
    }
  }, [request.config]);

  const targetApps = request.apps?.split(",") || [];
  const serverCount = Object.keys(mcpServers || {}).length;
  const risks = useMemo(() => {
    const found = new Set<RiskKind>();

    for (const spec of Object.values(mcpServers || {}) as JsonRecord[]) {
      const commandRisk = classifyCommand(spec.command, spec.args);
      if (commandRisk) found.add(commandRisk);

      if (typeof spec.url === "string") {
        const endpointRisk = classifyEndpoint(spec.url);
        if (endpointRisk) found.add(endpointRisk);
      }

      for (const key of Object.keys(asRecord(spec.env))) {
        const envRisk = classifyEnvKey(key);
        if (envRisk) found.add(envRisk);
      }
    }

    return [...found];
  }, [mcpServers]);

  const Row = ({
    label,
    value,
    risk,
  }: {
    label: string;
    value: string;
    risk?: RiskKind | null;
  }) => (
    <div className="grid grid-cols-[4rem_1fr] gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={`break-all font-mono ${
          risk ? "font-semibold text-yellow-700 dark:text-yellow-500" : ""
        }`}
      >
        {risk && (
          <AlertTriangle
            className="mr-1 inline h-3 w-3 align-text-bottom"
            aria-hidden="true"
          />
        )}
        {value}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t("deeplink.mcp.title")}</h3>

      <div>
        <label className="block text-sm font-medium text-muted-foreground">
          {t("deeplink.mcp.targetApps")}
        </label>
        <div className="mt-1 flex gap-2 flex-wrap">
          {targetApps.map((app) => (
            <span
              key={app}
              className="px-2 py-1 bg-primary/10 text-primary text-xs rounded capitalize"
            >
              {app.trim()}
            </span>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground">
          {t("deeplink.mcp.serverCount", { count: serverCount })}
        </label>
        <div className="mt-1 space-y-2 max-h-64 overflow-auto border rounded p-2 bg-muted/30">
          {mcpServers &&
            Object.entries(mcpServers).map(([id, rawSpec]) => {
              const spec = asRecord(rawSpec);
              const commandRisk = classifyCommand(spec.command, spec.args);
              const args = Array.isArray(spec.args)
                ? spec.args.map(String)
                : [];
              const env = asRecord(spec.env);

              return (
                <div key={id} className="rounded border bg-background p-2">
                  <div className="mb-1 text-sm font-semibold">{id}</div>
                  <div className="space-y-1">
                    {spec.command !== undefined && (
                      <Row
                        label={t("deeplink.mcp.command")}
                        value={String(spec.command)}
                        risk={commandRisk}
                      />
                    )}
                    {args.map((arg, index) => (
                      <Row
                        key={`${id}-arg-${index}`}
                        label={index === 0 ? t("deeplink.mcp.args") : ""}
                        value={arg}
                        risk={commandRisk}
                      />
                    ))}
                    {spec.url !== undefined && (
                      <Row
                        label={t("deeplink.mcp.url")}
                        value={String(spec.url)}
                        risk={classifyEndpoint(spec.url)}
                      />
                    )}
                    {Object.entries(env).map(([key, value], index) => (
                      <Row
                        key={`${id}-env-${key}`}
                        label={index === 0 ? t("deeplink.mcp.env") : ""}
                        value={`${key}=${maskValue(key, String(value))}`}
                        risk={classifyEnvKey(key)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {risks.length > 0 && (
        <div className="space-y-1 rounded border border-yellow-500/40 bg-yellow-500/10 p-2">
          {risks.map((risk) => (
            <div
              key={risk}
              className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-500"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <span>{t(riskI18nKey(risk))}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-500">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("deeplink.mcp.enabledWarning")}</span>
      </div>
    </div>
  );
}
