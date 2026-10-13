/** Material filled / outlined / search fields, preserving native editing and autofill. */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { StateLayer } from "./StateLayer";
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
import { MaterialIcon } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { caretAfterKey, shouldCorrectWebCaret } from "../../lib/web-input-caret";
import { useMaterialMotion } from "../../theme/material-motion";
import { InputSurfaceContext } from "./input-surface";
import { nativeInputEdit } from "../../lib/native-input-edit";
import { alphaTint } from "../../theme/state-layer";
const AnimatedLabel = Animated.createAnimatedComponent(Text);

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
  variant?: "filled" | "outlined" | "search";
  containerStyle?: ViewStyle;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Hide repeated visual markers when every field in the form is required. Semantics remain required. */
  showRequiredIndicator?: boolean;
  showCounter?: boolean;
  reserveSupportingSpace?: boolean;
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
  variant = "filled",
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
  disabled = false,
  readOnly = false,
  required = false,
  showRequiredIndicator = true,
  showCounter = false,
  reserveSupportingSpace = !!label,
  ...rest
}, ref) {
  const { palette } = useTheme();
  const messageId = React.useId();
  const fieldSurface = React.useContext(InputSurfaceContext) ?? palette.surface;
  const motion = useMaterialMotion();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inactive = disabled || (!editable && !readOnly);
  const canEdit = !inactive && !readOnly;
  const indicateRequired = required && showRequiredIndicator;
  const displayLabel = label && indicateRequired ? `${label} *` : label;
  const support = error ?? (helper ? indicateRequired ? `${helper} * Required` : helper : indicateRequired ? "* Required" : undefined);
  const foreground = inactive ? alphaTint(palette.onSurface, 0.38) : palette.onSurface;
  const [hasText, setHasText] = useState(!!value);
  const [overlayWidth, setOverlayWidth] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const accessoryRef = useRef<View>(null);
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
    // aria-hidden alone doesn't remove trailing actions from keyboard navigation.
    if (Platform.OS === "web" && accessoryRef.current) (accessoryRef.current as unknown as HTMLElement).inert = inactive;
  }, [inactive, rightAccessory]);

  useLayoutEffect(() => {
    if (!androidUncontrolled) return;
    const edit = nativeInputEdit(value, lastAppliedValue.current, focusedRef.current);
    if (edit === "none") return;
    lastAppliedValue.current = value;
    setHasText(!!value);
    if (edit === "replace") {
      // Clipboard/clear actions are external edits, not another controlled echo
      // of the keystroke. Apply them without remounting or dismissing the IME.
      const text = value ?? "";
      inputRef.current?.setNativeProps({ text, selection: { start: text.length, end: text.length } });
    } else setAndroidEpoch((n) => n + 1);
  }, [androidUncontrolled, value]);

  const search = variant === "search";
  const filled = variant === "filled";
  const leadingIcon = React.isValidElement<React.ComponentProps<typeof MaterialIcon>>(icon) && icon.type === MaterialIcon
    ? React.cloneElement(icon, { size: 24, style: [icon.props.style, { width: 24, height: 24 }] }) : icon;
  const borderColor = inactive ? alphaTint(palette.onSurface, 0.12) : error ? palette.error : focused ? palette.primary : hovered ? palette.onSurface : palette.outline;
  const borderWidth = search ? 0 : focused && !inactive ? 2 : 1;
  const floating = focused || hasText || !!value;
  const floatProgress = useSharedValue(floating ? 1 : 0);
  useEffect(() => {
    floatProgress.value = withTiming(floating ? 1 : 0, { duration: motion.reducedMotion ? 0 : 150 });
  }, [floating, floatProgress, motion.reducedMotion]);
  const labelPosition = useAnimatedStyle(() => ({ top: 16 - (filled ? 8 : 24) * floatProgress.value }));
  const labelType = useAnimatedStyle(() => ({ fontSize: 16 - 4 * floatProgress.value, lineHeight: 24 - 8 * floatProgress.value }));
  // iOS Password AutoFill silently ignores secure fields that use a custom
  // font. Use the system face while the value is masked.
  const fontFamily = secureTextEntry
    ? undefined
    : mono && Platform.OS !== "android"
      ? resolveFont("mono", "400")
      : resolveFont("sans", "400");
  const overlay = overlayRightAccessory && !!rightAccessory && !error;
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
    <View style={[label && !filled && !search ? { paddingTop: 8 } : null, containerStyle]}>
      <View
        onPointerEnter={(event) => { if (event.nativeEvent.pointerType !== "touch") setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => { if (!inactive && event.target === event.currentTarget) inputRef.current?.focus(); }}
        onStartShouldSetResponder={(event) => !inactive && event.target === event.currentTarget}
        onResponderRelease={() => { if (!inactive) inputRef.current?.focus(); }}
        style={[
          styles.box,
          {
            backgroundColor: inactive && filled ? alphaTint(palette.onSurface, 0.04) : search ? palette.surfaceContainerHigh : filled ? palette.surfaceContainerHighest : fieldSurface,
            paddingHorizontal: icon && !search ? spacing[12] : spacing[16],
            borderRadius: search ? radius.full : filled ? 0 : radius.sm,
            ...(filled ? { borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs } : {}),
          },
        ]}
      >
        <StateLayer testID="material-field-hover" color={palette.onSurface} fraction={hovered && !inactive ? 0.08 : 0}
          surfaceStyle={{ borderRadius: search ? radius.full : filled ? 0 : radius.sm,
            ...(filled ? { borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs } : {}) }} />
        {search && focused ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderColor, borderWidth: 2, borderRadius: radius.full }]} /> : null}
        {filled ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: borderWidth, backgroundColor: borderColor }} />
          : !search ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderColor, borderWidth, borderRadius: radius.sm }]} /> : null}
        {label ? <Animated.View pointerEvents="none" style={[styles.floatingLabel, {
          left: icon ? 48 : 12,
          backgroundColor: filled || search ? "transparent" : fieldSurface,
        }, labelPosition]}>
          <AnimatedLabel variant="bodyLarge" style={[{ color: inactive ? foreground : error ? palette.error : focused ? palette.primary : palette.onSurfaceVariant }, labelType]}>{displayLabel}</AnimatedLabel>
        </Animated.View> : null}
        {icon ? <View pointerEvents="none" style={[styles.icon, inactive ? { opacity: 0.38 } : null]}>{leadingIcon}</View> : null}
        <TextInput
          ref={setInputRef}
          key={androidUncontrolled ? `android-field-${androidEpoch}` : undefined}
           placeholderTextColor={inactive ? foreground : palette.onSurfaceVariant}
          autoCorrect={false}
          autoCapitalize="none"
          secureTextEntry={secureTextEntry}
          keyboardType={resolvedKeyboardType}
          underlineColorAndroid="transparent"
          editable={canEdit}
          accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
          selectionColor={palette.primary}
          cursorColor={palette.primary}
          keyboardAppearance={palette.mode}
          {...rest}
          accessibilityState={{ ...rest.accessibilityState, disabled: inactive }}
          accessibilityHint={rest.accessibilityHint ?? (readOnly ? "Read only." : required ? "Required." : undefined)}
          // RN-web promotes even aria-readonly=false to HTML readOnly=true.
          // Omit that attribute for editable fields; native readOnly remains authoritative.
          {...(Platform.OS === "web" ? { disabled: inactive, readOnly, "aria-readonly": readOnly ? true : undefined, "aria-required": required ? true : undefined, "aria-invalid": !!error, "aria-describedby": support ? messageId : undefined } : null)}
          placeholder={label && !floating ? undefined : rest.placeholder}
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
            if (!canEdit && target && typeof value === "string" && target.value !== value) {
              target.value = value;
            }
            restoreWebCaret(webCaretNode(target), pendingCaret.current);
          }}
          onChangeText={canEdit ? (text) => {
            if (androidUncontrolled) lastAppliedValue.current = text;
            setHasText(text.length > 0); onChangeText?.(text);
          } : undefined}
          style={[
            styles.input,
            {
              color: foreground,
              fontFamily,
              writingDirection: "ltr",
            },
            webCaretFix,
            Platform.OS === "web" ? { outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } as unknown as TextStyle : null,
            padRight != null ? { paddingRight: padRight } : null,
            filled && label ? { paddingTop: spacing[24], paddingBottom: spacing[8] } : null,
          ]}
        />
        {error && !inactive ? <View testID="material-field-error-icon" pointerEvents="none" style={{ marginLeft: 8 }}><MaterialIcon name="alert-circle" size={24} color={palette.error} accessible={false} /></View> : null}
        {rightAccessory ? (
          <View
            ref={accessoryRef}
            pointerEvents={inactive ? "none" : overlay ? "box-none" : "auto"}
            accessibilityElementsHidden={inactive}
            importantForAccessibility={inactive ? "no-hide-descendants" : "auto"}
            aria-hidden={inactive}
            onLayout={
              overlay && overlayPaddingRight == null
                ? (event) => {
                    const width = Math.ceil(event.nativeEvent.layout.width);
                    setOverlayWidth((current) => (current === width ? current : width));
                  }
                : undefined
            }
            style={[overlay ? styles.rightOverlay : styles.right, inactive ? { opacity: 0.38 } : null]}
          >
            {rightAccessory}
          </View>
        ) : null}
      </View>
      {support || reserveSupportingSpace || showCounter ? <View style={[styles.msg, { minHeight: 16, flexDirection: "row", gap: 8 }]}>
        <Text nativeID={messageId} variant="bodySmall" color={error ? "danger" : "secondary"}
          accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion={error ? "polite" : "none"} style={[{ flex: 1 }, inactive ? { color: foreground } : null]}>{support ?? " "}</Text>
        {showCounter && rest.maxLength != null ? <Text variant="bodySmall" color="secondary" accessibilityLabel={`${value?.length ?? 0} of ${rest.maxLength} characters`}>{value?.length ?? 0}/{rest.maxLength}</Text> : null}
      </View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  floatingLabel: { position: "absolute", paddingHorizontal: spacing[4], zIndex: 1 },
   box: {
    flexDirection: "row",
    alignItems: "center",
      minHeight: 56,
  },
   icon: { width: 24, height: 24, marginRight: spacing[16], alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minWidth: 0,
    borderWidth: 0,
    paddingVertical: spacing[16],
    fontSize: fontSize.md,
    lineHeight: 24,
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
  msg: { marginTop: spacing[4], paddingHorizontal: spacing[16] },
});
