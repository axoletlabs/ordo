import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { commitServerSwitch } from "../lib/commit-server-switch";
import { isCloudServerUrl } from "../lib/hosting";
import { useSettingsStore } from "../store/settings";
import { toast } from "../components/ui/toast-store";

export function useCommitServerSwitch() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // A second tap can land before React disables the action, so the request is
  // owned by a ref instead of the rendered `busy` flag.
  const inFlight = useRef(false);

  const commit = async (url: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      const previous = useSettingsStore.getState().serverUrl;
      const result = await commitServerSwitch(url);
      if (!result.ok) {
        toast.error("Couldn't change server.");
        return false;
      }
      toast.success(
        isCloudServerUrl(url)
          ? "Using ordo Cloud"
          : isCloudServerUrl(previous)
            ? "Using your server"
            : "Server changed",
      );
      if (result.restarted) {
        router.replace("/(auth)/login");
        return true;
      }
      return true;
    } catch {
      // A storage failure while committing must still release the action.
      toast.error("Couldn't change server.");
      return false;
    } finally {
      // A reload replaces the runtime, so reaching here means it failed (or the
      // switch did not need one) and the screen must accept another attempt.
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { commit, busy };
}
