import type { ProviderCategory } from "@/types";

/** Only built-in application logins and PuppyRouter are offered in the product picker. */
export function showProviderPreset(preset: {
  category?: ProviderCategory;
  providerType?: string;
}) {
  return (
    preset.category === "official" || preset.providerType === "puppyrouter"
  );
}
