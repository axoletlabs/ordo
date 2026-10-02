import React from "react";
import { View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { MaterialIcon } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { useButtonGroupInteraction } from "./ButtonGroup";
import { useTheme } from "../../theme/ThemeProvider";

export function IconButton({ name, variant = "tonal", color, style, ...props }: Omit<PressableProps, "style" | "children"> & {
  name: keyof typeof MaterialIcon.glyphMap;
  variant?: "standard" | "filled" | "tonal" | "outlined";
  color?: string; style?: StyleProp<ViewStyle>;
}) {
  const { palette, expressive } = useTheme();
  const grouped = useButtonGroupInteraction() != null;
  const foreground = props.disabled ? `${palette.onSurface}61` : variant === "filled" ? palette.onPrimary
    : variant === "tonal" ? palette.onSecondaryContainer : color ?? palette.onSurfaceVariant;
  const background = props.disabled && (variant === "filled" || variant === "tonal") ? `${palette.onSurface}1f` : variant === "filled" ? palette.primary
    : variant === "tonal" ? palette.secondaryContainer : "transparent";
  return <View style={[{ width: grouped ? "100%" : 48, height: 48, padding: 4, flexShrink: 0 }, style]}>
    <PressableScale {...props} accessibilityRole={props.accessibilityRole ?? "button"}
    stateLayerColor={foreground} shape={{ rest: 20, pressed: expressive ? 8 : 20 }}
    hitSlop={props.hitSlop ?? 4}
    style={{ width: "100%", height: 40, borderRadius: 20,
      backgroundColor: background, borderWidth: variant === "outlined" ? 1 : 0, borderColor: palette.outline,
      alignItems: "center", justifyContent: "center" }}>
    <MaterialIcon name={name} size={24} color={foreground} />
    </PressableScale>
  </View>;
}
