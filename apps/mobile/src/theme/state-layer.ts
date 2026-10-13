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

/**
 * Bake the state fraction into the color itself. A resting element must never
 * carry a sub-1 opacity: the compositor then distorts its radius clip and the
 * feedback stops matching the surface (seen as a squared-off hover cap).
 * "transparent" and unknown formats pass through unchanged.
 */
export function alphaTint(color: string, fraction: number): string {
  if (color === "transparent") return "transparent";
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!hex) return color;
  const alpha = Math.round(Math.min(1, Math.max(0, fraction || 0)) * 255).toString(16).padStart(2, "0");
  return `#${hex[1]}${alpha}`;
}
