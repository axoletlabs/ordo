/**
 * Client/UI settings store: server URL, theme mode, AMOLED, haptics,
 * website-browser, in-app force-dark, and share-sheet preferences.
 * Persisted to AsyncStorage (non-secret). Hydrated explicitly on app start.
 */
import { create } from "zustand";
import { setHapticsEnabled as applyHapticsEnabled } from "../lib/haptics";
import { patchQuickShareSessionServerUrl, syncQuickShareFlags } from "../lib/share-targets";
import { canonicalizeServerUrl, DEFAULT_SERVER_URL, resolvePersistedServerUrl } from "../lib/hosting";
import { prefsGet, prefsSet, StorageKeys } from "../lib/storage";
import type { ThemeMode } from "../theme/theme";

export { DEFAULT_SERVER_URL } from "../lib/hosting";
/** How pages enter and leave. */
export type NavigationAnimation = "slide" | "fade" | "instant";
export type CreateButtonAction = "menu" | "bookmark" | "folder";
export type CreateButtonHoldAction = CreateButtonAction | "none";
/** Where live websites open: ordo's WebView, a Safari/Chrome sheet, or the browser app. */
export type WebsiteBrowser = "ordo" | "inApp" | "external";

function isCreateButtonAction(value: unknown): value is CreateButtonAction {
  return value === "menu" || value === "bookmark" || value === "folder";
}

function isWebsiteBrowser(value: unknown): value is WebsiteBrowser {
  return value === "ordo" || value === "inApp" || value === "external";
}

function isNavigationAnimation(value: unknown): value is NavigationAnimation {
  return value === "slide" || value === "fade" || value === "instant";
}

export interface SettingsState {
  serverUrl: string;
  themeMode: ThemeMode;
  amoled: boolean;
  expressive: boolean;
  materialYouColors: boolean;
  themeContrast: 0 | 0.5 | 1;
  navigationAnimation: NavigationAnimation;
  createButtonTapAction: CreateButtonAction;
  createButtonHoldAction: CreateButtonHoldAction;
  websiteBrowser: WebsiteBrowser;
  /** Darken live pages in ordo's WebView (BookmarkBrowser). */
  forceWebsiteDark: boolean;
  /** Save a shared link as unfiled without opening the save form. Off by default. */
  shareQuickBookmark: boolean;
  /** When Quick Bookmark is on, also keep the normal Save share target. */
  shareShowQuickAction: boolean;
  hapticsEnabled: boolean;
  /** One-time tip: OTP is printed to the server console when SMTP is unset. */
  consoleOtpTipDismissed: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setAmoled: (on: boolean) => void;
  setExpressive: (on: boolean) => void;
  setMaterialYouColors: (on: boolean) => void;
  setThemeContrast: (contrast: 0 | 0.5 | 1) => void;
  setNavigationAnimation: (animation: NavigationAnimation) => void;
  setCreateButtonTapAction: (action: CreateButtonAction) => void;
  setCreateButtonHoldAction: (action: CreateButtonHoldAction) => void;
  setWebsiteBrowser: (browser: WebsiteBrowser) => void;
  setForceWebsiteDark: (on: boolean) => void;
  setShareQuickBookmark: (on: boolean) => void;
  setShareShowQuickAction: (on: boolean) => void;
  setHapticsEnabled: (on: boolean) => void;
  dismissConsoleOtpTip: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  serverUrl: DEFAULT_SERVER_URL,
  themeMode: "system",
  amoled: false,
  expressive: true,
  materialYouColors: false,
  themeContrast: 0,
  navigationAnimation: "slide",
  createButtonTapAction: "bookmark",
  createButtonHoldAction: "menu",
  websiteBrowser: "ordo",
  forceWebsiteDark: false,
  shareQuickBookmark: false,
  shareShowQuickAction: false,
  hapticsEnabled: true,
  consoleOtpTipDismissed: false,
  hydrated: false,

  hydrate: async () => {
    const saved = await prefsGet<Partial<SettingsState>>(StorageKeys.SETTINGS);
    set({
      serverUrl: resolvePersistedServerUrl(saved?.serverUrl),
      themeMode: saved?.themeMode ?? "system",
      amoled: saved?.amoled ?? false,
      expressive: saved?.expressive !== false,
      materialYouColors: saved?.materialYouColors === true,
      themeContrast: saved?.themeContrast === 0.5 || saved?.themeContrast === 1 ? saved.themeContrast : 0,
      navigationAnimation: isNavigationAnimation(saved?.navigationAnimation)
        ? saved.navigationAnimation
        : "slide",
      createButtonTapAction: isCreateButtonAction(saved?.createButtonTapAction)
        ? saved.createButtonTapAction
        : "bookmark",
      createButtonHoldAction:
        saved?.createButtonHoldAction === "none" || isCreateButtonAction(saved?.createButtonHoldAction)
          ? saved.createButtonHoldAction
          : "menu",
      websiteBrowser: isWebsiteBrowser(saved?.websiteBrowser) ? saved.websiteBrowser : "ordo",
      forceWebsiteDark: saved?.forceWebsiteDark === true,
      shareQuickBookmark: saved?.shareQuickBookmark === true,
      shareShowQuickAction:
        saved?.shareQuickBookmark === true && saved?.shareShowQuickAction === true,
      hapticsEnabled: saved?.hapticsEnabled !== false,
      consoleOtpTipDismissed: saved?.consoleOtpTipDismissed === true,
      hydrated: true,
    });
    applyHapticsEnabled(get().hapticsEnabled);
    if (saved && ("navigationStyle" in saved || "showNavigationLabels" in saved)) {
      // One-release cleanup: drop keys from the removed navigation-style
      // settings so the persisted blob reflects the live shape.
      const { navigationStyle: _s, showNavigationLabels: _l, ...rest } = saved as Record<string, unknown>;
      void prefsSet(StorageKeys.SETTINGS, { ...get(), ...rest });
    }
    void syncQuickShareFlags({
      quickBookmark: get().shareQuickBookmark,
      showAlongside: get().shareShowQuickAction,
    });
  },

  setServerUrl: async (url) => {
    const next = canonicalizeServerUrl(url) ?? url;
    set({ serverUrl: next });
    await prefsSet(StorageKeys.SETTINGS, { ...get(), serverUrl: next });
    void patchQuickShareSessionServerUrl(next);
  },
  setThemeMode: (mode) => {
    set({ themeMode: mode });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), themeMode: mode });
  },
  setAmoled: (on) => {
    set({ amoled: on });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), amoled: on });
  },
  setExpressive: (expressive) => {
    set({ expressive });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), expressive });
  },
  setMaterialYouColors: (materialYouColors) => {
    set({ materialYouColors });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), materialYouColors });
  },
  setThemeContrast: (themeContrast) => {
    set({ themeContrast });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), themeContrast });
  },
  setNavigationAnimation: (navigationAnimation) => {
    set({ navigationAnimation });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), navigationAnimation });
  },
  setCreateButtonTapAction: (createButtonTapAction) => {
    set({ createButtonTapAction });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), createButtonTapAction });
  },
  setCreateButtonHoldAction: (createButtonHoldAction) => {
    set({ createButtonHoldAction });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), createButtonHoldAction });
  },
  setWebsiteBrowser: (websiteBrowser) => {
    set({ websiteBrowser });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), websiteBrowser });
  },
  setForceWebsiteDark: (forceWebsiteDark) => {
    set({ forceWebsiteDark });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), forceWebsiteDark });
  },
  setShareQuickBookmark: (shareQuickBookmark) => {
    const shareShowQuickAction = shareQuickBookmark ? get().shareShowQuickAction : false;
    set({ shareQuickBookmark, shareShowQuickAction });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), shareQuickBookmark, shareShowQuickAction });
    void syncQuickShareFlags({ quickBookmark: shareQuickBookmark, showAlongside: shareShowQuickAction });
  },
  setShareShowQuickAction: (on) => {
    const shareShowQuickAction = on && get().shareQuickBookmark;
    set({ shareShowQuickAction });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), shareShowQuickAction });
    void syncQuickShareFlags({
      quickBookmark: get().shareQuickBookmark,
      showAlongside: shareShowQuickAction,
    });
  },
  setHapticsEnabled: (hapticsEnabled) => {
    set({ hapticsEnabled });
    applyHapticsEnabled(hapticsEnabled);
    void prefsSet(StorageKeys.SETTINGS, { ...get(), hapticsEnabled });
  },
  dismissConsoleOtpTip: () => {
    set({ consoleOtpTipDismissed: true });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), consoleOtpTipDismissed: true });
  },
}));
