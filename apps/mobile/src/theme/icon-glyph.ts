import type { TextStyle } from "react-native";

/**
 * Locks an Ionicons glyph to its em-square.
 *
 * On Android the default font padding makes the drawn icon taller than
 * `size` and shifts the ink down. Menus, checks, and panel icons pass this
 * so the visible mark sits in the box the layout measured.
 */
export function iconGlyphStyle(size: number): TextStyle {
  return {
    width: size,
    height: size,
    lineHeight: size,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  };
}
