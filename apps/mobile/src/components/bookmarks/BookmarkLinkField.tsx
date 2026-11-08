import React from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type TextInput, type ViewStyle } from "react-native";
import Animated, { runOnUI, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { focusTextInput } from "../../lib/focus-text-input";
import { type BookmarkDraft } from "../../lib/bookmark-drafts";
import { materialWebMotion, useMaterialMotion } from "../../theme/material-motion";
import { spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { IconButton } from "../ui/IconButton";
import { ExpandingInputAccessory, Input, InputExpansionContext, inputDensityMetrics } from "../ui/Input";
import { MaterialIcon } from "../ui/MaterialIcon";

type LinkLayoutProps = {
  fields: React.ReactElement[]; activeIndex: number; children: React.ReactNode;
};

/** Reserve the final extent once; geometry inside the group shares one clock.
 * Retarget from the current weights so interrupted focus changes cannot make
 * a row's position disagree with the fields expanding above it. */
export const BookmarkLinkLayout = Platform.OS === "web" ? WebLinkLayout : NativeLinkLayout;

function WebLinkLayout({ fields, activeIndex, children }: LinkLayoutProps) {
  const { fontScale } = useWindowDimensions();
  const { compact, extra } = inputDensityMetrics(fontScale);
  const height = fields.length * compact + (activeIndex < 0 ? 0 : extra);
  const motion = useMaterialMotion();
  const ref = React.useRef<View>(null);
  const animation = React.useRef<Animation | null>(null);
  const keySignature = fields.map(field => field.key).join("\0");
  React.useLayoutEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    for (const name of ["--ordo-link-phase", "--ordo-input-expansion"]) {
      try { CSS.registerProperty({ name, syntax: "<number>", inherits: true, initialValue: "0" }); }
      catch { /* A prior group already registered the property. */ }
    }
    const rows = Array.from(node.children) as HTMLElement[];
    const current = rows.map(row => Number.parseFloat(getComputedStyle(row).getPropertyValue("--ordo-input-expansion")) || 0);
    animation.current?.cancel();
    node.style.setProperty("--ordo-link-phase", "0");
    let fromTop = 0;
    let toTop = 0;
    rows.forEach((row, index) => {
      const target = Number(index === activeIndex);
      row.style.setProperty("--ordo-input-expansion", `calc(${current[index]} + ${target - current[index]} * var(--ordo-link-phase))`);
      row.style.setProperty("--ordo-link-before", `calc(${fromTop} + ${toTop - fromTop} * var(--ordo-link-phase))`);
      fromTop += current[index];
      toTop += target;
    });
    if (motion.reducedMotion) node.style.setProperty("--ordo-link-phase", "1");
    else animation.current = node.animate([
      { "--ordo-link-phase": "0" }, { "--ordo-link-phase": "1" },
    ], { ...materialWebMotion.contained[motion.expressive ? "expressive" : "standard"], fill: "forwards" });
  }, [keySignature, activeIndex, motion]);
  React.useLayoutEffect(() => () => animation.current?.cancel(), []);
  return <View>
    <View ref={ref} style={{ height }}>
      {fields.map((field, index) => <WebLinkRow key={field.key} top={index * compact} extra={extra}
        initiallyExpanded={fields.length === 1 && activeIndex === index}>{field}</WebLinkRow>)}
    </View>
    <FollowingLinks height={height}>{children}</FollowingLinks>
  </View>;
}
function WebLinkRow({ top, extra, initiallyExpanded, children }: {
  top: number; extra: number; initiallyExpanded: boolean; children: React.ReactNode;
}) {
  const initial = React.useRef(Number(initiallyExpanded));
  return <InputExpansionContext.Provider value="web">
    <View style={[styles.row, {
      "--ordo-input-expansion": String(initial.current),
      transform: [{ translateY: `calc(${top}px + ${extra}px * var(--ordo-link-before, 0))` as unknown as number }],
    } as ViewStyle]}>{children}</View>
  </InputExpansionContext.Provider>;
}

function NativeLinkLayout({ fields, activeIndex, children }: LinkLayoutProps) {
  const { fontScale } = useWindowDimensions();
  const { compact, extra } = inputDensityMetrics(fontScale);
  const height = fields.length * compact + (activeIndex < 0 ? 0 : extra);
  const motion = useMaterialMotion();
  const keySignature = fields.map(field => field.key).join("\0");
  const keys = React.useMemo(() => keySignature.split("\0"), [keySignature]);
  const order = useSharedValue(keys);
  const from = useSharedValue(keys.map((_, index) => Number(index === activeIndex)));
  const to = useSharedValue(keys.map((_, index) => Number(index === activeIndex)));
  const phase = useSharedValue(1);
  const weights = useDerivedValue(() => to.value.map((target, index) => from.value[index] + (target - from.value[index]) * phase.value));
  React.useLayoutEffect(() => {
    runOnUI((nextKeys: string[], active: number, reduced: boolean, spring: typeof motion.spatial) => {
      const current = weights.value;
      from.value = nextKeys.map(key => current[order.value.indexOf(key)] ?? 0);
      to.value = nextKeys.map((_, index) => Number(index === active));
      order.value = nextKeys;
      phase.value = 0;
      phase.value = reduced ? 1 : withSpring(1, { ...spring, overshootClamping: true });
    })(keys, activeIndex, motion.reducedMotion, motion.spatial);
  }, [keys, activeIndex, motion, from, to, order, phase, weights]);
  return <View>
    <View style={{ height }}>
      {fields.map((field, index) => <NativeLinkRow key={field.key} id={String(field.key)} top={index * compact}
        extra={extra} order={order} weights={weights}>{field}</NativeLinkRow>)}
    </View>
    <FollowingLinks height={height}>{children}</FollowingLinks>
  </View>;
}
function NativeLinkRow({ id, top, extra, order, weights, children }: {
  id: string; top: number; extra: number; order: SharedValue<string[]>; weights: SharedValue<number[]>; children: React.ReactNode;
}) {
  const progress = useDerivedValue(() => weights.value[order.value.indexOf(id)] ?? 0);
  const position = useAnimatedStyle(() => ({ transform: [{ translateY: top
    + extra * weights.value.slice(0, order.value.indexOf(id)).reduce((sum, value) => sum + value, 0) }] }));
  return <InputExpansionContext.Provider value={progress}>
    <Animated.View style={[styles.row, position]}>{children}</Animated.View>
  </InputExpansionContext.Provider>;
}

const FollowingLinks = Platform.OS === "web" ? WebFollowingLinks : NativeFollowingLinks;
function WebFollowingLinks({ height, children }: { height: number; children: React.ReactNode }) {
  const motion = useMaterialMotion();
  const ref = React.useRef<View>(null);
  const previous = React.useRef(height);
  const animation = React.useRef<Animation | null>(null);
  React.useLayoutEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    const offset = animation.current ? new DOMMatrixReadOnly(getComputedStyle(node).transform).m42 : 0;
    animation.current?.cancel();
    const delta = previous.current - height + offset;
    previous.current = height;
    animation.current = !motion.reducedMotion && delta ? node.animate([
      { transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" },
    ], materialWebMotion.contained[motion.expressive ? "expressive" : "standard"]) : null;
  }, [height, motion]);
  React.useLayoutEffect(() => () => animation.current?.cancel(), []);
  return <View ref={ref} style={styles.following}>{children}</View>;
}
function NativeFollowingLinks({ height, children }: { height: number; children: React.ReactNode }) {
  const motion = useMaterialMotion();
  const extent = useSharedValue(height);
  React.useLayoutEffect(() => {
    extent.value = motion.reducedMotion ? height : withSpring(height, { ...motion.spatial, overshootClamping: true });
  }, [height, extent, motion]);
  const following = useAnimatedStyle(() => ({ transform: [{ translateY: extent.value - height }] }));
  return <Animated.View style={[styles.following, following]}>{children}</Animated.View>;
}

interface BookmarkLinkActions {
  onFocus: (id: number, input: TextInput | null) => void;
  onBlur: (id: number) => void;
  onChange: (id: number, url: string) => void;
  onRemove: (id: number) => void;
  onPaste: (id: number) => void;
  onNext: () => void;
}

/** Stable handlers let untouched rows skip rendering while another URL is
 * typed. Publish only committed callbacks so async events keep live ownership. */
export function useBookmarkLinkActions(actions: BookmarkLinkActions): BookmarkLinkActions {
  const latest = React.useRef(actions);
  React.useLayoutEffect(() => { latest.current = actions; });
  return React.useMemo(() => ({
    onFocus: (id, input) => latest.current.onFocus(id, input),
    onBlur: id => latest.current.onBlur(id),
    onChange: (id, url) => latest.current.onChange(id, url),
    onRemove: id => latest.current.onRemove(id),
    onPaste: id => latest.current.onPaste(id),
    onNext: () => latest.current.onNext(),
  }), []);
}

/** One URL field morphs between a compact tonal row and the outlined editor. */
export const BookmarkLinkField = React.memo(function BookmarkLinkField({ draft, index, expanded, disabled, removable,
  autoFocus, focusRequest, focusEnabled, actions,
}: {
  draft: BookmarkDraft; index: number; expanded: boolean; disabled: boolean;
  removable: boolean; autoFocus: boolean; focusRequest: number; focusEnabled: boolean;
  actions: BookmarkLinkActions;
}) {
  const { palette } = useTheme();
  const inputRef = React.useRef<TextInput>(null);
  const fieldRef = React.useRef<View>(null);
  const pendingBlur = React.useRef<(() => void) | undefined>(undefined);
  React.useEffect(() => () => pendingBlur.current?.(), []);
  React.useLayoutEffect(() => {
    if (expanded && focusRequest) pendingBlur.current?.();
  }, [expanded, focusRequest]);
  React.useEffect(() => {
    if (!focusRequest || !expanded || disabled || !focusEnabled) return;
    const frame = requestAnimationFrame(() => focusTextInput(inputRef.current));
    return () => cancelAnimationFrame(frame);
  }, [disabled, expanded, focusEnabled, focusRequest]);

  const blur = (event: { nativeEvent: unknown }) => {
    if (Platform.OS === "web") {
      const next = (event.nativeEvent as FocusEvent).relatedTarget as Node | null;
      if (next && (fieldRef.current as unknown as HTMLElement | null)?.contains(next)) return;
      // Finish pointer clicks before moving the target. Also covers immediate
      // geometry changes with reduced motion and keyboard focus on actions.
      if (next instanceof HTMLElement && next.closest('button, [role="button"]')?.matches(":active")) {
        pendingBlur.current?.();
        let frame = 0;
        const removeListeners = () => {
          document.removeEventListener("pointerup", finish);
          document.removeEventListener("pointercancel", finish);
        };
        const finish = () => {
          removeListeners();
          frame = requestAnimationFrame(() => {
            pendingBlur.current = undefined;
            if (!inputRef.current?.isFocused()) actions.onBlur(draft.id);
          });
        };
        pendingBlur.current = () => {
          removeListeners();
          cancelAnimationFrame(frame);
          pendingBlur.current = undefined;
        };
        document.addEventListener("pointerup", finish);
        document.addEventListener("pointercancel", finish);
        return;
      }
    }
    // Let the next field claim focus in this event turn. Collapsing to an
    // empty active selection first would resize and render the whole form
    // twice for every field-to-field handoff.
    pendingBlur.current?.();
    const frame = requestAnimationFrame(() => {
      pendingBlur.current = undefined;
      if (!inputRef.current?.isFocused()) actions.onBlur(draft.id);
    });
    pendingBlur.current = () => {
      cancelAnimationFrame(frame);
      pendingBlur.current = undefined;
    };
  };

  return <View ref={fieldRef}>
    <Input ref={inputRef} label={`Link ${index + 1}`} variant="outlined" value={draft.url}
      compact={!expanded} disabled={disabled} placeholder="Paste or type a link" keyboardType="url"
      icon={<MaterialIcon name="link-outline" size={16} color={palette.onSurfaceVariant} />}
      autoCapitalize="none" autoCorrect={false} autoFocus={autoFocus}
      onFocus={() => { pendingBlur.current?.(); actions.onFocus(draft.id, inputRef.current); }} onBlur={blur}
      onChangeText={url => actions.onChange(draft.id, url)} onSubmitEditing={actions.onNext} returnKeyType="next" submitBehavior="submit"
      error={draft.error} hideSupportingText accessibilityHint={draft.error}
      overlayRightAccessory overlayPaddingRight={(removable ? 48 : 0) + 48 + 8}
      compactOverlayPaddingRight={(removable ? 48 : 0) + 8}
      rightAccessory={<View style={styles.accessories}>
        <View pointerEvents={expanded ? "auto" : "none"}
          aria-hidden={!expanded} accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}>
          <ExpandingInputAccessory><IconButton name="clipboard-outline" variant="standard" disabled={disabled} focusable={expanded} tabIndex={expanded ? 0 : -1}
            accessibilityLabel={`Paste link ${index + 1} from clipboard`} onPress={() => { if (expanded) actions.onPaste(draft.id); }} onBlur={blur} /></ExpandingInputAccessory>
        </View>
        {removable ? <IconButton name="close" variant="standard" iconSize={20} disabled={disabled}
          accessibilityLabel={`Remove link ${index + 1}`} onPress={() => actions.onRemove(draft.id)} onBlur={blur} /> : null}
      </View>} />
  </View>;
});

const styles = StyleSheet.create({
  row: { position: "absolute", top: 0, left: 0, right: 0 },
  following: { gap: spacing[16], paddingTop: spacing[8] },
  accessories: { flexDirection: "row", alignItems: "center" },
});
