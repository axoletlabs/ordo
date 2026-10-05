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
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  return (
    <Pressable
      {...rest}
      {...(Platform.OS === "web" && feedback ? { dataSet: { ...rest.dataSet, materialHoverSurface: "true" } } : {})}
      {...(Platform.OS === "web" ? webSelectionKeys(rest) : {})}
      {...(Platform.OS !== "web" ? nativeHoverEvents(rest, setHovered) : {})}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-disabled={rest.disabled || rest.accessibilityState?.disabled}
      onFocus={(event) => { setFocused(Platform.OS === "web" && !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible")); rest.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); rest.onBlur?.(event); }}
      onHoverIn={(event) => { setHovered(true); rest.onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); rest.onHoverOut?.(event); }}
      android_ripple={{ color: "transparent", borderless: false }}
      style={(state) => [typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>,
        focused ? { outlineColor: palette.primary, outlineWidth: 2, outlineOffset: -2, outlineStyle: "solid" } : null]}
    >
      {state => {
        const flat = StyleSheet.flatten(typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>);
        return <>{typeof children === "function" ? children(state) : children}
          {feedback ? <StateLayer testID="material-list-state-layer" color={palette.onSurface} surfaceStyle={flat}
            opacity={stateLayerOpacity({ disabled: rest.disabled, pressed: state.pressed, focused, hovered })} /> : null}</>;
      }}
    </Pressable>
  );
}
