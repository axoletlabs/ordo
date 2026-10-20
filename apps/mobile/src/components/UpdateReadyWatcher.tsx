/**
 * Announces native releases once per artifact. OTA updates are automatic and
 * deliberately never interrupt the user with Download / Restart prompts.
 */
import { useEffect, useRef } from "react";
import { APP_NAME } from "@ordo/shared";
import { useAppUpdate } from "../hooks/use-app-update";
import { toast } from "./ui/toast-store";
import { haptics } from "../lib/haptics";
import { releaseName } from "../lib/release-name";

export function UpdateReadyWatcher() {
  const update = useAppUpdate();
  const { native } = update;
  const lastNativeDownloadShown = useRef<string | null>(null);
  const lastNativeInstallShown = useRef<string | null>(null);

  useEffect(() => {
    if (!native.release || native.showProgress) return;
    if (native.status === "downloading") return;
    if (native.status !== "available") return;
    if (native.release.tagName === lastNativeDownloadShown.current) return;
    lastNativeDownloadShown.current = native.release.tagName;

    haptics.light();
    toast.show(`${APP_NAME} ${releaseName(native.release.version)} is available`, {
      duration: 6000,
      swipeable: true,
      action: {
        label: "Download",
        onPress: () =>
          native.downloadAndInstall().catch(() => toast.error("Couldn't download the update.")),
      },
    });
  }, [native.downloadAndInstall, native.release, native.showProgress, native.status]);

  useEffect(() => {
    if (!native.release || native.showProgress) return;
    if (native.status !== "downloaded" || !native.downloadedUri) return;
    if (native.release.tagName === lastNativeInstallShown.current) return;
    lastNativeInstallShown.current = native.release.tagName;

    haptics.light();
    toast.show(`${APP_NAME} ${releaseName(native.release.version)} is ready to install`, {
      duration: 6000,
      swipeable: true,
      action: {
        label: "Install",
        onPress: () =>
          native.install().catch(() => toast.error("Couldn't open the installer.")),
      },
    });
  }, [
    native.downloadedUri,
    native.install,
    native.release,
    native.showProgress,
    native.status,
  ]);

  return null;
}
