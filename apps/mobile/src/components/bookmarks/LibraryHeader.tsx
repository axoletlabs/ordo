/** A persistent search app bar and compact, contextual library actions. */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { useFocusEffect } from "expo-router";
import { useAppRouter as useRouter } from "../../hooks/use-app-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { materialMotion, useMaterialMotion } from "../../theme/material-motion";
import { useSearchBack } from "../../hooks/use-search-back";
import { useAuthStore } from "../../store/auth";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { registerSearchFieldFocus } from "../../lib/search-field-focus";
import { useOverlayBlockingEffect } from "../ui/overlay-host";
import { AnimatedDisclosure } from "../ui/AnimatedDisclosure";
import { nativeFocusPermitted } from "../ui/input-focus-scope";
import { MaterialIcon } from "../ui/MaterialIcon";
import { Input } from "../ui/Input";
import { IconButton } from "../ui/IconButton";
import { HeaderIconButton } from "../ui/Header";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { UserAvatar } from "../ui/UserAvatar";
import { SelectionHeader } from "./SelectionHeader";
import { appBarLayout } from "../../theme/app-bar-layout";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";

/** Retain fading actions, but remove inactive slots from touch, Tab and screen readers. */
function SearchBarActions({ active, style, children }: { active: boolean; style: React.ComponentProps<typeof Animated.View>["style"]; children: React.ReactNode }) {
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = !active;
  }, [active]);
  return <Animated.View ref={ref} pointerEvents={active ? "box-none" : "none"} aria-hidden={!active}
    accessibilityElementsHidden={!active} importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    style={style}>{children}</Animated.View>;
}

/** One bar of the selection crossfade. Both bars stay mounted in the shared
 * 56dp footprint; the inactive one is inert, untouchable and unreadable while
 * its opacity/translate fade settles. */
function HeaderBarSurface({ active, style, children }: { active: boolean; style: React.ComponentProps<typeof Animated.View>["style"]; children: React.ReactNode }) {
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && ref.current) (ref.current as unknown as HTMLElement).inert = !active;
  }, [active]);
  return <Animated.View ref={ref} pointerEvents={active ? "auto" : "none"} aria-hidden={!active}
    accessibilityElementsHidden={!active} importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    style={style}>{children}</Animated.View>;
}

const LibrarySearch = React.memo(function LibrarySearch({ query, onChange, autoFocus, onFilter, filtersOn, onFocusChange, onInputFocusChange, filterOpen, selecting, spatialProgress, effectsProgress }: {
  query: string; onChange: (query: string) => void; autoFocus?: boolean;
  onFilter: (anchor: MenuAnchorRect) => void; filtersOn: boolean;
  onFocusChange: (focused: boolean) => void;
  /** Reports the field's real focus only; the editing session outlives blur. */
  onInputFocusChange?: (focused: boolean) => void;
  filterOpen: boolean; selecting: boolean;
  spatialProgress: SharedValue<number>; effectsProgress: SharedValue<number>;
}) {
  const { palette } = useTheme();
  const motion = useMaterialMotion();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(query);
  const focused = useRef(false);
  const [editing, setEditing] = useState(false);
  const overlayBlockedRef = useRef(false);
  const clearProgress = useSharedValue(query ? 1 : 0);
  useEffect(() => {
    clearProgress.value = motion.reducedMotion ? (text ? 1 : 0) : withSpring(text ? 1 : 0, materialMotion.effects.fast);
  }, [!!text, clearProgress, motion.reducedMotion]);
  const searchIconStyle = useAnimatedStyle(() => ({ opacity: 1 - effectsProgress.value }));
  const backStyle = useAnimatedStyle(() => ({ opacity: effectsProgress.value,
    transform: [{ translateX: -4 * (1 - spatialProgress.value) }] }));
  const accessoriesStyle = useAnimatedStyle(() => ({ opacity: effectsProgress.value,
    transform: [{ translateX: 8 * (1 - spatialProgress.value) }] }));
  const clearStyle = useAnimatedStyle(() => ({ opacity: clearProgress.value }));
  const exitSearch = useCallback(() => {
    setEditing(false);
    onFocusChange(false);
    onInputFocusChange?.(false);
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, [onFocusChange, onInputFocusChange]);
  useSearchBack(editing, exitSearch, filterOpen);
  useEffect(() => { if (selecting) exitSearch(); }, [selecting, exitSearch]);
  useEffect(() => { if (!focused.current) setText(query); }, [query]);
  /** A render-time `blocked` snapshot can lag the portal handoff by a commit.
   * Native also needs the live top-owner registry, not just React state. */
  const overlayOwnsFocus = useCallback(() => Platform.OS !== "web"
    ? overlayBlockedRef.current || !nativeFocusPermitted(null)
    : overlayBlockedRef.current,
  []);
  useFocusEffect(useCallback(() => registerSearchFieldFocus(() => {
    // The tab handler can run while an overlay owns the surface. The
    // background field must refuse the take itself.
    if (overlayOwnsFocus()) return;
    inputRef.current?.focus();
  }), [overlayOwnsFocus]));
  // Route autofocus is a one-shot intent. If a popup claims the surface before
  // the delayed take fires, the intent is spent: closing the popup must never
  // replay it and pull the keyboard back into the library. A fresh
  // autoFocus false -> true request is a new intent.
  const routeFocusIntent = useRef(0);
  const routeFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOverlayBlockingEffect(useCallback((blocked: boolean) => {
    overlayBlockedRef.current = blocked;
    // Consume the take when modality commits, not in a later header render.
    // Unblocking never creates a new intent or refocuses the library.
    if (!blocked) return;
    routeFocusIntent.current += 1;
    if (routeFocusTimer.current == null) return;
    clearTimeout(routeFocusTimer.current);
    routeFocusTimer.current = null;
  }, []));
  useEffect(() => {
    if (!autoFocus) return;
    const intent = ++routeFocusIntent.current;
    if (overlayOwnsFocus()) return;
    const timer = setTimeout(() => {
      if (routeFocusTimer.current === timer) routeFocusTimer.current = null;
      if (routeFocusIntent.current !== intent || overlayOwnsFocus()) return;
      inputRef.current?.focus();
    }, 200);
    routeFocusTimer.current = timer;
    return () => {
      if (routeFocusTimer.current === timer) routeFocusTimer.current = null;
      clearTimeout(timer);
    };
  }, [autoFocus]);
  const change = (next: string) => {
    setText(next);
    onChange(next);
  };
  const clear = () => { inputRef.current?.clear(); change(""); inputRef.current?.focus(); };
  return <View><Input ref={inputRef} variant="search" showFocusIndicator={false} value={text} onChangeText={change}
    placeholder={editing ? "Search your library" : "Library"} accessibilityLabel="Search your library"
    accessibilityHint="Search saved bookmarks and folders."
    onFocus={() => {
      // Native focus ownership can move to this background field when a child
      // surface removes its own input, before React publishes a new blocked
      // prop. The live owner registry (plus the DOM flag on web) decides, so
      // the library never starts an editing session behind an overlay.
      if (overlayOwnsFocus() || (Platform.OS === "web" && typeof document !== "undefined"
        && Boolean(document.querySelector('[data-material-overlay="true"]')))) {
        inputRef.current?.blur();
        return;
      }
      focused.current = true; setEditing(true); onFocusChange(true); onInputFocusChange?.(true);
    }}
    onBlur={() => { focused.current = false; onInputFocusChange?.(false); }}
    autoCorrect={false} spellCheck={false} autoCapitalize="none" returnKeyType="search"
    onSubmitEditing={exitSearch}
    onKeyPress={(event) => { if (event.nativeEvent.key === "Escape") exitSearch(); }}
    icon={<Animated.View style={searchIconStyle}><MaterialIcon name="search" color={palette.onSurfaceVariant} /></Animated.View>}
    overlayPaddingRight={104} />
    <SearchBarActions active={editing} style={[styles.searchAccessories, accessoriesStyle]}>
      <SearchBarActions active={editing && !!text} style={clearStyle}>
        <IconButton name="close" variant="standard" accessibilityLabel="Clear search" onPress={clear} />
      </SearchBarActions>
      <View><HeaderIconButton name="filter-outline" variant="standard" color={filtersOn ? palette.primary : palette.onSurfaceVariant}
        accessibilityLabel={filtersOn ? "Search filters, active" : "Search filters"} onPress={onFilter} />
        {filtersOn ? <View pointerEvents="none" style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary }} /> : null}
      </View>
    </SearchBarActions>
    <SearchBarActions active={editing} style={[styles.back, backStyle]}>
      <IconButton name="arrow-back" variant="standard" accessibilityLabel="Exit search" onPress={exitSearch} />
    </SearchBarActions>
  </View>;
});

export function LibraryHeader({ tools, query, onQueryChange, onFilter, filtersOn = false, filterOpen = false, autoFocusSearch, resultLabel, filters, selection, maxWidth = layout.maxContentWidth }: {
  tools: React.ReactNode; query: string; onQueryChange: (query: string) => void; autoFocusSearch?: boolean;
  resultLabel?: string; filters?: React.ReactNode;
  onFilter: (anchor: MenuAnchorRect) => void; filtersOn?: boolean;
  filterOpen?: boolean;
  maxWidth?: number;
  selection?: Pick<React.ComponentProps<typeof SelectionHeader>, "store" | "selectableCount" | "onCancel" | "onToggleSelectAll">;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxWidth);
  const { compactHeight } = useResponsiveLayout();
  const barLayout = appBarLayout({ topInset: insets.top, tonal: true, compact: compactHeight });
  const motion = useMaterialMotion();
  const [focused, setFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const spatialProgress = useSharedValue(0);
  const effectsProgress = useSharedValue(0);
  const ringProgress = useSharedValue(0);
  useEffect(() => {
    const target = focused ? 1 : 0;
    spatialProgress.value = motion.reducedMotion ? target : withSpring(target, { ...motion.spatial, overshootClamping: true });
    effectsProgress.value = motion.reducedMotion ? target : withSpring(target, materialMotion.effects.spatial);
  }, [focused, spatialProgress, effectsProgress, motion.reducedMotion, motion.expressive]);
  // The ring mirrors the field's real focus, not the editing session: an
  // overlay that steals focus (save sheet, picker) clears only the ring,
  // while the search chrome — back, clear, filters — and the query stay
  // until the user actually exits search. Nothing refocuses on blur.
  useEffect(() => {
    ringProgress.value = motion.reducedMotion
      ? (inputFocused ? 1 : 0)
      : withSpring(inputFocused ? 1 : 0, materialMotion.effects.fast);
  }, [inputFocused, ringProgress, motion.reducedMotion, motion.expressive]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringProgress.value }));
  // The input and action slots never resize: fade/translate the two groups in
  // place instead of clipping and squeezing live buttons on every frame.
  const toolsStyle = useAnimatedStyle(() => ({ opacity: 1 - effectsProgress.value,
    transform: [{ translateX: 8 * spatialProgress.value }] }));
  const hasSelection = selection != null;
  useEffect(() => { if (selection) Keyboard.dismiss(); }, [hasSelection]);
  const user = useAuthStore((s) => s.user);
  // Selection crossfade in the shared 56dp footprint. The search bar never
  // unmounts — its query, editing session and one-shot route autofocus intent
  // stay alive — and the selection bar is retained after its first use so
  // exiting selection fades it out in place instead of cutting away.
  const selectionSpatial = useSharedValue(0);
  const selectionEffects = useSharedValue(0);
  const [selectionMounted, setSelectionMounted] = useState(hasSelection);
  if (hasSelection && !selectionMounted) setSelectionMounted(true);
  const lastSelection = useRef(selection);
  if (selection) lastSelection.current = selection;
  useEffect(() => {
    const target = hasSelection ? 1 : 0;
    selectionSpatial.value = motion.reducedMotion ? target : withSpring(target, { ...motion.spatial, overshootClamping: true });
    selectionEffects.value = motion.reducedMotion ? target : withSpring(target, materialMotion.effects.spatial);
  }, [hasSelection, selectionSpatial, selectionEffects, motion.reducedMotion, motion.expressive]);
  const searchSurfaceStyle = useAnimatedStyle(() => ({
    opacity: 1 - selectionEffects.value,
    transform: [{ translateX: -8 * selectionSpatial.value }],
  }));
  const selectionSurfaceStyle = useAnimatedStyle(() => ({
    opacity: selectionEffects.value,
    transform: [{ translateX: 8 * (1 - selectionSpatial.value) }],
  }));
  return <View testID="material-app-bar" style={{ width: "100%", maxWidth, alignSelf: "center",
    paddingTop: barLayout.paddingTop, paddingBottom: barLayout.paddingBottom,
    paddingLeft: column.left, paddingRight: column.right }}>
    <View>
      <HeaderBarSurface active={!hasSelection} style={[styles.appBar, { backgroundColor: palette.surfaceContainerHigh }, searchSurfaceStyle]}>
        <View style={styles.search}><LibrarySearch query={query} onChange={onQueryChange} autoFocus={autoFocusSearch} onFilter={onFilter} filtersOn={filtersOn} onFocusChange={setFocused} onInputFocusChange={setInputFocused} filterOpen={filterOpen} selecting={hasSelection} spatialProgress={spatialProgress} effectsProgress={effectsProgress} /></View>
        <SearchBarActions active={!focused} style={[styles.searchAccessories, toolsStyle]}>{tools}
        <PressableScale accessibilityRole="button" accessibilityLabel="Account and settings"
          onPress={() => router.navigate("/settings")} stateLayerColor={palette.onSurface}
          stateLayerInset={4}
          style={styles.account}>
          {user ? <UserAvatar user={user} size={40} /> : <MaterialIcon name="person-circle" size={24} color={palette.onSecondaryContainer} />}
       </PressableScale>
       </SearchBarActions>
       <Animated.View testID="library-search-focus-ring" pointerEvents="none" style={[StyleSheet.absoluteFill, styles.focusRing, { borderColor: palette.primary }, ringStyle]} />
      </HeaderBarSurface>
      {selectionMounted && lastSelection.current ? (
        <HeaderBarSurface active={hasSelection} style={[StyleSheet.absoluteFill, selectionSurfaceStyle]}>
          <SelectionHeader {...(selection ?? lastSelection.current)} embedded />
        </HeaderBarSurface>
      ) : null}
    </View>
    <AnimatedDisclosure expanded={!selection && resultLabel != null}>
      {resultLabel ? <Text variant="bodySmall" color="secondary" accessibilityLiveRegion="polite" style={{ marginTop: spacing[8], marginLeft: spacing[16] }}>{resultLabel}</Text> : null}
    </AnimatedDisclosure>
    <AnimatedDisclosure expanded={!selection && filters != null}>{filters ?? null}</AnimatedDisclosure>
  </View>;
}
const styles = StyleSheet.create({
  appBar: { flexDirection: "row", alignItems: "center", minHeight: 56, borderRadius: radius.full },
  search: { flex: 1, minWidth: 0 },
  searchAccessories: { position: "absolute", right: spacing[4], top: spacing[4], height: 48, width: 96, flexDirection: "row", alignItems: "center" },
  back: { position: "absolute", left: spacing[4], top: spacing[4] },
  focusRing: { borderWidth: 2, borderRadius: radius.full },
  account: { width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
