import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/components/providers/ProviderCard";

vi.mock("@/lib/query/failover", () => ({
  useProviderHealth: () => ({ data: undefined }),
}));

vi.mock("@/lib/query/queries", () => ({
  useUsageQuery: () => ({ data: undefined }),
}));

function renderCard(
  overrides: Partial<ComponentProps<typeof ProviderCard>> = {},
) {
  return render(
    createElement(ProviderCard, {
      provider: {
        id: "test-provider",
        name: "Test Provider",
        category: "custom",
        settingsConfig: {},
      },
      appId: "codex",
      isCurrent: false,
      isProxyRunning: false,
      onSwitch: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onConfigureUsage: vi.fn(),
      onOpenWebsite: vi.fn(),
      onDuplicate: vi.fn(),
      ...overrides,
    }),
  );
}

const PROVIDER_CARD_TSX = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "components",
  "providers",
  "ProviderCard.tsx",
);

describe("ProviderCard active state", () => {
  it.each(["claude", "codex", "gemini", "grokbuild"] as const)(
    "uses green for the current %s provider without changing button behavior",
    (appId) => {
      const onSwitch = vi.fn();
      const { container, getByRole } = renderCard({
        appId,
        isCurrent: true,
        onSwitch,
      });
      expect(container.firstElementChild).toHaveClass("border-emerald-500/60");
      expect(container.firstElementChild).not.toHaveClass("border-primary/60");
      expect(container.querySelector(".from-emerald-500\\/10")).toHaveClass(
        "opacity-100",
      );
      const status = getByRole("button", { name: "provider.inUse" });
      expect(status).toHaveClass("bg-emerald-100", "text-emerald-800");
      expect(status).toBeDisabled();
      fireEvent.click(status);
      expect(onSwitch).not.toHaveBeenCalled();
    },
  );

  it("does not highlight an inactive provider in green", () => {
    const onSwitch = vi.fn();
    const { container, getByRole } = renderCard({ onSwitch });
    expect(container.firstElementChild).not.toHaveClass(
      "border-emerald-500/60",
    );
    fireEvent.click(getByRole("button", { name: "provider.enable" }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "follows the actual failover provider (active: %s)",
    (active) => {
      const { container } = renderCard({
        isCurrent: !active,
        isProxyTakeover: true,
        isAutoFailoverEnabled: true,
        activeProviderId: active ? "test-provider" : "other-provider",
      });
      expect(
        container.firstElementChild?.classList.contains(
          "border-emerald-500/60",
        ),
      ).toBe(active);
    },
  );

  it("keeps OpenCode configured-only cards distinct from active providers", () => {
    const { container } = renderCard({ appId: "opencode", isInConfig: true });
    expect(container.firstElementChild).toHaveClass("border-primary/60");
    expect(container.firstElementChild).not.toHaveClass(
      "border-emerald-500/60",
    );
  });

  it("uses green for active OMO while preserving its disable action", () => {
    const onDisableOmo = vi.fn();
    const { container, getByRole } = renderCard({
      appId: "opencode",
      isOmo: true,
      isCurrent: true,
      onDisableOmo,
    });
    expect(container.firstElementChild).toHaveClass("border-emerald-500/60");
    const status = getByRole("button", { name: "provider.inUse" });
    expect(status).toHaveClass("text-emerald-800");
    fireEvent.click(status);
    expect(onDisableOmo).toHaveBeenCalledTimes(1);
  });

  it("uses green for the OpenClaw default provider and its status", () => {
    const { container, getByRole } = renderCard({
      appId: "openclaw",
      isInConfig: true,
      isDefaultModel: true,
      onSetAsDefault: vi.fn(),
    });
    expect(container.firstElementChild).toHaveClass("border-emerald-500/60");
    const status = getByRole("button", { name: "当前默认" });
    expect(status).toHaveClass("text-emerald-800");
    expect(status).toBeDisabled();
  });
});

describe("ProviderCard layout", () => {
  const source = fs.readFileSync(PROVIDER_CARD_TSX, "utf8");

  it("lets website links use available card width before truncating", () => {
    expect(source).not.toContain("max-w-[280px]");
    expect(source).toContain("flex min-w-0 flex-1 items-center gap-2");
    expect(source).toContain("min-w-0 flex-1 space-y-1");
    expect(source).toContain(
      "inline-flex max-w-full items-center overflow-hidden text-left text-sm",
    );
  });
});
