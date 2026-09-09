/**
 * Thumbtack for pinned folders. Ionicons `pin` is a map marker, so it reads
 * as a location rather than "kept at the top".
 */
import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";

/** Lucide pin body — T-bar head with flared collar. */
const BODY =
  "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 7 17h10a2 2 0 0 0 1.11-3.55l-1.78-.9A2 2 0 0 1 15 10.76V7a1 2 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 2 0 0 1 1 1z";
const NEEDLE_STROKE = "M12 17v5";
const NEEDLE_FILL = "M11 16.25h2V21a1 1 0 0 1-2 0z";

export function PinIcon({
  size = 16,
  color,
  filled = true,
  style,
}: {
  size?: number;
  color: string;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      accessible={false}
      importantForAccessibility="no"
    >
      {filled ? (
        <>
          <Path d={BODY} fill={color} />
          <Path d={NEEDLE_FILL} fill={color} />
        </>
      ) : (
        <>
          <Path
            d={BODY}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d={NEEDLE_STROKE}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

/** Ionicons wrapper that swaps map-pin glyphs for the thumbtack. */
export function AppIcon({
  name,
  size,
  color,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size: number;
  color: string;
}) {
  if (name === "pin" || name === "pin-outline") {
    return <PinIcon size={size} color={color} filled={name === "pin"} />;
  }
  return <Ionicons name={name} size={size} color={color} />;
}
