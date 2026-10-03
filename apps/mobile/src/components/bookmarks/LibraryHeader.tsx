/** A persistent search app bar and compact, contextual library actions. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColumnPadding } from "../../hooks/use-scene-column-insets";
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

const LibrarySearch = React.memo(function LibrarySearch({ query, onChange, autoFocus, onFilter, filtersOn }: {
  query: string; onChange: (query: string) => void; autoFocus?: boolean;
  onFilter: (anchor: MenuAnchorRect) => void; filtersOn: boolean;
}) {
  const { palette } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(query);
  const focused = useRef(false);
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
  return <Input ref={inputRef} variant="search" value={text} onChangeText={change}
    placeholder="Search your library" accessibilityLabel="Search your library"
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}
    autoCorrect={false} spellCheck={false} autoCapitalize="none" returnKeyType="search"
    onSubmitEditing={() => Keyboard.dismiss()}
    onKeyPress={(event) => { if (event.nativeEvent.key === "Escape") { inputRef.current?.clear(); change(""); inputRef.current?.blur(); } }}
    icon={<MaterialIcon name="search" color={palette.onSurfaceVariant} />}
    overlayRightAccessory overlayPaddingRight={104}
    rightAccessory={<View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 48 }}>{text ? <IconButton name="close" variant="standard" accessibilityLabel="Clear search" onPress={clear} /> : null}</View>
      <View><HeaderIconButton name="filter-outline" variant="standard" color={filtersOn ? palette.primary : palette.onSurfaceVariant}
        accessibilityLabel={filtersOn ? "Search filters, active" : "Search filters"} onPress={onFilter} />
        {filtersOn ? <View pointerEvents="none" style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: palette.primary }} /> : null}
      </View>
    </View>} />;
});

export function LibraryHeader({ tools, query, onQueryChange, onFilter, filtersOn = false, autoFocusSearch, resultLabel, filters, selection, maxWidth = layout.maxContentWidth }: {
  tools: React.ReactNode; query: string; onQueryChange: (query: string) => void; autoFocusSearch?: boolean;
  resultLabel?: string; filters?: React.ReactNode;
  onFilter: (anchor: MenuAnchorRect) => void; filtersOn?: boolean;
  maxWidth?: number;
  selection?: { count: number; selectableCount: number; onCancel: () => void; onToggleSelectAll: () => void };
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const column = useColumnPadding(maxWidth);
  const user = useAuthStore((s) => s.user);
  return <View style={{ width: "100%", maxWidth, alignSelf: "center",
    paddingTop: insets.top + spacing[8], paddingLeft: column.left, paddingRight: column.right }}>
    <View style={[styles.appBar, selection ? { display: "none" } : null]}>
      <View style={styles.search}><LibrarySearch query={query} onChange={onQueryChange} autoFocus={autoFocusSearch} onFilter={onFilter} filtersOn={filtersOn} /></View>
    </View>
    {selection ? <SelectionHeader {...selection} embedded /> : null}
    <View style={styles.toolbar}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="titleLarge" numberOfLines={1}>{selection ? "Select items" : "Library"}</Text>
        {resultLabel && !selection ? <Text variant="bodySmall" color="secondary" numberOfLines={1} accessibilityLiveRegion="polite">{resultLabel}</Text> : null}
      </View>
      {!selection ? tools : null}
      {!selection ? <PressableScale accessibilityRole="button" accessibilityLabel="Account and settings"
        onPress={() => router.push("/settings")} stateLayerColor={palette.onSecondaryContainer}
        style={[styles.account, { backgroundColor: palette.secondaryContainer }]}>
        {user ? <UserAvatar user={user} size={40} /> : <MaterialIcon name="person-circle" size={24} color={palette.onSecondaryContainer} />}
      </PressableScale> : null}
    </View>
    {filters}
  </View>;
}
const styles = StyleSheet.create({
  appBar: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  search: { flex: 1, minWidth: 0 },
  account: { width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  toolbar: { height: 64, flexDirection: "row", alignItems: "center", gap: spacing[8] },
});
