/**
 * Read-side React Query hooks.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeFolderIcon } from "@ordo/shared";
import { authApi } from "../lib/api/auth";
import { serverApi } from "../lib/api/server";
import { foldersApi } from "../lib/api/folders";
import { qk } from "../lib/api/query-keys";
import { useAuthStore } from "../store/auth";
import { useSettingsStore } from "../store/settings";

/** Server info — unauthenticated; keyed by URL so switching servers refetches.
 *  Must not gate the app navigator: an unreachable server has to leave Tabs
 *  mounted so Settings → Account / Server stay reachable. */
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

/** Current user. Enabled only when authenticated. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => authApi.me(),
    enabled: false, // invoked manually on bootstrap; see useValidateSession
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
    queryFn: async () => {
      const folders = await foldersApi.list();
      return folders.map((folder) => ({
        ...folder,
        icon: normalizeFolderIcon(folder.icon),
        pinned: folder.pinned ?? false,
      }));
    },
    staleTime: 30_000,
  });
}
