/**
 * Tag catalogue row — same chrome as FolderRow / BookmarkRow so the Tags
 * screen reads as part of the library, not a separate admin list.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { ListPressable } from "../ui/ListPressable";
import { Text } from "../ui/Text";
import { TagMark } from "./TagMark";
import { useTheme } from "../../theme/ThemeProvider";
import { haptics } from "../../lib/haptics";
import { measureAnchor, menuHoverFill, type MenuAnchorRect } from "../../lib/menu-anchor";
import { SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { prefetchTaggedBookmarks } from "../../hooks/use-tags";
import { spacing } from "../../theme/tokens";
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
        <TagMark color={tag.color} />
        <View style={styles.content}>
          <Text variant="headline" numberOfLines={1}>
            {tag.name}
          </Text>
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
  content: { flex: 1, minWidth: 0 },
  count: { marginTop: spacing[6] },
});
