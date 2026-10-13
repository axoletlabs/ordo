/**
 * Read-side React Query hooks.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../lib/api/auth";
import { serverApi } from "../lib/api/server";
import { fetchFoldersNormalized } from "../lib/api/folders";
import { qk } from "../lib/api/query-keys";
import { PERSISTED_QUERY_GC_TIME_MS } from "../lib/query-persist";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";

/** Server info — unauthenticated; keyed by URL so switching servers refetches.
 *  OfflineGate covers an unreachable host; Settings → Server stays mounted
 *  so the address can still be changed. */
export function useServerInfo() {
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  return useQuery({
    queryKey: qk.serverInfo(serverUrl),
    queryFn: () => serverApi.info(),
    staleTime: 60_000,
    retry: 1,
    networkMode: "always",
  });
}

/** Validate the persisted session on launch and when returning to the app. */
export function useValidateSession() {
  const setUser = useAuthStore((s) => s.setUser);
  const query = useQuery({
    queryKey: ["auth", "validate"],
    queryFn: () => authApi.me(),
    retry: false,
    // Success should not refetch on every app switch. A failed boot has no
    // data, so it stays stale and retries when the app returns to the foreground.
    staleTime: Infinity,
    refetchOnWindowFocus: true,
  });

  // The server account is canonical (display name, email, reader preferences…):
  // fold the fetched user back into the persisted local session.
  useEffect(() => {
    if (query.data) setUser(query.data);
  }, [query.data, setUser]);

  return query;
}

export function useSessions() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => authApi.listSessions(),
    staleTime: 20_000,
  });
}

export function useFolders() {
  return useQuery({
    queryKey: qk.folders,
    queryFn: fetchFoldersNormalized,
    staleTime: 30_000,
    gcTime: PERSISTED_QUERY_GC_TIME_MS,
  });
}
