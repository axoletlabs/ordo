/**
 * Reader or live website view for a saved bookmark.
 * Use `?view=browser` to open ordo's browser first (from "Open original").
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { ReaderPane } from "../../../src/components/reader/ReaderPane";

export default function ReaderScreen() {
  const { id, view } = useLocalSearchParams<{ id: string; view?: string }>();
  const bookmarkId = Array.isArray(id) ? id[0] : id;
  const viewParam = Array.isArray(view) ? view[0] : view;

  return (
    <ReaderPane
      bookmarkId={bookmarkId}
      initialSurface={viewParam === "browser" ? "browser" : "auto"}
    />
  );
}
