/**
 * List-row pressable. Avoids Reanimated (PressableScale mounts two animated
 * views per bookmark row and stutters once a couple dozen are on screen).
 */
import React from "react";
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";

export function ListPressable({ style, children, feedback = true, ...rest }: PressableProps & { feedback?: boolean }) {
  const { palette } = useTheme();
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  return (
    <Pressable
      {...rest}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-disabled={rest.disabled || rest.accessibilityState?.disabled}
      onFocus={(event) => { setFocused(Platform.OS === "web" && !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible")); rest.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); rest.onBlur?.(event); }}
      onHoverIn={(event) => { setHovered(true); rest.onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); rest.onHoverOut?.(event); }}
      android_ripple={feedback ? { color: `${palette.onSurface}1a` } : undefined}
      style={(state) => [typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>,
        focused ? { outlineColor: palette.primary, outlineWidth: 2, outlineOffset: -2, outlineStyle: "solid" } : null]}
    >
      {state => {
        const flat = StyleSheet.flatten(typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>);
        return <>{typeof children === "function" ? children(state) : children}
          {feedback ? <View testID="material-list-state-layer" pointerEvents="none" style={[StyleSheet.absoluteFill, {
            borderRadius: flat?.borderRadius ?? 0,
            borderTopLeftRadius: flat?.borderTopLeftRadius ?? flat?.borderRadius ?? 0,
            borderTopRightRadius: flat?.borderTopRightRadius ?? flat?.borderRadius ?? 0,
            borderBottomLeftRadius: flat?.borderBottomLeftRadius ?? flat?.borderRadius ?? 0,
            borderBottomRightRadius: flat?.borderBottomRightRadius ?? flat?.borderRadius ?? 0,
            backgroundColor: palette.onSurface,
            opacity: rest.disabled ? 0 : (state.pressed && Platform.OS !== "android") || focused ? 0.1 : hovered ? 0.08 : 0,
          }]} /> : null}</>;
      }}
    </Pressable>
  );
}
