/**
 * Segmented one-time-code field. A single hidden TextInput captures typing,
 * paste, and OS autofill; the cells are the visual layer. Completing the
 * last character fires `onComplete`. Success / error play a bounce or a shake.
 */
import React, { useEffect, useRef } from "react";
import {
  Platform,
  Pressable,
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
import { fontSize, radius, resolveFont, spacing, springs } from "../../theme/tokens";
import { haptics } from "../../lib/haptics";

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
  const inputRef = useRef<TextInput>(null);
  const completedRef = useRef<string | null>(null);
  const prevLen = useRef(0);
  const [focused, setFocused] = React.useState(false);

  const chars =
    kind === "backup"
      ? value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, length)
      : value.replace(/\D/g, "").slice(0, length);
  const locked = !editable || status === "loading" || status === "success";
  const activeIndex = Math.min(chars.length, length - 1);
  const showCaret = focused && !locked && status === "idle" && chars.length < length;
  // A kept-alive screen can remount this field already filled (previous OTP).
  // Don't treat that restored value as a fresh user completion.
  const skipRestoredComplete = useRef(chars.length === length);

  const shake = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, [autoFocus]);

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
    if (status === "loading" || status === "success" || !onComplete) return;
    const t = setTimeout(() => {
      completedRef.current = chars;
      onComplete(chars);
    }, 80);
    return () => clearTimeout(t);
  }, [chars, length, onComplete, status]);

  useEffect(() => {
    if (status !== "error") return;
    shake.value = 0;
    shake.value = withSequence(
      withTiming(1, { duration: 42, easing: Easing.out(Easing.quad) }),
      withTiming(-1, { duration: 42 }),
      withTiming(0.72, { duration: 42 }),
      withTiming(-0.72, { duration: 42 }),
      withTiming(0.36, { duration: 38 }),
      withTiming(0, { duration: 90, easing: Easing.out(Easing.cubic) }),
    );
  }, [status, shake]);

  useEffect(() => {
    if (status === "loading") {
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
    pulse.value = withTiming(1, { duration: 160 });
    return undefined;
  }, [status, pulse]);

  const rowMotion = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ translateX: shake.value * 11 }],
  }));

  const setCode = (raw: string) => {
    const next =
      kind === "backup"
        ? raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, length)
        : raw.replace(/\D/g, "").slice(0, length);
    onChange(next);
  };

  const message = error || helper;
  const messageDanger = Boolean(error);
  const compact = kind === "backup";
  const boxPalette = {
    text: palette.text,
    border: palette.border,
    borderStrong: palette.borderStrong,
    accent: palette.accent,
    background: palette.background,
    surface: palette.surfaceElevated,
    danger: palette.danger,
    dangerSoft: palette.dangerSoft,
    success: palette.success,
    successSoft: palette.mode === "dark" ? "rgba(138,170,90,0.16)" : "rgba(108,143,58,0.12)",
  };

  const renderBox = (i: number) => (
    <DigitBox
      key={i}
      index={i}
      digit={chars[i] ?? ""}
      active={showCaret && i === (chars.length === length ? activeIndex : chars.length)}
      filled={Boolean(chars[i])}
      focused={focused && !locked && i === (chars.length < length ? chars.length : activeIndex)}
      status={status}
      compact={compact}
      palette={boxPalette}
    />
  );

  return (
    <View style={style}>
      {label ? (
        <Text variant="label" color={error ? "danger" : "tertiary"} style={styles.label}>
          {label}
        </Text>
      ) : null}

      <Pressable
        onPress={() => {
          if (locked) return;
          inputRef.current?.focus();
        }}
        style={styles.hit}
      >
        <Animated.View style={[styles.row, rowMotion]}>
          {compact && length === MFA.BACKUP_CODE_LENGTH ? (
            <>
              <View style={styles.group}>{Array.from({ length: 4 }, (_, i) => renderBox(i))}</View>
              <Text variant="title3" color="tertiary" style={styles.hyphen}>
                -
              </Text>
              <View style={styles.group}>{Array.from({ length: 4 }, (_, i) => renderBox(i + 4))}</View>
            </>
          ) : (
            Array.from({ length }, (_, i) => renderBox(i))
          )}
        </Animated.View>

        <TextInput
          ref={inputRef}
          value={chars}
          onChangeText={setCode}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!locked}
          autoFocus={false}
          caretHidden
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
          maxLength={kind === "backup" ? length * 2 : length}
          accessibilityLabel={label ?? (purpose === "pin" ? "PIN" : "Verification code")}
          accessibilityValue={{ text: chars }}
          style={[
            styles.hiddenInput,
            Platform.OS === "web"
              ? ({ outlineWidth: 0, outlineStyle: "none" } as unknown as TextStyle)
              : null,
          ]}
        />
      </Pressable>

      {message ? (
        <Text variant="footnote" color={messageDanger ? "danger" : "tertiary"} style={styles.msg}>
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
}: {
  index: number;
  digit: string;
  active: boolean;
  filled: boolean;
  focused: boolean;
  status: OtpStatus;
  compact?: boolean;
  palette: BoxPalette;
}) {
  const mood = useSharedValue(status === "error" ? 1 : status === "success" ? 2 : 0);
  const focusAmt = useSharedValue(focused ? 1 : 0);
  const appear = useSharedValue(filled ? 1 : 0);
  const pop = useSharedValue(1);
  const caret = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    mood.value = withTiming(status === "error" ? 1 : status === "success" ? 2 : 0, {
      duration: 220,
    });
  }, [status, mood]);

  useEffect(() => {
    focusAmt.value = withSpring(focused ? 1 : 0, springs.snappy);
  }, [focused, focusAmt]);

  useEffect(() => {
    if (filled) {
      appear.value = withSpring(1, springs.snappy);
      pop.value = 0.62;
      pop.value = withSpring(1, springs.snappy);
    } else {
      appear.value = withTiming(0, { duration: 90 });
      pop.value = withTiming(1, { duration: 90 });
    }
  }, [filled, appear, pop]);

  useEffect(() => {
    if (status !== "success") return;
    pop.value = withDelay(
      index * 48,
      withSequence(withSpring(1.14, springs.bouncy), withSpring(1, springs.snappy)),
    );
  }, [status, index, pop]);

  useEffect(() => {
    if (!active) {
      cancelAnimation(caret);
      caret.value = 0;
      return;
    }
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
  }, [active, caret]);

  const boxStyle = useAnimatedStyle(() => {
    const idleBorder = interpolateColor(
      focusAmt.value,
      [0, 1],
      [filled ? palette.borderStrong : palette.border, palette.accent],
    );
    const borderColor = interpolateColor(
      mood.value,
      [0, 1, 2],
      [idleBorder, palette.danger, palette.success],
    );
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
        [1, 1.5],
        Extrapolation.CLAMP,
      ),
      transform: [
        { scale: interpolate(focusAmt.value, [0, 1], [1, 1.04]) * pop.value },
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
      opacity: appear.value,
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
      {digit ? (
        <Animated.Text
          style={[
            compact ? styles.digitCompact : styles.digit,
            { fontFamily: resolveFont("mono", "600") },
            digitStyle,
          ]}
        >
          {digit}
        </Animated.Text>
      ) : (
        <Animated.View
          style={[
            compact ? styles.caretCompact : styles.caret,
            { backgroundColor: palette.accent },
            caretStyle,
          ]}
        />
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  label: { marginBottom: spacing[8] },
  hit: { position: "relative" },
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
  hyphen: { marginHorizontal: spacing[2] },
  box: {
    flex: 1,
    maxWidth: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  boxCompact: {
    flex: 1,
    height: 44,
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
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    opacity: 0.02,
    color: "transparent",
    fontSize: 16,
  },
  msg: { marginTop: spacing[8] },
});
