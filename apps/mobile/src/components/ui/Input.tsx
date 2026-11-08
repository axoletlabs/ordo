/** Material filled / outlined / search fields, preserving native editing and autofill. */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, type AnimatedStyle, type SharedValue } from "react-native-reanimated";
import { StateLayer } from "./StateLayer";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import {
  AppState,
  Platform,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type AppStateStatus,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Text } from "./Text";
import { MaterialIcon } from "./MaterialIcon";
import { useTheme } from "../../theme/ThemeProvider";
import { fontSize, radius, resolveFont, spacing } from "../../theme/tokens";
import { caretAfterKey, shouldCorrectWebCaret } from "../../lib/web-input-caret";
import { materialWebMotion, useMaterialMotion } from "../../theme/material-motion";
import { InputSurfaceContext } from "./input-surface";
import { InputFocusScopeContext, markNativeFocus, nativeFocusPermitted, registerNativeFocusField } from "./input-focus-scope";
import { useOverlayBlocked } from "./overlay-host";
import { PanelTitleContext } from "./panel-title";
import { focusTextInput } from "../../lib/focus-text-input";
import { nativeInputEdit } from "../../lib/native-input-edit";
import { alphaTint } from "../../theme/state-layer";
import { isSensitiveInput, privateKeyboardType } from "../../lib/input-privacy";
const AnimatedLabel = Animated.createAnimatedComponent(Text);

/** Web backgrounds are already inert under a blocking overlay, so subscribing
 * there only re-rendered every field when a popup opened. Native still needs
 * the live hit-test/focus gate. Mirrors the platform-split hook in ScrollBar. */
const useNativeOverlayBlocked = Platform.OS === "web" ? () => false : useOverlayBlocked;

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

/** A pending native focus frame must not run against a backgrounded app. */
function appCanTakeFocus(state: AppStateStatus) {
  return state !== "background" && state !== "inactive";
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
  /** Compact inset; interpolates to overlayPaddingRight with the field. */
  compactOverlayPaddingRight?: number;
  mono?: boolean;
  variant?: "filled" | "outlined" | "search";
  /** Embedded search bars let their enclosing surface own the focus outline. */
  showFocusIndicator?: boolean;
  containerStyle?: ViewStyle;
  disabled?: boolean;
  readOnly?: boolean;
  /** Preserve password keyboard/privacy semantics even while explicitly revealed. */
  sensitive?: boolean;
  required?: boolean;
  /** Hide the label asterisk when every field in the form is required. Semantics remain required. */
  showRequiredIndicator?: boolean;
  showCounter?: boolean;
  /** Opt in to an empty supporting row; otherwise only real messages/counters take space. */
  reserveSupportingSpace?: boolean;
  /** Keep one editable field as it expands from a compact row. Opt-in only. */
  compact?: boolean;
  /** A surrounding field group may present validation in one shared message. */
  hideSupportingText?: boolean;
}

export function inputDensityMetrics(fontScale: number) {
  const compactBody = Math.max(32, 20 * fontScale + 12);
  const expandedBody = Math.max(56, 24 * fontScale + 32);
  const compact = compactBody + 16;
  return { compact, compactBody, expandedBody, extra: expandedBody + 8 * fontScale - compact };
}

const DensityContext = React.createContext<null | {
  animated: boolean; compact: boolean;
  container: AnimatedStyle<ViewStyle>; box: AnimatedStyle<ViewStyle>;
  input: AnimatedStyle<TextStyle>; label: AnimatedStyle<ViewStyle>;
  icon: AnimatedStyle<ViewStyle>; outline: AnimatedStyle<ViewStyle>;
  accessory: AnimatedStyle<ViewStyle>;
}>(null);
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
/** A field group may own expansion so positions and field geometry cannot
 * diverge when a focus transition is interrupted. Web inherits a CSS number. */
export const InputExpansionContext = React.createContext<SharedValue<number> | "web" | null>(null);

/** Only expanding fields allocate geometry animations. The input node and its
 * native editing/focus machinery remain mounted throughout the transition. */
const InputDensity = Platform.OS === "web" ? WebInputDensity : NativeInputDensity;

type InputDensityProps = { compact: boolean; invalid: boolean; children: React.ReactNode;
  paddingRight?: number; compactPaddingRight?: number };

function WebInputDensity({ compact, invalid, paddingRight, compactPaddingRight, children }: InputDensityProps) {
  const motion = useMaterialMotion();
  const { palette } = useTheme();
  const fieldSurface = React.useContext(InputSurfaceContext) ?? palette.surface;
  const { fontScale } = useWindowDimensions();
  const metrics = inputDensityMetrics(fontScale);
  const compactRadius = motion.expressive ? metrics.compactBody / 2 : radius.sm;
  const curve = materialWebMotion.contained[motion.expressive ? "expressive" : "standard"];
  const accessoryWidth = Math.max(0, (paddingRight ?? 0) - (compactPaddingRight ?? paddingRight ?? 0));
  const grouped = React.useContext(InputExpansionContext) === "web";
  const length = (from: number, to: number) => `calc(${from}px + ${to - from}px * var(--ordo-input-expansion))` as unknown as number;
  const amount = (from: number, to: number) => `calc(${from} + ${to - from} * var(--ordo-input-expansion))` as unknown as number;
  const transition = {
    transitionProperty: "padding-top, padding-bottom, padding-left, padding-right, min-height, font-size, line-height, border-radius, background-color, width, margin-right, opacity, transform",
    transitionDuration: `${motion.reducedMotion ? 0 : curve.duration}ms`,
    transitionTimingFunction: curve.easing,
  } as ViewStyle;
  return <DensityContext.Provider value={{
    animated: false,
    compact,
    container: grouped ? { paddingTop: length(8, 8 * fontScale), paddingBottom: length(8, 0) }
      : { paddingTop: compact ? 8 : 8 * fontScale, paddingBottom: compact ? 8 : 0, ...transition },
    box: { minHeight: compact ? metrics.compactBody : metrics.expandedBody,
      backgroundColor: compact ? palette.surfaceContainerHighest : fieldSurface,
      borderRadius: compact ? compactRadius : radius.sm,
      paddingLeft: compact ? 12 : 16, paddingRight: compact ? 12 : 16, ...transition,
      ...(grouped ? { minHeight: length(metrics.compactBody, metrics.expandedBody), borderRadius: length(compactRadius, radius.sm),
        paddingLeft: length(12, 16), paddingRight: length(12, 16), transitionProperty: "background-color" } : {}) },
    input: { paddingTop: compact ? 6 : 16, paddingBottom: compact ? 6 : 16,
      ...(compactPaddingRight != null ? { paddingRight: compact ? compactPaddingRight : paddingRight } : {}),
      fontSize: compact ? 14 : 16, lineHeight: compact ? 20 : 24, ...transition,
      ...(grouped ? { paddingTop: length(6, 16), paddingBottom: length(6, 16), fontSize: length(14, 16), lineHeight: length(20, 24),
        ...(compactPaddingRight != null ? { paddingRight: length(compactPaddingRight, paddingRight ?? compactPaddingRight) } : {}),
        transitionProperty: "none" } : {}) },
    icon: { width: compact ? 16 : 0, marginRight: compact ? 8 : 0, opacity: compact ? 1 : 0,
      transform: [{ scale: compact ? 1 : 0 }], ...transition,
      ...(grouped ? { width: length(16, 0), marginRight: length(8, 0), opacity: amount(1, 0), transform: [{ scale: amount(1, 0) }], transitionProperty: "none" } : {}) },
    accessory: grouped ? { width: length(0, accessoryWidth),
      opacity: "clamp(0, calc(2.5 * var(--ordo-input-expansion) - 1.5), 1)" as unknown as number }
      : { width: compact ? 0 : accessoryWidth, opacity: compact ? 0 : 1, ...transition },
    outline: grouped ? { opacity: invalid ? 1 : amount(0, 1), borderRadius: length(compactRadius, radius.sm) }
      : { opacity: compact && !invalid ? 0 : 1, borderRadius: compact ? compactRadius : radius.sm, ...transition },
    label: { opacity: compact ? 0 : 1, transitionProperty: "opacity",
      transitionDuration: `${motion.reducedMotion ? 0 : materialWebMotion.effects.duration}ms`,
      transitionTimingFunction: materialWebMotion.effects.easing } as ViewStyle,
  }}>{children}</DensityContext.Provider>;
}

function NativeInputDensity({ compact, invalid, paddingRight, compactPaddingRight, children }: InputDensityProps) {
  const motion = useMaterialMotion();
  const { palette } = useTheme();
  const fieldSurface = React.useContext(InputSurfaceContext) ?? palette.surface;
  const { fontScale } = useWindowDimensions();
  const metrics = inputDensityMetrics(fontScale);
  const compactRadius = motion.expressive ? metrics.compactBody / 2 : radius.sm;
  const accessoryWidth = Math.max(0, (paddingRight ?? 0) - (compactPaddingRight ?? paddingRight ?? 0));
  const groupProgress = React.useContext(InputExpansionContext);
  const ownProgress = useSharedValue(compact ? 0 : 1);
  const progress = groupProgress && groupProgress !== "web" ? groupProgress : ownProgress;
  useLayoutEffect(() => {
    if (groupProgress) return;
    progress.value = motion.reducedMotion ? Number(!compact)
      : withSpring(Number(!compact), { ...motion.spatial, overshootClamping: true });
  }, [compact, motion, progress, groupProgress]);
  const container = useAnimatedStyle(() => ({ paddingTop: 8 + (8 * fontScale - 8) * progress.value, paddingBottom: 8 * (1 - progress.value) }));
  const box = useAnimatedStyle(() => ({
    minHeight: metrics.compactBody + (metrics.expandedBody - metrics.compactBody) * progress.value,
    backgroundColor: interpolateColor(progress.value, [0, 1], [palette.surfaceContainerHighest, fieldSurface]),
    borderRadius: compactRadius + (radius.sm - compactRadius) * progress.value,
    paddingLeft: 12 + 4 * progress.value, paddingRight: 12 + 4 * progress.value,
  }));
  const input = useAnimatedStyle(() => ({ paddingTop: 6 + 10 * progress.value, paddingBottom: 6 + 10 * progress.value,
    ...(compactPaddingRight != null ? { paddingRight: compactPaddingRight + ((paddingRight ?? compactPaddingRight) - compactPaddingRight) * progress.value } : {}),
    fontSize: 14 + 2 * progress.value, lineHeight: 20 + 4 * progress.value }));
  const label = useAnimatedStyle(() => ({ opacity: progress.value }));
  const icon = useAnimatedStyle(() => ({ width: 16 * (1 - progress.value), marginRight: 8 * (1 - progress.value), opacity: 1 - progress.value,
    transform: [{ scale: 1 - progress.value }] }));
  // Reveal the full glyph only after its inset has made room for it. On blur,
  // hide it before the URL reclaims that space, avoiding a crossfade over text.
  const accessory = useAnimatedStyle(() => ({ width: accessoryWidth * progress.value,
    opacity: Math.max(0, Math.min(1, (progress.value - 0.6) / 0.4)) }));
  const outline = useAnimatedStyle(() => ({ opacity: invalid ? 1 : progress.value,
    borderRadius: compactRadius + (radius.sm - compactRadius) * progress.value }));
  return <DensityContext.Provider value={{ animated: true, compact, container, box, input, label, icon, outline, accessory }}>{children}</DensityContext.Provider>;
}

/** Keep the glyph at its final size and position while its space is released.
 * Clipping a shrinking slot slices icons into slivers during focus handoff.
 * Native shares the field's progress, including interrupted transitions. */
export function ExpandingInputAccessory({ children }: { children: React.ReactNode }) {
  const density = React.useContext(DensityContext);
  const Slot = (density?.animated ? Animated.View : View) as typeof Animated.View;
  return <Slot style={[{ height: 48 }, density?.accessory]}>
    <View style={{ position: "absolute", right: 0, top: 0, width: 48, height: 48 }}>{children}</View>
  </Slot>;
}

/** Floating label owns its animation so unlabeled fields (search bars, inline
 * pickers) don't allocate a shared value, two animated styles and a motion
 * subscription that would never paint. */
const FloatingLabel = React.memo(function FloatingLabel({ label, floating, filled, fontScale, left, backgroundColor, color }: {
  label: string; floating: boolean; filled: boolean; fontScale: number;
  left: number; backgroundColor: string; color: string;
}) {
  const motion = useMaterialMotion();
  const density = React.useContext(DensityContext);
  const floatProgress = useSharedValue(floating ? 1 : 0);
  const previousFloat = useRef({ floating, reducedMotion: motion.reducedMotion });
  useEffect(() => {
    if (previousFloat.current.floating === floating && previousFloat.current.reducedMotion === motion.reducedMotion) return;
    previousFloat.current = { floating, reducedMotion: motion.reducedMotion };
    floatProgress.value = motion.reducedMotion ? Number(floating) : withSpring(Number(floating), motion.fast);
  }, [floating, floatProgress, motion.reducedMotion, motion.fast]);
  const labelPosition = useAnimatedStyle(() => ({ top: 16 - (filled ? 8 : 16 + 8 * fontScale) * floatProgress.value }));
  const labelType = useAnimatedStyle(() => ({ fontSize: 16 - 4 * floatProgress.value, lineHeight: 24 - 8 * floatProgress.value }));
  return <Animated.View pointerEvents="none" style={[styles.floatingLabel, { left, backgroundColor }, labelPosition, density?.label]}>
    <AnimatedLabel variant="bodyLarge" style={[{ color }, labelType]}>{label}</AnimatedLabel>
  </Animated.View>;
});

export const Input = React.forwardRef<TextInput, InputProps>(function Input({ compact, compactOverlayPaddingRight, ...props }, ref) {
  return compact === undefined ? <InputContent {...props} ref={ref} />
    : <InputDensity compact={compact} invalid={!!props.error} paddingRight={props.overlayPaddingRight}
        compactPaddingRight={compactOverlayPaddingRight}><InputContent {...props} ref={ref} /></InputDensity>;
});

const InputContent = React.forwardRef<TextInput, InputProps>(function InputContent({
  label,
  error,
  helper,
  icon,
  rightAccessory,
  overlayRightAccessory,
  overlayPaddingRight,
  mono,
  variant = "filled",
  showFocusIndicator = true,
  containerStyle,
  onFocus,
  onBlur,
  onChange,
  onChangeText,
  onKeyPress,
  secureTextEntry,
  sensitive,
  keyboardType,
  value,
  editable = true,
  disabled = false,
  readOnly = false,
  required = false,
  showRequiredIndicator = true,
  showCounter = false,
  reserveSupportingSpace = false,
  hideSupportingText = false,
  ...rest
}, ref) {
  const { palette, expressive } = useTheme();
  const density = React.useContext(DensityContext);
  // Both branches expose the same native instance. Use the animated prop
  // superset here; ordinary fields never receive an animated style handle.
  const FieldView = (density?.animated ? Animated.View : View) as typeof Animated.View;
  const FieldInput = (density?.animated ? AnimatedTextInput : TextInput) as typeof AnimatedTextInput;
  const { fontScale } = useWindowDimensions();
  const messageId = React.useId();
  const fieldSurface = React.useContext(InputSurfaceContext) ?? palette.surface;
  const panelTitle = React.useContext(PanelTitleContext);
  const focusScope = React.useContext(InputFocusScopeContext);
  const overlayBlocked = useNativeOverlayBlocked();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inactive = disabled || (!editable && !readOnly);
  const canEdit = !inactive && !readOnly;
  const indicateRequired = required && showRequiredIndicator;
  const displayLabel = label && indicateRequired ? `${label} *` : label;
  const support = hideSupportingText ? undefined : error || helper;
  const counterVisible = showCounter && rest.maxLength != null;
  const foreground = inactive ? alphaTint(palette.onSurface, 0.38) : density?.compact ? palette.onSurfaceVariant : palette.onSurface;
  const [hasText, setHasText] = useState(!!value);
  const [overlayWidth, setOverlayWidth] = useState(0);
  const inputRef = useRef<TextInput>(null);
  /** Stable identity in the overlay focus registry; the callbacks below read
   * live refs, so normal re-renders never unregister the field. */
  const nativeField = useRef<object>({}).current;
  const nativeFieldEditable = useRef(false);
  const accessoryRef = useRef<View>(null);
  const pendingCaret = useRef<number | null>(null);
  const lastAppliedValue = useRef(value);
  // Android re-applies a controlled `value` on every keystroke and walks the
  // caret (type/backspace in the middle). Keep one uncontrolled native node
  // while editing; external edits are written imperatively below.
  const secret = isSensitiveInput({ sensitive, secureTextEntry, ...rest });
  const androidUncontrolled = Platform.OS === "android" && !secret;
  // Overlay inputs request native focus only after their owning panel has
  // measured and started opening. Taking focus on mount would run before the
  // panel's opening keyboard dismissal, which would then blur its own field.
  const nativeOverlayBlocked = Platform.OS !== "web" && overlayBlocked;
  const scopedNativeAutoFocus = Platform.OS !== "web" && focusScope != null;
  const scopeSession = focusScope?.session ?? 0;
  const scopedSession = useRef(scopeSession);
  const scopedAutoFocusIntent = useRef(
    scopedNativeAutoFocus && !nativeOverlayBlocked && !!rest.autoFocus && focusScope?.active === true,
  );
  const scopedAutoFocusDone = useRef(false);
  const scopedFocusFrame = useRef<number | null>(null);
  const scopedAppState = useRef<ReturnType<typeof AppState.addEventListener> | null>(null);
  const scopedFocusBaseline = useRef<unknown>(null);
  const scopedBaselineSession = useRef<number | null>(null);
  const scopeActive = useRef(focusScope?.active === true && !nativeOverlayBlocked);
  const scopeReady = useRef(focusScope?.ready === true);
  useLayoutEffect(() => {
    scopeActive.current = focusScope?.active === true && !nativeOverlayBlocked;
    scopeReady.current = focusScope?.ready === true;
  }, [focusScope?.active, focusScope?.ready, nativeOverlayBlocked]);

  // Native focus ownership spans portal siblings: an obscured background field
  // can still be targeted by Android's focus fallback, so it must refuse the
  // move itself. A field publishes focus only for the surface that currently
  // owns the screen; closing/resuming that surface restores its own last field.
  const scopeOwner = focusScope?.owner ?? null;
  useLayoutEffect(() => {
    nativeFieldEditable.current = canEdit;
  }, [canEdit]);
  useLayoutEffect(() => {
    if (Platform.OS === "web" || scopeOwner == null) return;
    return registerNativeFocusField(scopeOwner, nativeField, {
      canFocus: () => nativeFieldEditable.current && appCanTakeFocus(AppState.currentState),
      focus: () => {
        if (!nativeFieldEditable.current || !appCanTakeFocus(AppState.currentState)) return;
        if (!nativeFocusPermitted(scopeOwner)) return;
        // Android Back can hide the IME without clearing TextInputState; this
        // helper resets only this already-owned field.
        focusTextInput(inputRef.current);
      },
    });
  }, [nativeField, scopeOwner]);

  const setInputRef = (node: TextInput | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const clearScopedFocusTake = () => {
    if (scopedFocusFrame.current != null) {
      cancelAnimationFrame(scopedFocusFrame.current);
      scopedFocusFrame.current = null;
    }
    scopedAppState.current?.remove();
    scopedAppState.current = null;
  };

  const cancelScopedAutoFocus = () => {
    if (!scopedNativeAutoFocus) return;
    scopedAutoFocusDone.current = true;
    clearScopedFocusTake();
  };

  useEffect(() => {
    if (!scopedNativeAutoFocus) return;
    if (scopedSession.current !== scopeSession) {
      // A retained exiting panel can reopen inside the same React tree. Each
      // new visible session may take focus once, while picker suspension in
      // the same session must not replay it.
      scopedSession.current = scopeSession;
      scopedAutoFocusDone.current = false;
      scopedAutoFocusIntent.current = !!rest.autoFocus && scopeActive.current;
      scopedBaselineSession.current = null;
    }
    if (!scopedAutoFocusIntent.current || scopedAutoFocusDone.current) return;
    if (!rest.autoFocus) {
      // The parent cancelled this session's intent before it took effect.
      scopedAutoFocusDone.current = true;
      clearScopedFocusTake();
      return;
    }
    if (!scopeActive.current) {
      // Started suspended/closing: never steal focus if this owner resumes.
      scopedAutoFocusDone.current = true;
      clearScopedFocusTake();
      return;
    }
    if (!appCanTakeFocus(AppState.currentState)) {
      // Ready or still measuring: a background opening has no focus claim.
      scopedAutoFocusDone.current = true;
      clearScopedFocusTake();
      return;
    }
    if (scopedBaselineSession.current !== scopeSession) {
      // Remember who owned focus when this session became active. A field
      // that was already focused (possibly stale from the screen behind the
      // overlay) must be replaced; one that gains focus afterwards is a
      // deliberate choice and wins over the delayed take.
      scopedBaselineSession.current = scopeSession;
      scopedFocusBaseline.current = TextInput.State?.currentlyFocusedInput?.() ?? null;
    }
    // The initial intent is pending even before the panel reports ready. Keep
    // one pending-only observer so backgrounding during measurement cancels it;
    // normal mounted fields never subscribe.
    if (scopedAppState.current == null) {
      scopedAppState.current = AppState.addEventListener("change", (state) => {
        if (state !== "active") cancelScopedAutoFocus();
      });
    }
    if (!scopeReady.current) return clearScopedFocusTake;
    const frame = requestAnimationFrame(() => {
      scopedFocusFrame.current = null;
      scopedAppState.current?.remove();
      scopedAppState.current = null;
      scopedAutoFocusDone.current = true;
      if (!scopeActive.current || !scopeReady.current || !appCanTakeFocus(AppState.currentState)) return;
      const target = inputRef.current;
      if (!target) return;
      const focused = TextInput.State?.currentlyFocusedInput?.() ?? null;
      const baseline = scopedFocusBaseline.current;
      // A field focused after this session became active is a deliberate
      // choice; a field that was already focused is a stale owner to replace.
      if (focused && focused !== target && focused !== baseline) return;
      // Owner/session/blocked checks above must pass before the shared policy
      // reopens a retained Android target whose IME Back left hidden.
      focusTextInput(target);
    });
    scopedFocusFrame.current = frame;
    return clearScopedFocusTake;
  }, [scopedNativeAutoFocus, nativeOverlayBlocked, scopeSession, focusScope?.active, focusScope?.ready, rest.autoFocus]);

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
    if (nativeInputEdit(value, lastAppliedValue.current) === "none") return;
    lastAppliedValue.current = value;
    setHasText(!!value);
    // Clipboard/clear/parent resets are external edits, not another controlled
    // echo of the keystroke. Replace the text on the stable native node: a
    // remount would replay autoFocus and could steal focus from a picker.
    const text = value ?? "";
    inputRef.current?.setNativeProps({ text, selection: { start: text.length, end: text.length } });
  }, [androidUncontrolled, value]);

  const search = variant === "search";
  const filled = variant === "filled";
  const leadingSize = density ? 16 : 24;
  const leadingIcon = React.isValidElement<React.ComponentProps<typeof MaterialIcon>>(icon) && icon.type === MaterialIcon
    ? React.cloneElement(icon, { size: leadingSize, style: [icon.props.style, { width: leadingSize, height: leadingSize }] }) : icon;
  const borderColor = inactive ? alphaTint(palette.onSurface, 0.12) : error ? palette.error : focused ? palette.primary : hovered ? palette.onSurface : palette.outline;
  const borderWidth = search ? 0 : focused && !inactive ? 2 : 1;
  const floating = !!density || focused || hasText || !!value;
  // Keep the system face for secure editing/AutoFill, including across reveal.
  const fontFamily = secret
    ? undefined
    : mono && Platform.OS !== "android"
      ? resolveFont("mono", "400")
      : resolveFont("sans", "400");
  const overlay = overlayRightAccessory && !!rightAccessory && (!error || hideSupportingText);
  const padRight =
    overlayPaddingRight != null
      ? overlayPaddingRight
      : overlay && overlayWidth > 0
        ? overlayWidth + spacing[8]
        : undefined;
  // RN-web maps keyboardType="url" onto <input type="url">; Android's URI
  // variation walks the caret the same way. Keep a URL keyboard on iOS only.
  const resolvedKeyboardType = privateKeyboardType(Platform.OS, secret, secureTextEntry, keyboardType);
  const webCaretFix =
    Platform.OS === "web"
      ? ({
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
          unicodeBidi: "normal",
        } as TextStyle)
      : null;

  return (
    <FieldView
      onPointerDown={(event) => { if (density && !inactive && event.target === event.currentTarget) inputRef.current?.focus(); }}
      onStartShouldSetResponder={(event) => !!density && !inactive && event.target === event.currentTarget}
      onResponderRelease={() => { if (density && !inactive) inputRef.current?.focus(); }}
      style={[label && !filled && !search ? { paddingTop: 8 * fontScale } : null, containerStyle, density?.container]}>
      <FieldView
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
          density?.box,
        ]}
      >
        <StateLayer testID="material-field-hover" color={palette.onSurface} fraction={hovered && !inactive ? 0.08 : 0}
          surfaceStyle={{ borderRadius: density?.compact && expressive ? inputDensityMetrics(fontScale).compactBody / 2 : search ? radius.full : filled ? 0 : radius.sm,
            ...(filled ? { borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs } : {}) }} />
        {search && focused && showFocusIndicator ? <View testID="material-search-focus-ring" pointerEvents="none" style={[StyleSheet.absoluteFill, { borderColor, borderWidth: 2, borderRadius: radius.full }]} /> : null}
        {filled ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: borderWidth, backgroundColor: borderColor }} />
          : !search ? <FieldView pointerEvents="none" style={[StyleSheet.absoluteFill, { borderColor, borderWidth, borderRadius: radius.sm }, density?.outline]} /> : null}
        {label ? <FloatingLabel label={displayLabel ?? label} floating={floating} filled={filled} fontScale={fontScale}
          left={icon && !density ? 48 : 12} backgroundColor={filled || search ? "transparent" : fieldSurface}
          color={inactive ? foreground : error ? palette.error : focused ? palette.primary : palette.onSurfaceVariant} /> : null}
        {icon ? <FieldView pointerEvents="none" style={[styles.icon, density?.icon, inactive ? { opacity: 0.38 } : null]}>{leadingIcon}</FieldView> : null}
        <FieldInput
          ref={setInputRef}
          placeholderTextColor={inactive ? foreground : palette.onSurfaceVariant}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          textContentType={rest.autoComplete && rest.autoComplete !== "off" ? undefined : "none"}
          importantForAutofill={rest.autoComplete && rest.autoComplete !== "off" ? "yes" : "no"}
          secureTextEntry={secureTextEntry}
          keyboardType={resolvedKeyboardType}
          underlineColorAndroid="transparent"
          editable={canEdit}
          accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
          selectionColor={palette.primary}
          cursorColor={palette.primary}
          keyboardAppearance={palette.mode}
          {...rest}
          // The panel focuses after its portal is attached. Mount-time web
          // autofocus forces layout in the middle of that publication, before
          // the dialog can establish keyboard ownership. Scoped native fields
          // wait for their owner's ready state instead (effect above).
          autoFocus={nativeOverlayBlocked || scopedNativeAutoFocus || (Platform.OS === "web" && panelTitle) ? false : rest.autoFocus}
          // Never let a sensitive field opt into spelling, correction or casing.
          {...(secret ? { autoCorrect: false, spellCheck: false, autoCapitalize: "none" as const, disableFullscreenUI: true } : null)}
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
            // Android's removal fallback can land on any editable field in the
            // window, including the screen behind an overlay. Reject that move
            // before the field's editing state, caret, or IME becomes visible.
            if (Platform.OS !== "web" && !nativeFocusPermitted(scopeOwner)) {
              cancelScopedAutoFocus();
              setFocused(false);
              inputRef.current?.blur();
              return;
            }
            if (Platform.OS !== "web" && scopeOwner != null) markNativeFocus(scopeOwner, nativeField);
            cancelScopedAutoFocus();
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            // Keep `lastAppliedValue` as the last native text. The render
            // closure may still hold the previous value when a batched IME
            // update lands before this blur.
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
            // The native field is authoritative while typing. A late parent
            // commit echoing this text must not look like an external edit.
            lastAppliedValue.current = text;
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
            filled && label ? { paddingTop: spacing[8] + 16 * fontScale, paddingBottom: spacing[8] } : null,
            density?.input,
          ]}
        />
        {error && !inactive && !hideSupportingText ? <View testID="material-field-error-icon" pointerEvents="none" style={{ marginLeft: 8 }}><MaterialIcon name="alert-circle" size={24} color={palette.error} accessible={false} /></View> : null}
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
      </FieldView>
      <AnimatedDisclosure expanded={!!(support || reserveSupportingSpace || counterVisible)}><View style={[styles.msg, { minHeight: 16, flexDirection: "row", gap: spacing[16] }]}>
        <Text nativeID={messageId} variant="bodySmall" color={error ? "danger" : "secondary"}
          accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion={error ? "polite" : "none"} style={[{ flex: 1 }, inactive ? { color: foreground } : null]}>{support ?? " "}</Text>
        {counterVisible ? <Text variant="bodySmall" color="secondary" accessibilityLabel={`${value?.length ?? 0} of ${rest.maxLength} characters`}>{value?.length ?? 0}/{rest.maxLength}</Text> : null}
      </View></AnimatedDisclosure>
    </FieldView>
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
