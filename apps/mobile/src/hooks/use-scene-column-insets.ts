/** Safe-area-aware Material content rails for full-window and embedded layouts. */
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SCREEN_RAIL, columnContentInset } from "../theme/alignment";
export type ColumnAlign = "scene" | "window" | "parent";
export function useSceneColumnInsets(_alignTo: ColumnAlign = "scene") {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return {
    sceneWidth: width, lead: 0,
    leading(maxWidth: number) { return columnContentInset(insets.left, width, maxWidth); },
    trailing(maxWidth: number) { return columnContentInset(insets.right, width, maxWidth); },
  };
}
export function useColumnPadding(maxWidth: number, alignTo: ColumnAlign = "scene") {
  const scene = useSceneColumnInsets(alignTo);
  return {
    left: alignTo === "parent" ? SCREEN_RAIL : scene.leading(maxWidth),
    right: alignTo === "parent" ? SCREEN_RAIL : scene.trailing(maxWidth),
    sceneWidth: scene.sceneWidth, lead: 0,
  };
}
