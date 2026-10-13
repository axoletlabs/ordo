/** Material contextual top app bar. */
import React from "react";
import { Header, HeaderActions, HeaderIconButton } from "../ui/Header";
import { useTheme } from "../../theme/ThemeProvider";
import { layout } from "../../theme/tokens";
import { View } from "react-native";
import { Text } from "../ui/Text";
export function SelectionHeader({ count, selectableCount, onCancel, onToggleSelectAll, maxWidth = layout.maxContentWidth, embedded = false }: {
  count: number; selectableCount: number; onCancel: () => void; onToggleSelectAll: () => void; maxWidth?: number;
  embedded?: boolean;
}) {
  const { palette } = useTheme();
  const all = selectableCount > 0 && count === selectableCount;
  const title = count ? `${count} selected` : "Select items";
  if (embedded) return <View style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 28, backgroundColor: palette.secondaryContainer, paddingHorizontal: 4 }}>
    <HeaderIconButton name="close" color={palette.onSecondaryContainer} onPress={onCancel} accessibilityLabel="Cancel selection" />
    <Text variant="titleLarge" numberOfLines={1} style={{ flex: 1, color: palette.onSecondaryContainer }}>{title}</Text>
    {selectableCount > 0 ? <HeaderIconButton name={all ? "checkbox" : "square-outline"} color={palette.onSecondaryContainer}
      onPress={onToggleSelectAll} accessibilityLabel={all ? "Deselect all" : "Select all"} /> : null}
  </View>;
  return <Header title={title} showBack onBack={onCancel} maxWidth={maxWidth}
    right={<HeaderActions>{selectableCount > 0 ? <HeaderIconButton name={all ? "checkbox" : "square-outline"}
      color={palette.primary} onPress={onToggleSelectAll} accessibilityLabel={all ? "Deselect all" : "Select all"} /> : null}</HeaderActions>} />;
}
