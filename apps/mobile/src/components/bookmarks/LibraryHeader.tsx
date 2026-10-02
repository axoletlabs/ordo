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
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { UserAvatar } from "../ui/UserAvatar";
import { SelectionHeader } from "./SelectionHeader";

const LibrarySearch = React.memo(function LibrarySearch({ query, onChange, autoFocus }: {
  query: string; onChange: (query: string) => void; autoFocus?: boolean;
}) {
  const { palette } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(query);
  const focused = useRef(false);
  const frame = useRef<number | null>(null);
  useEffect(() => { if (!focused.current) setText(query); }, [query]);
  useFocusEffect(useCallback(() => registerSearchFieldFocus(() => inputRef.current?.focus()), []));
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);
  const change = (next: string) => {
    setText(next);
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { frame.current = null; onChange(next); });
  };
  const clear = () => { inputRef.current?.clear(); change(""); inputRef.current?.focus(); };
  return <Input ref={inputRef} variant="search" value={text} onChangeText={change}
    placeholder="Search your library" accessibilityLabel="Search your library"
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }}
    autoCorrect={false} spellCheck={false} autoCapitalize="none" returnKeyType="search"
    onSubmitEditing={() => Keyboard.dismiss()}
    onKeyPress={(event) => { if (event.nativeEvent.key === "Escape") { inputRef.current?.clear(); change(""); inputRef.current?.blur(); } }}
    icon={<MaterialIcon name="search" color={palette.onSurfaceVariant} />}
    overlayRightAccessory overlayPaddingRight={48}
    rightAccessory={text ? <IconButton name="close" variant="standard" accessibilityLabel="Clear search" onPress={clear} /> : undefined} />;
});

export function LibraryHeader({ tools, query, onQueryChange, autoFocusSearch, resultLabel, filters, selection, maxWidth = layout.maxContentWidth }: {
  tools: React.ReactNode; query: string; onQueryChange: (query: string) => void; autoFocusSearch?: boolean;
  resultLabel?: string; filters?: React.ReactNode;
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
      <View style={styles.search}><LibrarySearch query={query} onChange={onQueryChange} autoFocus={autoFocusSearch} /></View>
      <PressableScale accessibilityRole="button" accessibilityLabel="Account and settings"
        onPress={() => router.navigate("/settings")} stateLayerColor={palette.onSecondaryContainer}
        style={[styles.account, { backgroundColor: palette.secondaryContainer }]}>
        {user ? <UserAvatar user={user} size={40} /> : <MaterialIcon name="person-circle" size={24} color={palette.onSecondaryContainer} />}
      </PressableScale>
    </View>
    {selection ? <SelectionHeader {...selection} embedded /> : null}
    <View style={styles.toolbar}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="titleLarge" numberOfLines={1}>{selection ? "Select items" : "Library"}</Text>
        {resultLabel && !selection ? <Text variant="bodySmall" color="secondary" numberOfLines={1} accessibilityLiveRegion="polite">{resultLabel}</Text> : null}
      </View>
      {!selection ? tools : null}
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
