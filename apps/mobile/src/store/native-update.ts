import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { create } from "zustand";
import { APP_NAME } from "@ordo/shared";
import {
  classifyReleaseVersion,
  compareReleaseCandidates,
  isEarlyRelease,
  isNewerVersion,
  selectNativeUpdate,
} from "../lib/app-version";
import { prefsGet, prefsSet, StorageKeys } from "../lib/storage";

const GITHUB_REPO_API = "https://api.github.com/repos/axoletlabs/ordo";
const GITHUB_HEADERS = { Accept: "application/vnd.github+json" };
const CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15 * 1000;
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const READ_URI_PERMISSION = 1;

export interface NativeRelease {
  version: string;
  tagName: string;
  name: string;
  body: string;
  prerelease: boolean;
  publishedAt: string;
  pageUrl: string;
  apkUrl: string;
  apkSize: number;
}

interface GithubAsset {
  name?: string;
  state?: string;
  size?: number;
  browser_download_url?: string;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets?: GithubAsset[];
}

interface CachedUpdate {
  checkedAt: number;
  includePrereleases: boolean;
  release: NativeRelease | null;
}

export type NativeUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

interface NativeUpdateState {
  hydrated: boolean;
  includePrereleases: boolean;
  status: NativeUpdateStatus;
  release: NativeRelease | null;
  progress: number;
  downloadedUri: string | null;
  /** True while this process is fetching or presenting a just-downloaded APK. */
  showProgress: boolean;
  error: string | null;
  lastChecked: number | null;
  hydrate: () => Promise<void>;
  setIncludePrereleases: (enabled: boolean) => Promise<void>;
  check: (force?: boolean) => Promise<NativeRelease | null>;
  downloadAndInstall: () => Promise<void>;
  install: () => Promise<void>;
  dismissDownload: () => void;
}

function releaseVersion(tagName: string): string | null {
  return classifyReleaseVersion(tagName)?.version ?? null;
}

function selectApk(assets: GithubAsset[]): GithubAsset | null {
  const uploaded = assets.filter(
    (asset) =>
      asset.state === "uploaded" &&
      asset.name?.toLowerCase().endsWith(".apk") &&
      asset.browser_download_url,
  );
  const architectures = (Device.supportedCpuArchitectures ?? [])
    .map((value): string | null => {
      const architecture = value.toLowerCase();
      if (architecture.includes("arm64")) return "arm64-v8a";
      if (architecture.includes("armeabi")) return "armeabi-v7a";
      if (architecture.includes("x86_64") || architecture.includes("x86-64")) return "x86_64";
      if (architecture.includes("x86")) return "x86";
      return null;
    })
    .filter((architecture): architecture is string => architecture != null);
  const abiTokens = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];
  const hasAbi = (name: string, abi: string) => {
    const escaped = abi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[-_])${escaped}(?:[-.]|$)`).test(name.toLowerCase());
  };
  const exact = architectures
    .map((architecture) => uploaded.find((asset) => hasAbi(asset.name!, architecture)))
    .find((asset) => asset != null);
  const universal = uploaded.find((asset) =>
    !abiTokens.some((abi) => hasAbi(asset.name!, abi)),
  );
  return exact ?? universal ?? null;
}

function normalizeRelease(release: GithubRelease): NativeRelease | null {
  const version = releaseVersion(release.tag_name ?? "");
  const apk = selectApk(release.assets ?? []);
  if (!version || !apk?.browser_download_url || !release.published_at) return null;
  return {
    version,
    tagName: release.tag_name!,
    name: release.name?.trim() || `${APP_NAME} ${release.tag_name}`,
    body: release.body?.trim() ?? "",
    prerelease: !!release.prerelease || classifyReleaseVersion(version)?.kind === "prerelease",
    publishedAt: release.published_at,
    pageUrl: release.html_url ?? "https://github.com/axoletlabs/ordo/releases",
    apkUrl: apk.browser_download_url,
    apkSize: apk.size ?? 0,
  };
}

function currentVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "0.0.0";
}

function isSupported(): boolean {
  return Platform.OS === "android" && !__DEV__;
}

async function fetchGithubReleases(signal: AbortSignal): Promise<GithubRelease[]> {
  const [listResponse, latestResponse] = await Promise.all([
    fetch(`${GITHUB_REPO_API}/releases?per_page=100`, { headers: GITHUB_HEADERS, signal }),
    fetch(`${GITHUB_REPO_API}/releases/latest`, { headers: GITHUB_HEADERS, signal }),
  ]);
  if (!listResponse.ok) throw new Error(`GitHub returned ${listResponse.status}`);
  const listed = (await listResponse.json()) as GithubRelease[];
  const byTag = new Map<string, GithubRelease>();
  for (const release of listed) {
    if (release.tag_name) byTag.set(release.tag_name, release);
  }
  if (latestResponse.ok) {
    const latest = (await latestResponse.json()) as GithubRelease;
    if (latest.tag_name) byTag.set(latest.tag_name, latest);
  } else if (latestResponse.status !== 404) {
    throw new Error(`GitHub returned ${latestResponse.status}`);
  }
  return [...byTag.values()];
}

function apkDestination(version: string): string | null {
  if (!FileSystem.cacheDirectory) return null;
  return `${FileSystem.cacheDirectory}ordo-${version}.apk`;
}

async function apkIsReady(uri: string | null, apkSize: number): Promise<boolean> {
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return false;
    return apkSize <= 0 || info.size === apkSize;
  } catch {
    return false;
  }
}

async function resolveLocalApk(release: NativeRelease | null): Promise<string | null> {
  if (!release) return null;
  const destination = apkDestination(release.version);
  if (destination && (await apkIsReady(destination, release.apkSize))) return destination;
  return null;
}

async function deleteApk(version: string | undefined): Promise<void> {
  if (!version) return;
  const path = apkDestination(version);
  if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
}

async function saveCache(state: NativeUpdateState): Promise<void> {
  await prefsSet(StorageKeys.NATIVE_UPDATE, {
    checkedAt: state.lastChecked ?? Date.now(),
    includePrereleases: state.includePrereleases,
    release: state.release,
  } satisfies CachedUpdate);
}

export const useNativeUpdateStore = create<NativeUpdateState>((set, get) => ({
  hydrated: false,
  includePrereleases: false,
  status: isSupported() ? "idle" : "disabled",
  release: null,
  progress: 0,
  downloadedUri: null,
  showProgress: false,
  error: null,
  lastChecked: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const cached = await prefsGet<CachedUpdate>(StorageKeys.NATIVE_UPDATE);
    const includePrereleases = cached?.includePrereleases ?? false;
    let release =
      cached?.release && isNewerVersion(cached.release.version, currentVersion())
        ? cached.release
        : null;
    if (release && !includePrereleases && isEarlyRelease(release)) {
      await deleteApk(release.version);
      release = null;
    }
    if (cached?.release && !release) await deleteApk(cached.release.version);
    if (!isSupported()) {
      set({
        hydrated: true,
        includePrereleases,
        release: null,
        lastChecked: cached?.checkedAt ?? null,
        downloadedUri: null,
        showProgress: false,
        status: "disabled",
      });
      return;
    }
    const downloadedUri = await resolveLocalApk(release);
    set({
      hydrated: true,
      includePrereleases,
      release,
      lastChecked: cached?.checkedAt ?? null,
      downloadedUri,
      progress: downloadedUri ? 1 : 0,
      showProgress: false,
      status: release ? (downloadedUri ? "downloaded" : "available") : "idle",
    });
  },

  setIncludePrereleases: async (enabled) => {
    await get().hydrate();
    const current = get().release;
    if (!enabled && current && isEarlyRelease(current)) {
      await deleteApk(current.version);
      set({
        includePrereleases: false,
        lastChecked: null,
        release: null,
        downloadedUri: null,
        progress: 0,
        status: isSupported() ? "idle" : "disabled",
      });
    } else {
      set({ includePrereleases: enabled, lastChecked: null });
    }
    await saveCache(get());
    await get().check(true).catch(() => {});
  },

  check: async (force = false) => {
    await get().hydrate();
    if (!isSupported()) return null;
    const state = get();
    if (state.status === "checking" || state.status === "downloading") return state.release;
    const awaitingNewer = !!state.release || !!state.downloadedUri;
    if (
      !force &&
      !awaitingNewer &&
      state.lastChecked != null &&
      Date.now() - state.lastChecked < CHECK_COOLDOWN_MS
    ) {
      return state.release;
    }

    const previous = {
      release: state.release,
      downloadedUri: state.downloadedUri,
      progress: state.progress,
    };
    set({ status: "checking", error: null });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      try {
        const releases = await fetchGithubReleases(controller.signal);
        const includePrereleases = get().includePrereleases;
        const current = currentVersion();
        const versionEligible = releases.flatMap((item) => {
          if (item.draft || !item.published_at) return [];
          const version = releaseVersion(item.tag_name ?? "");
          if (!version) return [];
          const meta = {
            version,
            prerelease: !!item.prerelease || classifyReleaseVersion(version)?.kind === "prerelease",
            publishedAt: item.published_at,
            github: item,
          };
          if (!includePrereleases && isEarlyRelease(meta)) return [];
          if (!isNewerVersion(version, current)) return [];
          return [meta];
        });
        const candidates = versionEligible
          .map((item) => normalizeRelease(item.github))
          .filter((item): item is NativeRelease => item != null);
        const release = selectNativeUpdate(candidates, current, includePrereleases);
        const newestEligible = selectNativeUpdate(versionEligible, current, includePrereleases);
        const waitingForApk =
          !!newestEligible &&
          (!release || compareReleaseCandidates(newestEligible, release) > 0);
        if (previous.release?.version && previous.release.version !== release?.version) {
          await deleteApk(previous.release.version);
        }
        const downloadedUri = await resolveLocalApk(release);
        set({
          release,
          downloadedUri,
          progress: downloadedUri ? 1 : 0,
          status: release ? (downloadedUri ? "downloaded" : "available") : "idle",
          lastChecked: waitingForApk ? null : Date.now(),
          error: null,
        });
        if (waitingForApk) {
          await prefsSet(StorageKeys.NATIVE_UPDATE, {
            checkedAt: 0,
            includePrereleases,
            release,
          } satisfies CachedUpdate);
        } else {
          await saveCache(get());
        }
        if (get().includePrereleases !== includePrereleases) {
          return get().check(true);
        }
        return release;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const downloadedUri =
        (await resolveLocalApk(previous.release)) ?? previous.downloadedUri;
      set({
        release: previous.release,
        downloadedUri,
        progress: downloadedUri ? 1 : previous.progress,
        status: downloadedUri
          ? "downloaded"
          : previous.release
            ? "available"
            : "error",
        error: error instanceof Error ? error.message : "Native update check failed",
      });
      throw error;
    }
  },

  downloadAndInstall: async () => {
    if (get().status === "downloading") return;
    const release = get().release;
    if (!release) return;
    const destination = apkDestination(release.version);
    if (!destination) return;
    if (await apkIsReady(destination, release.apkSize)) {
      set({
        status: "downloaded",
        progress: 1,
        downloadedUri: destination,
        error: null,
        showProgress: true,
      });
      await get().install();
      if (get().lastChecked == null) void get().check(true).catch(() => {});
      return;
    }
    set({
      status: "downloading",
      progress: 0,
      downloadedUri: null,
      error: null,
      showProgress: true,
    });
    try {
      await FileSystem.deleteAsync(destination, { idempotent: true });
      const download = FileSystem.createDownloadResumable(
        release.apkUrl,
        destination,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            set({ progress: totalBytesWritten / totalBytesExpectedToWrite });
          }
        },
      );
      const result = await download.downloadAsync();
      if (!result?.uri) throw new Error("The update download did not finish");
      if (!(await apkIsReady(result.uri, release.apkSize))) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new Error("The update download was incomplete");
      }
      set({ status: "downloaded", progress: 1, downloadedUri: result.uri });
      await get().install();
      if (get().lastChecked == null) void get().check(true).catch(() => {});
    } catch (error) {
      if (get().downloadedUri) {
        set({
          status: "downloaded",
          error: error instanceof Error ? error.message : "Couldn't open the installer.",
        });
        throw error;
      }
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Couldn't download the update.",
      });
      throw error;
    }
  },

  install: async () => {
    const release = get().release;
    const currentUri = get().downloadedUri;
    const uri = (await apkIsReady(currentUri, release?.apkSize ?? 0))
      ? currentUri
      : await resolveLocalApk(release);
    if (!uri) {
      set({
        downloadedUri: null,
        progress: 0,
        status: release ? "available" : "idle",
      });
      throw new Error("The downloaded update is no longer on the device");
    }
    if (uri !== currentUri) {
      set({ downloadedUri: uri, status: "downloaded", progress: 1 });
    }
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: APK_MIME_TYPE,
        flags: READ_URI_PERMISSION,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Couldn't open the installer." });
      throw error;
    }
  },

  dismissDownload: () => {
    const release = get().release;
    const downloaded = !!get().downloadedUri;
    set({
      status: release ? (downloaded ? "downloaded" : "available") : "idle",
      showProgress: false,
      error: null,
    });
  },
}));
