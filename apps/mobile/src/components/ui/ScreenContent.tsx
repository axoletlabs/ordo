import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding, type ColumnAlign } from "../../hooks/use-scene-column-insets";
import { layout } from "../../theme/tokens";

interface ScreenContentProps {
  children: React.ReactNode;
  maxWidth?: number;
  padded?: boolean;
  /** See `Header` `alignTo`. Nested panes pass `parent`. */
  alignTo?: ColumnAlign;
  style?: StyleProp<ViewStyle>;
}

/** A centered content column that also protects landscape display cutouts. */
export function ScreenContent({
  children,
  maxWidth = layout.maxContentWidth,
  padded = true,
  alignTo = "scene",
  style,
}: ScreenContentProps) {
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxWidth, alignTo);

  return (
    <View
      style={[
        styles.content,
        {
          maxWidth,
          paddingLeft: padded ? column.left : insets.left,
          paddingRight: padded ? column.right : insets.right,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
});
