/** A consistent, full-width entry into folder, tag, and icon selection. */
import React, { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialIcon } from "./MaterialIcon";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { InputSurfaceContext } from "./input-surface";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";

export function PickerField({ label, value, icon, onPress, dropdown = false, expanded = false }: {
  label: string; value: string; icon: keyof typeof MaterialIcon.glyphMap; onPress: (anchor: MenuAnchorRect) => void;
  dropdown?: boolean; expanded?: boolean;
}) {
  const { palette } = useTheme();
  const surface = React.useContext(InputSurfaceContext) ?? palette.surface;
  const anchorRef = useRef<View>(null);
  return <View ref={anchorRef} collapsable={false} style={{ paddingTop: spacing[8] }}>
    <PressableScale accessibilityRole="button" accessibilityLabel={`${label}, ${value}`}
      accessibilityState={{ expanded }} aria-haspopup={dropdown ? "menu" : "dialog"}
      accessibilityHint={`Choose ${label.toLocaleLowerCase()}.`} onPress={(event) => measureAnchor(anchorRef.current, onPress, event)}
      stateLayerColor={palette.onSurface}
      style={[styles.field, { backgroundColor: surface, borderColor: expanded ? palette.primary : palette.outline }]}>
      <MaterialIcon name={icon} size={24} color={palette.onSurfaceVariant} />
      <Text variant="bodyLarge" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{value}</Text>
      <MaterialIcon name={dropdown ? expanded ? "chevron-up" : "chevron-down" : "chevron-forward"} size={24} color={palette.onSurfaceVariant} />
    </PressableScale>
    <View pointerEvents="none" style={[styles.label, { backgroundColor: surface }]}>
      <Text variant="bodySmall" style={{ color: expanded ? palette.primary : palette.onSurfaceVariant }}>{label}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  field: { minHeight: 56, borderWidth: 1, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: spacing[16], paddingHorizontal: spacing[12] },
  label: { position: "absolute", top: 0, left: 48, paddingHorizontal: spacing[4] },
});
