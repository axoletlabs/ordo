import { useEffect, useRef } from "react";
import { useShareIntentContext } from "expo-share-intent";
import { APP_NAME } from "@ordo/shared";
import { returnToShareSender, saveUnfiledBookmark } from "../lib/share-target";
import { shareIntakeMode, shareSavedToast } from "../lib/share-intake";
import { consumeQuickShareHandoff } from "../lib/share-targets";
import { extractSharedUrls } from "../lib/shared-url";
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
  const setPendingUrls = useIncomingShareStore((state) => state.setPendingUrls);
  const consumed = useRef<object | null>(null);
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent || consumed.current === shareIntent) return;
    consumed.current = shareIntent;

    const urls = extractSharedUrls(shareIntent.webUrl, shareIntent.text);
    resetShareIntent();

    if (!urls.length) {
      useIncomingShareStore.getState().clear();
      returnToShareSender("The shared text doesn't contain a valid link.");
      return;
    }

    const generation = useIncomingShareStore.getState().begin();
    const stillThisIntake = () => useIncomingShareStore.getState().generation === generation;

    void (async () => {
      const handoff = await consumeQuickShareHandoff();
      if (!stillThisIntake()) return;

      const { shareQuickBookmark, shareShowQuickAction } = useSettingsStore.getState();
      const mode = handoff.review ? "sheet" : shareIntakeMode({
        quickBookmark: shareQuickBookmark,
        showAlongside: shareShowQuickAction,
        fromQuickTarget: handoff.fromQuickTarget,
      });

      if (useAuthStore.getState().status !== "authenticated") {
        useIncomingShareStore.getState().clear();
        returnToShareSender("Sign in to save bookmarks.");
        return;
      }

      if (mode === "sheet") {
        prefetchExtraction(urls[0]);
        if (!stillThisIntake()) return;
        setPendingUrls(urls);
        if (handoff.savedCount) toast.error(`${handoff.savedCount} saved. Save the remaining links here.`);
        return;
      }

      let saved = 0;
      try {
        for (const url of urls) {
          if (!stillThisIntake()) return;
          await saveUnfiledBookmark(url);
          saved++;
        }
        if (!stillThisIntake()) return;
        haptics.success();
        returnToShareSender(shareSavedToast(undefined, urls.length));
      } catch (err) {
        if (!stillThisIntake()) return;
        const remaining = urls.slice(saved);
        toast.error(saved ? `${saved} saved. ${errorMessage(err)}` : errorMessage(err));
        prefetchExtraction(remaining[0]);
        setPendingUrls(remaining);
      }
    })();
  }, [hasShareIntent, resetShareIntent, setPendingUrls, shareIntent]);

  useEffect(() => {
    if (!error) return;
    resetShareIntent();
    useIncomingShareStore.getState().clear();
    returnToShareSender(`${APP_NAME} couldn't read the shared link.`);
  }, [error, resetShareIntent]);

  return null;
}
