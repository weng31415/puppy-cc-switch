import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppSwitcher } from "@/components/AppSwitcher";

describe("AppSwitcher", () => {
  it("keeps the four primary apps fixed and folds the rest into More", async () => {
    const user = userEvent.setup();
    render(<AppSwitcher activeApp="codex" onSwitch={vi.fn()} />);

    expect(screen.getByTestId("app-switcher-codex")).toBeInTheDocument();
    expect(screen.getByTestId("app-switcher-claude")).toBeInTheDocument();
    expect(
      screen.getByTestId("app-switcher-claude-desktop"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("app-switcher-grokbuild")).toBeInTheDocument();
    expect(screen.getByTestId("app-switcher-more")).toBeInTheDocument();
    expect(screen.getByTestId("app-switcher")).toBeInTheDocument();

    await user.click(screen.getByTestId("app-switcher-more"));
    expect(
      screen.getByRole("menuitem", { name: "Gemini" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "OpenCode" }),
    ).toBeInTheDocument();
  });

  it("marks an app from the folded list as active", async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(<AppSwitcher activeApp="openclaw" onSwitch={onSwitch} />);

    const trigger = screen.getByTestId("app-switcher-more");
    expect(trigger).toHaveAttribute("aria-label", "More apps");

    await user.click(trigger);
    expect(
      screen.getByRole("menuitem", { name: "OpenClaw" }),
    ).toBeInTheDocument();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
