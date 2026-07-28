import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type DisplayCurrencyOption = "auto" | "cny" | "usd";

interface CurrencySettingsProps {
  value: DisplayCurrencyOption;
  onChange: (value: DisplayCurrencyOption) => void;
}

const OPTIONS: DisplayCurrencyOption[] = ["auto", "cny", "usd"];

export function CurrencySettings({ value, onChange }: CurrencySettingsProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-2">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("settings.displayCurrency")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.displayCurrencyHint")}
        </p>
      </header>
      <div className="inline-flex gap-1 rounded-md border border-border-default bg-background p-1">
        {OPTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            size="sm"
            variant={value === option ? "default" : "ghost"}
            className={cn(
              "min-w-[104px]",
              value === option
                ? "shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`settings.displayCurrencyOption.${option}`)}
          </Button>
        ))}
      </div>
    </section>
  );
}
