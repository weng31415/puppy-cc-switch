import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { puppyRouterKeyPage } from "@/lib/puppyrouterLinks";
import ApiKeyInput from "../ApiKeyInput";
import type { ProviderCategory } from "@/types";

interface ApiKeySectionProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  category?: ProviderCategory;
  shouldShowLink: boolean;
  websiteUrl: string;
  placeholder?: {
    official: string;
    thirdParty: string;
  };
  disabled?: boolean;
  /** 保存时会校验 Key 非空的表单才传；官方 / 云厂商 / 禁用时不标星 */
  required?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  /** Displayed below the input. */
  hint?: ReactNode;
}

export function ApiKeySection({
  id,
  label,
  value,
  onChange,
  category,
  shouldShowLink,
  websiteUrl,
  placeholder,
  disabled,
  required = false,
  hint,
}: ApiKeySectionProps) {
  const { t } = useTranslation();

  const defaultPlaceholder = {
    official: t("providerForm.officialNoApiKey", {
      defaultValue: "官方供应商无需 API Key",
    }),
    thirdParty: t("providerForm.apiKeyAutoFill", {
      defaultValue: "输入 API Key，将自动填充到配置",
    }),
  };

  const finalPlaceholder = placeholder || defaultPlaceholder;
  const isDisabled = disabled ?? category === "official";
  const isRequired =
    required &&
    !isDisabled &&
    category !== "official" &&
    category !== "cloud_provider";

  const keyPage = shouldShowLink ? puppyRouterKeyPage(websiteUrl) : undefined;

  return (
    <ApiKeyInput
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      placeholder={
        category === "official"
          ? finalPlaceholder.official
          : finalPlaceholder.thirdParty
      }
      disabled={isDisabled}
      required={isRequired}
      labelAside={
        keyPage ? (
          <a
            href={keyPage}
            target="_blank"
            rel="noopener noreferrer"
            className="text-caption text-blue-400 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
          >
            {t("providerForm.getApiKey", { defaultValue: "获取 API Key" })} ↗
          </a>
        ) : null
      }
      hint={hint || undefined}
    />
  );
}
