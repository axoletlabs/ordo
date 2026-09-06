import { useEffect } from "react";
import { useShareIntentContext } from "expo-share-intent";
import { APP_NAME } from "@ordo/shared";
import { returnToShareSender } from "../lib/share-target";
import { extractSharedUrl } from "../lib/shared-url";
import { useIncomingShareStore } from "../store/incoming-share";

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

    setPendingUrl(url);
  }, [hasShareIntent, resetShareIntent, setPendingUrl, shareIntent]);

  useEffect(() => {
    if (!error) return;
    resetShareIntent();
    returnToShareSender(`${APP_NAME} couldn't read the shared link.`);
  }, [error, resetShareIntent]);

  return null;
}
