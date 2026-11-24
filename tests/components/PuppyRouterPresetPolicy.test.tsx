import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { showProviderPreset } from "@/config/puppyrouterPresets";
import {
  ProviderPresetSelector,
  type PresetEntry,
} from "@/components/providers/forms/ProviderPresetSelector";

it("offers the official and PuppyRouter entries and allows manual configuration", async () => {
  const onPresetChange = vi.fn();
  const entries: PresetEntry[] = [
    {
      id: "official",
      preset: {
        name: "Official fixture",
        category: "official",
        websiteUrl: "",
        settingsConfig: {},
      },
    },
    {
      id: "third",
      preset: {
        name: "Hidden fixture",
        category: "third_party",
        websiteUrl: "",
        settingsConfig: {},
      },
    },
  ];
  render(
    <ProviderPresetSelector
      selectedPresetId={null}
      presetEntries={entries}
      onPresetChange={onPresetChange}
    />,
  );
  expect(screen.getByText("Official fixture")).toBeInTheDocument();
  expect(
    showProviderPreset({ category: "aggregator", providerType: "puppyrouter" }),
  ).toBe(true);
  expect(screen.queryByText("Hidden fixture")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", {
      name: /providerPreset\.custom|自定义配置|custom config/i,
    }),
  );
  expect(onPresetChange).toHaveBeenCalledWith("custom");
});
