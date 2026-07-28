import { describe, expect, it } from "vitest";
import {
  formatDisplayAmountFromUsd,
  formatQuotaForDisplay,
  isChineseLanguage,
  normalizeUsdExchangeRate,
  resolveDisplayCurrency,
} from "./displayCurrency";

describe("display currency", () => {
  it("recognizes simplified and traditional Chinese language tags", () => {
    expect(isChineseLanguage("zh")).toBe(true);
    expect(isChineseLanguage("zh-CN")).toBe(true);
    expect(isChineseLanguage("zh_TW")).toBe(true);
    expect(isChineseLanguage("zh-Hant-HK")).toBe(true);
    expect(isChineseLanguage("en")).toBe(false);
    expect(isChineseLanguage("ja")).toBe(false);
  });

  it("follows language in auto mode and honors explicit overrides", () => {
    expect(resolveDisplayCurrency("auto", "zh-TW")).toBe("CNY");
    expect(resolveDisplayCurrency("auto", "ja")).toBe("USD");
    expect(resolveDisplayCurrency("usd", "zh")).toBe("USD");
    expect(resolveDisplayCurrency("cny", "en")).toBe("CNY");
  });

  it("formats USD and converts CNY only at display time", () => {
    expect(formatDisplayAmountFromUsd(2, "usd", "zh", 7.3)).toBe("$2");
    expect(formatDisplayAmountFromUsd(2, "auto", "zh", 7.3)).toBe("¥14.6");
    expect(formatQuotaForDisplay(500_000, 500_000, "cny", "en", 7.3)).toBe(
      "¥7.3",
    );
  });

  it("uses a safe exchange-rate fallback for missing or invalid status data", () => {
    expect(normalizeUsdExchangeRate(undefined)).toBe(7.3);
    expect(normalizeUsdExchangeRate(0)).toBe(7.3);
    expect(normalizeUsdExchangeRate(Number.NaN)).toBe(7.3);
  });
});
