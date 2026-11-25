import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";
import type { View } from "@/lib/navigation";
import type { Settings, VisibleApps } from "@/types";
import { createTestQueryClient } from "../../utils/testQueryClient";

const status = vi.hoisted(() => ({
  todayCost: 47.2,
  todayTokens: 120_400_000,
  todayRequests: 663,
  todayHitRate: 0.986,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: string }) =>
      options?.value != null ? `${key}:${options.value}` : key,
    i18n: { resolvedLanguage: "en" },
  }),
}));

const update = vi.hoisted(() => ({
  hasUpdate: false,
  checkUpdate: vi.fn<() => Promise<boolean>>(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => ({
    hasUpdate: update.hasUpdate,
    checkUpdate: update.checkUpdate,
    updateInfo: update.hasUpdate ? { availableVersion: "8.12.4" } : null,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: update.success, error: update.error },
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "8.12.3",
}));

vi.mock("@/hooks/useSidebarStatus", () => ({
  useSidebarStatus: () => ({
    appStatus: () => ({ mode: "direct", alert: false }),
    todayCost: status.todayCost,
    todayTokens: status.todayTokens,
    todayRequests: status.todayRequests,
    todayHitRate: status.todayHitRate,
    authNeedsAttention: false,
  }),
}));

const renderSidebar = (settings: Partial<Settings>, view: View = "usage") => {
  const client = createTestQueryClient();
  const selectSettingsSection = vi.fn();
  // 不让设置查询回头去 mock 后端重取，盖掉这里给的值
  client.setQueryDefaults(["settings"], { staleTime: Infinity });
  client.setQueryData(["settings"], settings);
  render(
    <QueryClientProvider client={client}>
      <Sidebar
        activeApp="claude"
        view={view}
        visibleApps={{} as VisibleApps}
        settingsSection="general"
        onSelectApp={vi.fn()}
        onSelectPage={vi.fn()}
        onSelectSettingsSection={selectSettingsSection}
        onExitSettings={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return selectSettingsSection;
};

describe("sidebar branding", () => {
  afterEach(() => {
    localStorage.removeItem("cc-switch-sidebar-collapsed");
    update.hasUpdate = false;
    vi.clearAllMocks();
  });

  it.each([false, true])(
    "opens About from the version shortcut (already aware of update: %s)",
    async (known) => {
      update.hasUpdate = known;
      update.checkUpdate.mockResolvedValue(true);
      const openSection = renderSidebar({});
      const button = await screen.findByRole("button", { name: /^v8\.12\.3/ });
      button.focus();
      await userEvent.setup().keyboard("{Enter}");
      expect(update.checkUpdate).toHaveBeenCalledTimes(known ? 0 : 1);
      expect(openSection).toHaveBeenCalledWith("about");
    },
  );

  it("reports a clean check and a network error without navigating or installing", async () => {
    update.checkUpdate
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("offline"));
    const openSection = renderSidebar({});
    const button = await screen.findByRole("button", { name: /^v8\.12\.3/ });
    const user = userEvent.setup();
    await user.click(button);
    expect(update.success).toHaveBeenCalledWith(
      "settings.upToDate",
      expect.anything(),
    );
    await user.click(button);
    expect(update.error).toHaveBeenCalledWith(
      "settings.checkUpdateFailed",
      expect.anything(),
    );
    expect(openSection).not.toHaveBeenCalled();
  });

  it.each(["usage", "settings"] as const)(
    "shows the brand and actual app version on separate lines in %s",
    async (view) => {
      renderSidebar({}, view);
      const nav = within(screen.getByRole("navigation"));
      const name = nav.getByText("puppyrouter tool", { exact: true });
      const version = await nav.findByText("v8.12.3", { exact: true });
      expect(name.nextElementSibling).toBe(version);
      expect(nav.queryByText(/puppyrouter app/)).toBeNull();
      expect(screen.getByRole("navigation")).toHaveStyle({ width: "224px" });
    },
  );

  it("restores the brand and version after expanding the icon rail", async () => {
    const user = userEvent.setup();
    renderSidebar({});
    await screen.findByText("v8.12.3");
    await user.click(
      screen.getByRole("button", { name: "nav.collapseSidebar" }),
    );
    expect(screen.queryByText("puppyrouter tool")).toBeNull();
    expect(screen.queryByText("v8.12.3")).toBeNull();
    await user.click(screen.getByRole("button", { name: "nav.expandSidebar" }));
    expect(screen.getByText("puppyrouter tool")).toBeVisible();
    expect(screen.getByText("v8.12.3")).toBeVisible();
  });
});

describe("sidebar Today label", () => {
  it.each([
    [undefined, "nav.today:$47.20"],
    [["tokens"], "nav.today:120M"],
    [["requests"], "nav.today:nav.todayRequests:663"],
    [["hitRate"], "nav.today:nav.todayHitRate:98.6%"],
  ])("shows %s", (items, label) => {
    status.todayCost = 47.2;
    status.todayTokens = 120_400_000;
    status.todayRequests = 663;
    renderSidebar({ usageDisplay: { sidebarTodayItems: items } });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("stacks only the numbers when showing two items", async () => {
    // 带上「今日」一行放不下长币种，会挤掉「用量统计」；完整说法在读屏名字和悬停里
    status.todayCost = 47.2;
    status.todayTokens = 120_400_000;
    renderSidebar({ usageDisplay: { sidebarTodayItems: ["cost", "tokens"] } });
    expect(screen.getByText("$47.20")).toBeInTheDocument();
    expect(screen.getByText("120M")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "nav.usage · nav.today:$47.20 · 120M",
      }),
    ).toBeInTheDocument();

    // 「今日」只在悬停提示里
    await userEvent.hover(screen.getByText("$47.20"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "nav.usage · nav.today:$47.20 · 120M",
    );
  });

  it("shows nothing when hidden", () => {
    renderSidebar({ usageDisplay: { sidebarTodayItems: [] } });
    expect(screen.queryByText(/^nav\.today/)).not.toBeInTheDocument();
  });

  it("skips the parts that are zero", () => {
    // 没配定价时金额是 0：金额 + Token 只剩 Token，只勾金额就整个不显示
    status.todayCost = 0;
    status.todayTokens = 5_000;
    renderSidebar({ usageDisplay: { sidebarTodayItems: ["cost", "tokens"] } });
    expect(screen.getByText("nav.today:5,000")).toBeInTheDocument();
  });

  it("leaves out the hit rate before the first request of the day", () => {
    status.todayRequests = 0;
    status.todayTokens = 0;
    status.todayCost = 0;
    renderSidebar({ usageDisplay: { sidebarTodayItems: ["hitRate"] } });
    expect(screen.queryByText(/^nav\.today/)).not.toBeInTheDocument();
  });

  it("hides the cost-only label while nothing is priced", () => {
    status.todayCost = 0;
    status.todayTokens = 5_000;
    renderSidebar({});
    expect(screen.queryByText(/^nav\.today/)).not.toBeInTheDocument();
  });
});
