import { invoke } from "@tauri-apps/api/core";

export interface PuppyRouterAccountUser {
  id: number;
  username: string;
  displayName?: string;
  group?: string;
  role?: number;
  status?: number;
}

export interface PuppyRouterAccountStatus {
  loggedIn: boolean;
  user?: PuppyRouterAccountUser;
  loggedInAt?: number;
}

export interface PuppyRouterAccountBalance {
  quota: number;
  usedQuota: number;
  quotaPerUnit: number;
  balanceUsd: number;
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

export const puppyrouterAccountApi = {
  async getStatus(): Promise<PuppyRouterAccountStatus> {
    return await invoke("get_puppyrouter_account_status");
  },

  async getBalance(): Promise<PuppyRouterAccountBalance> {
    return await invoke("get_puppyrouter_account_balance");
  },

  async beginLogin(): Promise<PuppyRouterLoginStart> {
    return await invoke("begin_puppyrouter_account_login");
  },

  async pollLogin(deviceCode: string): Promise<PuppyRouterLoginPollResult> {
    return await invoke("poll_puppyrouter_account_login", { deviceCode });
  },

  async logout(): Promise<boolean> {
    return await invoke("logout_puppyrouter_account");
  },

  async listApiKeys(targetApp: string): Promise<PuppyRouterApiKeyList> {
    return await invoke("list_puppyrouter_api_keys", { targetApp });
  },

  async listGroups(): Promise<PuppyRouterAccountGroup[]> {
    return await invoke("list_puppyrouter_account_groups");
  },

  async updateApiKeyGroup(
    tokenId: number,
    group: string,
  ): Promise<PuppyRouterGroupUpdateResult> {
    return await invoke("update_puppyrouter_api_key_group", {
      tokenId,
      group,
    });
  },

  async applyApiKey(
    tokenId: number,
    targetApp: string,
  ): Promise<PuppyRouterApplyKeyResult> {
    return await invoke("apply_puppyrouter_api_key", { tokenId, targetApp });
  },
};
