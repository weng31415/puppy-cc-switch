export type DisplayCurrencyPreference = "auto" | "cny" | "usd";
export type ResolvedDisplayCurrency = "CNY" | "USD";

const DEFAULT_USD_EXCHANGE_RATE = 7.3;

export function isChineseLanguage(language?: string | null): boolean {
  if (!language) return false;
  return language.toLowerCase().replace(/_/g, "-").startsWith("zh");
}

export function resolveDisplayCurrency(
  preference: DisplayCurrencyPreference | undefined,
  language?: string | null,
): ResolvedDisplayCurrency {
  if (preference === "cny") return "CNY";
  if (preference === "usd") return "USD";
  return isChineseLanguage(language) ? "CNY" : "USD";
}

export function normalizeUsdExchangeRate(rate?: number | null): number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : DEFAULT_USD_EXCHANGE_RATE;
}

export function formatDisplayAmountFromUsd(
  valueUsd: number,
  preference: DisplayCurrencyPreference | undefined,
  language?: string | null,
  usdExchangeRate?: number | null,
): string {
  const currency = resolveDisplayCurrency(preference, language);
  const amount =
    currency === "CNY"
      ? valueUsd * normalizeUsdExchangeRate(usdExchangeRate)
      : valueUsd;
  const absoluteAmount = Math.abs(amount);

  return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: absoluteAmount >= 1 ? 2 : 4,
  }).format(Object.is(amount, -0) ? 0 : amount);
}

export function formatQuotaForDisplay(
  quota: number,
  quotaPerUnit: number,
  preference: DisplayCurrencyPreference | undefined,
  language?: string | null,
  usdExchangeRate?: number | null,
): string {
  const safeQuotaPerUnit = quotaPerUnit > 0 ? quotaPerUnit : 500_000;
  return formatDisplayAmountFromUsd(
    quota / safeQuotaPerUnit,
    preference,
    language,
    usdExchangeRate,
  );
}
