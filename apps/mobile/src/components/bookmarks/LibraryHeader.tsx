/** A persistent search app bar and compact, contextual library actions. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useFocusEffect } from "expo-router";
import { useAppRouter as useRouter } from "../../hooks/use-app-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
import { useMaterialMotion } from "../../theme/material-motion";
import { useSearchBack } from "../../hooks/use-search-back";
import { useAuthStore } from "../../store/auth";
import { useTheme } from "../../theme/ThemeProvider";
import { layout, radius, spacing } from "../../theme/tokens";
import { registerSearchFieldFocus } from "../../lib/search-field-focus";
import { MaterialIcon } from "../ui/MaterialIcon";
import { Input } from "../ui/Input";
import { IconButton } from "../ui/IconButton";
import { HeaderIconButton } from "../ui/Header";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { UserAvatar } from "../ui/UserAvatar";
import { SelectionHeader } from "./SelectionHeader";

const LibrarySearch = React.memo(function LibrarySearch({ query, onChange, autoFocus, onFilter, filtersOn, onFocusChange, filterOpen, selecting }: {
  query: string; onChange: (query: string) => void; autoFocus?: boolean;
  onFilter: (anchor: MenuAnchorRect) => void; filtersOn: boolean;
  onFocusChange: (focused: boolean) => void;
  filterOpen: boolean; selecting: boolean;
}) {
  const { palette } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(query);
  const focused = useRef(false);
  const [editing, setEditing] = useState(false);
  const exitSearch = useCallback(() => {
    setEditing(false);
    onFocusChange(false);
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, [onFocusChange]);
  useSearchBack(editing, exitSearch, filterOpen);
  useEffect(() => { if (selecting) exitSearch(); }, [selecting, exitSearch]);
  useEffect(() => { if (!focused.current) setText(query); }, [query]);
  useFocusEffect(useCallback(() => registerSearchFieldFocus(() => inputRef.current?.focus()), []));
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  const change = (next: string) => {
    setText(next);
    onChange(next);
  };
  const clear = () => { inputRef.current?.clear(); change(""); inputRef.current?.focus(); };
  return <View><Input ref={inputRef} variant="search" value={text} onChangeText={change}
    placeholder={editing ? "Search your library" : "Library"} accessibilityLabel="Search your library"
    accessibilityHint="Search saved bookmarks and folders."
    onFocus={() => { focused.current = true; setEditing(true); onFocusChange(true); }}
    onBlur={() => { focused.current = false; }}
    autoCorrect={false} spellCheck={false} autoCapitalize="none" returnKeyType="search"
    onSubmitEditing={exitSearch}
    onKeyPress={(event) => { if (event.nativeEvent.key === "Escape") exitSearch(); }}
    icon={editing ? <View /> : <MaterialIcon name="search" color={palette.onSurfaceVariant} />}
    overlayRightAccessory overlayPaddingRight={editing ? text ? 104 : 56 : 0}
    rightAccessory={editing ? <View style={{ flexDirection: "row", alignItems: "center" }}>
      {text ? <IconButton name="close" variant="standard" accessibilityLabel="Clear search" onPress={clear} /> : null}
      <View><HeaderIconButton name="filter-outline" variant="standard" color={filtersOn ? palette.primary : palette.onSurfaceVariant}
        accessibilityLabel={filtersOn ? "Search filters, active" : "Search filters"} onPress={onFilter} />
        {filtersOn ? <View pointerEvents="none" style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary }} /> : null}
      </View>
    </View> : undefined} />
    {editing ? <View style={{ position: "absolute", left: spacing[4], top: spacing[4] }}>
      <IconButton name="arrow-back" variant="standard" accessibilityLabel="Exit search" onPress={exitSearch} />
    </View> : null}
  </View>;
});

export function LibraryHeader({ tools, query, onQueryChange, onFilter, filtersOn = false, filterOpen = false, autoFocusSearch, resultLabel, filters, selection, maxWidth = layout.maxContentWidth }: {
  tools: React.ReactNode; query: string; onQueryChange: (query: string) => void; autoFocusSearch?: boolean;
  resultLabel?: string; filters?: React.ReactNode;
  onFilter: (anchor: MenuAnchorRect) => void; filtersOn?: boolean;
  filterOpen?: boolean;
  maxWidth?: number;
  selection?: { count: number; selectableCount: number; onCancel: () => void; onToggleSelectAll: () => void };
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxWidth);
  const motion = useMaterialMotion();
  const [focused, setFocused] = useState(false);
  const collapseTools = focused;
  const toolsProgress = useSharedValue(0);
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, { duration: motion.reducedMotion ? 0 : 180 });
  }, [focused, focusProgress, motion.reducedMotion]);
  const focusStyle = useAnimatedStyle(() => ({ opacity: focusProgress.value }));
  useEffect(() => {
    toolsProgress.value = withTiming(collapseTools ? 1 : 0, { duration: motion.reducedMotion ? 0 : 180 });
  }, [collapseTools, toolsProgress, motion.reducedMotion]);
  const toolsStyle = useAnimatedStyle(() => ({ width: 96 * (1 - toolsProgress.value), opacity: 1 - toolsProgress.value }));
  useEffect(() => { if (selection) Keyboard.dismiss(); }, [!!selection]);
  const user = useAuthStore((s) => s.user);
  return <View style={{ width: "100%", maxWidth, alignSelf: "center",
    paddingTop: insets.top + spacing[8], paddingBottom: spacing[8],
    paddingLeft: column.left, paddingRight: column.right }}>
    <View style={[styles.appBar, { backgroundColor: palette.surfaceContainerHigh }, selection ? { display: "none" } : null]}>
      <View style={styles.search}><LibrarySearch query={query} onChange={onQueryChange} autoFocus={autoFocusSearch} onFilter={onFilter} filtersOn={filtersOn} onFocusChange={setFocused} filterOpen={filterOpen} selecting={!!selection} /></View>
      <Animated.View pointerEvents={collapseTools ? "none" : "auto"} aria-hidden={collapseTools}
        accessibilityElementsHidden={collapseTools} importantForAccessibility={collapseTools ? "no-hide-descendants" : "auto"}
        style={[{ height: 48, overflow: "hidden", flexDirection: "row", alignItems: "center" }, toolsStyle]}>{tools}
      <PressableScale accessibilityRole="button" accessibilityLabel="Account and settings"
        onPress={() => router.navigate("/settings")} stateLayerColor={palette.onSurface}
        style={styles.account}>
        {user ? <UserAvatar user={user} size={40} /> : <MaterialIcon name="person-circle" size={24} color={palette.onSecondaryContainer} />}
       </PressableScale>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.focusRing, { borderColor: palette.primary }, focusStyle]} />
    </View>
    {selection ? <SelectionHeader {...selection} embedded /> : null}
    {!selection && resultLabel ?
      <Text variant="bodySmall" color="secondary" accessibilityLiveRegion="polite" style={{ marginTop: spacing[8], marginLeft: spacing[16] }}>{resultLabel}</Text> : null}
    {!selection ? filters : null}
  </View>;
}
const styles = StyleSheet.create({
  appBar: { flexDirection: "row", alignItems: "center", minHeight: 56, borderRadius: radius.full, paddingRight: spacing[4] },
  search: { flex: 1, minWidth: 0 },
  focusRing: { borderWidth: 2, borderRadius: radius.full },
  account: { width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
