/**
 * A single bookmark row. Tapping opens the reader; a long-press on the row
 * reveals actions. Hold the favicon to multi-select.
 */
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ListPressable } from "../ui/ListPressable";
import { Spinner } from "../ui/Spinner";
import { Text } from "../ui/Text";
import { TagChip } from "../tags/TagChip";
import { SelectionMark } from "./SelectionMark";
import { useTheme } from "../../theme/ThemeProvider";
import { domainFromUrl, relativeTime } from "../../lib/format";
import { bookmarkIsArticle, bookmarkOpensAsWebsite } from "../../lib/bookmark-reader";
import { openBookmarkInExternalBrowser } from "../../lib/open-website";
import { haptics } from "../../lib/haptics";
import { measureAnchor, menuHoverFill, type MenuAnchorRect } from "../../lib/menu-anchor";
import { prefetchBookmarkDetail } from "../../hooks/use-bookmarks";
import { prefetchTaggedBookmarks } from "../../hooks/use-tags";
import { firstSearchHighlight } from "../../lib/search-bookmarks";
import { radius, spacing } from "../../theme/tokens";
import { bookmarkKey, SELECTION_LONG_PRESS_MS } from "../../hooks/use-selection";
import { useMenuHighlightStore } from "../../hooks/use-menu-highlight";
import type { BookmarkDto } from "@ordo/shared";

/** Compact tags shown inline on a row before overflow. */
const MAX_ROW_TAGS = 3;

function highlightTitle(title: string, query?: string, fuzzy = false) {
  const span = query ? firstSearchHighlight(title, query, fuzzy) : null;
  if (!span) return title;
  return (
    <>
      {title.slice(0, span.start)}
      <Text variant="headline" color="accent">
        {title.slice(span.start, span.end)}
      </Text>
      {title.slice(span.end)}
    </>
  );
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
}: BookmarkRowProps) {
  const { palette } = useTheme();
  const router = useRouter();
  const rowRef = React.useRef<View>(null);
  const [hovered, setHovered] = React.useState(false);
  const menuKey = bookmarkKey(bookmark.id);
  const highlightedFromMenu = useMenuHighlightStore((s) => s.key === menuKey);
  const highlighted = highlightedProp ?? highlightedFromMenu;
  const titleColor = bookmark.isRead ? "secondary" : "primary";
  const domain = bookmark.domain || domainFromUrl(bookmark.url);
  const title = bookmark.title || domain;
  const createdLabel = relativeTime(bookmark.createdAt);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  const [failedFavicon, setFailedFavicon] = React.useState<string | null>(null);
  const opensAsWebsite = bookmarkOpensAsWebsite(bookmark);
  const isArticle = bookmarkIsArticle(bookmark);
  const showReadingTime = isArticle && !!bookmark.readingTimeMinutes;
  const showDescription = isArticle && !!bookmark.description;
  const isPending = bookmark.fetchStatus === "pending";
  const tags = Array.isArray(bookmark.tags) ? bookmark.tags : [];
  const suggestedTags = Array.isArray(bookmark.suggestedTags) ? bookmark.suggestedTags : [];
  const hasSuggestions = suggestedTags.length > 0;
  const rowTags = omitTagIds?.length
    ? tags.filter((tag) => !omitTagIds.includes(tag.id))
    : tags;
  const visibleTags = rowTags.slice(0, MAX_ROW_TAGS);
  const overflowCount = rowTags.length - visibleTags.length;
  const accessibilityLabel = [
    title,
    domain,
    createdLabel,
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
            onContextMenu:
              onMore && !selectionMode
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
        accessibilityLabel={`Select ${title}`}
        accessibilityHint="Press and hold to select"
        accessible={!selectionMode}
        importantForAccessibility={selectionMode ? "no" : "yes"}
        style={styles.leading}
        onPressIn={warmBookmark}
        onPress={openBookmark}
        onLongPress={
          selectionMode || !onEnterSelection ? undefined : () => onEnterSelection(bookmark)
        }
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        {selectionMode ? (
          <SelectionMark selected={!!selected} />
        ) : (
          <View
            style={[
              styles.faviconFrame,
              { backgroundColor: palette.surfaceSecondary, borderColor: palette.border },
            ]}
          >
            {failedFavicon === faviconUrl ? (
              <Ionicons
                name="globe-outline"
                size={18}
                color={palette.textTertiary}
                accessible={false}
              />
            ) : (
              <Image
                source={{ uri: faviconUrl }}
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
      </ListPressable>

      <ListPressable
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
        onPressIn={warmBookmark}
        onPress={openBookmark}
        onLongPress={selectionMode ? undefined : onMore ? (event) => openMore(event) : undefined}
        delayLongPress={SELECTION_LONG_PRESS_MS}
      >
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text variant="headline" color={titleColor} numberOfLines={1} style={styles.title}>
              {highlightTitle(title, searchQuery, searchFuzzy)}
            </Text>
            {isArticle ? (
              <Ionicons
                name="document-text-outline"
                size={14}
                color={palette.textTertiary}
                style={styles.articleIcon}
                accessible={false}
              />
            ) : null}
          </View>
          {showDescription ? (
            <Text variant="footnote" color="secondary" numberOfLines={1} style={styles.description}>
              {bookmark.description}
            </Text>
          ) : null}
          {rowTags.length > 0 ? (
            <View style={styles.tagRow}>
              {visibleTags.map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  compact
                  onPress={() => handleTagPress(tag.id)}
                  accessibilityLabel={`Show bookmarks tagged ${tag.name}`}
                />
              ))}
              {overflowCount > 0 ? (
                <Text variant="caption" color="tertiary" style={styles.overflow}>
                  +{overflowCount}
                </Text>
              ) : null}
            </View>
          ) : null}
          {hasSuggestions ? (
            <View style={styles.suggestionRow}>
              <Ionicons name="sparkles-outline" size={12} color={palette.accent} />
              <Text variant="caption" color="accent">
                {suggestedTags.length} tag{" "}
                {suggestedTags.length === 1 ? "suggestion" : "suggestions"}
              </Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text variant="caption" color="tertiary" numberOfLines={1} style={styles.domain}>
              {domain}
            </Text>
            <View style={[styles.separator, { backgroundColor: palette.textFaint }]} />
            <Text variant="caption" color="tertiary" numberOfLines={1}>
              {createdLabel}
            </Text>
            {showReadingTime ? (
              <>
                <View style={[styles.separator, { backgroundColor: palette.textFaint }]} />
                <Text variant="caption" color="tertiary" numberOfLines={1}>
                  {bookmark.readingTimeMinutes} min read
                </Text>
              </>
            ) : null}
            {isPending ? (
              <Spinner
                size="sm"
                color={palette.textTertiary}
                style={styles.statusIcon}
                accessible={false}
              />
            ) : opensAsWebsite ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${title} in the browser`}
                accessibilityHint="Opens the original page in your browser app."
                hitSlop={{ top: 6, bottom: 8, left: 2, right: 10 }}
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
                <Ionicons
                  name="open-outline"
                  size={13}
                  color={palette.textTertiary}
                  accessible={false}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </ListPressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: spacing[16],
  },
  leading: {
    alignSelf: "stretch",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing[12],
    paddingLeft: spacing[16],
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[12],
    paddingLeft: spacing[12],
    paddingRight: spacing[8],
  },
  faviconFrame: {
    width: 36,
    height: 36,
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[6] },
  title: { flex: 1, minWidth: 0 },
  articleIcon: { flexShrink: 0 },
  description: { marginTop: spacing[4] },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[4],
    marginTop: spacing[6],
  },
  overflow: { marginLeft: spacing[2] },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    marginTop: spacing[4],
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[6], marginTop: spacing[6] },
  domain: { flexShrink: 1 },
  separator: { width: 3, height: 3, borderRadius: radius.full },
  statusIcon: { marginLeft: spacing[2] },
  openExternal: {
    marginLeft: spacing[2],
    ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
  },
  openExternalPressed: { opacity: 0.72 },
});
