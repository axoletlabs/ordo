/** Navigation links keep a full Material target and shared keyboard feedback. */
import React from "react";
import { Link, type Href } from "expo-router";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";

export function AuthLink({ href, label, replace = false }: { href: Href; label: string; replace?: boolean }) {
  const { palette } = useTheme();
  return <Link href={href} replace={replace} asChild>
    <PressableScale accessibilityRole="link" accessibilityLabel={label} stateLayerColor={palette.primary}
      style={{ minHeight: layout.touchTargetMin, minWidth: layout.touchTargetMin, paddingHorizontal: spacing[8],
        justifyContent: "center", alignItems: "center", borderRadius: radius.full }}>
      <Text variant="labelLarge" color="accent">{label}</Text>
    </PressableScale>
  </Link>;
}
