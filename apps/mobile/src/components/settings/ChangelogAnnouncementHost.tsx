/** Announce the running release once per installed bundle, after sign-in/MFA. */
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "expo-router";
import { useBuildInfo } from "../../hooks/use-build-info";
import { useChangelog } from "../../hooks/use-changelog";
import { changelogBuildKey, unseenChangelogRelease } from "../../lib/changelog";
import { prefsGet, prefsSet, StorageKeys } from "../../lib/storage";
import { ChangelogSheet } from "./ChangelogList";
import { useIncomingShareStore } from "../../store/incoming-share";

export function ChangelogAnnouncementHost({ enabled }: { enabled: boolean }) {
  const build = useBuildInfo();
  const pathname = usePathname();
  const pendingShare = useIncomingShareStore((state) => state.pendingUrl);
  const key = changelogBuildKey(build.releaseVersion, build.gitHash);
  const [seen, setSeen] = useState<{ key: unknown } | null>(null);
  const [announcement, setAnnouncement] = useState<{ key: string; tag: string } | null>(null);
  const [open, setOpen] = useState(false);
  // Do not interrupt a deep-linked reader, incoming share, or settings page.
  const ready = enabled && pathname === "/" && !pendingShare;
  const changelog = useChangelog(ready && seen !== null && key !== null && seen.key !== key);

  useEffect(() => {
    let cancelled = false;
    void prefsGet<unknown>(StorageKeys.CHANGELOG_SEEN_BUILD).then((saved) => {
      if (!cancelled) setSeen({ key: saved });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !seen || announcement) return;
    const release = unseenChangelogRelease(changelog.releases, build.releaseVersion, key, seen.key);
    if (!release || !key) return;
    setAnnouncement({ key, tag: release.tagName });
    setOpen(true);
  }, [ready, seen, announcement, changelog.releases, build.releaseVersion, key]);

  const markShown = useCallback(() => {
    if (!announcement) return;
    setSeen({ key: announcement.key });
    void prefsSet(StorageKeys.CHANGELOG_SEEN_BUILD, announcement.key);
  }, [announcement]);

  return <ChangelogSheet visible={open && ready} initialTag={announcement?.tag}
    onShow={markShown} onDismiss={() => setOpen(false)} />;
}
