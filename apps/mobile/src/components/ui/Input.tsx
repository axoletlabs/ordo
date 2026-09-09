/**
 * Themed text input faithful to ordo-archive: tiny uppercase label, 1px line
 * border, coral 1.5px focus ring, radius 8. URLs/mono handled by the caller via
 * a `mono` flag (JetBrains Mono).
 */
import React, { useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, spacing } from "../../theme/tokens";
import { resolveFont } from "../../theme/tokens";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string;
  helper?: string;
  icon?: React.ReactNode;
  rightAccessory?: React.ReactNode;
  mono?: boolean;
  containerStyle?: ViewStyle;
}

export const Input = React.forwardRef<TextInput, InputProps>(function Input({
  label,
  error,
  helper,
  icon,
  rightAccessory,
  mono,
  containerStyle,
  onFocus,
  onBlur,
  onChange,
  onChangeText,
  secureTextEntry,
  ...rest
}, ref) {
  const { palette } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? palette.danger : focused ? palette.accent : palette.border;
  const borderWidth = error ? 1 : focused ? 1.5 : 1;
  // iOS Password AutoFill silently ignores secure fields that use a custom
  // font. Use the system face while the value is masked.
  const fontFamily = secureTextEntry
    ? undefined
    : mono
      ? resolveFont("mono", "400")
      : resolveFont("sans", "400");

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="label" color={error ? "danger" : "tertiary"} style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: palette.background,
            borderColor,
            borderWidth,
            borderRadius: radius.sm,
          },
        ]}
      >
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={palette.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          secureTextEntry={secureTextEntry}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          onChange={onChange}
          onChangeText={onChangeText}
          style={[
            styles.input,
            { color: palette.text, fontFamily },
          ]}
        />
        {rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
      </View>
      {error ? (
        <Text variant="footnote" color="danger" style={styles.msg}>
          {error}
        </Text>
      ) : helper ? (
        <Text variant="footnote" color="tertiary" style={styles.msg}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { marginBottom: spacing[6] },
  box: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[12],
    minHeight: 46,
  },
  icon: { marginRight: spacing[8] },
  input: { flex: 1, paddingVertical: spacing[10], fontSize: 13 },
  right: { marginLeft: spacing[8] },
  msg: { marginTop: spacing[6] },
});
