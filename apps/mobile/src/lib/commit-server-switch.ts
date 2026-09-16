/**
 * Point the client at another origin. Signed-in switches clear the session
 * and reload so no library from the previous host stays on screen.
 */
import { cancelProactiveRefresh } from "./api/client";
import { discardQueryCache } from "./query-cache";
import { useAuthStore } from "../store/auth";
import { useFolderTokenStore } from "../store/folder-tokens";
import { useSettingsStore } from "../store/settings";
import { restartRuntime } from "../store/update-restart";

export type ServerSwitchResult =
  | { ok: true; restarted: boolean }
  | { ok: false };

export async function commitServerSwitch(nextUrl: string): Promise<ServerSwitchResult> {
  const signedIn = useAuthStore.getState().status === "authenticated";
  if (!signedIn) {
    await useSettingsStore.getState().setServerUrl(nextUrl);
    return { ok: true, restarted: false };
  }

  let switchCommitted = false;
  try {
    await restartRuntime(async () => {
      cancelProactiveRefresh();
      discardQueryCache();
      await Promise.all([
        useAuthStore.getState().clear(),
        useFolderTokenStore.getState().clearAll(),
        useSettingsStore.getState().setServerUrl(nextUrl),
      ]);
      switchCommitted = true;
    });
  } catch {
    if (!switchCommitted) return { ok: false };
  }
  return { ok: true, restarted: true };
}
