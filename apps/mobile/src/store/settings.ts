/**
 * Client/UI settings store: server URL, recent server history, theme mode,
 * AMOLED, navigation, and website-browser preferences. Persisted to
 * AsyncStorage (non-secret). Hydrated explicitly on app start.
 */
import { create } from "zustand";
import {
  parseServerHistory,
  recordServerSwitch,
  removeServerHistoryEntry,
  type ServerHistoryEntry,
} from "../lib/server-history";
import { prefsGet, prefsSet, StorageKeys } from "../lib/storage";
import type { ThemeMode } from "../theme/theme";

export const DEFAULT_SERVER_URL = "http://localhost:3000";
export type NavigationStyle = "docked" | "floating" | "compactFloating";
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

export interface SettingsState {
  serverUrl: string;
  themeMode: ThemeMode;
  amoled: boolean;
  navigationStyle: NavigationStyle;
  showNavigationLabels: boolean;
  createButtonTapAction: CreateButtonAction;
  createButtonHoldAction: CreateButtonHoldAction;
  websiteBrowser: WebsiteBrowser;
  /** One-time tip: OTP is printed to the server console when SMTP is unset. */
  consoleOtpTipDismissed: boolean;
  /** Last three servers left behind when switching. URLs only — no credentials. */
  serverHistory: ServerHistoryEntry[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  removeServerHistory: (url: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAmoled: (on: boolean) => void;
  setNavigationStyle: (style: NavigationStyle) => void;
  setShowNavigationLabels: (show: boolean) => void;
  setCreateButtonTapAction: (action: CreateButtonAction) => void;
  setCreateButtonHoldAction: (action: CreateButtonHoldAction) => void;
  setWebsiteBrowser: (browser: WebsiteBrowser) => void;
  dismissConsoleOtpTip: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  serverUrl: DEFAULT_SERVER_URL,
  themeMode: "system",
  amoled: false,
  navigationStyle: "docked",
  showNavigationLabels: true,
  createButtonTapAction: "menu",
  createButtonHoldAction: "bookmark",
  websiteBrowser: "ordo",
  consoleOtpTipDismissed: false,
  serverHistory: [],
  hydrated: false,

  hydrate: async () => {
    const saved = await prefsGet<Partial<SettingsState>>(StorageKeys.SETTINGS);
    set({
      serverUrl: saved?.serverUrl?.trim() || DEFAULT_SERVER_URL,
      themeMode: saved?.themeMode ?? "system",
      amoled: saved?.amoled ?? false,
      navigationStyle:
        saved?.navigationStyle === "floating" || saved?.navigationStyle === "compactFloating"
          ? saved.navigationStyle
          : "docked",
      showNavigationLabels: saved?.showNavigationLabels !== false,
      createButtonTapAction: isCreateButtonAction(saved?.createButtonTapAction)
        ? saved.createButtonTapAction
        : "menu",
      createButtonHoldAction:
        saved?.createButtonHoldAction === "none" || isCreateButtonAction(saved?.createButtonHoldAction)
          ? saved.createButtonHoldAction
          : "bookmark",
      websiteBrowser: isWebsiteBrowser(saved?.websiteBrowser) ? saved.websiteBrowser : "ordo",
      consoleOtpTipDismissed: saved?.consoleOtpTipDismissed === true,
      serverHistory: parseServerHistory(saved?.serverHistory),
      hydrated: true,
    });
  },

  setServerUrl: async (url) => {
    const previous = get().serverUrl;
    const serverHistory = recordServerSwitch(get().serverHistory, previous, url);
    set({ serverUrl: url, serverHistory });
    await prefsSet(StorageKeys.SETTINGS, { ...get(), serverUrl: url, serverHistory });
  },
  removeServerHistory: (url) => {
    const serverHistory = removeServerHistoryEntry(get().serverHistory, url);
    set({ serverHistory });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), serverHistory });
  },
  setThemeMode: (mode) => {
    set({ themeMode: mode });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), themeMode: mode });
  },
  setAmoled: (on) => {
    set({ amoled: on });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), amoled: on });
  },
  setNavigationStyle: (navigationStyle) => {
    set({ navigationStyle });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), navigationStyle });
  },
  setShowNavigationLabels: (showNavigationLabels) => {
    set({ showNavigationLabels });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), showNavigationLabels });
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
  dismissConsoleOtpTip: () => {
    set({ consoleOtpTipDismissed: true });
    void prefsSet(StorageKeys.SETTINGS, { ...get(), consoleOtpTipDismissed: true });
  },
}));
