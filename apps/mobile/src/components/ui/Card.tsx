/** Material outlined and elevated cards. */
import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing, type Radius } from "../../theme/tokens";

export interface CardProps extends ViewProps {
  pad?: keyof typeof spacing;
  radiusKey?: Radius;
  elevated?: boolean;
}

export function Card({ pad = 16, radiusKey = "md", elevated, style, children, ...rest }: CardProps) {
  const { palette, shadows } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? palette.surfaceContainerLow : palette.surface,
          borderColor: palette.outlineVariant,
          borderRadius: radius[radiusKey],
          padding: spacing[pad],
          ...(elevated ? shadows.level1 : {}),
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
});
