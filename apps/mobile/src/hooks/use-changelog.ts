/**
 * Changelog for the settings screen. Shows the last good notes immediately,
 * then refreshes from GitHub. A failed refresh keeps what is already on screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../components/ui/toast-store";
import { compareReleaseCandidates } from "../lib/app-version";
import { ChangelogFetchError, fetchChangelogReleases } from "../lib/changelog-feed";
import { isChangelogReleaseList, type ChangelogRelease } from "../lib/changelog";
import { prefsGet, prefsSet, StorageKeys } from "../lib/storage";

const FRESH_MS = 60_000;
const TIMEOUT_MS = 15_000;

interface MemoryCache {
  releases: ChangelogRelease[];
  fetchedAt: number;
}

let memory: MemoryCache | null = null;

async function readCache(): Promise<ChangelogRelease[] | null> {
  const cached = await prefsGet<{ releases?: unknown }>(StorageKeys.CHANGELOG);
  if (!cached || !isChangelogReleaseList(cached.releases)) return null;
  return [...cached.releases].sort((left, right) => compareReleaseCandidates(right, left));
}

export function useChangelog() {
  const [releases, setReleases] = useState<ChangelogRelease[] | null>(memory?.releases ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const request = useRef(0);

  const load = useCallback(async (force: boolean) => {
    if (!force && memory && Date.now() - memory.fetchedAt < FRESH_MS) {
      setReleases(memory.releases);
      setErrorStatus(null);
      return;
    }

    const id = ++request.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    if (force) setRefreshing(true);
    if (force) setErrorStatus(null);

    try {
      const next = await fetchChangelogReleases(controller.signal);
      if (request.current !== id) return;
      memory = { releases: next, fetchedAt: Date.now() };
      setReleases(next);
      setErrorStatus(null);
      void prefsSet(StorageKeys.CHANGELOG, { releases: next, fetchedAt: memory.fetchedAt });
    } catch (error) {
      if (request.current !== id) return;
      const status = error instanceof ChangelogFetchError ? error.status : 0;
      if (memory) {
        setReleases(memory.releases);
        if (force) toast.error("Couldn't refresh the changelog.");
        return;
      }
      setErrorStatus(status);
    } finally {
      clearTimeout(timeout);
      if (request.current === id) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!memory) {
        const cached = await readCache();
        if (cancelled) return;
        if (cached) {
          memory = { releases: cached, fetchedAt: 0 };
          setReleases(cached);
        }
      }
      if (!cancelled) await load(false);
    })();
    return () => {
      cancelled = true;
      request.current += 1;
    };
  }, [load]);

  return {
    releases,
    refreshing,
    errorStatus,
    reload: () => void load(true),
  };
}
