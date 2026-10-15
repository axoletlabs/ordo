/**
 * Segmented one-time-code field. Each cell is a real, selectable TextInput;
 * typing, paste, and OS autofill share the same editing rules. Completing the
 * last character fires `onComplete`. Success / error play a bounce or a shake.
 */
import React, { useEffect, useLayoutEffect, useRef } from "react";
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { EMAIL_OTP, MFA } from "@ordo/shared";
import { Text } from "./Text";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { haptics } from "../../lib/haptics";
import { InputSurfaceContext } from "./input-surface";
import { alphaTint } from "../../theme/state-layer";
import { editOtp, normalizeOtp } from "../../lib/otp-edit";

export type OtpStatus = "idle" | "loading" | "success" | "error";

export const OTP_SUCCESS_HOLD_MS = 560;

export function holdOtpSuccess(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, OTP_SUCCESS_HOLD_MS));
}

export type OtpKind = "numeric" | "backup";

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  kind?: OtpKind;
  length?: number;
  label?: string;
  error?: string;
  helper?: string;
  status?: OtpStatus;
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
  /** `pin` disables SMS one-time-code autofill. */
  purpose?: "otp" | "pin";
  style?: ViewStyle;
}

export function OtpInput({
  value,
  onChange,
  kind = "numeric",
  length = kind === "backup" ? MFA.BACKUP_CODE_LENGTH : EMAIL_OTP.LENGTH,
  label,
  error,
  helper,
  status = "idle",
  onComplete,
  autoFocus = true,
  editable = true,
  purpose = "otp",
  style,
}: OtpInputProps) {
  const { palette } = useTheme();
  const fieldSurface = React.useContext(InputSurfaceContext) ?? palette.surface;
  const messageId = React.useId();
  const motion = useMaterialMotion();
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const completedRef = useRef<string | null>(null);
  const prevLen = useRef(0);
  const didFocus = useRef(false);
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);
  const [width, setWidth] = React.useState(0);
  const [, refreshSelection] = React.useReducer((revision: number) => revision + 1, 0);

  const chars = normalizeOtp(value, kind, length);
  const locked = !editable || status === "loading" || status === "success";
  const inactive = !editable || status === "loading";
  const focusCell = (index: number) => {
    if (locked) return;
    inputRefs.current[Math.min(Math.max(index, 0), chars.length, length - 1)]?.focus();
  };
  // A kept-alive screen can remount this field already filled (previous OTP).
  // Don't treat that restored value as a fresh user completion.
  const skipRestoredComplete = useRef(chars.length === length);

  const shake = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!autoFocus || locked || didFocus.current) return;
    // Don't steal focus after a failed verification or from another form field.
    const t = setTimeout(() => {
      if (!inputRefs.current.some((input) => input?.isFocused())) {
        didFocus.current = true;
        inputRefs.current[Math.min(chars.length, length - 1)]?.focus();
      }
    }, 280);
    return () => clearTimeout(t);
  }, [autoFocus, locked, chars.length, length]);

  // Move only after the controlled value reaches the cells. Focusing during
  // onChangeText sees the old value and can bounce back to the previous end.
  useLayoutEffect(() => {
    if (focusedIndex === null || locked) return;
    if (Platform.OS === "web" && document.activeElement !== document.body &&
      !inputRefs.current.some((input) => input?.isFocused())) {
      setFocusedIndex(null);
      return;
    }
    inputRefs.current[Math.min(focusedIndex, chars.length, length - 1)]?.focus();
  }, [focusedIndex, chars, locked, length]);

  useEffect(() => {
    if (chars.length > prevLen.current) haptics.selection();
    prevLen.current = chars.length;
  }, [chars.length]);

  useEffect(() => {
    if (chars.length !== length) {
      completedRef.current = null;
      skipRestoredComplete.current = false;
      return;
    }
    if (skipRestoredComplete.current) return;
    if (completedRef.current === chars) return;
    if (locked || !onComplete) return;
    const t = setTimeout(() => {
      completedRef.current = chars;
      onComplete(chars);
    }, 80);
    return () => clearTimeout(t);
  }, [chars, length, onComplete, locked]);

  useEffect(() => {
    cancelAnimation(shake);
    shake.value = 0;
    if (status !== "error" || motion.reducedMotion) return;
    shake.value = withSequence(
      withTiming(1, { duration: 42, easing: Easing.out(Easing.quad) }),
      withTiming(-1, { duration: 42 }),
      withTiming(0.72, { duration: 42 }),
      withTiming(-0.72, { duration: 42 }),
      withTiming(0.36, { duration: 38 }),
      withTiming(0, { duration: 90, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(shake);
  }, [status, shake, motion.reducedMotion]);

  useEffect(() => {
    if (status === "loading" && !motion.reducedMotion) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 540, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 540, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
      return () => cancelAnimation(pulse);
    }
    cancelAnimation(pulse);
    pulse.value = motion.reducedMotion ? 1 : withTiming(1, { duration: 160 });
    return undefined;
  }, [status, pulse, motion.reducedMotion]);

  const rowMotion = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ translateX: shake.value * 11 }],
  }));

  const setCode = (raw: string, index: number) => {
    if (locked) return;
    const next = editOtp(chars, raw, index, kind, length);
    if (next.value !== chars) {
      skipRestoredComplete.current = false;
      if (next.value.length === chars.length) haptics.selection();
      onChange(next.value);
    }
    // Reconcile even rejected input or retyping the same digit at the end.
    refreshSelection();
    // The new text may extend past the previous end; don't clamp to old chars.
    setFocusedIndex(next.index);
  };

  const message = error || helper;
  const messageDanger = Boolean(error);
  const compact = kind === "backup";
  const grouped = compact && length === MFA.BACKUP_CODE_LENGTH;
  const stacked = grouped && width < 448;
  const boxPalette = {
    text: inactive ? alphaTint(palette.onSurface, 0.38) : palette.text,
    border: inactive ? alphaTint(palette.onSurface, 0.12) : palette.outline,
    borderStrong: inactive ? alphaTint(palette.onSurface, 0.12) : palette.borderStrong,
    accent: palette.accent,
    background: fieldSurface,
    surface: palette.surfaceElevated,
    danger: palette.onErrorContainer,
    dangerSoft: palette.dangerSoft,
    success: palette.onPrimaryContainer,
    successSoft: palette.primaryContainer,
  };

  const renderBox = (i: number) => (
    <DigitBox
      key={i}
      index={i}
      digit={chars[i] ?? ""}
      active={focusedIndex === i && !locked && !chars[i]}
      filled={Boolean(chars[i])}
      focused={focusedIndex === i && !locked}
      status={status}
      compact={compact}
      palette={boxPalette}
    >
      <TextInput
        ref={(input) => { inputRefs.current[i] = input; }}
        value={chars[i] ?? ""}
        onChangeText={(raw) => setCode(raw, i)}
        onFocus={() => {
          didFocus.current = true;
          const target = Math.min(i, chars.length);
          if (target !== i) { focusCell(target); return; }
          setFocusedIndex(i);
        }}
        onBlur={() => {
          // Disabling during verification can blur on web. Preserve the chosen
          // cell for a failed attempt, but don't restore focus after a real blur.
          if (!locked) setFocusedIndex((current) => current === i ? null : current);
        }}
        onSelectionChange={(event) => {
          const { start, end } = event.nativeEvent.selection;
          // Tapping an already-focused cell must still replace its digit, not
          // insert beside it. Keep native paste/copy menus and keyboard support.
          if (focusedIndex === i && chars[i] && (start !== 0 || end !== 1)) refreshSelection();
        }}
        onKeyPress={(event) => {
          if (locked) return;
          const key = event.nativeEvent.key;
          if (key === "Backspace" && !chars[i] && i > 0) {
            event.preventDefault();
            setCode("", i - 1);
          } else if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") {
            event.preventDefault();
            focusCell(key === "Home" ? 0 : key === "End" ? chars.length : i + (key === "ArrowLeft" ? -1 : 1));
          }
        }}
        onSubmitEditing={() => focusCell(i + 1)}
        editable={!locked}
        selectTextOnFocus
        selection={{ start: 0, end: chars[i] ? 1 : 0 }}
        caretHidden
        selectionColor="transparent"
        contextMenuHidden={false}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        autoComplete={purpose === "pin" || kind === "backup" ? "off" : "one-time-code"}
        textContentType={purpose === "pin" ? "none" : kind === "numeric" ? "oneTimeCode" : "none"}
        importantForAutofill={purpose === "pin" || kind === "backup" ? "no" : "yes"}
        keyboardType={kind === "backup" ? "default" : "number-pad"}
        inputMode={kind === "backup" ? "text" : "numeric"}
        keyboardAppearance={palette.mode === "dark" ? "dark" : "light"}
        submitBehavior="submit"
        blurOnSubmit={false}
        accessibilityLabel={`${label ?? (purpose === "pin" ? "PIN" : "Verification code")}, ${kind === "backup" ? "character" : "digit"} ${i + 1} of ${length}`}
        accessibilityHint="Typing replaces this character. Pasting a complete code replaces all characters."
        accessibilityState={{ disabled: inactive, busy: status === "loading" }}
        {...(Platform.OS === "web" ? { disabled: inactive, readOnly: locked, tabIndex: i <= chars.length ? 0 : -1, "aria-required": true, "aria-invalid": !!error, "aria-describedby": message ? messageId : undefined } : null)}
        style={[
          styles.cellInput,
          Platform.OS === "web"
            ? ({ outlineWidth: 0, outlineStyle: "none", caretColor: "transparent" } as unknown as TextStyle)
            : null,
        ]}
      />
    </DigitBox>
  );

  return (
    <View style={style}>
      {label ? (
        <Text variant="label" color={error ? "danger" : "tertiary"} style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View style={styles.hit} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <Animated.View style={[styles.row, !grouped && width > 0 && width < length * 48 + (length - 1) * spacing[6] ? styles.tightRow : null, stacked ? styles.stackedRow : null, rowMotion]}>
          {grouped ? (
            <>
              <View style={[styles.group, stacked ? styles.stackedGroup : null]}>{Array.from({ length: 4 }, (_, i) => renderBox(i))}</View>
              {!stacked ? <Text variant="title3" color="tertiary" style={styles.hyphen}>
                -
              </Text> : null}
              <View style={[styles.group, stacked ? styles.stackedGroup : null]}>{Array.from({ length: 4 }, (_, i) => renderBox(i + 4))}</View>
            </>
          ) : (
            Array.from({ length }, (_, i) => renderBox(i))
          )}
        </Animated.View>
      </View>

      {message ? (
        <Text nativeID={messageId} variant="bodySmall" color={messageDanger ? "danger" : "secondary"} accessibilityRole={messageDanger ? "alert" : undefined} accessibilityLiveRegion={messageDanger ? "polite" : "none"} style={styles.msg}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

interface BoxPalette {
  text: string;
  border: string;
  borderStrong: string;
  accent: string;
  background: string;
  surface: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
}

const DigitBox = React.memo(function DigitBox({
  index,
  digit,
  active,
  filled,
  focused,
  status,
  compact,
  palette,
  children,
}: {
  index: number;
  digit: string;
  active: boolean;
  filled: boolean;
  focused: boolean;
  status: OtpStatus;
  compact?: boolean;
  palette: BoxPalette;
  children: React.ReactNode;
}) {
  const motion = useMaterialMotion();
  const mood = useSharedValue(status === "error" ? 1 : status === "success" ? 2 : 0);
  const focusAmt = useSharedValue(focused ? 1 : 0);
  const appear = useSharedValue(filled ? 1 : 0);
  const pop = useSharedValue(1);
  const successPop = useSharedValue(1);
  const caret = useSharedValue(active ? 1 : 0);
  const previousFilled = useRef(filled);
  const lastDigit = useRef(digit);
  if (digit) lastDigit.current = digit;

  useEffect(() => {
    mood.value = withTiming(status === "error" ? 1 : status === "success" ? 2 : 0, {
      duration: motion.reducedMotion ? 0 : 200,
    });
  }, [status, mood, motion.reducedMotion]);

  useEffect(() => {
    focusAmt.value = motion.reducedMotion ? +focused : withSpring(+focused, motion.fast);
  }, [focused, focusAmt, motion.fast, motion.reducedMotion]);

  useEffect(() => {
    const changed = previousFilled.current !== filled;
    previousFilled.current = filled;
    if (motion.reducedMotion) { appear.value = +filled; pop.value = 1; return; }
    if (!changed) return;
    if (filled) {
      appear.value = withSpring(1, materialMotion.effects.fast);
      pop.value = 0.62;
      pop.value = withSpring(1, motion.fast);
    } else {
      appear.value = withTiming(0, { duration: 90 });
      pop.value = withTiming(1, { duration: 90 });
    }
  }, [filled, appear, pop, motion.fast, motion.reducedMotion]);

  useEffect(() => {
    cancelAnimation(successPop);
    successPop.value = 1;
    if (status !== "success" || motion.reducedMotion) return;
    successPop.value = withDelay(
      index * 48,
      withSequence(withSpring(1.14, motion.spatial), withSpring(1, motion.fast)),
    );
    return () => cancelAnimation(successPop);
  }, [status, index, successPop, motion.spatial, motion.fast, motion.reducedMotion]);

  useEffect(() => {
    if (!active) {
      cancelAnimation(caret);
      caret.value = 0;
      return;
    }
    if (motion.reducedMotion) { cancelAnimation(caret); caret.value = 1; return; }
    caret.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(1, { duration: 520 }),
        withTiming(0, { duration: 160 }),
        withTiming(0, { duration: 380 }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(caret);
  }, [active, caret, motion.reducedMotion]);

  const boxStyle = useAnimatedStyle(() => {
    const idleBorder = interpolateColor(
      focusAmt.value,
      [0, 1],
      [filled ? palette.borderStrong : palette.border, palette.accent],
    );
    const statusBorder = interpolateColor(
      mood.value,
      [0, 1, 2],
      [idleBorder, palette.danger, palette.success],
    );
    const borderColor = interpolateColor(focusAmt.value, [0, 1], [statusBorder, palette.accent]);
    const backgroundColor = interpolateColor(
      mood.value,
      [0, 1, 2],
      [palette.background, palette.dangerSoft, palette.successSoft],
    );
    return {
      borderColor,
      backgroundColor,
      borderWidth: interpolate(
        Math.max(focusAmt.value, mood.value === 0 ? 0 : 1),
        [0, 1],
        [1, 2],
        Extrapolation.CLAMP,
      ),
      transform: [
        { scale: motion.reducedMotion ? 1 : interpolate(focusAmt.value, [0, 1], [1, 1.04]) * pop.value * successPop.value },
      ],
    };
  });

  const digitStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      mood.value,
      [0, 1, 2],
      [palette.text, palette.danger, palette.success],
    );
    return {
      color,
      opacity: Math.max(0, Math.min(1, appear.value)),
      transform: [{ scale: interpolate(appear.value, [0, 1], [0.7, 1]) }],
    };
  });

  const caretStyle = useAnimatedStyle(() => ({
    opacity: caret.value,
  }));

  return (
    <Animated.View
      style={[
        compact ? styles.boxCompact : styles.box,
        { borderRadius: radius.sm, zIndex: focused || status !== "idle" ? 2 : 1 },
        boxStyle,
      ]}
    >
        <Animated.Text
          accessible={false}
          aria-hidden
          style={[
            compact ? styles.digitCompact : styles.digit,
            { position: "absolute", fontFamily: resolveFont("mono", "600") },
            digitStyle,
          ]}
        >
          {digit || lastDigit.current}
        </Animated.Text>
        <Animated.View
          pointerEvents="none"
          style={[
            compact ? styles.caretCompact : styles.caret,
            { position: "absolute", backgroundColor: palette.accent },
            caretStyle,
          ]}
        />
        {children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  label: { marginBottom: spacing[8] },
  hit: { position: "relative", minHeight: 48, justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[6],
  },
  group: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[6],
  },
  tightRow: { gap: 0 },
  stackedRow: { flexDirection: "column", gap: spacing[8] },
  stackedGroup: { flex: 0, minHeight: 48, width: "100%", maxWidth: 240 },
  hyphen: { marginHorizontal: spacing[2] },
  box: {
    flex: 1,
    maxWidth: 48,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  boxCompact: {
    flex: 1,
    maxWidth: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: {
    fontSize: fontSize["3xl"],
    fontWeight: "600",
    letterSpacing: 0,
    textAlign: "center",
    includeFontPadding: false,
  },
  digitCompact: {
    fontSize: fontSize["2xl"],
    fontWeight: "600",
    letterSpacing: 0,
    textAlign: "center",
    includeFontPadding: false,
  },
  caret: {
    position: "absolute",
    width: 1.5,
    height: 22,
    borderRadius: 1,
  },
  caretCompact: {
    position: "absolute",
    width: 1.5,
    height: 16,
    borderRadius: 1,
  },
  cellInput: {
    ...StyleSheet.absoluteFill,
    // Include the animated outline in the hit area, not just its inner content.
    top: -2,
    bottom: -2,
    left: -2,
    right: -2,
    zIndex: 2,
    opacity: 0.02,
    color: "transparent",
    backgroundColor: "transparent",
    padding: 0,
    textAlign: "center",
    fontSize: 16,
  },
  msg: { marginTop: spacing[8] },
});
