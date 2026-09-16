import { useState } from "react";
import { useRouter } from "expo-router";
import { commitServerSwitch } from "../lib/commit-server-switch";
import { isCloudServerUrl } from "../lib/hosting";
import { useSettingsStore } from "../store/settings";
import { toast } from "../components/ui/toast-store";

export function useCommitServerSwitch() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const commit = async (url: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const previous = useSettingsStore.getState().serverUrl;
    const result = await commitServerSwitch(url);
    if (!result.ok) {
      setBusy(false);
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
    setBusy(false);
    return true;
  };

  return { commit, busy };
}
