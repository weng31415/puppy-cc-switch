import { useQuery, type QueryClient } from "@tanstack/react-query";

import {
  puppyrouterAccountApi,
  type PuppyRouterAccountGroup,
  type PuppyRouterAccountBalance,
  type PuppyRouterAccountStatus,
  type PuppyRouterApiKeyList,
} from "@/lib/api/puppyrouterAccount";
import type { AppId } from "@/lib/api/types";

export const PUPPYROUTER_ACCOUNT_STATUS_CACHE_MS = 15 * 60 * 1000;
export const PUPPYROUTER_ACCOUNT_BALANCE_CACHE_MS = 5 * 60 * 1000;
export const PUPPYROUTER_API_KEYS_CACHE_MS = 10 * 60 * 1000;
export const PUPPYROUTER_ACCOUNT_GC_MS = 30 * 60 * 1000;

export const puppyrouterAccountKeys = {
  all: ["puppyrouterAccount"] as const,
  status: () => [...puppyrouterAccountKeys.all, "status"] as const,
  balance: () => [...puppyrouterAccountKeys.all, "balance"] as const,
  groups: () => [...puppyrouterAccountKeys.all, "groups"] as const,
  apiKeys: (appId?: AppId) =>
    appId
      ? ([...puppyrouterAccountKeys.all, "apiKeys", appId] as const)
      : ([...puppyrouterAccountKeys.all, "apiKeys"] as const),
};

export function markPuppyRouterApiKeyActive(
  list: PuppyRouterApiKeyList | undefined,
  tokenId: number,
): PuppyRouterApiKeyList | undefined {
  if (!list) return list;

  return {
    ...list,
    selectedTokenId: tokenId,
    keys: list.keys.map((key) => ({
      ...key,
      active: key.id === tokenId,
    })),
  };
}

export function updatePuppyRouterApiKeyGroup(
  list: PuppyRouterApiKeyList | undefined,
  tokenId: number,
  group: string,
  crossGroupRetry: boolean,
): PuppyRouterApiKeyList | undefined {
  if (!list) return list;

  return {
    ...list,
    keys: list.keys.map((key) =>
      key.id === tokenId ? { ...key, group, crossGroupRetry } : key,
    ),
  };
}

export function updateAllPuppyRouterApiKeyGroupCaches(
  queryClient: QueryClient,
  tokenId: number,
  group: string,
  crossGroupRetry: boolean,
) {
  queryClient.setQueriesData<PuppyRouterApiKeyList>(
    { queryKey: puppyrouterAccountKeys.apiKeys() },
    (list) =>
      updatePuppyRouterApiKeyGroup(list, tokenId, group, crossGroupRetry),
  );
}

export function clearPuppyRouterAccountCache(
  queryClient: QueryClient,
  status: PuppyRouterAccountStatus = {
    loggedIn: false,
    sessionState: "signed_out",
  },
) {
  queryClient.setQueryData<PuppyRouterAccountStatus>(
    puppyrouterAccountKeys.status(),
    status,
  );
  queryClient.removeQueries({ queryKey: puppyrouterAccountKeys.balance() });
  queryClient.removeQueries({ queryKey: puppyrouterAccountKeys.groups() });
  queryClient.removeQueries({ queryKey: puppyrouterAccountKeys.apiKeys() });
}

export function usePuppyRouterAccountGroups(enabled: boolean) {
  return useQuery<PuppyRouterAccountGroup[]>({
    queryKey: puppyrouterAccountKeys.groups(),
    queryFn: () => puppyrouterAccountApi.listGroups(),
    enabled,
    staleTime: PUPPYROUTER_API_KEYS_CACHE_MS,
    gcTime: PUPPYROUTER_ACCOUNT_GC_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function usePuppyRouterAccountStatus() {
  return useQuery<PuppyRouterAccountStatus>({
    queryKey: puppyrouterAccountKeys.status(),
    queryFn: () => puppyrouterAccountApi.getStatus(),
    staleTime: PUPPYROUTER_ACCOUNT_STATUS_CACHE_MS,
    gcTime: PUPPYROUTER_ACCOUNT_GC_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function usePuppyRouterAccountBalance(enabled: boolean) {
  return useQuery<PuppyRouterAccountBalance>({
    queryKey: puppyrouterAccountKeys.balance(),
    queryFn: () => puppyrouterAccountApi.getBalance(),
    enabled,
    staleTime: PUPPYROUTER_ACCOUNT_BALANCE_CACHE_MS,
    gcTime: PUPPYROUTER_ACCOUNT_GC_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function usePuppyRouterApiKeys(enabled: boolean, appId: AppId) {
  return useQuery<PuppyRouterApiKeyList>({
    queryKey: puppyrouterAccountKeys.apiKeys(appId),
    queryFn: () => puppyrouterAccountApi.listApiKeys(appId),
    enabled,
    staleTime: PUPPYROUTER_API_KEYS_CACHE_MS,
    gcTime: PUPPYROUTER_ACCOUNT_GC_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
