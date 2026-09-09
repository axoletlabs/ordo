/**
 * React Query client with sensible defaults:
 *  - staleTime so cached screens don't flicker; refetch on app foreground
 *    once that window has elapsed (wired via AppState → focusManager).
 *  - retry skips client errors (except token_expired, which the interceptor already retried).
 *  - retry pauses when the device has no link (not when the Ordo server is down).
 *  - networkMode `always` so a false "offline" flag cannot leave queries pending forever.
 *  - refetchInterval pauses in the background (`refetchIntervalInBackground: false`).
 */
import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./api/client";
import { useOnlineStore } from "./online";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      networkMode: "always",
      retry: (failureCount, error) => {
        const err = error as ApiClientError;
        if (err?.status && err.status >= 400 && err.status < 500 && !err.tokenExpired) {
          return false;
        }
        if (!useOnlineStore.getState().online) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: false,
      networkMode: "always",
    },
  },
});
