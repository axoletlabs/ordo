import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { create } from "zustand";
import { APP_NAME } from "@ordo/shared";
import { isNewerVersion, parseVersion } from "../lib/app-version";
import { prefsGet, prefsSet, StorageKeys } from "../lib/storage";

const RELEASES_URL = "https://api.github.com/repos/axoletlabs/ordo/releases?per_page=20";
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
  return parseVersion(tagName) ? tagName.replace(/^v/, "") : null;
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
    prerelease: !!release.prerelease,
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
  error: null,
  lastChecked: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const cached = await prefsGet<CachedUpdate>(StorageKeys.NATIVE_UPDATE);
    const release =
      cached?.release && isNewerVersion(cached.release.version, currentVersion())
        ? cached.release
        : null;
    set({
      hydrated: true,
      includePrereleases: cached?.includePrereleases ?? false,
      release,
      lastChecked: cached?.checkedAt ?? null,
      status: !isSupported() ? "disabled" : release ? "available" : "idle",
    });
  },

  setIncludePrereleases: async (enabled) => {
    await get().hydrate();
    set({
      includePrereleases: enabled,
      lastChecked: null,
      release: null,
      status: isSupported() ? "idle" : "disabled",
    });
    await saveCache(get());
    await get().check(true).catch(() => {});
  },

  check: async (force = false) => {
    await get().hydrate();
    if (!isSupported()) return null;
    const state = get();
    if (state.status === "checking") return state.release;
    if (state.status === "downloading" || state.status === "downloaded") return state.release;
    if (state.status === "error" && (state.downloadedUri || state.progress > 0)) {
      return state.release;
    }
    if (
      !force &&
      state.lastChecked != null &&
      Date.now() - state.lastChecked < CHECK_COOLDOWN_MS
    ) {
      return state.release;
    }

    set({ status: "checking", error: null });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(RELEASES_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const releases = (await response.json()) as GithubRelease[];
      const eligible = releases.filter((release) => {
        const version = releaseVersion(release.tag_name ?? "");
        return (
          !release.draft &&
          (state.includePrereleases || !release.prerelease) &&
          version != null &&
          isNewerVersion(version, currentVersion())
        );
      });
      const candidates = eligible
        .map(normalizeRelease)
        .filter((release): release is NativeRelease => release != null)
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      const release = candidates[0] ?? null;
      const waitingForApk = eligible.length > candidates.length;
      set({
        release,
        status: release ? "available" : "idle",
        lastChecked: waitingForApk ? null : Date.now(),
        error: null,
      });
      if (waitingForApk) {
        await prefsSet(StorageKeys.NATIVE_UPDATE, {
          checkedAt: 0,
          includePrereleases: state.includePrereleases,
          release,
        } satisfies CachedUpdate);
      } else {
        await saveCache(get());
      }
      return release;
    } catch (error) {
      set({
        status: get().release ? "available" : "error",
        error: error instanceof Error ? error.message : "Native update check failed",
      });
      throw error;
    }
  },

  downloadAndInstall: async () => {
    if (get().status === "downloading") return;
    const release = get().release;
    if (!release || !FileSystem.cacheDirectory) return;
    const existingUri = get().downloadedUri;
    if (existingUri) {
      const existing = await FileSystem.getInfoAsync(existingUri).catch(() => null);
      if (existing?.exists && (release.apkSize <= 0 || existing.size === release.apkSize)) {
        set({ status: "downloaded", progress: 1, error: null });
        await get().install();
        return;
      }
    }
    const destination = `${FileSystem.cacheDirectory}ordo-${release.version}.apk`;
    set({ status: "downloading", progress: 0, downloadedUri: null, error: null });
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
      const info = await FileSystem.getInfoAsync(result.uri);
      if (!info.exists || (release.apkSize > 0 && info.size !== release.apkSize)) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new Error("The update download was incomplete");
      }
      set({ status: "downloaded", progress: 1, downloadedUri: result.uri });
      await get().install();
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Couldn't download the update.",
      });
      throw error;
    }
  },

  install: async () => {
    const uri = get().downloadedUri;
    if (!uri) return;
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
    set({ status: release ? "available" : "idle", progress: 0, error: null });
  },
}));
