/**
 * Reader preferences (font size/family, theme, AMOLED) sourced from the
 * authenticated user's account-synced preferences. The persisted local
 * account is a launch cache; the server account is canonical.
 */
import { useMemo } from "react";
import { DEFAULT_READER_PREFERENCES, normalizeReaderPreferences } from "@ordo/shared";
import type { ReaderPreferences } from "@ordo/shared";
import { useAuthStore } from "../store/auth";
import { useUpdateReaderPreferences } from "./use-auth-actions";

export function useReaderPreferences() {
  const stored = useAuthStore((s) => s.user?.preferences);
  const update = useUpdateReaderPreferences();

  const preferences = useMemo<ReaderPreferences>(
    () => (stored ? normalizeReaderPreferences(stored) : DEFAULT_READER_PREFERENCES),
    [stored],
  );

  /** Optimistically applies a partial patch and syncs it to the account. */
  const setPreferences = update.mutate;

  return { preferences, setPreferences };
}
