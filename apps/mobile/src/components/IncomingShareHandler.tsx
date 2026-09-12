import { useEffect } from "react";
import { useShareIntentContext } from "expo-share-intent";
import { APP_NAME } from "@ordo/shared";
import { returnToShareSender, saveUnfiledBookmark } from "../lib/share-target";
import { shareIntakeMode } from "../lib/share-intake";
import { consumeQuickShareFlag } from "../lib/share-targets";
import { extractSharedUrl } from "../lib/shared-url";
import { prefetchExtraction } from "../lib/prefetch-extraction";
import { errorMessage } from "../lib/error-message";
import { haptics } from "../lib/haptics";
import { toast } from "./ui/toast-store";
import { useAuthStore } from "../store/auth";
import { useIncomingShareStore } from "../store/incoming-share";
import { useSettingsStore } from "../store/settings";

/** Bridges Android ACTION_SEND intents into Ordo's existing bookmark flow. */
export function IncomingShareHandler() {
  const setPendingUrl = useIncomingShareStore((state) => state.setPendingUrl);
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;

    const url = extractSharedUrl(shareIntent.webUrl, shareIntent.text);
    resetShareIntent();

    if (!url) {
      returnToShareSender("The shared text doesn't contain a valid link.");
      return;
    }

    void (async () => {
      const fromQuickTarget = await consumeQuickShareFlag();
      const { shareQuickBookmark, shareShowQuickAction } = useSettingsStore.getState();
      const mode = shareIntakeMode({
        quickBookmark: shareQuickBookmark,
        showAlongside: shareShowQuickAction,
        fromQuickTarget,
      });

      if (mode === "sheet") {
        prefetchExtraction(url);
        setPendingUrl(url);
        return;
      }

      if (useAuthStore.getState().status !== "authenticated") {
        returnToShareSender("Sign in to save bookmarks.");
        return;
      }

      try {
        await saveUnfiledBookmark(url);
        haptics.success();
        returnToShareSender("Saved to Bookmarks");
      } catch (err) {
        toast.error(errorMessage(err));
        prefetchExtraction(url);
        setPendingUrl(url);
      }
    })();
  }, [hasShareIntent, resetShareIntent, setPendingUrl, shareIntent]);

  useEffect(() => {
    if (!error) return;
    resetShareIntent();
    returnToShareSender(`${APP_NAME} couldn't read the shared link.`);
  }, [error, resetShareIntent]);

  return null;
}
