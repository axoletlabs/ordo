/** M3 buttons: official size/shape tokens with a separate 48dp touch target. */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { PressableScale } from "./PressableScale";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "tonal" | "elevated";
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
  const filled = variant === "primary" || variant === "danger" || variant === "tonal" || variant === "elevated";
  const surface = inactive ? filled ? `${palette.onSurface}1f` : "transparent"
    : variant === "primary" ? palette.primary : variant === "danger" ? palette.error
    : variant === "tonal" ? palette.secondaryContainer : variant === "elevated" ? palette.surfaceContainerLow : "transparent";
  const foreground = inactive ? `${palette.onSurface}61` : variant === "primary" ? palette.onPrimary
    : variant === "danger" ? palette.onError : variant === "tonal" ? palette.onSecondaryContainer
    : variant === "secondary" ? palette.onSurface : palette.primary;
  return <View style={[{ minHeight: 48, minWidth: 48, justifyContent: "center", ...(block ? { width: "100%" as const } : {}) }, style]}>
    <PressableScale testID={testID} disabled={inactive} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }} stateLayerColor={foreground}
      hitSlop={{ top: Math.max(0, (48 - tokens.height) / 2), bottom: Math.max(0, (48 - tokens.height) / 2) }}
      shape={{ rest: tokens.height / 2, pressed: expressive ? tokens.pressed : tokens.height / 2 }}
      onPress={() => { haptics.light(); onPress?.(); }}
      style={[styles.base, { height: tokens.height, paddingHorizontal: tokens.padding,
        backgroundColor: surface, borderRadius: tokens.height / 2,
        borderWidth: variant === "secondary" ? size === "xl" ? 3 : size === "lg" ? 2 : 1 : 0,
        borderColor: inactive ? `${palette.onSurface}1f` : palette.outline },
        variant === "elevated" && !inactive ? shadows.level1 : null]}>
      <View style={styles.content}>
        {loading ? <Spinner size="sm" color={foreground} /> : <>
          {icon ? <View style={{ marginRight: 8 }}>{React.isValidElement<{ color?: string; size?: number }>(icon)
            ? React.cloneElement(icon, { color: foreground, size: tokens.icon }) : icon}</View> : null}
          <Text variant="labelLarge" numberOfLines={1} style={[styles.label, {
            color: foreground, fontSize: tokens.font, lineHeight: tokens.font + 6,
          }]}>{label}</Text>
        </>}
      </View>
    </PressableScale>
  </View>;
}
const styles = StyleSheet.create({
  base: { minWidth: 48, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 0, maxWidth: "100%" },
  label: { flexShrink: 1, includeFontPadding: false },
});
