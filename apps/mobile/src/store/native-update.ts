import { recordDiagnosticOperation, withDiagnosticOperation } from "../lib/local-diagnostics";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { create } from "zustand";
import { APP_NAME } from "@ordo/shared";
import {
  classifyReleaseVersion,
  compareReleaseCandidates,
  releaseMatchesVariant,
  isNewerVersion,
  selectNativeUpdate,
} from "../lib/app-version";
import {
  isTrustedGithubAssetUrl,
  isTrustedGithubReleasePageUrl,
} from "../lib/github-asset-url";
import { apkFileIsComplete, nativeDownloadRatio } from "../lib/native-download-progress";
import { selectReleaseApk, type GithubApkAsset } from "../lib/native-apk";
import { prefsGet, prefsSet, StorageKeys } from "../lib/storage";
import { APP_IDENTITY, APP_VARIANT } from "../lib/app-variant";

const GITHUB_REPO_API = "https://api.github.com/repos/axoletlabs/ordo";
const GITHUB_HEADERS = { Accept: "application/vnd.github+json" };
const CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15 * 1000;
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const READ_URI_PERMISSION = 1;
const INSTALL_UNKNOWN_APPS_ACTION = "android.settings.MANAGE_UNKNOWN_APP_SOURCES";

/** Invalidate in-flight GitHub checks so they cannot overwrite a download or installer. */
let checkEpoch = 0;
/** Invalidate an in-flight download or installer result after cancel or dismiss. */
let downloadEpoch = 0;
let activeDownload: FileSystem.DownloadResumable | null = null;
let hydration: Promise<void> | null = null;
let cancellation: Promise<void> = Promise.resolve();
let checkInFlight: Promise<NativeRelease | null> | null = null;

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

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets?: GithubApkAsset[];
}

interface CachedUpdate {
  checkedAt: number;
  variant: typeof APP_VARIANT;
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
  status: NativeUpdateStatus;
  release: NativeRelease | null;
  progress: number;
  /** Bytes written for the in-flight APK. 0 until the first socket read. */
  receivedBytes: number;
  downloadedUri: string | null;
  /** True while this process is fetching or presenting a just-downloaded APK. */
  showProgress: boolean;
  /** True while the system installer activity is in the foreground. */
  installing: boolean;
  /** True when Android likely blocked sideloading (unknown-sources). */
  installPermissionLikely: boolean;
  error: string | null;
  lastChecked: number | null;
  hydrate: () => Promise<void>;
  check: (force?: boolean) => Promise<NativeRelease | null>;
  downloadAndInstall: () => Promise<void>;
  install: () => Promise<void>;
  /** Stop the transfer, drop the partial file, and close the dialog. */
  cancelDownload: () => void;
  dismissDownload: () => void;
}

function androidPackageName(): string {
  return APP_IDENTITY.package;
}

export async function openInstallPermissionSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(INSTALL_UNKNOWN_APPS_ACTION, {
    data: `package:${androidPackageName()}`,
  });
}

function isInstallPermissionError(message: string): boolean {
  return /unknown source|install.?unknown|REQUEST_INSTALL|not allowed to install|permission denied|INSTALL_FAILED_USER_RESTRICTED/i.test(
    message,
  );
}

function releaseVersion(tagName: string): string | null {
  return classifyReleaseVersion(tagName)?.version ?? null;
}

function normalizeRelease(release: GithubRelease): NativeRelease | null {
  const version = releaseVersion(release.tag_name ?? "");
  const apk = version ? selectReleaseApk(release.assets ?? [], version, Device.supportedCpuArchitectures ?? [], APP_VARIANT) : null;
  if (!version || !apk?.browser_download_url || !release.published_at) return null;
  const normalized: NativeRelease = {
    version,
    tagName: release.tag_name!,
    name: release.name?.trim() || `${APP_NAME} ${release.tag_name}`,
    body: release.body?.trim() ?? "",
    prerelease: !!release.prerelease,
    publishedAt: release.published_at,
    pageUrl: isTrustedGithubReleasePageUrl(release.html_url ?? "")
      ? release.html_url!
      : "https://github.com/axoletlabs/ordo/releases",
    apkUrl: apk.browser_download_url,
    apkSize: apk.size ?? 0,
  };
  return releaseIsEligible(normalized) ? normalized : null;
}

function currentVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "0.0.0";
}

function isSupported(): boolean {
  return Platform.OS === "android" && !__DEV__ && APP_VARIANT !== "development";
}

function releaseIsEligible(release: NativeRelease): boolean {
  if (!releaseMatchesVariant(release, APP_VARIANT) || !isTrustedGithubAssetUrl(release.apkUrl)) return false;
  // Cached metadata must not smuggle another app's APK into the installer.
  let name: string;
  try {
    name = decodeURIComponent(new URL(release.apkUrl).pathname.split("/").pop() ?? "");
  } catch { return false; }
  return !!selectReleaseApk([{ name, state: "uploaded", size: release.apkSize,
    browser_download_url: release.apkUrl }], release.version, Device.supportedCpuArchitectures ?? [], APP_VARIANT);
}

async function fetchGithubReleases(signal: AbortSignal): Promise<GithubRelease[]> {
  const [listResponse, latestResponse] = await Promise.all([
    fetch(`${GITHUB_REPO_API}/releases?per_page=100`, { headers: GITHUB_HEADERS, signal }),
    fetch(`${GITHUB_REPO_API}/releases/latest`, { headers: GITHUB_HEADERS, signal }).catch(() => null),
  ]);
  if (!listResponse.ok) throw new Error(`GitHub returned ${listResponse.status}`);
  const listed = (await listResponse.json()) as GithubRelease[];
  const byTag = new Map<string, GithubRelease>();
  for (const release of listed) {
    if (release.tag_name) byTag.set(release.tag_name, release);
  }
  if (latestResponse?.ok) {
    const latest = (await latestResponse.json()) as GithubRelease;
    if (latest.tag_name) byTag.set(latest.tag_name, latest);
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
    return apkFileIsComplete(info.size ?? 0, apkSize);
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
  if (!version || !classifyReleaseVersion(version)) return;
  const path = apkDestination(version);
  if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
}

async function saveCache(state: NativeUpdateState): Promise<void> {
  await prefsSet(StorageKeys.NATIVE_UPDATE, {
    checkedAt: state.lastChecked ?? 0,
    variant: APP_VARIANT,
    release: state.release,
  } satisfies CachedUpdate);
}

export const useNativeUpdateStore = create<NativeUpdateState>((set, get) => ({
  hydrated: false,
  status: isSupported() ? "idle" : "disabled",
  release: null,
  progress: 0,
  receivedBytes: 0,
  downloadedUri: null,
  showProgress: false,
  installing: false,
  installPermissionLikely: false,
  error: null,
  lastChecked: null,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydration) return hydration;
    hydration = (async () => {
    // Cache is an optimization, never a prerequisite for finding an update.
    const cached = await prefsGet<CachedUpdate>(StorageKeys.NATIVE_UPDATE).catch(() => null);
    let lastChecked = cached?.variant === APP_VARIANT && typeof cached?.checkedAt === "number" && Number.isFinite(cached.checkedAt) &&
      cached.checkedAt >= 0 && cached.checkedAt <= Date.now() ? cached.checkedAt : null;
    let release =
      cached?.variant === APP_VARIANT && cached?.release && typeof cached.release.version === "string" &&
      typeof cached.release.apkUrl === "string" &&
      classifyReleaseVersion(cached.release.version) &&
      Number.isSafeInteger(cached.release.apkSize) && cached.release.apkSize > 0 &&
      isNewerVersion(cached.release.version, currentVersion())
        ? cached.release
        : null;
    if (release && !releaseIsEligible(release)) {
      release = null;
    }
    if (cached?.release && !release) {
      await deleteApk(cached.release.version);
      lastChecked = null;
    }
    if (!isSupported()) {
      set({
        hydrated: true,
        release: null,
        lastChecked,
        downloadedUri: null,
        showProgress: false,
        installing: false,
        installPermissionLikely: false,
        status: "disabled",
      });
      return;
    }
    const downloadedUri = await resolveLocalApk(release);
    set({
      hydrated: true,
      release,
      lastChecked,
      downloadedUri,
      progress: downloadedUri ? 1 : 0,
      showProgress: false,
      installing: false,
      installPermissionLikely: false,
      status: release ? (downloadedUri ? "downloaded" : "available") : "idle",
    });
    })().finally(() => { hydration = null; });
    return hydration;
  },

  check: async (force = false) => {
    await get().hydrate();
    if (!isSupported()) return null;
    const state = get();
    if (state.status === "checking" && checkInFlight) return checkInFlight;
    if (
      state.status === "checking" ||
      state.status === "downloading" ||
      state.installing
    ) {
      return state.release;
    }
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
    const epoch = ++checkEpoch;
    const mayCommit = () => {
      const current = get();
      return (
        epoch === checkEpoch &&
        current.status !== "downloading" &&
        !current.installing
      );
    };
    set({ status: "checking", error: null });
    const request = withDiagnosticOperation("update-check", async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      try {
        const releases = await fetchGithubReleases(controller.signal);
        const current = currentVersion();
        const versionEligible = releases.flatMap((item) => {
          if (item.draft || !item.published_at) return [];
          const version = releaseVersion(item.tag_name ?? "");
          if (!version) return [];
          const meta = {
            version,
            prerelease: !!item.prerelease,
            publishedAt: item.published_at,
            github: item,
          };
          if (!releaseMatchesVariant(meta, APP_VARIANT)) return [];
          if (!isNewerVersion(version, current)) return [];
          return [meta];
        });
        const candidates = versionEligible
          .map((item) => normalizeRelease(item.github))
          .filter((item): item is NativeRelease => item != null);
        const release = selectNativeUpdate(candidates, current, APP_VARIANT);
        const newestEligible = selectNativeUpdate(versionEligible, current, APP_VARIANT);
        const waitingForApk =
          !!newestEligible &&
          (!release || compareReleaseCandidates(newestEligible, release) > 0);
        if (!mayCommit()) return get().release;
        if (previous.release?.version && previous.release.version !== release?.version) {
          await deleteApk(previous.release.version);
        }
        if (!mayCommit()) return get().release;
        const downloadedUri = await resolveLocalApk(release);
        if (!mayCommit()) return get().release;
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
            variant: APP_VARIANT,
            release,
          } satisfies CachedUpdate);
        } else {
          await saveCache(get());
        }
        return release;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (!mayCommit()) throw error;
      const downloadedUri =
        await resolveLocalApk(previous.release);
      if (!mayCommit()) throw error;
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
    }).finally(() => {
      if (checkInFlight === request) checkInFlight = null;
    });
    checkInFlight = request;
    return request;
  },

  downloadAndInstall: async () => {
    await cancellation;
    if (!isSupported()) return;
    if (get().status === "downloading" || get().installing) return;
    checkEpoch += 1;
    const epoch = ++downloadEpoch;
    const release = get().release;
    if (!release) return;
    if (!releaseIsEligible(release)) {
      throw new Error("The update APK does not belong to this app variant");
    }
    const destination = apkDestination(release.version);
    if (!destination) throw new Error("Update storage is unavailable on this device");
    // Reserve BEFORE the asynchronous file check, so a second tap cannot
    // supersede the first operation while the filesystem catches up.
    set({
      status: "downloading",
      progress: 0,
      receivedBytes: 0,
      downloadedUri: null,
      error: null,
      showProgress: true,
      installPermissionLikely: false,
    });
    const stillCurrent = () => epoch === downloadEpoch;
    try {
    if (await apkIsReady(destination, release.apkSize)) {
      if (epoch !== downloadEpoch) return;
      set({
        status: "downloaded",
        progress: 1,
        receivedBytes: release.apkSize,
        downloadedUri: destination,
        error: null,
        showProgress: true,
        installPermissionLikely: false,
      });
      await get().install();
      if (get().lastChecked == null && !get().error) void get().check(true).catch(() => {});
      return;
    }
    if (epoch !== downloadEpoch) return;
      const download = FileSystem.createDownloadResumable(
        release.apkUrl,
        destination,
        {
          // Keep Content-Length. OkHttp otherwise asks for gzip and then
          // reports an unknown size, which left this dialog at 0%.
          headers: {
            Accept: "application/octet-stream",
            "Accept-Encoding": "identity",
          },
        },
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (!stillCurrent()) return;
          const written = Number(totalBytesWritten) || 0;
          set({
            receivedBytes: written,
            progress: nativeDownloadRatio(written, Number(totalBytesExpectedToWrite), release.apkSize),
          });
        },
      );
      activeDownload = download;
      const result = await withDiagnosticOperation("update-download", () => download.downloadAsync());
      if (activeDownload === download) activeDownload = null;
      if (!stillCurrent()) return;
      if (!result?.uri) throw new Error("The update download did not finish");
      if (result.status != null && (result.status < 200 || result.status >= 300)) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new Error(`Couldn't download the update (HTTP ${result.status}).`);
      }
      if (!(await apkIsReady(result.uri, release.apkSize))) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new Error("The update download was incomplete");
      }
      if (!stillCurrent()) return;
      set({
        status: "downloaded",
        progress: 1,
        receivedBytes: release.apkSize,
        downloadedUri: result.uri,
      });
      await get().install();
      if (get().lastChecked == null && !get().error) void get().check(true).catch(() => {});
    } catch (error) {
      if (!stillCurrent()) return;
      activeDownload = null;
      if (get().downloadedUri) {
        set({
          status: "downloaded",
          error: error instanceof Error ? error.message : "Couldn't open the installer.",
        });
        throw error;
      }
      await deleteApk(release.version);
      if (!stillCurrent()) return;
      set({
        status: "error",
        progress: 0,
        receivedBytes: 0,
        downloadedUri: null,
        error: error instanceof Error ? error.message : "Couldn't download the update.",
      });
      throw error;
    }
  },

  install: async () => {
    const epoch = downloadEpoch;
    if (get().installing || !isSupported()) return;
    if (!get().release || !releaseIsEligible(get().release!)) return;
    checkEpoch += 1;
    set({ installing: true });
    const release = get().release;
    const currentUri = get().downloadedUri;
    const uri = (await apkIsReady(currentUri, release?.apkSize ?? 0))
      ? currentUri
      : await resolveLocalApk(release);
    if (epoch !== downloadEpoch) return;
    if (!uri) {
      set({
        downloadedUri: null,
        progress: 0,
        receivedBytes: 0,
        status: release ? "available" : "idle",
        installing: false,
      });
      throw new Error("The downloaded update is no longer on the device");
    }
    if (uri !== currentUri) {
      set({ downloadedUri: uri, status: "downloaded", progress: 1 });
    }
    checkEpoch += 1;
    set({
      installing: true,
      error: null,
      installPermissionLikely: false,
      showProgress: true,
      status: "downloaded",
    });
    try {
      const contentUri = await FileSystem.getContentUriAsync(uri);
      if (epoch !== downloadEpoch) return;
      recordDiagnosticOperation("update-apply", "started", 0);
      const result = await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: APK_MIME_TYPE,
        flags: READ_URI_PERMISSION,
      });
      if (epoch !== downloadEpoch) return;
      const stillNeedsUpdate =
        !!release && isNewerVersion(release.version, currentVersion());
      if (!stillNeedsUpdate) {
        set({ showProgress: false, error: null, installPermissionLikely: false });
        return;
      }
      const canceled = result.resultCode === IntentLauncher.ResultCode.Canceled;
      if (canceled) recordDiagnosticOperation("update-apply", "cancelled", 0);
      set({
        status: "downloaded",
        downloadedUri: uri,
        progress: 1,
        showProgress: true,
        error: canceled
          ? "Install was cancelled. Your current version is unchanged."
          : `The new version isn't installed yet. Finish the system installer, or allow ${APP_NAME} to install unknown apps.`,
        installPermissionLikely: !canceled,
      });
    } catch (error) {
      if (epoch !== downloadEpoch) return;
      const message = error instanceof Error ? error.message : "Couldn't open the installer.";
      const permission = isInstallPermissionError(message);
      set({
        status: "downloaded",
        downloadedUri: uri,
        progress: 1,
        showProgress: true,
        error: permission
          ? `Android blocked the installer. Allow ${APP_NAME} to install unknown apps, then try again.`
          : message,
        installPermissionLikely: permission,
      });
      throw error;
    } finally {
      if (epoch === downloadEpoch) set({ installing: false });
    }
  },

  cancelDownload: () => {
    downloadEpoch += 1;
    const task = activeDownload;
    activeDownload = null;
    const version = get().release?.version;
    const release = get().release;
    if (task) {
      cancellation = task.cancelAsync().catch(() => {}).then(async () => {
        await deleteApk(version);
      });
    }
    set({
      status: release ? "available" : "idle",
      progress: 0,
      receivedBytes: 0,
      downloadedUri: null,
      showProgress: false,
      installing: false,
      installPermissionLikely: false,
      error: null,
    });
  },

  dismissDownload: () => {
    if (get().status === "downloading") {
      get().cancelDownload();
      return;
    }
    downloadEpoch += 1;
    const release = get().release;
    const downloaded = !!get().downloadedUri;
    set({
      status: release ? (downloaded ? "downloaded" : "available") : "idle",
      showProgress: false,
      installing: false,
      installPermissionLikely: false,
      error: null,
    });
  },
}));
