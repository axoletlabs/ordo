/** Lock / session-unlock glyph for folder lists and pickers. Unlocked folders show a key. */
import type { ComponentProps } from "react";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { iconGlyphStyle } from "../../theme/icon-glyph";
import { ROW_STATUS_ICON_SIZE } from "./RowStatusIcon";

export function FolderLockIcon({
  unlocked,
  size = ROW_STATUS_ICON_SIZE,
  outline = true,
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
            ? "key-outline"
            : "key"
          : outline
            ? "lock-closed-outline"
            : "lock-closed"
      }
      size={size}
      color={palette.textTertiary}
      style={[iconGlyphStyle(size), style]}
      accessible={false}
    />
  );
}
