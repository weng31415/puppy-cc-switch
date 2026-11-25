import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PuppyRouterAccountBanner } from "@/components/puppyrouter/PuppyRouterAccountBanner";
import {
  puppyrouterAccountApi,
  providersApi,
  settingsApi,
  type PuppyRouterApiKey,
} from "@/lib/api";
import * as clipboard from "@/lib/clipboard";
import { proxyApi } from "@/lib/api/proxy";
import { renderWithQueryClient } from "../utils/testQueryClient";

const signedIn = {
  loggedIn: true,
  sessionState: "authenticated" as const,
  user: { id: 5, username: "fixture-user" },
};
function grant(code: string) {
  return {
    userCode: code,
    deviceCode: "device-" + code,
    authorizeUrl: "https://puppyrouter.com/desktop-auth?code=" + code,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    interval: 1,
  };
}
const key: PuppyRouterApiKey = {
  id: 10,
  name: "fixture-key",
  maskedKey: "masked",
  status: 1,
  remainQuota: 0,
  usedQuota: 0,
  unlimitedQuota: true,
  expiredTime: -1,
  createdTime: 0,
  accessedTime: 0,
  crossGroupRetry: false,
  modelLimitsEnabled: false,
  usable: true,
  recommended: false,
  providerKeyMatch: false,
  active: false,
};
const click = async (name: string) =>
  fireEvent.click(await screen.findByRole("button", { name }));
const pending = <T,>() => new Promise<T>(() => {});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PuppyRouter account interaction", () => {
  it("recovers from a connection error and shows approval while keys and balance are still loading", async () => {
    const start = grant("ABCD-EFGH");
    vi.spyOn(puppyrouterAccountApi, "beginLogin").mockResolvedValue(start);
    const open = vi
      .spyOn(settingsApi, "openExternal")
      .mockResolvedValue(undefined);
    const poll = vi
      .spyOn(puppyrouterAccountApi, "pollLogin")
      .mockRejectedValueOnce(new Error("offline fixture"))
      .mockResolvedValueOnce({ status: "approved", account: signedIn });
    const keys = vi
      .spyOn(puppyrouterAccountApi, "listApiKeys")
      .mockReturnValue(pending());
    const balance = vi
      .spyOn(puppyrouterAccountApi, "getBalance")
      .mockReturnValue(pending());
    vi.spyOn(puppyrouterAccountApi, "listGroups").mockResolvedValue([]);
    const apply = vi.spyOn(puppyrouterAccountApi, "applyApiKey");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.loginCta");
    await click("puppyrouterAccount.login");
    await waitFor(() => expect(open).toHaveBeenCalledWith(start.authorizeUrl));
    expect(
      await screen.findByText(
        "puppyrouterAccount.loginReconnecting",
        {},
        { timeout: 3500 },
      ),
    ).toBeVisible();
    expect(
      await screen.findByText("fixture-user", {}, { timeout: 3500 }),
    ).toBeVisible();
    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(keys).toHaveBeenCalledOnce();
      expect(balance).toHaveBeenCalledOnce();
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("copies the official approval link and reopens the same pending grant", async () => {
    const start = grant("COPY-TEST");
    const begin = vi
      .spyOn(puppyrouterAccountApi, "beginLogin")
      .mockResolvedValue(start);
    vi.spyOn(puppyrouterAccountApi, "cancelLogin").mockResolvedValue(undefined);
    vi.spyOn(puppyrouterAccountApi, "pollLogin").mockReturnValue(pending());
    const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue();
    const open = vi.spyOn(settingsApi, "openExternal").mockResolvedValue();
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="agy" />);
    await click("puppyrouterAccount.loginCta");
    await click("puppyrouterAccount.copyLoginLink");
    await waitFor(() => expect(copy).toHaveBeenCalledWith(start.authorizeUrl));
    expect(open).not.toHaveBeenCalled();
    await click("puppyrouterAccount.openBrowserAgain");
    await waitFor(() => expect(open).toHaveBeenCalledWith(start.authorizeUrl));
    expect(begin).toHaveBeenCalledOnce();
  });

  it("discards the cancelled link and allows a fresh grant after expiry", async () => {
    const cancel = vi
      .spyOn(puppyrouterAccountApi, "cancelLogin")
      .mockResolvedValue(undefined);
    const begin = vi
      .spyOn(puppyrouterAccountApi, "beginLogin")
      .mockResolvedValueOnce(grant("FIRST"))
      .mockResolvedValueOnce({ ...grant("EXPIRED"), expiresAt: 1 })
      .mockResolvedValueOnce(grant("LATEST"));
    vi.spyOn(settingsApi, "openExternal").mockResolvedValue(undefined);
    const poll = vi
      .spyOn(puppyrouterAccountApi, "pollLogin")
      .mockReturnValue(pending());
    const error = vi.spyOn(toast, "error");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="agy" />);
    await click("puppyrouterAccount.loginCta");
    await click("puppyrouterAccount.login");
    expect(await screen.findByText("FIRST")).toBeVisible();
    await click("common.cancel");
    await click("puppyrouterAccount.loginCta");
    await click("puppyrouterAccount.login");
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("puppyrouterAccount.loginExpired"),
    );
    await click("puppyrouterAccount.login");
    expect(await screen.findByText("LATEST")).toBeVisible();
    expect(cancel).toHaveBeenCalledWith("device-FIRST");
    expect(begin).toHaveBeenCalledTimes(3);
    expect(poll).not.toHaveBeenCalledWith("device-EXPIRED");
  });

  it.each([false, true])(
    "explains the saved key when routing to PuppyRouter is %s",
    async (routed) => {
      vi.spyOn(puppyrouterAccountApi, "getStatus").mockResolvedValue(signedIn);
      vi.spyOn(puppyrouterAccountApi, "listGroups").mockResolvedValue([]);
      vi.spyOn(puppyrouterAccountApi, "getBalance").mockReturnValue(pending());
      vi.spyOn(puppyrouterAccountApi, "listApiKeys").mockResolvedValue({
        keys: [key],
        total: 1,
      });
      vi.spyOn(proxyApi, "getAppMode").mockResolvedValue({
        mode: routed ? "route" : "direct",
        attached: routed,
        routeProviderId: "universal-codex-puppyrouter",
        directProviderId: "codex-official",
      });
      const apply = vi
        .spyOn(puppyrouterAccountApi, "applyApiKey")
        .mockResolvedValue({
          synced: true,
          name: key.name,
          tokenId: key.id,
          maskedKey: key.maskedKey,
        });
      const change = vi.spyOn(providersApi, "switch");
      const success = vi.spyOn(toast, "success");
      renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
      await click("puppyrouterAccount.applyToApp");
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith("puppyrouterAccount.syncSuccess", {
          description:
            "puppyrouterAccount.keyUsage." + (routed ? "proxy" : "staged"),
        }),
      );
      expect(apply).toHaveBeenCalledWith(key.id, "codex");
      expect(change).not.toHaveBeenCalled();
    },
  );
});
