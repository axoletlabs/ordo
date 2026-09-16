import { useEffect } from "react";
import { useShareIntentContext } from "expo-share-intent";
import { APP_NAME } from "@ordo/shared";
import { returnToShareSender, saveUnfiledBookmark } from "../lib/share-target";
import { shareIntakeMode, shareSavedToast } from "../lib/share-intake";
import { consumeQuickShareFlag } from "../lib/share-targets";
import { extractSharedUrl } from "../lib/shared-url";
import { prefetchExtraction } from "../lib/prefetch-extraction";
import { errorMessage } from "../lib/error-message";
import { haptics } from "../lib/haptics";
import { toast } from "./ui/toast-store";
import { useAuthStore } from "../store/auth";
import { useIncomingShareStore } from "../store/incoming-share";
import { useSettingsStore } from "../store/settings";

/** Bridges Android ACTION_SEND intents into Ordo's existing bookmark flow.
 *  Quick Save usually never reaches here: the translucent receiver POSTs
 *  natively. This handler is the Save sheet plus the JS fallback. */
export function IncomingShareHandler() {
  const setPendingUrl = useIncomingShareStore((state) => state.setPendingUrl);
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;

    const url = extractSharedUrl(shareIntent.webUrl, shareIntent.text);
    resetShareIntent();

    if (!url) {
      useIncomingShareStore.getState().clear();
      returnToShareSender("The shared text doesn't contain a valid link.");
      return;
    }

    const generation = useIncomingShareStore.getState().generation;
    const stillThisIntake = () => useIncomingShareStore.getState().generation === generation;

    void (async () => {
      const fromQuickTarget = await consumeQuickShareFlag();
      if (!stillThisIntake()) return;

      const { shareQuickBookmark, shareShowQuickAction } = useSettingsStore.getState();
      const mode = shareIntakeMode({
        quickBookmark: shareQuickBookmark,
        showAlongside: shareShowQuickAction,
        fromQuickTarget,
      });

      if (useAuthStore.getState().status !== "authenticated") {
        useIncomingShareStore.getState().clear();
        returnToShareSender("Sign in to save bookmarks.");
        return;
      }

      if (mode === "sheet") {
        prefetchExtraction(url);
        if (!stillThisIntake()) return;
        setPendingUrl(url);
        return;
      }

      try {
        await saveUnfiledBookmark(url);
        if (!stillThisIntake()) return;
        haptics.success();
        returnToShareSender(shareSavedToast());
      } catch (err) {
        if (!stillThisIntake()) return;
        toast.error(errorMessage(err));
        prefetchExtraction(url);
        setPendingUrl(url);
      }
    })();
  }, [hasShareIntent, resetShareIntent, setPendingUrl, shareIntent]);

  useEffect(() => {
    if (!error) return;
    resetShareIntent();
    useIncomingShareStore.getState().clear();
    returnToShareSender(`${APP_NAME} couldn't read the shared link.`);
  }, [error, resetShareIntent]);

  return null;
}
