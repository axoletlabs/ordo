/** Material push-pin for saved collections, with legacy action-name compatibility. */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { MaterialIcon } from "./MaterialIcon";
export function PinIcon({ size = 16, color, style }: { size?: number; color: string; filled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={style}><MaterialIcon name="pin" size={size} color={color} accessible={false} /></View>;
}
export function AppIcon({ name, size, color }: { name: keyof typeof MaterialIcon.glyphMap; size: number; color: string }) {
  return <MaterialIcon name={name} size={size} color={color} accessible={false} />;
}
