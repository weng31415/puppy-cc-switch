import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractErrorMessage } from "@/utils/errorUtils";
import {
  buildGrokBuildConfig,
  GROK_BUILD_DEFAULT_API_BACKEND,
  parseGrokBuildConfig,
  validateGrokBuildConfig,
} from "@/utils/grokBuildConfig";
import { PUPPYROUTER_PROVIDER_IDS } from "@/utils/lockedProviders";
import type { ProviderFormProps, ProviderFormValues } from "./ProviderForm";

type GrokBuildProviderFormProps = Omit<ProviderFormProps, "appId">;

const PUPPYROUTER_GROK_ENDPOINT = "https://puppyrouter.com/v1";

export function GrokBuildProviderForm({
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: GrokBuildProviderFormProps) {
  const { t } = useTranslation();
  const isOfficial = initialData?.category === "official";
  const isPuppyRouter =
    providerId === PUPPYROUTER_PROVIDER_IDS.grokbuild;
  const initialConfigText =
    typeof initialData?.settingsConfig?.config === "string"
      ? initialData.settingsConfig.config
      : undefined;
  const initialConfig = useMemo(
    () => parseGrokBuildConfig(initialConfigText, initialData?.name),
    [initialConfigText, initialData?.name],
  );

  const [name, setName] = useState(initialData?.name ?? initialConfig.name);
  const [baseUrl, setBaseUrl] = useState(
    isPuppyRouter ? PUPPYROUTER_GROK_ENDPOINT : initialConfig.baseUrl,
  );
  const [apiKey, setApiKey] = useState(initialConfig.apiKey);
  const [model, setModel] = useState(initialConfig.model);
  const [contextWindow, setContextWindow] = useState(
    String(initialConfig.contextWindow),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setName(initialData?.name ?? initialConfig.name);
    setBaseUrl(
      isPuppyRouter ? PUPPYROUTER_GROK_ENDPOINT : initialConfig.baseUrl,
    );
    setApiKey(initialConfig.apiKey);
    setModel(initialConfig.model);
    setContextWindow(String(initialConfig.contextWindow));
  }, [initialConfig, initialData?.name, isPuppyRouter]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  if (isOfficial) {
    return (
      <div className="space-y-5">
        <div className="rounded-md border border-border/70 bg-muted/20 p-4">
          <p className="text-sm font-medium">
            {t("grokbuild.form.officialTitle")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("grokbuild.form.officialDescription")}
          </p>
        </div>
        {showButtons && (
          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.close")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const resolvedName = isPuppyRouter ? "PuppyRouter" : name.trim();
    const resolvedBaseUrl = isPuppyRouter
      ? PUPPYROUTER_GROK_ENDPOINT
      : baseUrl.trim();
    const parsedContextWindow = Number.parseInt(contextWindow, 10);

    if (!resolvedName) {
      toast.error(t("grokbuild.form.errors.nameRequired"));
      return;
    }
    if (!resolvedBaseUrl) {
      toast.error(t("grokbuild.form.errors.endpointRequired"));
      return;
    }
    try {
      const endpoint = new URL(resolvedBaseUrl);
      if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      toast.error(t("grokbuild.form.errors.endpointInvalid"));
      return;
    }
    if (!model.trim()) {
      toast.error(t("grokbuild.form.errors.modelRequired"));
      return;
    }
    if (!Number.isInteger(parsedContextWindow) || parsedContextWindow <= 0) {
      toast.error(t("grokbuild.form.errors.contextWindowInvalid"));
      return;
    }
    if (!isPuppyRouter && !apiKey.trim()) {
      toast.error(t("grokbuild.form.errors.apiKeyRequired"));
      return;
    }

    const config = buildGrokBuildConfig({
      model,
      baseUrl: resolvedBaseUrl,
      name: resolvedName,
      // The backend preserves the selected cloud key for the locked
      // PuppyRouter provider. Never round-trip that credential through UI.
      apiKey: isPuppyRouter ? "" : apiKey,
      apiBackend: GROK_BUILD_DEFAULT_API_BACKEND,
      contextWindow: parsedContextWindow,
    });
    const configError = validateGrokBuildConfig(config);
    if (configError && !isPuppyRouter) {
      toast.error(t("grokbuild.form.errors.configInvalid", { error: configError }));
      return;
    }

    const values: ProviderFormValues = {
      name: resolvedName,
      websiteUrl: resolvedBaseUrl,
      notes: initialData?.notes ?? "",
      settingsConfig: JSON.stringify({ config }),
      icon: "grok",
      iconColor: initialData?.iconColor ?? "#F59E0B",
      presetCategory: isPuppyRouter ? "aggregator" : "custom",
      meta: isPuppyRouter ? { providerType: "puppyrouter" } : undefined,
    };

    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } catch (error) {
      toast.error(
        t("grokbuild.form.errors.saveFailed", {
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form id="provider-form" className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="grok-provider-name">
            {t("grokbuild.form.providerName")}
          </Label>
          <Input
            id="grok-provider-name"
            value={isPuppyRouter ? "PuppyRouter" : name}
            onChange={(event) => setName(event.target.value)}
            disabled={isPuppyRouter || isSubmitting}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grok-model-id">{t("grokbuild.form.modelId")}</Label>
          <Input
            id="grok-model-id"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={isSubmitting}
            placeholder="grok-4.5"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="grok-endpoint">{t("grokbuild.form.endpoint")}</Label>
        <Input
          id="grok-endpoint"
          value={isPuppyRouter ? PUPPYROUTER_GROK_ENDPOINT : baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          disabled={isPuppyRouter || isSubmitting}
          placeholder="https://api.example.com/v1"
          autoComplete="url"
        />
        {isPuppyRouter && (
          <p className="text-xs text-muted-foreground">
            {t("grokbuild.form.puppyrouterEndpointLocked")}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="grok-api-key">{t("grokbuild.form.apiKey")}</Label>
          <Input
            id="grok-api-key"
            value={
              isPuppyRouter
                ? t("grokbuild.form.puppyrouterApiKeyManaged")
                : apiKey
            }
            onChange={(event) => setApiKey(event.target.value)}
            disabled={isPuppyRouter || isSubmitting}
            type={isPuppyRouter ? "text" : "password"}
            autoComplete={isPuppyRouter ? "off" : "new-password"}
          />
          {isPuppyRouter && (
            <p className="text-xs text-muted-foreground">
              {t("grokbuild.form.puppyrouterApiKeyManagedHint")}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="grok-context-window">
            {t("grokbuild.form.contextWindow")}
          </Label>
          <Input
            id="grok-context-window"
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value)}
            disabled={isSubmitting}
            inputMode="numeric"
            min={1}
            type="number"
          />
        </div>
      </div>

      {showButtons && (
        <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
