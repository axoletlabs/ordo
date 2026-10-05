/**
 * Tag catalogue row — same muted chrome as FolderRow. Color is a small
 * leading dot, not a filled badge, so the list stays quiet.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { ListPressable } from "../ui/ListPressable";
import { PressableScale } from "../ui/PressableScale";
import { Text } from "../ui/Text";
import { ThemeOverrideProvider, useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { runPressAction } from "../../lib/press-action";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { prefetchTaggedBookmarks } from "../../hooks/use-tags";
import { tagColorValue } from "../../lib/tag-colors";
import { RowIconWell } from "../ui/RowIconWell";
import { ROW_ICON_GLYPH } from "../../theme/alignment";
import { layout, radius, spacing } from "../../theme/tokens";
import { RowHighlight } from "../bookmarks/RowHighlight";
import type { TagDto } from "@ordo/shared";
import { rowOwnsHover } from "../../lib/row-hover";
import { nativeHoverEvents } from "../../lib/pointer-hover";

export const TAG_ROW_SIZE = 72;

export interface TagRowProps {
  tag: TagDto;
  onPress: (tag: TagDto) => void | boolean;
  onMore?: (tag: TagDto, anchor: MenuAnchorRect) => void;
  highlighted?: boolean;
}

export const TagRow = React.memo(function TagRow({
  tag,
  onPress,
  onMore,
  highlighted,
}: TagRowProps) {
  const { palette: basePalette, expressive } = useTheme();
  const palette = React.useMemo(() => highlighted ? {
    ...basePalette, onSurface: basePalette.onSecondaryContainer, onSurfaceVariant: basePalette.onSecondaryContainer,
    text: basePalette.onSecondaryContainer, textSecondary: basePalette.onSecondaryContainer,
    textTertiary: basePalette.onSecondaryContainer, textFaint: basePalette.onSecondaryContainer,
  } : basePalette, [basePalette, highlighted]);
  const rowRef = React.useRef<View>(null);
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const countLabel = `${tag.bookmarkCount} ${tag.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`;

  const openTag = () => {
    runPressAction(() => onPress(tag), haptics.light);
  };

  const warmTag = () => {
    void prefetchTaggedBookmarks(tag.id);
  };

  const openMore = (event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    haptics.light();
    measureAnchor(rowRef.current, (anchor) => onMore?.(tag, anchor), event);
  };

  return (
    <ThemeOverrideProvider palette={palette}>
    <View
      ref={rowRef}
      collapsable={false}
      style={[styles.wrap, { borderBottomWidth: 0,
        backgroundColor: expressive ? palette.surfaceContainerLow : "transparent", borderRadius: expressive ? radius.xl : 0,
        marginBottom: expressive ? spacing[2] : 0 }]}
      {...(Platform.OS === "web"
        ? {
            onMouseEnter: (event: { target?: unknown; currentTarget?: unknown }) => setHovered(rowOwnsHover(event)),
            onMouseMove: (event: { target?: unknown; currentTarget?: unknown }) => setHovered(rowOwnsHover(event)),
            onMouseLeave: () => setHovered(false),
            onContextMenu: onMore
              ? (event: { preventDefault?: () => void }) => {
                  event.preventDefault?.();
                  openMore();
                }
              : undefined,
          }
          : nativeHoverEvents({}, setHovered))}
    >
      <RowHighlight selected={!!highlighted} hovered={hovered} pressed={pressed} />
      <ListPressable
        feedback={false}
        accessibilityRole="button"
        accessibilityLabel={`${tag.name}, ${countLabel}`}
        accessibilityHint={onMore ? "Press and hold for more actions" : undefined}
        accessibilityActions={onMore ? [{ name: "more", label: "More actions" }] : undefined}
        onAccessibilityAction={
          onMore
            ? (event) => {
                if (event.nativeEvent.actionName === "more") openMore();
              }
            : undefined
        }
        style={styles.press}
        onPressIn={() => { setPressed(true); warmTag(); }}
        onPressOut={() => setPressed(false)}
        onPress={openTag}
        onLongPress={onMore ? (event) => openMore(event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <RowIconWell>
          <Ionicons name="pricetag-outline" size={ROW_ICON_GLYPH} color={palette.onSecondaryContainer} />
        </RowIconWell>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: tagColorValue(tag.color).dot }]} />
            <Text variant="headline" numberOfLines={1} style={styles.title}>
              {tag.name}
            </Text>
          </View>
          <Text variant="bodyMedium" color="tertiary" numberOfLines={1} style={styles.count}>
            {countLabel}
          </Text>
        </View>
      </ListPressable>
      {onMore ? <PressableScale accessibilityRole="button" accessibilityLabel={`More actions for ${tag.name}`}
        onPress={(event) => openMore(event)} style={{ width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="ellipsis-vertical" size={24} color={palette.onSurfaceVariant} />
      </PressableScale> : null}
    </View>
    </ThemeOverrideProvider>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  press: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingVertical: spacing[12],
    minHeight: 72,
    paddingLeft: layout.rowInset,
    paddingRight: layout.rowInset,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  title: { flex: 1, minWidth: 0 },
  dot: { width: 7, height: 7, borderRadius: 9999, flexShrink: 0 },
  count: { marginTop: spacing[4] },
});
