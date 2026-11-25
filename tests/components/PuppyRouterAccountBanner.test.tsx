import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PuppyRouterAccountBanner } from "@/components/puppyrouter/PuppyRouterAccountBanner";
import {
  puppyrouterAccountApi,
  providersApi,
  settingsApi,
  type PuppyRouterApiKey,
} from "@/lib/api";
import {
  PUPPYROUTER_SESSION_EXPIRED_EVENT,
  type PuppyRouterConfigReport,
} from "@/lib/api/puppyrouterAccount";
import * as clipboard from "@/lib/clipboard";
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
      vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
        scope: routed ? "proxy" : "staged",
        issues: routed ? [] : ["ProviderNotCurrent"],
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

  function signInForDiagnostics() {
    vi.spyOn(puppyrouterAccountApi, "getStatus").mockResolvedValue(signedIn);
    vi.spyOn(puppyrouterAccountApi, "listGroups").mockResolvedValue([]);
    vi.spyOn(puppyrouterAccountApi, "getBalance").mockReturnValue(pending());
    return vi.spyOn(puppyrouterAccountApi, "listApiKeys").mockResolvedValue({
      selectedTokenId: key.id,
      keys: [{ ...key, providerKeyMatch: true }],
      total: 1,
    });
  }

  it.each(["direct", "native", "launch", "proxy"] as const)(
    "reports only what was checked for %s",
    async (scope) => {
      signInForDiagnostics();
      vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
        scope,
        issues: [],
      });
      renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
      await click("puppyrouterAccount.diagnose");
      expect(
        await screen.findByText("puppyrouterAccount.diagnoseScope." + scope),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: "puppyrouterAccount.diagnoseFixLiveConfig",
        }),
      ).toBeNull();
    },
  );

  it("keeps native findings visible when cloud verification is unavailable and never proposes rewriting a route", async () => {
    signInForDiagnostics().mockResolvedValue({
      keys: [{ ...key, providerKeyMatch: null }],
      total: 1,
      selectedTokenId: key.id,
    });
    vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
      scope: "proxy",
      issues: ["ProxyConfigMismatch"],
    });
    const write = vi.spyOn(providersApi, "switch");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseCloudUnverified"),
    ).toBeVisible();
    expect(
      screen.getByText("puppyrouterAccount.diagnoseProxyConfigMismatch"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "puppyrouterAccount.diagnoseFixLiveConfig",
      }),
    ).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("rechecks the mode before repairing and preserves a newly selected route", async () => {
    signInForDiagnostics();
    const read = vi
      .spyOn(puppyrouterAccountApi, "diagnoseConfig")
      .mockResolvedValue({ scope: "direct", issues: ["KeyMismatch"] });
    const write = vi.spyOn(providersApi, "switch");
    const reapply = vi.spyOn(puppyrouterAccountApi, "reapplyConfig");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    await screen.findByText("puppyrouterAccount.diagnoseKeyMismatch");
    read.mockResolvedValue({ scope: "staged", issues: ["ProxyNotSelected"] });
    await click("puppyrouterAccount.diagnoseFixLiveConfig");
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseProxyNotSelected"),
    ).toBeVisible();
    expect(write).not.toHaveBeenCalled();
    expect(reapply).not.toHaveBeenCalled();
  });

  it("repairs the active client from its saved card without switching its supplier", async () => {
    signInForDiagnostics();
    const read = vi
      .spyOn(puppyrouterAccountApi, "diagnoseConfig")
      .mockResolvedValue({ scope: "direct", issues: ["KeyMismatch"] });
    const reapply = vi
      .spyOn(puppyrouterAccountApi, "reapplyConfig")
      .mockImplementation(async () => {
        read.mockResolvedValue({ scope: "direct", issues: [] });
        return true;
      });
    const change = vi.spyOn(providersApi, "switch");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    await click("puppyrouterAccount.diagnoseFixLiveConfig");
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseHealthy"),
    ).toBeVisible();
    expect(reapply).toHaveBeenCalledWith("codex");
    expect(change).not.toHaveBeenCalled();
  });

  it("fixes the selected key first, then enables the client only on a second click", async () => {
    const keys = signInForDiagnostics().mockResolvedValue({
      selectedTokenId: key.id,
      keys: [key],
      total: 1,
    });
    const read = vi
      .spyOn(puppyrouterAccountApi, "diagnoseConfig")
      .mockResolvedValue({
        scope: "staged",
        issues: ["SavedKeyMissing", "ProviderNotCurrent"],
      });
    const apply = vi
      .spyOn(puppyrouterAccountApi, "applyApiKey")
      .mockImplementation(async () => {
        keys.mockResolvedValue({
          selectedTokenId: key.id,
          keys: [{ ...key, providerKeyMatch: true }],
          total: 1,
        });
        read.mockResolvedValue({
          scope: "staged",
          issues: ["ProviderNotCurrent"],
        });
        return {
          synced: true,
          name: key.name,
          tokenId: key.id,
          maskedKey: key.maskedKey,
        };
      });
    const change = vi
      .spyOn(providersApi, "switch")
      .mockImplementation(async () => {
        read.mockResolvedValue({ scope: "direct", issues: [] });
        return { warnings: [] };
      });
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    await screen.findByText("puppyrouterAccount.diagnoseSavedKeyMissing");
    expect(
      screen.queryByRole("button", {
        name: "puppyrouterAccount.diagnoseEnable",
      }),
    ).toBeNull();
    await click("puppyrouterAccount.diagnoseFixCloudKey");
    const enable = await screen.findByRole("button", {
      name: "puppyrouterAccount.diagnoseEnable",
    });
    await waitFor(() => expect(enable).toBeEnabled());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(key.id, "codex", "staged");
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(enable);
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseHealthy"),
    ).toBeVisible();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it.each([
    "ExternalAuth",
    "NativeDisabled",
    "NativeProfileConflict",
    "ReadFailed",
    "CodexConfigInvalid",
  ] as const)(
    "preserves %s even if the selected cloud key differs",
    async (problem) => {
      signInForDiagnostics().mockResolvedValue({
        selectedTokenId: key.id,
        keys: [key],
        total: 1,
      });
      vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
        scope: "native",
        issues: [problem, "KeyMismatch"],
      });
      renderWithQueryClient(<PuppyRouterAccountBanner activeApp="kimi" />);
      await click("puppyrouterAccount.diagnose");
      await screen.findByText("puppyrouterAccount.diagnoseCloudKeyMismatch");
      expect(
        screen.queryByRole("button", {
          name: "puppyrouterAccount.diagnoseFixCloudKey",
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "puppyrouterAccount.diagnoseFixLiveConfig",
        }),
      ).toBeNull();
    },
  );

  it("rechecks client protection before applying a cloud repair from an open dialog", async () => {
    signInForDiagnostics().mockResolvedValue({
      selectedTokenId: key.id,
      keys: [key],
      total: 1,
    });
    const read = vi
      .spyOn(puppyrouterAccountApi, "diagnoseConfig")
      .mockResolvedValue({
        scope: "native",
        issues: ["KeyMismatch"],
      });
    const apply = vi.spyOn(puppyrouterAccountApi, "applyApiKey");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="kimi" />);
    await click("puppyrouterAccount.diagnose");
    await screen.findByText("puppyrouterAccount.diagnoseCloudKeyMismatch");
    read.mockResolvedValue({
      scope: "native",
      issues: ["ExternalAuth", "KeyMismatch"],
    });
    await click("puppyrouterAccount.diagnoseFixCloudKey");
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseExternalAuth"),
    ).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
  });

  it("rechecks the cloud key before a live repair and leaves a disabled key out of the client", async () => {
    const keys = signInForDiagnostics();
    vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
      scope: "direct",
      issues: ["KeyMismatch"],
    });
    const reapply = vi.spyOn(puppyrouterAccountApi, "reapplyConfig");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    await screen.findByText("puppyrouterAccount.diagnoseKeyMismatch");
    keys.mockResolvedValue({
      selectedTokenId: key.id,
      keys: [{ ...key, usable: false }],
      total: 1,
    });
    await click("puppyrouterAccount.diagnoseFixLiveConfig");
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseCloudKeyUnusable"),
    ).toBeVisible();
    expect(reapply).not.toHaveBeenCalled();
  });

  it("closes an expired account's diagnosis and discards a pending repair", async () => {
    signInForDiagnostics();
    const report: PuppyRouterConfigReport = {
      scope: "direct",
      issues: ["KeyMismatch"],
    };
    const read = vi
      .spyOn(puppyrouterAccountApi, "diagnoseConfig")
      .mockResolvedValue(report);
    const write = vi.spyOn(puppyrouterAccountApi, "reapplyConfig");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    await screen.findByRole("dialog");
    let finish: () => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(report);
        }),
    );
    await click("puppyrouterAccount.diagnoseFixLiveConfig");
    act(() => {
      window.dispatchEvent(new CustomEvent(PUPPYROUTER_SESSION_EXPIRED_EVENT));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      finish();
    });
    expect(write).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows unresolved issues after a failed live write", async () => {
    signInForDiagnostics();
    const read = vi
      .spyOn(puppyrouterAccountApi, "diagnoseConfig")
      .mockResolvedValue({ scope: "direct", issues: ["KeyMismatch"] });
    vi.spyOn(puppyrouterAccountApi, "reapplyConfig").mockImplementation(
      async () => {
        read.mockResolvedValue({ scope: "direct", issues: ["ReadFailed"] });
        throw new Error("write refused");
      },
    );
    const err = vi.spyOn(toast, "error");
    renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
    await click("puppyrouterAccount.diagnose");
    await click("puppyrouterAccount.diagnoseFixLiveConfig");
    expect(
      await screen.findByText("puppyrouterAccount.diagnoseReadFailed"),
    ).toBeVisible();
    expect(screen.queryByText("puppyrouterAccount.diagnoseHealthy")).toBeNull();
    expect(err).toHaveBeenCalledWith("puppyrouterAccount.diagnoseFixFailed", {
      closeButton: true,
    });
  });

  it.each([true, false])(
    "explains why an account without a usable key cannot enable a staged card, empty list %s",
    async (empty) => {
      signInForDiagnostics().mockResolvedValue({
        keys: empty ? [] : [{ ...key, usable: false }],
        total: empty ? 0 : 1,
      });
      vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
        scope: "staged",
        issues: ["ProviderNotCurrent"],
      });
      renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
      await click("puppyrouterAccount.diagnose");
      expect(
        await screen.findByText(
          "puppyrouterAccount.diagnoseCloudKey" +
            (empty ? "Missing" : "Unusable"),
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: "puppyrouterAccount.diagnoseEnable",
        }),
      ).toBeNull();
    },
  );

  it.each(["missing", "disabled"] as const)(
    "identifies a %s cloud selection even when the client matches its saved card",
    async (state) => {
      signInForDiagnostics().mockResolvedValue({
        selectedTokenId: key.id,
        total: 1,
        keys: [
          {
            ...key,
            id: state === "missing" ? key.id + 1 : key.id,
            usable: state === "missing",
            providerKeyMatch: true,
          },
        ],
      });
      vi.spyOn(puppyrouterAccountApi, "diagnoseConfig").mockResolvedValue({
        scope: "direct",
        issues: [],
      });
      renderWithQueryClient(<PuppyRouterAccountBanner activeApp="codex" />);
      await click("puppyrouterAccount.diagnose");
      expect(
        await screen.findByText(
          "puppyrouterAccount.diagnoseCloudKey" +
            (state === "missing" ? "Missing" : "Unusable"),
        ),
      ).toBeVisible();
      expect(
        screen.queryByText("puppyrouterAccount.diagnoseHealthy"),
      ).toBeNull();
    },
  );
});
