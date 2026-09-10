/** Lock / session-unlock glyph for folder lists and pickers. */
import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeProvider";

export function FolderLockIcon({
  unlocked,
  size = 12,
  outline = false,
  style,
}: {
  unlocked: boolean;
  size?: number;
  outline?: boolean;
  style?: ComponentProps<typeof Ionicons>["style"];
}) {
  const { palette } = useTheme();
  return (
    <Ionicons
      name={
        unlocked
          ? outline
            ? "lock-open-outline"
            : "lock-open"
          : outline
            ? "lock-closed-outline"
            : "lock-closed"
      }
      size={size}
      color={unlocked ? palette.success : palette.textTertiary}
      style={style}
      accessible={false}
    />
  );
}
