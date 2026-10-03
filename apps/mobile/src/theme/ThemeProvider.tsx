/**
 * ThemeProvider: resolves the active palette from the settings store
 * (theme mode + AMOLED flag) and the device color scheme, then exposes it via
 * context. Also keeps the status bar, OS color scheme, and web scrollbars in
 * sync so native chrome is not stuck on a Light activity theme.
 */
import React, { createContext, useContext, useEffect, useMemo } from "react";
import { Appearance, Platform, View, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSettingsStore } from "../store/settings";
import {
  resolvePalette,
  resolveShadows,
  type Palette,
  type Shadows,
} from "./theme";
import { pinWindowBackground } from "./pin-system-chrome";
import { scrollbarColors, WEB_SCROLLBAR_CSS } from "./scrollbar";
import { MATERIAL_ROLES } from "./material-colors";
import { useDeviceColors } from "./device-colors";

interface ThemeContextValue {
  palette: Palette;
  shadows: Shadows;
  expressive: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const WEB_SCROLLBAR_STYLE_ID = "ordo-scrollbar-css";

function applyWebScrollbarTheme(palette: Palette) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const { thumb, track } = scrollbarColors(palette);
  const root = document.documentElement;
  root.style.colorScheme = palette.mode === "dark" ? "dark" : "light";
  for (const role of MATERIAL_ROLES) {
    root.style.setProperty(`--md-sys-color-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, palette[role]);
  }
  root.style.setProperty("--ordo-scrollbar-thumb", thumb);
  root.style.setProperty("--ordo-scrollbar-track", track);
  if (!document.getElementById(WEB_SCROLLBAR_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = WEB_SCROLLBAR_STYLE_ID;
    style.textContent = WEB_SCROLLBAR_CSS;
    document.head.appendChild(style);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const amoled = useSettingsStore((s) => s.amoled);
  const expressive = useSettingsStore((s) => s.expressive);
  const materialYouColors = useSettingsStore((s) => s.materialYouColors);
  const deviceColors = useDeviceColors();
  const contrast = useSettingsStore((s) => s.themeContrast);
  const systemScheme = useColorScheme();

  const value = useMemo<ThemeContextValue>(() => {
    const palette = resolvePalette(themeMode, amoled, systemScheme, undefined, expressive, contrast, materialYouColors ? deviceColors : null);
    return { palette, shadows: resolveShadows(palette), expressive };
  }, [themeMode, amoled, systemScheme, deviceColors, materialYouColors, expressive, contrast]);

  useEffect(() => {
    if (typeof Appearance.setColorScheme !== "function") return;
    // Palettes theme the app; Appearance remains the actual OS signal. An
    // override makes "System" read our forced mode instead of the device.
    Appearance.setColorScheme("unspecified");
  }, []);

  useEffect(() => {
    applyWebScrollbarTheme(value.palette);
  }, [value.palette]);

  useEffect(() => {
    void pinWindowBackground(value.palette.background).catch(() => {});
  }, [value.palette.background]);

  return (
    <ThemeContext.Provider value={value}>
      <View style={{ flex: 1, backgroundColor: value.palette.background }}>
        <StatusBar style={value.palette.mode === "dark" ? "light" : "dark"} />
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}

/**
 * Overrides the ambient palette for a subtree — e.g. the reader surface,
 * which themes itself independently of the app theme. Every nested
 * `useTheme()` consumer (Text, sheets, buttons…) picks up the override.
 * Overlays published through OverlayPortal must re-provide this palette
 * themselves; the overlay host is not a descendant of this provider.
 */
export function ThemeOverrideProvider({
  palette,
  children,
}: {
  palette: Palette;
  children: React.ReactNode;
}) {
  const expressive = useSettingsStore((s) => s.expressive);
  const value = useMemo<ThemeContextValue>(
    () => ({ palette, shadows: resolveShadows(palette), expressive }),
    [palette, expressive],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
