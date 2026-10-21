/**
 * List-row pressable. Avoids Reanimated (PressableScale mounts two animated
 * views per bookmark row and stutters once a couple dozen are on screen).
 */
import React from "react";
import { Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { StateLayer } from "./StateLayer";
import { stateLayerOpacity } from "../../theme/state-layer";
import { webSelectionKeys, type WebPressKeyEvent } from "./pressable-web";
import { nativeHoverEvents } from "../../lib/pointer-hover";

export function ListPressable({ style, children, feedback = true, ...rest }: PressableProps & { feedback?: boolean; dataSet?: Record<string, string>; onKeyDown?: (event: WebPressKeyEvent) => void }) {
  const { palette } = useTheme();
  // Rows that paint their own full-bleed highlight pass feedback={false}. They
  // gain nothing from a second hover state machine (and used to re-render both
  // list pressables on every pointer crossing); keep only the keyboard focus
  // ring. `focused` doubles as focus-visible on web.
  const tracksHover = feedback && !rest.disabled;
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  return (
    <Pressable
      {...rest}
      {...(Platform.OS === "web" && feedback ? { dataSet: { ...rest.dataSet, materialHoverSurface: "true" } } : {})}
      {...(Platform.OS === "web" ? webSelectionKeys({ role: rest.role, accessibilityRole: rest.accessibilityRole, disabled: rest.disabled, onKeyDown: rest.onKeyDown, onPress: rest.onPress }) : {})}
      {...(Platform.OS !== "web" && tracksHover ? nativeHoverEvents({ disabled: rest.disabled,
        onPointerEnter: rest.onPointerEnter, onPointerLeave: rest.onPointerLeave,
        onHoverIn: rest.onHoverIn, onHoverOut: rest.onHoverOut }, setHovered) : {})}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-expanded={rest.accessibilityState?.expanded}
      aria-busy={rest.accessibilityState?.busy}
      aria-disabled={rest.disabled || rest.accessibilityState?.disabled}
      onFocus={(event) => { setFocused(Platform.OS !== "web" || !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible")); rest.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); setHovered(false); rest.onBlur?.(event); }}
      {...(tracksHover ? {
        onHoverIn: (event: Parameters<NonNullable<PressableProps["onHoverIn"]>>[0]) => { setHovered(true); rest.onHoverIn?.(event); },
        onHoverOut: (event: Parameters<NonNullable<PressableProps["onHoverOut"]>>[0]) => { setHovered(false); rest.onHoverOut?.(event); },
      } : {})}
      android_ripple={{ color: "transparent", borderless: false }}
      style={(state) => [typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>,
        focused && Platform.OS === "web" ? { outlineColor: palette.primary, outlineWidth: 2, outlineOffset: -2, outlineStyle: "solid" } : null]}
    >
      {state => {
        const flat = feedback ? StyleSheet.flatten(typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>) : undefined;
        return <>{typeof children === "function" ? children(state) : children}
          {feedback ? <StateLayer testID="material-list-state-layer" color={palette.onSurface} surfaceStyle={flat}
            fraction={stateLayerOpacity({ disabled: rest.disabled, pressed: state.pressed, focused, hovered })} /> : null}</>;
      }}
    </Pressable>
  );
}
