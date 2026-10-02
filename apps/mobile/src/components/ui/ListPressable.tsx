/**
 * List-row pressable. Avoids Reanimated (PressableScale mounts two animated
 * views per bookmark row and stutters once a couple dozen are on screen).
 */
import React from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";

export function ListPressable({ style, children, ...rest }: PressableProps) {
  const { palette } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      {...rest}
      aria-checked={rest.accessibilityState?.checked}
      aria-selected={rest.accessibilityState?.selected}
      aria-disabled={rest.disabled || rest.accessibilityState?.disabled}
      onFocus={(event) => { setFocused(true); rest.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); rest.onBlur?.(event); }}
      android_ripple={{ color: `${palette.primary}1f` }}
      style={(state) => [typeof style === "function" ? style(state) : style as StyleProp<ViewStyle>,
        state.pressed ? { backgroundColor: `${palette.onSurface}14` } : null,
        focused ? { outlineColor: palette.primary, outlineWidth: 2, outlineOffset: -2 } : null]}
    >
      {children}
    </Pressable>
  );
}
