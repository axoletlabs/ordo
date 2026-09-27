import React from "react";
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { columnContentInset } from "../../theme/alignment";
import { layout } from "../../theme/tokens";

interface ScreenContentProps {
  children: React.ReactNode;
  maxWidth?: number;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A centered content column that also protects landscape display cutouts. */
export function ScreenContent({
  children,
  maxWidth = layout.maxContentWidth,
  padded = true,
  style,
}: ScreenContentProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <View
      style={[
        styles.content,
        {
          maxWidth,
          paddingLeft: padded ? columnContentInset(insets.left, width, maxWidth) : insets.left,
          paddingRight: padded ? columnContentInset(insets.right, width, maxWidth) : insets.right,
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
