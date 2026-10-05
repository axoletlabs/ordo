/** State feedback follows the painted surface, not an unrelated touch shape. */
import type { ViewStyle } from "react-native";
type SurfaceShape = Pick<ViewStyle, "borderRadius" | "borderTopLeftRadius" | "borderTopRightRadius" | "borderBottomLeftRadius" | "borderBottomRightRadius">;

export function stateLayerCorners(style?: SurfaceShape) {
  const radius = style?.borderRadius ?? 0;
  // Longhands only: mixing shorthand and explicit/undefined corners can reset
  // grouped shapes differently on native and web.
  return {
    borderTopLeftRadius: style?.borderTopLeftRadius ?? radius,
    borderTopRightRadius: style?.borderTopRightRadius ?? radius,
    borderBottomLeftRadius: style?.borderBottomLeftRadius ?? radius,
    borderBottomRightRadius: style?.borderBottomRightRadius ?? radius,
  };
}

export function stateLayerOpacity({ disabled, pressed, focused, hovered }: {
  disabled?: boolean | null; pressed?: boolean; focused?: boolean; hovered?: boolean;
}) {
  return disabled ? 0 : pressed || focused ? 0.1 : hovered ? 0.08 : 0;
}
