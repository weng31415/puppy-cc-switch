import { invoke } from "@tauri-apps/api/core";

export interface PuppyRouterAccountUser {
  id: number;
  username: string;
  displayName?: string;
  group?: string;
  role?: number;
  status?: number;
}

export type PuppyRouterSessionState =
  | "signed_out"
  | "authenticated"
  | "offline"
  | "expired"
  | "server_error";

export interface PuppyRouterAccountStatus {
  loggedIn: boolean;
  sessionState: PuppyRouterSessionState;
  user?: PuppyRouterAccountUser;
  loggedInAt?: number;
  verifiedAt?: number;
  message?: string;
}

export interface PuppyRouterAccountBalance {
  quota: number;
  usedQuota: number;
  quotaPerUnit: number;
  balanceUsd: number;
  usdExchangeRate: number;
  formattedBalance: string;
  updatedAt: number;
}

export interface PuppyRouterLoginStart {
  deviceCode: string;
  userCode: string;
  authorizeUrl: string;
  expiresAt: number;
  interval: number;
}

export type PuppyRouterLoginPollResult =
  | {
      status: "pending";
      message: string;
      interval: number;
    }
  | {
      status: "approved";
      account: PuppyRouterAccountStatus;
    }
  | {
      status: "expired" | "denied" | "invalid";
      message: string;
    };

export interface PuppyRouterApiKey {
  id: number;
  name: string;
  maskedKey: string;
  status: number;
  remainQuota: number;
  usedQuota: number;
  unlimitedQuota: boolean;
  expiredTime: number;
  createdTime: number;
  accessedTime: number;
  group?: string;
  crossGroupRetry: boolean;
  modelLimitsEnabled: boolean;
  modelLimits?: string;
  usable: boolean;
  recommended: boolean;
  providerKeyMatch: boolean;
  active: boolean;
}

export interface PuppyRouterApiKeyList {
  keys: PuppyRouterApiKey[];
  total: number;
  selectedTokenId?: number;
}

export interface PuppyRouterApplyKeyResult {
  synced: boolean;
  tokenId: number;
  name: string;
  maskedKey: string;
  group?: string;
}

export interface PuppyRouterAccountGroup {
  name: string;
  description: string;
  ratio: unknown;
}

export interface PuppyRouterGroupUpdateResult {
  tokenId: number;
  group: string;
  crossGroupRetry: boolean;
}

export const PUPPYROUTER_SESSION_EXPIRED_EVENT = "puppyrouter-session-expired";
export const PUPPYROUTER_SESSION_EXPIRED_ERROR = "PUPPYROUTER_SESSION_EXPIRED";

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

export function isPuppyRouterSessionExpiredError(error: unknown) {
  return errorMessage(error).includes(PUPPYROUTER_SESSION_EXPIRED_ERROR);
}

async function invokePuppyRouterAccount<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isPuppyRouterSessionExpiredError(error)) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(PUPPYROUTER_SESSION_EXPIRED_EVENT),
        );
      }
      throw new Error(PUPPYROUTER_SESSION_EXPIRED_ERROR);
    }
    throw error;
  }
}

export const puppyrouterAccountApi = {
  async getStatus(): Promise<PuppyRouterAccountStatus> {
    return await invokePuppyRouterAccount("get_puppyrouter_account_status");
  },

  async getBalance(): Promise<PuppyRouterAccountBalance> {
    return await invokePuppyRouterAccount("get_puppyrouter_account_balance");
  },

  async beginLogin(): Promise<PuppyRouterLoginStart> {
    return await invokePuppyRouterAccount("begin_puppyrouter_account_login");
  },

  async pollLogin(deviceCode: string): Promise<PuppyRouterLoginPollResult> {
    return await invokePuppyRouterAccount("poll_puppyrouter_account_login", {
      deviceCode,
    });
  },

  async logout(): Promise<boolean> {
    return await invokePuppyRouterAccount("logout_puppyrouter_account");
  },

  async listApiKeys(targetApp: string): Promise<PuppyRouterApiKeyList> {
    return await invokePuppyRouterAccount("list_puppyrouter_api_keys", {
      targetApp,
    });
  },

  async listGroups(): Promise<PuppyRouterAccountGroup[]> {
    return await invokePuppyRouterAccount("list_puppyrouter_account_groups");
  },

  async updateApiKeyGroup(
    tokenId: number,
    group: string,
  ): Promise<PuppyRouterGroupUpdateResult> {
    return await invokePuppyRouterAccount("update_puppyrouter_api_key_group", {
      tokenId,
      group,
    });
  },

  async applyApiKey(
    tokenId: number,
    targetApp: string,
  ): Promise<PuppyRouterApplyKeyResult> {
    return await invokePuppyRouterAccount("apply_puppyrouter_api_key", {
      tokenId,
      targetApp,
    });
  },
};
