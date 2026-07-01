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

export type PuppyRouterLoginResult =
  | {
      status: "logged_in";
      account: PuppyRouterAccountStatus;
    }
  | {
      status: "requires_2fa";
      message: string;
      username: string;
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

export const puppyrouterAccountApi = {
  async getStatus(): Promise<PuppyRouterAccountStatus> {
    return await invoke("get_puppyrouter_account_status");
  },

  async login(
    username: string,
    password: string,
  ): Promise<PuppyRouterLoginResult> {
    return await invoke("login_puppyrouter_account", { username, password });
  },

  async verify2fa(code: string): Promise<PuppyRouterLoginResult> {
    return await invoke("verify_puppyrouter_account_2fa", { code });
  },

  async logout(): Promise<boolean> {
    return await invoke("logout_puppyrouter_account");
  },

  async listApiKeys(): Promise<PuppyRouterApiKeyList> {
    return await invoke("list_puppyrouter_api_keys");
  },

  async applyApiKey(tokenId: number): Promise<PuppyRouterApplyKeyResult> {
    return await invoke("apply_puppyrouter_api_key", { tokenId });
  },
};
