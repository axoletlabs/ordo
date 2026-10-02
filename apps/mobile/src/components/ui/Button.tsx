/** Material filled, tonal, elevated, outlined, text, and error actions. */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { PressableScale } from "./PressableScale";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "tonal" | "elevated";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  block = false,
  style,
  testID,
}: ButtonProps) {
  const { palette, expressive, shadows } = useTheme();
  const isDisabled = disabled || loading;
  const height = { xs: 32, sm: 40, md: 48, lg: 56, xl: 64 }[size];

  const surface = isDisabled ? `${palette.onSurface}1f` : variant === "primary" ? palette.primary
    : variant === "tonal" ? palette.secondaryContainer : variant === "elevated" ? palette.surfaceContainerLow : "transparent";

  const fg =
    isDisabled ? `${palette.onSurface}61` : variant === "primary"
      ? palette.onPrimary
      : variant === "tonal" ? palette.onSecondaryContainer
      : variant === "danger"
        ? palette.danger
        : variant === "secondary" ? palette.onSurfaceVariant : palette.primary;

  // Keep a 1px border on every variant so filled and outlined buttons share a box.
  const borderWidth = 1;
  const borderColor =
    variant === "primary"
      ? surface
      : variant === "ghost"
        ? "transparent"
        : variant === "danger"
          ? palette.danger
           : variant === "secondary" ? palette.outlineVariant : "transparent";

  return (
    <PressableScale
      testID={testID}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      stateLayerColor={fg}
      shape={{ rest: height / 2, pressed: expressive ? (height >= 56 ? radius.lg : height >= 48 ? radius.md : radius.sm) : height / 2 }}
      onPress={() => {
        haptics.light();
        onPress?.();
      }}
      style={[
        styles.base,
        {
          height,
          backgroundColor: surface,
           borderRadius: radius.full,
          borderWidth,
          borderColor,
           minHeight: 48,
          ...(block ? { width: "100%" as const } : {}),
         },
         variant === "elevated" && !isDisabled ? shadows.level1 : null,
         style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <Spinner size="sm" color={fg} />
        ) : (
          <>
            {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
             <Text variant="labelLarge" numberOfLines={1} style={[styles.label, { color: fg }]}>
              {label}
            </Text>
          </>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing[16],
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    maxWidth: "100%",
  },
  label: { flexShrink: 1, includeFontPadding: false },
  iconWrap: { marginRight: spacing[8], flexShrink: 0 },
});
