/**
 * A single bookmark row. Tapping opens the reader; a long-press on the row
 * reveals actions. Hold the favicon to multi-select.
 */
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { MaterialIcon as Ionicons } from "../ui/MaterialIcon";
import { ListPressable } from "../ui/ListPressable";
import { Spinner } from "../ui/Spinner";
import { Text } from "../ui/Text";
import { TagChip } from "../tags/TagChip";
import { RowHighlight } from "./RowHighlight";
import { SelectionMark } from "./SelectionMark";
import { SelectionDragHandle, useSelectionDragRow } from "./SelectionDrag";
import { RowStatusSlot, ROW_STATUS_ICON_SIZE } from "./RowStatusIcon";
import { ThemeOverrideProvider, useTheme } from "../../theme/ThemeProvider";
import { domainFromUrl, relativeTime } from "../../lib/format";
import { bookmarkReminderStatus, formatReminderWhen } from "../../lib/bookmark-reminders";
import { bookmarkIsArticle, bookmarkOpensAsWebsite } from "../../lib/bookmark-reader";
import { openBookmarkInExternalBrowser } from "../../lib/open-website";
import { haptics } from "../../lib/haptics";
import { measureAnchor, type MenuAnchorRect } from "../../lib/menu-anchor";
import { prefetchBookmarkDetail } from "../../hooks/use-bookmarks";
import { prefetchTaggedBookmarks } from "../../hooks/use-tags";
import { searchHighlightRanges } from "../../lib/search-bookmarks";
import { ROW_ICON_FRAME, ROW_ICON_GLYPH } from "../../theme/alignment";
import { layout, radius, spacing } from "../../theme/tokens";
import { bookmarkKey, SELECTION_LONG_PRESS_MS, useSelectionHoldGuard } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";
import type { BookmarkDto } from "@ordo/shared";
import { listCorners, type ListPosition } from "../../theme/list-shape";

/** Compact tags shown inline on a row before overflow. */
const MAX_ROW_TAGS = 2;

function highlightTitle(title: string, query?: string, fuzzy = false, onSelectedSurface = false) {
  const spans = query ? searchHighlightRanges(title, query, fuzzy) : [];
  if (!spans.length) return title;
  let end = 0;
  const nodes: React.ReactNode[] = [];
  for (const span of spans) {
    nodes.push(title.slice(end, span.start), <Text key={span.start} variant="headline" color={onSelectedSurface ? "primary" : "accent"}>{title.slice(span.start, span.end)}</Text>);
    end = span.end;
  }
  return <>{nodes}{title.slice(end)}</>;
}

export interface BookmarkRowProps {
  bookmark: BookmarkDto;
  onPress: (b: BookmarkDto) => void;
  onMore?: (b: BookmarkDto, anchor: MenuAnchorRect) => void;
  /** Press-and-hold on the favicon enters selection with this bookmark. */
  onEnterSelection?: (b: BookmarkDto) => void;
  selected?: boolean;
  selectionMode?: boolean;
  /** True while this row's context menu is open, so the trigger stays obvious in a long list. */
  highlighted?: boolean;
  /** Override chip taps (e.g. toggle a search filter). Default: open that tag. */
  onTagPress?: (tagId: string) => void;
  /** Hide tags already expressed by the current view (e.g. the active tag filter). */
  omitTagIds?: readonly string[];
  /** When set, the matching word prefix in the title is emphasized. */
  searchQuery?: string;
  searchFuzzy?: boolean;
  position?: ListPosition;
}

export const BookmarkRow = React.memo(function BookmarkRow({
  bookmark,
  onPress,
  onMore,
  onEnterSelection,
  selected,
  selectionMode,
  highlighted: highlightedProp,
  onTagPress,
  omitTagIds,
  searchQuery,
  searchFuzzy,
  position = "only",
}: BookmarkRowProps) {
  const { palette: basePalette, expressive } = useTheme();
  const router = useRouter();
  const rowRef = React.useRef<View>(null);
  const dragRow = useSelectionDragRow(bookmarkKey(bookmark.id));
  const bodyStartY = React.useRef(0);
  const bodyMoved = React.useRef(false);
  const leadStartY = React.useRef(0);
  const leadMoved = React.useRef(false);
  const setRowRef = React.useCallback(
    (node: View | null) => {
      rowRef.current = node;
      dragRow.bind(node);
    },
    [dragRow],
  );
  const selectionModeRef = React.useRef(!!selectionMode);
  selectionModeRef.current = !!selectionMode;
  const hold = useSelectionHoldGuard();
  const holdItemId = bookmark.id;
  const holdItemIdRef = React.useRef(holdItemId);
  if (holdItemIdRef.current !== holdItemId) {
    holdItemIdRef.current = holdItemId;
    hold.reset();
  }
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const menuKey = bookmarkKey(bookmark.id);
  const highlightedFromMenu = useMenuHighlightStore((s) => s.key === menuKey);
  const highlighted = highlightedProp ?? highlightedFromMenu;
  const palette = React.useMemo(() => selected || highlighted ? {
    ...basePalette, onSurface: basePalette.onSecondaryContainer, onSurfaceVariant: basePalette.onSecondaryContainer,
    text: basePalette.onSecondaryContainer, textSecondary: basePalette.onSecondaryContainer,
    textTertiary: basePalette.onSecondaryContainer, textFaint: basePalette.onSecondaryContainer,
  } : basePalette, [basePalette, selected, highlighted]);
  const titleColor = bookmark.isRead ? "secondary" : "primary";
  const domain = bookmark.domain || domainFromUrl(bookmark.url);
  const title = (bookmark.title || domain).replace(/\s+/g, " ");
  const createdLabel = relativeTime(bookmark.createdAt);
  const reminderLabel = bookmark.remindAt != null ? formatReminderWhen(bookmark.remindAt) : null;
  const reminderDue = bookmarkReminderStatus(bookmark.remindAt) === "due";
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  const [failedFavicon, setFailedFavicon] = React.useState<string | null>(null);
  if (failedFavicon != null && failedFavicon !== faviconUrl) setFailedFavicon(null);
  const opensAsWebsite = bookmarkOpensAsWebsite(bookmark);
  const isArticle = bookmarkIsArticle(bookmark);
  const showReadingTime = isArticle && !!bookmark.readingTimeMinutes;
  const isPending = bookmark.fetchStatus === "pending";
  const tags = Array.isArray(bookmark.tags) ? bookmark.tags : [];
  const suggestedTags = Array.isArray(bookmark.suggestedTags) ? bookmark.suggestedTags : [];
  const hasSuggestions = suggestedTags.length > 0;
  const rowTags = omitTagIds?.length
    ? tags.filter((tag) => !omitTagIds.includes(tag.id))
    : tags;
  const visibleTags = rowTags.slice(0, MAX_ROW_TAGS);
  const overflowCount = rowTags.length - visibleTags.length;
  const hasDetails = rowTags.length > 0 || !!reminderLabel || hasSuggestions;
  const accessibilityLabel = [
    title,
    domain,
    createdLabel,
    reminderLabel,
    ...tags.map((t) => `Tag ${t.name}`),
    hasSuggestions ? `${suggestedTags.length} tag suggestions` : undefined,
    !bookmark.isRead ? "Unread" : undefined,
    isArticle ? "Article" : undefined,
    isPending ? "Article processing" : undefined,
    opensAsWebsite ? "Opens as website" : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  const handleTagPress = (tagId: string) => {
    if (selectionMode) return;
    if (onTagPress) {
      onTagPress(tagId);
      return;
    }
    haptics.light();
    void prefetchTaggedBookmarks(tagId);
    router.push(`/tags/${tagId}`);
  };

  const openBookmark = () => {
    if (dragRow.consumePress()) return;
    if (hold.consumePress()) return;
    if (selectionMode) {
      onPress(bookmark);
      return;
    }
    haptics.light();
    onPress(bookmark);
  };

  const warmBookmark = () => {
    if (selectionMode) return;
    void prefetchBookmarkDetail(bookmark.id, bookmark.folderId);
  };

  const openMore = (event?: { nativeEvent: { pageX: number; pageY: number } }) => {
    haptics.light();
    measureAnchor(rowRef.current, (anchor) => onMore?.(bookmark, anchor), event);
  };

  const openExternal = (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    if (selectionMode) return;
    haptics.light();
    openBookmarkInExternalBrowser(bookmark);
  };

  const rowFill = selected || highlighted
    ? palette.secondaryContainer
    : pressed || hovered
      ? `${palette.onSurface}${pressed ? "1f" : "14"}`
      : "transparent";

  return (
    <ThemeOverrideProvider palette={palette}>
    <View
      ref={setRowRef}
      collapsable={false}
      onLayout={selectionMode ? () => dragRow.bind(rowRef.current) : undefined}
      style={[
        styles.wrap,
        { borderBottomColor: palette.outlineVariant, borderBottomWidth: expressive ? 0 : StyleSheet.hairlineWidth,
          backgroundColor: expressive ? palette.surfaceContainerLow : "transparent",
          borderRadius: expressive ? radius.lg : 0, marginBottom: expressive ? spacing[4] : 0 },
        expressive ? listCorners(position, !!selected || !!highlighted) : null,
      ]}
      {...(Platform.OS === "web"
        ? {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onContextMenu:
              onMore && !selectionMode
                ? (event: { preventDefault?: () => void }) => {
                    event.preventDefault?.();
                    openMore();
                  }
                : undefined,
            onKeyDown: onMore && !selectionMode ? (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openMore(); }
            } : undefined,
          }
        : null)}
    >
      <RowHighlight color={rowFill} />
      <SelectionDragHandle
        selectionKey={bookmarkKey(bookmark.id)}
        selectionMode={!!selectionMode}
        onEnter={
          onEnterSelection
            ? () => {
                if (selectionModeRef.current) return;
                hold.markEnter();
                onEnterSelection(bookmark);
              }
            : undefined
        }
        style={styles.leadingHit}
      >
      <ListPressable
        feedback={false}
        accessibilityRole="button"
        accessibilityLabel={`Select ${title}`}
        accessibilityHint="Press and hold to select"
        accessible={!selectionMode}
        importantForAccessibility={selectionMode ? "no" : "yes"}
        style={[styles.leading, hasDetails ? { justifyContent: "flex-start" } : null]}
        onTouchStart={(event) => {
          leadStartY.current = event.nativeEvent.pageY;
          leadMoved.current = false;
        }}
        onTouchMove={(event) => {
          if (Math.abs(event.nativeEvent.pageY - leadStartY.current) > 10) leadMoved.current = true;
        }}
        onPressIn={() => {
          setPressed(true);
          hold.pressIn();
          warmBookmark();
        }}
        onPressOut={() => { setPressed(false); hold.pressOut(); }}
        onPress={() => {
          if (leadMoved.current) return;
          openBookmark();
        }}
      >
        <View pointerEvents="none">
        {selectionMode ? (
          <SelectionMark selected={!!selected} />
        ) : (
          <View
            style={[
              styles.faviconFrame,
               { backgroundColor: selected || highlighted ? palette.secondaryContainer : palette.surfaceContainerHighest, borderColor: "transparent", borderRadius: expressive ? radius.md : radius.full },
            ]}
          >
            {failedFavicon === faviconUrl ? (
              <Ionicons
                name="globe-outline"
                size={ROW_ICON_GLYPH}
                color={palette.textTertiary}
                accessible={false}
              />
            ) : (
              <Image
                source={{ uri: faviconUrl }}
                recyclingKey={bookmark.id}
                style={styles.favicon}
                contentFit="contain"
                cachePolicy="memory-disk"
                accessible={false}
                onError={() => setFailedFavicon(faviconUrl)}
              />
            )}
            {!bookmark.isRead ? (
              <View style={[styles.unreadDot, { backgroundColor: palette.accent }]} />
            ) : null}
          </View>
        )}
        </View>
      </ListPressable>
      </SelectionDragHandle>

      <ListPressable
        feedback={false}
        accessibilityRole={selectionMode ? "checkbox" : "button"}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={selectionMode ? { checked: !!selected } : { selected: !!selected }}
        accessibilityHint={
          selectionMode
            ? selected
              ? "Deselect this bookmark"
              : "Select this bookmark"
            : onMore
              ? "Press and hold for more actions"
              : undefined
        }
        accessibilityActions={
          onMore && !selectionMode ? [{ name: "more", label: "More actions" }] : undefined
        }
        onAccessibilityAction={
          onMore && !selectionMode
            ? (event) => {
                if (event.nativeEvent.actionName === "more") openMore();
              }
            : undefined
        }
        style={styles.body}
        onTouchStart={(event) => {
          bodyStartY.current = event.nativeEvent.pageY;
          bodyMoved.current = false;
        }}
        onTouchMove={(event) => {
          if (Math.abs(event.nativeEvent.pageY - bodyStartY.current) > 10) bodyMoved.current = true;
        }}
        onPressIn={() => {
          setPressed(true);
          hold.pressIn();
          warmBookmark();
        }}
        onPressOut={() => { setPressed(false); hold.pressOut(); }}
        onPress={() => {
          if (bodyMoved.current) return;
          openBookmark();
        }}
        onLongPress={selectionMode ? undefined : onMore ? (event) => openMore(event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.titleWrap}>
              <Text variant="headline" color={titleColor} numberOfLines={1} ellipsizeMode="tail">
                {highlightTitle(title, searchQuery, searchFuzzy, !!selected || !!highlighted)}
              </Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text variant="bodySmall" color="tertiary" numberOfLines={1} style={styles.domain}>{domain}</Text>
            {!showReadingTime ? <Text variant="bodySmall" color="tertiary" numberOfLines={1} style={{ flexShrink: 0 }}>{createdLabel}</Text> : null}
            {isPending ? (
              <RowStatusSlot>
                <Spinner
                  size={ROW_STATUS_ICON_SIZE}
                  color={palette.textTertiary}
                  accessible={false}
                />
              </RowStatusSlot>
            ) : isArticle ? (
              <View style={styles.readingTime}>
                <Ionicons
                  name="document-text-outline"
                  size={ROW_STATUS_ICON_SIZE}
                  color={palette.textTertiary}
                  accessible={false}
                />
                {showReadingTime ? <Text variant="bodySmall" color="tertiary">{bookmark.readingTimeMinutes} min</Text> : null}
              </View>
            ) : opensAsWebsite ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${title} in the browser`}
                accessibilityHint="Opens the original page in your browser app."
                hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
                disabled={selectionMode}
                onPressIn={(event) => event.stopPropagation()}
                onPress={openExternal}
                onLongPress={
                  selectionMode || !onMore ? undefined : (event) => {
                    event.stopPropagation();
                    openMore(event);
                  }
                }
                delayLongPress={SELECTION_LONG_PRESS_MS}
                style={({ pressed }) => [styles.openExternal, pressed ? styles.openExternalPressed : null]}
              >
                <RowStatusSlot>
                  <Ionicons
                    name="open-outline"
                    size={ROW_STATUS_ICON_SIZE}
                    color={palette.textTertiary}
                    accessible={false}
                  />
                </RowStatusSlot>
              </Pressable>
            ) : null}
          </View>
          {rowTags.length > 0 || reminderLabel ? (
            <View style={styles.detailsRow}>
              {visibleTags.map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  compact
                  inline
                  onPress={() => handleTagPress(tag.id)}
                  accessibilityLabel={`Show bookmarks tagged ${tag.name}`}
                />
              ))}
              {overflowCount > 0 ? (
                <Text variant="bodySmall" color="tertiary" style={styles.overflow}>
                  +{overflowCount}
                </Text>
              ) : null}
              {reminderLabel ? <View style={styles.reminderRow}>
                <Ionicons name="alarm-outline" size={ROW_STATUS_ICON_SIZE} color={reminderDue ? palette.primary : palette.onSurfaceVariant} />
                <Text variant="bodySmall" color={reminderDue ? "accent" : "tertiary"} numberOfLines={1} style={{ flexShrink: 1 }}>{reminderLabel}</Text>
              </View> : null}
            </View>
          ) : null}
          {hasSuggestions ? (
            <View style={styles.suggestionRow}>
              <Ionicons name="sparkles-outline" size={12} color={palette.accent} />
              <Text variant="footnote" color="accent">
                {suggestedTags.length} tag{" "}
                {suggestedTags.length === 1 ? "suggestion" : "suggestions"}
              </Text>
            </View>
          ) : null}
        </View>
      </ListPressable>
    </View>
    </ThemeOverrideProvider>
  );
});

const styles = StyleSheet.create({
  wrap: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: layout.rowInset,
    overflow: "hidden",
  },
  leadingHit: {
    alignSelf: "stretch",
  },
  leading: {
    alignSelf: "stretch",
     justifyContent: "center",
    alignItems: "center",
     paddingVertical: spacing[12],
    paddingLeft: layout.rowInset,
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
      paddingVertical: spacing[12],
     paddingLeft: spacing[16],
    paddingRight: spacing[8],
  },
  faviconFrame: {
    width: ROW_ICON_FRAME,
    height: ROW_ICON_FRAME,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  favicon: { width: 20, height: 20, borderRadius: radius.xs },
  unreadDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
  titleWrap: { flex: 1, minWidth: 0 },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: spacing[12],
    marginTop: spacing[4],
  },
  overflow: { marginLeft: spacing[2], flexShrink: 0 },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    marginTop: spacing[4],
  },
   metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[8], marginTop: spacing[4] },
   readingTime: { flexDirection: "row", alignItems: "center", gap: spacing[4], flexShrink: 0 },
   reminderRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing[4], maxWidth: "100%" },
  domain: { flex: 1, minWidth: 0 },
  openExternal: {
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
  openExternalPressed: { opacity: 0.72 },
});
