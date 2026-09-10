/**
 * Themed text input faithful to ordo-archive: tiny uppercase label, 1px line
 * border, coral 1.5px focus ring, radius 8. URLs/mono handled by the caller via
 * a `mono` flag (JetBrains Mono).
 */
import React, { useState } from "react";
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
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
  /** Sit the accessory on top of the field so empty space still focuses the input. */
  overlayRightAccessory?: boolean;
  /** Skip measuring the overlay; avoids TextInput padding jumps while typing. */
  overlayPaddingRight?: number;
  mono?: boolean;
  containerStyle?: ViewStyle;
}

export const Input = React.forwardRef<TextInput, InputProps>(function Input({
  label,
  error,
  helper,
  icon,
  rightAccessory,
  overlayRightAccessory,
  overlayPaddingRight,
  mono,
  containerStyle,
  onFocus,
  onBlur,
  onChange,
  onChangeText,
  secureTextEntry,
  keyboardType,
  ...rest
}, ref) {
  const { palette } = useTheme();
  const [focused, setFocused] = useState(false);
  const [overlayWidth, setOverlayWidth] = useState(0);

  const borderColor = error ? palette.danger : focused ? palette.accent : palette.border;
  const borderWidth = error ? 1 : focused ? 1.5 : 1;
  // iOS Password AutoFill silently ignores secure fields that use a custom
  // font. Use the system face while the value is masked.
  const fontFamily = secureTextEntry
    ? undefined
    : mono
      ? resolveFont("mono", "400")
      : resolveFont("sans", "400");
  const overlay = overlayRightAccessory && !!rightAccessory;
  const padRight =
    overlayPaddingRight != null
      ? overlayPaddingRight
      : overlay && overlayWidth > 0
        ? overlayWidth + spacing[8]
        : undefined;
  // RN-web maps keyboardType="url" onto <input type="url">, whose caret
  // walks one extra character on Backspace. Keep a URL keyboard on native.
  const resolvedKeyboardType =
    Platform.OS === "web" && keyboardType === "url" ? "default" : keyboardType;
  const webCaretFix =
    Platform.OS === "web"
      ? ({
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        } as TextStyle)
      : null;

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
          keyboardType={resolvedKeyboardType}
          {...rest}
          {...(Platform.OS === "web" ? { dir: "ltr" as const } : null)}
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
            {
              color: palette.text,
              fontFamily,
              writingDirection: "ltr",
            },
            webCaretFix,
            padRight != null ? { paddingRight: padRight } : null,
          ]}
        />
        {rightAccessory ? (
          <View
            pointerEvents={overlay ? "box-none" : "auto"}
            onLayout={
              overlay && overlayPaddingRight == null
                ? (event) => {
                    const width = Math.ceil(event.nativeEvent.layout.width);
                    setOverlayWidth((current) => (current === width ? current : width));
                  }
                : undefined
            }
            style={overlay ? styles.rightOverlay : styles.right}
          >
            {rightAccessory}
          </View>
        ) : null}
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
  rightOverlay: {
    position: "absolute",
    right: spacing[12],
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  msg: { marginTop: spacing[6] },
});
