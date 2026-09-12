/**
 * Tag catalogue row — same muted chrome as FolderRow. Color is a small
 * leading dot, not a filled badge, so the list stays quiet.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ListPressable } from "../ui/ListPressable";
import { Text } from "../ui/Text";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { measureAnchor, menuHoverFill, type MenuAnchorRect } from "../../lib/menu-anchor";
import { SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { prefetchTaggedBookmarks } from "../../hooks/use-tags";
import { tagColorValue } from "../../lib/tag-colors";
import { radius, spacing } from "../../theme/tokens";
import type { TagDto } from "@ordo/shared";

export const TAG_ROW_SIZE = 72;

export interface TagRowProps {
  tag: TagDto;
  onPress: (tag: TagDto) => void;
  onMore?: (tag: TagDto, anchor: MenuAnchorRect) => void;
  highlighted?: boolean;
}

export const TagRow = React.memo(function TagRow({
  tag,
  onPress,
  onMore,
  highlighted,
}: TagRowProps) {
  const { palette } = useTheme();
  const rowRef = React.useRef<View>(null);
  const [hovered, setHovered] = React.useState(false);
  const countLabel = `${tag.bookmarkCount} ${tag.bookmarkCount === 1 ? "bookmark" : "bookmarks"}`;

  const openTag = () => {
    haptics.light();
    onPress(tag);
  };

  const warmTag = () => {
    void prefetchTaggedBookmarks(tag.id);
  };

  const openMore = (event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    haptics.light();
    measureAnchor(rowRef.current, (anchor) => onMore?.(tag, anchor), event);
  };

  const rowFill = highlighted
    ? palette.surfaceSecondary
    : hovered
      ? menuHoverFill(palette.mode)
      : "transparent";

  return (
    <View
      ref={rowRef}
      collapsable={false}
      style={[
        styles.wrap,
        {
          backgroundColor: rowFill,
          borderBottomColor: palette.border,
        },
      ]}
      {...(Platform.OS === "web"
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onContextMenu: onMore
              ? (event: { preventDefault?: () => void }) => {
                  event.preventDefault?.();
                  openMore();
                }
              : undefined,
          }
        : null)}
    >
      <ListPressable
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
        onPressIn={warmTag}
        onPress={openTag}
        onLongPress={onMore ? (event) => openMore(event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <View
          style={[
            styles.iconFrame,
            { backgroundColor: palette.surfaceSecondary, borderColor: palette.border },
          ]}
        >
          <Ionicons name="pricetag-outline" size={18} color={palette.accent} />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: tagColorValue(tag.color).dot }]} />
            <Text variant="headline" numberOfLines={1} style={styles.title}>
              {tag.name}
            </Text>
          </View>
          <Text variant="caption" color="tertiary" numberOfLines={1} style={styles.count}>
            {countLabel}
          </Text>
        </View>
      </ListPressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  press: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[12],
    paddingVertical: spacing[12],
    paddingLeft: spacing[16],
    paddingRight: spacing[16],
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
  iconFrame: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  title: { flex: 1, minWidth: 0 },
  dot: { width: 7, height: 7, borderRadius: 9999, flexShrink: 0 },
  count: { marginTop: spacing[6] },
});
