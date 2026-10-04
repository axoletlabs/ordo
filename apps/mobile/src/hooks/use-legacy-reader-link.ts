import { useCallback } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { sanitizeRouteParam } from "../lib/search-bookmarks";

/** Old split-view links now open a full-screen reader, with the list behind it. */
export function useLegacyReaderLink(bookmark: string | string[] | undefined) {
  const router = useRouter();
  const bookmarkId = sanitizeRouteParam(bookmark);
  useFocusEffect(useCallback(() => {
    if (!bookmarkId) return;
    router.setParams({ bookmark: undefined });
    router.push({ pathname: "/reader/[id]", params: { id: bookmarkId } });
  }, [bookmarkId, router]));
}
