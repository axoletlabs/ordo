/**
 * Button — spring press feedback, four variants faithful to ordo-archive:
 *  - primary:   coral fill, white label
 *  - secondary: transparent, 1px line border
 *  - ghost:     transparent fill
 *  - danger:    coral outline (coral border + coral label)
 */
import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { PressableScale } from "./PressableScale";
import { Spinner } from "./Spinner";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  block?: boolean;
  style?: ViewStyle;
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
  const { palette } = useTheme();
  const isDisabled = disabled || loading;
  const height = size === "lg" ? 48 : 42;

  const surface =
    variant === "primary"
      ? palette.accent
      : variant === "secondary"
        ? "transparent"
        : variant === "ghost"
          ? "transparent"
          : "transparent"; // danger → outline

  const fg =
    variant === "primary"
      ? palette.onAccent
      : variant === "danger"
        ? palette.danger
        : palette.text;

  // Keep a 1px border on every variant so filled and outlined buttons share a box.
  const borderWidth = 1;
  const borderColor =
    variant === "primary"
      ? surface
      : variant === "ghost"
        ? "transparent"
        : variant === "danger"
          ? palette.danger
          : palette.borderStrong;

  return (
    <PressableScale
      testID={testID}
      disabled={isDisabled}
      onPress={() => {
        haptics.light();
        onPress?.();
      }}
      style={[
        styles.base,
        {
          height,
          backgroundColor: surface,
          borderRadius: radius.sm,
          borderWidth,
          borderColor,
          opacity: disabled ? 0.45 : 1,
          ...(block ? { width: "100%" as const } : {}),
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <Spinner size="sm" color={fg} />
        ) : (
          <>
            {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
            <Text variant="header" style={{ color: fg }}>
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
    paddingHorizontal: spacing[20],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  iconWrap: { marginRight: spacing[8] },
});
