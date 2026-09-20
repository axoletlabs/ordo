/**
 * Themed text input faithful to ordo-archive: tiny uppercase label, 1px line
 * border, coral 1.5px focus ring, radius 8. URLs/mono handled by the caller via
 * a `mono` flag (JetBrains Mono).
 */
import React, { useLayoutEffect, useRef, useState } from "react";
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
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { caretAfterKey, shouldCorrectWebCaret } from "../../lib/web-input-caret";

type WebCaretNode = TextInput & {
  selectionStart?: number | null;
  selectionEnd?: number | null;
  setSelectionRange?: (start: number, end: number) => void;
  value?: string;
};

function webCaretNode(value: unknown): WebCaretNode | null {
  if (!value || typeof (value as WebCaretNode).setSelectionRange !== "function") return null;
  return value as WebCaretNode;
}

function restoreWebCaret(node: WebCaretNode | null, start: number | null) {
  if (node == null || start == null) return;
  try {
    node.setSelectionRange?.(start, start);
  } catch {
    // Some input types throw if selection isn't supported.
  }
}

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
  onKeyPress,
  secureTextEntry,
  keyboardType,
  value,
  editable = true,
  ...rest
}, ref) {
  const { palette } = useTheme();
  const [focused, setFocused] = useState(false);
  const [overlayWidth, setOverlayWidth] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const pendingCaret = useRef<number | null>(null);
  const focusedRef = useRef(false);
  const lastAppliedValue = useRef(value);
  const [androidEpoch, setAndroidEpoch] = useState(0);
  // Android re-applies a controlled `value` on every keystroke and walks the
  // caret (type/backspace in the middle). Leave the native field uncontrolled
  // while editing; remount when an external value arrives while blurred.
  const androidUncontrolled = Platform.OS === "android" && !secureTextEntry;

  const setInputRef = (node: TextInput | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const start = pendingCaret.current;
    if (start == null) return;
    restoreWebCaret(webCaretNode(inputRef.current), start);
    pendingCaret.current = null;
  });

  useLayoutEffect(() => {
    if (!androidUncontrolled) return;
    if (focusedRef.current) return;
    if (value === lastAppliedValue.current) return;
    lastAppliedValue.current = value;
    setAndroidEpoch((n) => n + 1);
  }, [androidUncontrolled, value]);

  const borderColor = error ? palette.danger : focused ? palette.accent : palette.border;
  const borderWidth = error ? 1 : focused ? 1.5 : 1;
  // iOS Password AutoFill silently ignores secure fields that use a custom
  // font. Use the system face while the value is masked.
  const fontFamily = secureTextEntry
    ? undefined
    : mono && Platform.OS !== "android"
      ? resolveFont("mono", "400")
      : resolveFont("sans", "400");
  const overlay = overlayRightAccessory && !!rightAccessory;
  const padRight =
    overlayPaddingRight != null
      ? overlayPaddingRight
      : overlay && overlayWidth > 0
        ? overlayWidth + spacing[8]
        : undefined;
  // RN-web maps keyboardType="url" onto <input type="url">; Android's URI
  // variation walks the caret the same way. Keep a URL keyboard on iOS only.
  const resolvedKeyboardType =
    Platform.OS !== "ios" && keyboardType === "url" ? "default" : keyboardType;
  const webCaretFix =
    Platform.OS === "web"
      ? ({
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
          unicodeBidi: "normal",
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
          ref={setInputRef}
          key={androidUncontrolled ? `android-field-${androidEpoch}` : undefined}
          placeholderTextColor={palette.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          secureTextEntry={secureTextEntry}
          keyboardType={resolvedKeyboardType}
          underlineColorAndroid="transparent"
          editable={editable}
          {...rest}
          {...(Platform.OS === "web" ? { dir: "ltr" as const } : null)}
          {...(androidUncontrolled
            ? { defaultValue: typeof value === "string" ? value : undefined }
            : { value })}
          onFocus={(e) => {
            focusedRef.current = true;
            lastAppliedValue.current = value;
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            focusedRef.current = false;
            lastAppliedValue.current = value;
            setFocused(false);
            onBlur?.(e);
          }}
          onKeyPress={(event) => {
            if (Platform.OS === "web") {
              const native = event.nativeEvent as typeof event.nativeEvent & {
                metaKey?: boolean;
                ctrlKey?: boolean;
                altKey?: boolean;
                isComposing?: boolean;
                keyCode?: number;
              };
              if (shouldCorrectWebCaret(native)) {
                const node = webCaretNode(inputRef.current);
                const start = node?.selectionStart ?? 0;
                const end = node?.selectionEnd ?? start;
                pendingCaret.current = caretAfterKey(start, end, native.key);
              } else {
                pendingCaret.current = null;
              }
            }
            onKeyPress?.(event);
          }}
          onChange={(event) => {
            onChange?.(event);
            if (Platform.OS !== "web") return;
            const target = (event.target ?? event.nativeEvent?.target) as WebCaretNode | undefined;
            // Autofill writes locked fields even when they aren't focused.
            // Put the controlled value back so the DOM can't drift.
            if (!editable && target && typeof value === "string" && target.value !== value) {
              target.value = value;
            }
            restoreWebCaret(webCaretNode(target), pendingCaret.current);
          }}
          onChangeText={editable ? onChangeText : undefined}
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
  input: {
    flex: 1,
    paddingVertical: spacing[10],
    fontSize: fontSize.md,
    ...Platform.select({
      android: { includeFontPadding: false, textAlignVertical: "center" as const },
      default: {},
    }),
  },
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
