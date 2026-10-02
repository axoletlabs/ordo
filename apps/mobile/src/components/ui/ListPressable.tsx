/**
 * List-row pressable. Avoids Reanimated (PressableScale mounts two animated
 * views per bookmark row and stutters once a couple dozen are on screen).
 */
import React from "react";
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";

export function ListPressable({ style, children, feedback = true, ...rest }: PressableProps & { feedback?: boolean }) {
  const { palette } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      {...rest}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-disabled={rest.disabled || rest.accessibilityState?.disabled}
      onFocus={(event) => { setFocused(Platform.OS === "web" && !!(event.currentTarget as unknown as HTMLElement)?.matches?.(":focus-visible")); rest.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); rest.onBlur?.(event); }}
      android_ripple={feedback ? { color: `${palette.onSurface}1f` } : undefined}
      style={(state) => [typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>,
        feedback && state.pressed ? { backgroundColor: `${palette.onSurface}1f` } : null,
        focused ? { outlineColor: palette.primary, outlineWidth: 2, outlineOffset: -2, outlineStyle: "solid" } : null]}
    >
      {children}
    </Pressable>
  );
}
