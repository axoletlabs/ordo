/** M3 buttons: official size/shape tokens with a separate 48dp touch target. */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { PressableScale } from "./PressableScale";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "tonal" | "elevated" | "outlined";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";
const sizes = {
  xs: { height: 32, padding: 12, pressed: 8, font: 14, icon: 18 },
  sm: { height: 40, padding: 16, pressed: 8, font: 14, icon: 20 },
  md: { height: 56, padding: 24, pressed: 12, font: 16, icon: 24 },
  lg: { height: 96, padding: 48, pressed: 16, font: 24, icon: 32 },
  xl: { height: 136, padding: 64, pressed: 16, font: 32, icon: 40 },
} as const;

export interface ButtonProps {
  label: string; onPress?: () => void; variant?: ButtonVariant; size?: ButtonSize;
  loading?: boolean; disabled?: boolean; icon?: React.ReactNode; block?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string;
}

export function Button({ label, onPress, variant = "primary", size = "sm", loading = false,
  disabled = false, icon, block = false, style, testID }: ButtonProps) {
  const { palette, expressive, shadows } = useTheme();
  const inactive = disabled || loading;
  const tokens = sizes[size];
  const filled = variant === "primary" || variant === "danger" || variant === "tonal" || variant === "secondary" || variant === "elevated";
  const surface = inactive ? filled ? `${palette.onSurface}1f` : "transparent"
    : variant === "primary" ? palette.primary : variant === "danger" ? palette.error
    : variant === "tonal" || variant === "secondary" ? palette.secondaryContainer : variant === "elevated" ? palette.surfaceContainerLow : "transparent";
  const foreground = inactive ? `${palette.onSurface}61` : variant === "primary" ? palette.onPrimary
    : variant === "danger" ? palette.onError : variant === "tonal" || variant === "secondary" ? palette.onSecondaryContainer
    : variant === "outlined" && expressive ? palette.onSurfaceVariant : palette.primary;
  // The pressed squarer-corner morph is Expressive-only; Standard keeps the
  // capsule at rest and pressed. Always pass a shape (even when it doesn't
  // morph): PressableScale picks its implementation from the shape's presence,
  // and swapping implementations on a mode change would remount a focused or
  // pressed control mid-gesture.
  const shape = { rest: tokens.height / 2, pressed: expressive ? tokens.pressed : tokens.height / 2 };
  return <View style={[{ minHeight: 48, minWidth: 48, justifyContent: "center", ...(block ? { width: "100%" as const } : {}) }, style]}>
    <PressableScale testID={testID} disabled={inactive} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }} stateLayerColor={foreground}
      shape={shape}
      onPress={() => { haptics.light(); onPress?.(); }}
      style={{ minWidth: 48, minHeight: Math.max(48, tokens.height), borderRadius: tokens.height / 2, justifyContent: "center" }}
      visualStyle={[styles.base, { height: tokens.height, alignSelf: "stretch", paddingHorizontal: size === "sm" && !expressive ? 24 : tokens.padding,
        backgroundColor: surface, borderRadius: tokens.height / 2,
        borderWidth: variant === "outlined" ? 1 : 0,
        borderColor: inactive ? `${palette.onSurface}1f` : expressive ? palette.outlineVariant : palette.outline },
        variant === "elevated" && !inactive ? shadows.level1 : null]}>
      <View style={styles.content}>
        <View pointerEvents="none" aria-hidden={loading} importantForAccessibility={loading ? "no-hide-descendants" : "auto"}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 0, maxWidth: "100%", opacity: loading ? 0 : 1 }}>
          {icon ? <View style={{ marginRight: 8 }}>{React.isValidElement<{ color?: string; size?: number }>(icon)
            ? React.cloneElement(icon, { color: foreground, size: tokens.icon }) : icon}</View> : null}
          <Text variant="labelLarge" numberOfLines={1} style={[styles.label, {
            color: foreground, fontSize: tokens.font, lineHeight: tokens.font + 6,
          }]}>{label}</Text>
        </View>
        {loading ? <View pointerEvents="none" style={StyleSheet.absoluteFill}><View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Spinner size="sm" color={foreground} /></View></View> : null}
      </View>
    </PressableScale>
  </View>;
}
const styles = StyleSheet.create({
  base: { minWidth: 48, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 0, maxWidth: "100%" },
  label: { flexShrink: 1, includeFontPadding: false },
});
