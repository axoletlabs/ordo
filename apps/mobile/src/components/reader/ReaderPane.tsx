/**
 * Reader: distraction-free article surface for a bookmark.
 *
 * Renders the server's sanitized semantic HTML natively (no WebView/JS) in a
 * reader-themed surface independent of the app theme, with account-synced
 * font/size/theme preferences and reading-progress tracking. Non-articles
 * open according to the website-browser setting; "Read in ordo" appears when
 * extraction actually produced an article.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Appearance,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useColorScheme, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { StatusBar, setStatusBarStyle } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_NAME, EXTRACTION_VERSION, READ_COMPLETION_THRESHOLD } from "@ordo/shared";
import type {
  ReaderPreferences,
  UpdateReaderPreferencesInput,
} from "@ordo/shared";
import { Header, HeaderActions, HeaderIconButton } from "../ui/Header";
import { ScreenContent } from "../ui/ScreenContent";
import { Text } from "../ui/Text";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { PressableScale } from "../ui/PressableScale";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { FloatingPanel } from "../ui/FloatingPanel";
import { PanelHeader } from "../ui/PanelHeader";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { sheetMenuStyles } from "../ui/SheetActionRow";
import { FAB, FABLayer } from "../ui/FAB";
import { ArticleHtml, type ArticleHeading } from "./ArticleHtml";
import { Markdown } from "./Markdown";
import { ReaderControlsSheet } from "./ReaderControlsSheet";
import { EditTagsSheet } from "../tags/EditTagsSheet";
import { UnlockScreen } from "../bookmarks/LockPrompt";
import { READER_BODY_SIZE, resolveReaderFont } from "./reader-typography";
import { ThemeOverrideProvider, useTheme } from "../../theme/ThemeProvider";
import { resolveReaderPalette } from "../../theme/reader-theme";
import { resolvePalette, type Palette } from "../../theme/theme";
import { scrollbarColors } from "../../theme/scrollbar";
import { queryClient } from "../../lib/query-client";
import { bookmarksApi } from "../../lib/api/bookmarks";
import { findBookmarkInCache, updateBookmarkEverywhere } from "../../lib/cache-helpers";
import { useBookmarkDetail, useToggleRead } from "../../hooks/use-bookmarks";
import * as bookmarkHooks from "../../hooks/use-bookmarks";
import { useFolders } from "../../hooks/queries";
import { useReaderPreferences } from "../../hooks/use-reader-preferences";
import { useSettingsStore } from "../../store/settings";
import { domainFromUrl, formatDate } from "../../lib/format";
import { errorMessage, folderProtectedId, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { layout, spacing } from "../../theme/tokens";
import { toast } from "../ui/toast-store";
import type { MenuAnchorRect } from "../../lib/menu-anchor";
import { BookmarkBrowser, type BookmarkBrowserHandle } from "../browser/BookmarkBrowser";
import {
  bookmarkCanBeArticle,
  bookmarkIsArticle,
  bookmarkOpensAsWebsite,
  canReadInOrdo,
} from "../../lib/bookmark-reader";
import { copyLink } from "../../lib/copy-link";
import { openExternalBrowser, openLivePage } from "../../lib/open-website";
import { scrollReadingProgress, shouldFlushReadingProgress } from "../../lib/reading-progress";

function useSetContentKindMissing() {
  return { mutate: () => undefined, isPending: false };
}

const useSetContentKind =
  typeof bookmarkHooks.useSetContentKind === "function"
    ? bookmarkHooks.useSetContentKind
    : useSetContentKindMissing;

export interface ReaderPaneProps {
  bookmarkId?: string;
  embedded?: boolean;
  onBack?: () => void;
  safeBottom?: boolean;
  /** Force the live website view (e.g. "Open original" from the library). */
  initialSurface?: "auto" | "browser";
}

/** Minimum change worth an eager write (throttles request-per-scroll). */
const PROGRESS_DELTA = 0.08;
/** Trailing idle window before a progress write is flushed. */
const PROGRESS_DEBOUNCE_MS = 1_500;
const CONTENTS_IDLE_DELAY_MS = 450;

/** Collapse whitespace/newlines so stored titles render as one line-ish. */
function normalizeTitle(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * ReaderPane resolves the account-synced reader preferences + palette and
 * themes the entire reader surface (header, article, controls sheet) with
 * them, independent of the app theme.
 */
export function ReaderPane(props: ReaderPaneProps) {
  const systemScheme = useColorScheme();
  const { preferences, setPreferences } = useReaderPreferences();
  const readerPalette = useMemo(
    () => resolveReaderPalette(preferences.theme, preferences.amoled, systemScheme),
    [preferences.theme, preferences.amoled, systemScheme],
  );

  // The reader surface owns the status bar (full-screen stack usage only);
  // on unmount, restore the style the app theme expects.
  useEffect(() => {
    return () => {
      const { themeMode, amoled } = useSettingsStore.getState();
      const appMode = resolvePalette(themeMode, amoled, Appearance.getColorScheme()).mode;
      setStatusBarStyle(appMode === "dark" ? "light" : "dark");
    };
  }, []);

  return (
    <ReaderPaneInner
      {...props}
      preferences={preferences}
      onUpdatePreferences={setPreferences}
      readerPalette={readerPalette}
    />
  );
}

interface ReaderPaneInnerProps extends ReaderPaneProps {
  preferences: ReaderPreferences;
  onUpdatePreferences: (patch: UpdateReaderPreferencesInput) => void;
  readerPalette: Palette;
}

function ReaderPaneInner({
  bookmarkId,
  embedded = false,
  onBack,
  safeBottom = !embedded,
  initialSurface = "auto",
  preferences,
  onUpdatePreferences,
  readerPalette,
}: ReaderPaneInnerProps) {
  const { palette: appPalette } = useTheme();
  const forceWebsiteDark = useSettingsStore((s) => s.forceWebsiteDark);
  const settingsAmoled = useSettingsStore((s) => s.amoled);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();

  const cached = bookmarkId ? findBookmarkInCache(queryClient, bookmarkId) : undefined;
  const skipWebsiteDetail =
    (cached?.fetchStatus === "unsupported" || cached?.fetchStatus === "failed") &&
    cached.contentKindOverride !== "article" &&
    cached.contentKind !== "article";
  const detail = useBookmarkDetail(
    bookmarkId ?? "",
    !!bookmarkId && !skipWebsiteDetail,
    cached?.folderId,
  );
  const { data: folders } = useFolders();
  const protectedDetail = isFolderProtected(detail.error);
  const lockedFolderId = folderProtectedId(detail.error) ?? cached?.folderId ?? null;
  const lockedFolder = folders?.find((folder) => folder.id === lockedFolderId);

  const bookmark = protectedDetail ? undefined : detail.data ?? cached;
  const loading = !!bookmarkId && !bookmark && detail.isLoading;
  const hasHtml = !protectedDetail && !!detail.data?.contentHtml;
  // Compatibility: pre-versioning rows may only carry Markdown; current-version
  // content renders exclusively from detail HTML.
  const legacyMarkdown =
    !hasHtml &&
    bookmark?.fetchStatus === "ok" &&
    (bookmark.extractionVersion ?? 0) < EXTRACTION_VERSION &&
    !!bookmark?.contentMarkdown;
  const hasContent = hasHtml || legacyMarkdown;
  const preparingContent = bookmark?.fetchStatus === "pending";
  // Ok row whose detail (HTML) hasn't arrived yet, or failed to arrive.
  const waitingForHtml =
    !hasContent && bookmark?.fetchStatus === "ok" && detail.isLoading;
  const detailFetchFailed =
    !hasContent &&
    bookmark?.fetchStatus === "ok" &&
    !detail.isLoading &&
    !!detail.error;

  const [controlsOpen, setControlsOpen] = useState(false);
  const [actionPanel, setActionPanel] = useState<"actions" | "contents" | null>(null);
  const [actionsAnchor, setActionsAnchor] = useState<MenuAnchorRect | null>(null);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const [headingState, setHeadingState] = useState<{
    bookmarkId: string;
    headings: readonly ArticleHeading[];
  }>({ bookmarkId: "", headings: [] });
  const [contentsShortcutVisible, setContentsShortcutVisible] = useState(false);
  const [articleWidth, setArticleWidth] = useState(0);
  const [progress, setProgress] = useState(0);
  const [surface, setSurface] = useState<"auto" | "reader" | "browser">(
    initialSurface === "browser" ? "browser" : "auto",
  );

  const toggleRead = useToggleRead(bookmark?.folderId ?? null);
  const setContentKind = useSetContentKind();
  const markedRef = useRef<string | null>(null);
  const browserRef = useRef<BookmarkBrowserHandle>(null);
  const websiteViewRef = useRef(false);
  const [keptBrowserId, setKeptBrowserId] = useState<string | null>(null);
  const [pageHost, setPageHost] = useState<string | null>(null);

  // Auto-mark read on open — filed and unfiled (folderId null) alike.
  // Completion is driven by reading progress, never by opening.
  useEffect(() => {
    if (protectedDetail) return;
    if (bookmark && !bookmark.isRead && markedRef.current !== bookmark.id) {
      markedRef.current = bookmark.id;
      toggleRead.mutate({ id: bookmark.id, isRead: true });
    }
  }, [bookmark?.id, bookmark?.isRead, protectedDetail]);

  const domain = bookmark ? bookmark.domain || domainFromUrl(bookmark.url) : "";
  const displayTitle = bookmark
    ? normalizeTitle(bookmark.title) || domainFromUrl(bookmark.url)
    : "";
  const description = bookmark ? normalizeTitle(bookmark.description) : "";
  const byline = bookmark
    ? [
        bookmark.author?.trim() || null,
        bookmark.publishedAt ? formatDate(bookmark.publishedAt) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const headerSubtitle = bookmark
    ? bookmark.readingTimeMinutes
      ? `${bookmark.readingTimeMinutes} min read`
      : undefined
    : undefined;
  const readerBodySize = READER_BODY_SIZE[preferences.fontSize];
  const readerFont = resolveReaderFont(preferences.fontFamily);
  const readerBoldFont = resolveReaderFont(preferences.fontFamily, "700");
  const articleHeadings = headingState.bookmarkId === bookmark?.id ? headingState.headings : [];

  const handleHeadingsChange = useCallback(
    (headings: readonly ArticleHeading[]) => {
      if (bookmark?.id) setHeadingState({ bookmarkId: bookmark.id, headings });
    },
    [bookmark?.id],
  );

  const handleBack = () => {
    if (websiteViewRef.current && browserRef.current?.goBack()) return;
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) router.back();
  };

  const handleOpenOriginal = () => {
    if (!bookmark) return;
    haptics.light();
    const browser = useSettingsStore.getState().websiteBrowser;
    if (browser === "ordo") {
      setSurface("browser");
      return;
    }
    void openLivePage(bookmark.url, browser);
  };

  const handleOpenSystemBrowser = () => {
    if (!bookmark) return;
    void openExternalBrowser(bookmark.url);
  };

  const handleShare = () => {
    if (!bookmark) return;
    haptics.light();
    void Share.share({
      title: displayTitle,
      url: bookmark.url,
      message: Platform.OS === "ios" ? bookmark.url : `${displayTitle}\n${bookmark.url}`,
    }).catch(() => {});
  };

  const handleCopyLink = () => {
    if (!bookmark) return;
    void copyLink(bookmark.url);
  };

  const handleClassify = (asArticle: boolean) => {
    if (!bookmark) return;
    haptics.light();
    setContentKind.mutate(
      {
        id: bookmark.id,
        folderId: bookmark.folderId,
        contentKindOverride: asArticle ? "article" : "web",
      },
      {
        onSuccess: () => {
          setSurface("auto");
          toast.success(asArticle ? "Saved as an article" : "Saved as a website");
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't update this bookmark.")),
      },
    );
  };

  /* ---------------- non-articles: in-app website view ---------------- */

  const showWebsiteView =
    surface === "browser" || (surface === "auto" && !!bookmark && bookmarkOpensAsWebsite(bookmark));
  const showReadInOrdo = !!bookmark && canReadInOrdo(bookmark);
  const browserMounted = showWebsiteView || (!!bookmarkId && keptBrowserId === bookmarkId);
  websiteViewRef.current = showWebsiteView;
  const palette = showWebsiteView ? appPalette : readerPalette;
  const websiteChrome = forceWebsiteDark
    ? resolvePalette("dark", settingsAmoled, "dark").background
    : palette.background;
  const effectiveDark = palette.mode === "dark";

  useEffect(() => {
    setSurface(initialSurface === "browser" ? "browser" : "auto");
    setPageHost(null);
  }, [bookmarkId, initialSurface]);

  useEffect(() => {
    if (showWebsiteView && bookmarkId) setKeptBrowserId(bookmarkId);
  }, [showWebsiteView, bookmarkId]);

  /* ------------------------------ reading progress ----------------------------- */

  const scrollRef = useRef<ScrollView>(null);
  const trackProgressRef = useRef(false);
  const currentArticleRef = useRef<{ id: string; folderId: string | null } | null>(null);
  const initialProgressRef = useRef(0);
  const latestProgressRef = useRef(0);
  const persistedProgressRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const htmlReadyRef = useRef(false);
  const offsetRef = useRef(0);
  const viewHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRefs = useRef(new Map<string, View>());
  const articleHeaderHeightRef = useRef(0);
  const contentsShortcutVisibleRef = useRef(false);
  const contentsShortcutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHeadingRef = useCallback((id: string, view: View | null) => {
    if (view) headingRefs.current.set(id, view);
    else headingRefs.current.delete(id);
  }, []);

  const handleHeadingSelect = useCallback((id: string) => {
    const heading = headingRefs.current.get(id);
    const scrollContent = scrollRef.current?.getInnerViewNode();
    if (!heading || !scrollContent) return;
    heading.measureLayout(
      scrollContent,
      (_x, y) => {
        haptics.light();
        setActionPanel(null);
        scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing[16]), animated: true });
      },
      () => {},
    );
  }, []);

  const syncContentsShortcut = useCallback(
    (offset: number, headerHeight = articleHeaderHeightRef.current, defer = false) => {
      if (contentsShortcutTimerRef.current) {
        clearTimeout(contentsShortcutTimerRef.current);
        contentsShortcutTimerRef.current = null;
      }
      const eligible =
        hasHtml && articleHeadings.length >= 3 && offset >= headerHeight + spacing[16];
      const updateVisibility = (visible: boolean) => {
        if (visible === contentsShortcutVisibleRef.current) return;
        contentsShortcutVisibleRef.current = visible;
        setContentsShortcutVisible(visible);
      };
      if (!eligible) {
        updateVisibility(false);
        return;
      }
      if (!defer) {
        updateVisibility(true);
        return;
      }
      updateVisibility(false);
      contentsShortcutTimerRef.current = setTimeout(() => {
        contentsShortcutTimerRef.current = null;
        updateVisibility(true);
      }, CONTENTS_IDLE_DELAY_MS);
    },
    [articleHeadings.length, hasHtml],
  );

  useEffect(() => {
    syncContentsShortcut(offsetRef.current);
  }, [syncContentsShortcut]);

  useEffect(
    () => () => {
      if (contentsShortcutTimerRef.current) clearTimeout(contentsShortcutTimerRef.current);
    },
    [],
  );

  const persistProgress = useCallback(
    (id: string, folderId: string | null, value: number) => {
      const rounded = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
      // Optimistic: reflect in the detail + list caches immediately.
      updateBookmarkEverywhere(queryClient, id, (b) => ({
        ...b,
        readProgress: rounded,
        ...(rounded >= READ_COMPLETION_THRESHOLD
          ? { isRead: true, completedAt: b.completedAt ?? new Date().toISOString() }
          : {}),
      }));
      bookmarksApi
        .update(id, { readProgress: rounded }, { folderId })
        .then((updated) => {
          // Reconcile with server truth (completedAt/isRead); the spread keeps
          // detail-only fields like contentHtml.
          updateBookmarkEverywhere(queryClient, id, (b) => ({ ...b, ...updated }));
        })
        .catch(() => {
          /* best-effort; the server position stays canonical for next open */
        });
    },
    [],
  );

  const flushProgress = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const article = currentArticleRef.current;
    if (!article || !trackProgressRef.current) return;
    const value = latestProgressRef.current;
    const last = persistedProgressRef.current;
    if (last !== null && Math.abs(value - last) < 0.005) return;
    persistedProgressRef.current = value;
    persistProgress(article.id, article.folderId, value);
  }, [persistProgress]);

  const progressSV = useSharedValue(0);
  const trackWidthSV = useSharedValue(0);
  const progressFillStyle = useAnimatedStyle(() => ({
    width: Math.max(0, trackWidthSV.value * progressSV.value),
  }));

  const handleFraction = useCallback(
    (fraction: number) => {
      if (!trackProgressRef.current) return;
      progressSV.value = fraction;
      const pct = Math.round(fraction * 100);
      setProgress((prev) => (Math.round(prev * 100) === pct ? prev : fraction));
      latestProgressRef.current = fraction;
      const last = persistedProgressRef.current;
      if (shouldFlushReadingProgress(fraction, last, PROGRESS_DELTA, READ_COMPLETION_THRESHOLD)) {
        flushProgress();
      } else {
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushProgress, PROGRESS_DEBOUNCE_MS);
      }
    },
    [flushProgress, progressSV],
  );

  // Per-article baseline from the server; flush best-effort when leaving.
  useEffect(() => {
    const id = bookmark?.id;
    if (!id) return;
    const baseline = bookmark.readProgress ?? 0;
    currentArticleRef.current = { id, folderId: bookmark.folderId ?? null };
    initialProgressRef.current = baseline;
    latestProgressRef.current = baseline;
    persistedProgressRef.current = baseline;
    restoredRef.current = false;
    htmlReadyRef.current = false;
    offsetRef.current = 0;
    articleHeaderHeightRef.current = 0;
    progressSV.value = baseline;
    setProgress(baseline);
    if (contentsShortcutTimerRef.current) {
      clearTimeout(contentsShortcutTimerRef.current);
      contentsShortcutTimerRef.current = null;
    }
    contentsShortcutVisibleRef.current = false;
    setContentsShortcutVisible(false);
    return () => {
      flushProgress();
    };
  }, [bookmark?.id]);

  // Restore the saved reading position once layout + content size are known.
  const maybeRestore = useCallback(() => {
    if (restoredRef.current || !trackProgressRef.current) return;
    if (hasHtml && !htmlReadyRef.current) return;
    const viewH = viewHeightRef.current;
    const contentH = contentHeightRef.current;
    if (viewH <= 0 || contentH <= 0) return;
    const scrollable = contentH - viewH;
    // Placeholder/chrome can fit the viewport; wait until the article body
    // actually overflows before locking the restore.
    if (scrollable <= 0) return;
    restoredRef.current = true;
    if (offsetRef.current > 8) return;
    const target = initialProgressRef.current;
    if (target > 0.02 && target < READ_COMPLETION_THRESHOLD) {
      const y = target * scrollable;
      scrollRef.current?.scrollTo({ y, animated: false });
      offsetRef.current = y;
      syncContentsShortcut(y);
    }
  }, [hasHtml, syncContentsShortcut]);

  const handleArticleReady = useCallback(() => {
    htmlReadyRef.current = true;
    maybeRestore();
  }, [maybeRestore]);

  // Start tracking once content exists; retry restore in case the native
  // layout events fired before tracking was armed.
  useEffect(() => {
    trackProgressRef.current = hasContent;
    if (hasContent) maybeRestore();
  }, [hasContent, maybeRestore]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      offsetRef.current = contentOffset.y;
      viewHeightRef.current = layoutMeasurement.height;
      contentHeightRef.current = contentSize.height;
      syncContentsShortcut(contentOffset.y, articleHeaderHeightRef.current, true);
      if (contentSize.height <= 0 || layoutMeasurement.height <= 0) return;
      if (hasHtml && !htmlReadyRef.current) return;
      handleFraction(
        scrollReadingProgress(contentOffset.y, layoutMeasurement.height, contentSize.height),
      );
    },
    [handleFraction, hasHtml, syncContentsShortcut],
  );

  // Recompute when content settles/grows (images loading, HTML rendering).
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      contentHeightRef.current = h;
      maybeRestore();
      if (h <= 0 || viewHeightRef.current <= 0) return;
      if (hasHtml && !htmlReadyRef.current) return;
      handleFraction(scrollReadingProgress(offsetRef.current, viewHeightRef.current, h));
    },
    [handleFraction, hasHtml, maybeRestore],
  );

  const onScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewHeightRef.current = event.nativeEvent.layout.height;
      maybeRestore();
    },
    [maybeRestore],
  );

  /* ---------------------------------- render ---------------------------------- */

  const fallbackArticleWidth = Math.min(windowWidth, layout.maxContentWidth) - spacing[16] * 2;

  const rightActions = bookmark ? (
    <HeaderActions>
      {showWebsiteView ? (
        <HeaderIconButton
          name="open-outline"
          color={palette.text}
          onPress={() => handleOpenSystemBrowser()}
          accessibilityLabel="Open in external browser"
          accessibilityHint="Opens this page in Safari or Chrome."
        />
      ) : (
        <HeaderIconButton
          name="options-outline"
          color={palette.text}
          onPress={() => setControlsOpen(true)}
          accessibilityLabel="Reader settings"
          accessibilityHint="Adjust text size, typeface, and reading theme."
        />
      )}
      <HeaderIconButton
        name="ellipsis-horizontal"
        color={palette.text}
        onPress={(anchor) => {
          setActionsAnchor(anchor);
          setActionPanel("actions");
        }}
        accessibilityLabel={showWebsiteView ? "More page actions" : "More article actions"}
      />
    </HeaderActions>
  ) : undefined;

  const articleHead = (
    <>
      <Text
        variant="title1"
        style={{
          fontFamily: readerBoldFont,
          fontSize: Math.round(readerBodySize * 1.7),
          lineHeight: Math.round(readerBodySize * 2.05),
          letterSpacing: 0,
        }}
      >
        {displayTitle}
      </Text>
      {description ? (
        <Text
          variant="body"
          color="secondary"
          style={[
            styles.description,
            {
              fontFamily: readerFont,
              fontSize: readerBodySize,
              lineHeight: Math.round(readerBodySize * 1.5),
            },
          ]}
        >
          {description}
        </Text>
      ) : null}
      {byline ? (
        <Text
          variant="footnote"
          color="secondary"
          style={[
            styles.byline,
            {
              fontFamily: readerFont,
              fontSize: Math.max(11, readerBodySize - 3),
              lineHeight: Math.round(Math.max(11, readerBodySize - 3) * 1.45),
            },
          ]}
        >
          {byline}
        </Text>
      ) : null}
    </>
  );

  return (
    <ThemeOverrideProvider palette={palette}>
      {!embedded && !showWebsiteView ? (
        <StatusBar style={readerPalette.mode === "dark" ? "light" : "dark"} />
      ) : null}
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Header
        title={bookmark ? (showWebsiteView && pageHost ? pageHost : domain) : "Reader"}
        subtitle={showWebsiteView ? "Website" : headerSubtitle}
        showBack={!embedded}
        onBack={!embedded ? handleBack : undefined}
        safeTop={!embedded}
        maxWidth={layout.maxLibraryWidth}
        divider
        right={rightActions}
        onTitleLongPress={bookmark ? handleCopyLink : undefined}
        titleAccessibilityHint={bookmark ? "Copies the link." : undefined}
      />

      {hasContent && !showWebsiteView ? (
        <View
          style={[styles.progressTrack, { backgroundColor: scrollbarColors(palette).track }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Reading progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          onLayout={(event) => {
            trackWidthSV.value = event.nativeEvent.layout.width;
          }}
        >
          <Animated.View
            style={[
              styles.progressFill,
              { backgroundColor: palette.accent },
              progressFillStyle,
            ]}
          />
        </View>
      ) : null}

      {loading ? (
        <ScreenContent style={styles.stateBody}>
          <Skeleton width="80%" height={28} />
          <Skeleton width="100%" height={16} style={{ marginTop: spacing[16] }} />
          <Skeleton width="100%" height={16} style={{ marginTop: spacing[8] }} />
          <Skeleton width="65%" height={16} style={{ marginTop: spacing[8] }} />
        </ScreenContent>
      ) : protectedDetail ? (
        <ScreenContent style={styles.stateCenter}>
          {lockedFolderId ? (
            <UnlockScreen
              folderId={lockedFolderId}
              folderName={lockedFolder?.name}
              lockType={lockedFolder?.lockType}
              pinLength={lockedFolder?.pinLength}
              onUnlocked={() => void detail.refetch()}
            />
          ) : (
            <EmptyState
              icon="lock-closed-outline"
              title="This folder is locked"
              message="Unlock the folder to read it."
            />
          )}
        </ScreenContent>
      ) : !bookmark ? (
        <ScreenContent style={styles.stateCenter}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load this bookmark"
            message={detail.error ? errorMessage(detail.error) : undefined}
            action={
              <Button
                label={embedded ? "Retry" : "Go back"}
                variant="secondary"
                onPress={embedded ? () => detail.refetch() : handleBack}
              />
            }
          />
        </ScreenContent>
      ) : (
        <>
        {browserMounted ? (
        <View
          collapsable={false}
          style={[
            styles.browserPane,
            { backgroundColor: websiteChrome },
            !showWebsiteView && styles.browserParked,
          ]}
          pointerEvents={showWebsiteView ? "auto" : "none"}
          accessibilityElementsHidden={!showWebsiteView}
          importantForAccessibility={showWebsiteView ? "yes" : "no-hide-descendants"}
        >
          <BookmarkBrowser
            ref={browserRef}
            url={bookmark.url}
            active={showWebsiteView}
            onPageHost={setPageHost}
          />
        </View>
        ) : null}
        {!showWebsiteView ? (
        <View style={styles.scrollViewport}>
          <ThemedScrollView
            key={bookmark.id}
            ref={scrollRef}
            style={styles.scrollViewport}
            onLayout={onScrollViewLayout}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{
              paddingTop: spacing[16],
              paddingBottom: spacing[16] + (safeBottom ? insets.bottom : 0),
            }}
          >
            <ScreenContent style={styles.body}>
              <View
                style={styles.articleColumn}
                onLayout={(e) => setArticleWidth(e.nativeEvent.layout.width)}
              >
                <View
                  onLayout={(event) => {
                    const height = event.nativeEvent.layout.height;
                    articleHeaderHeightRef.current = height;
                    syncContentsShortcut(offsetRef.current, height);
                  }}
                >
                  {articleHead}
                </View>

                {hasHtml ? (
                <View style={styles.content}>
                  <ArticleHtml
                    html={detail.data?.contentHtml ?? ""}
                    preferences={preferences}
                    contentWidth={articleWidth || fallbackArticleWidth}
                    onHeadingsChange={handleHeadingsChange}
                    onHeadingRef={handleHeadingRef}
                    onReady={handleArticleReady}
                  />
                </View>
              ) : legacyMarkdown ? (
                <View style={styles.content}>
                  <Markdown>{bookmark.contentMarkdown ?? ""}</Markdown>
                </View>
              ) : detailFetchFailed ? (
                <EmptyState
                  compact
                  icon="cloud-offline-outline"
                  title="Couldn't load the article"
                  action={
                    <Button
                      label="Retry"
                      variant="secondary"
                      onPress={() => detail.refetch()}
                    />
                  }
                />
              ) : waitingForHtml ? (
                <View style={styles.inlineEmpty}>
                  <Skeleton width="100%" height={16} />
                  <Skeleton width="92%" height={16} style={{ marginTop: spacing[8] }} />
                  <Skeleton width="68%" height={16} style={{ marginTop: spacing[8] }} />
                </View>
              ) : preparingContent ? (
                <View style={styles.inlineEmpty}>
                  <Skeleton width="100%" height={16} />
                  <Skeleton width="92%" height={16} style={{ marginTop: spacing[8] }} />
                  <Skeleton width="68%" height={16} style={{ marginTop: spacing[8] }} />
                  <Text variant="footnote" color="secondary" style={styles.preparingText}>
                    Preparing this page…
                  </Text>
                </View>
              ) : bookmark.fetchStatus === "failed" ? (
                <EmptyState
                  compact
                  icon="cloud-offline-outline"
                  title="Couldn't load this page"
                  action={
                    <Button
                      label="Retry"
                      variant="secondary"
                      onPress={() => {
                        if (bookmark.contentKindOverride === "article") {
                          handleClassify(true);
                          return;
                        }
                        void detail.refetch();
                      }}
                    />
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon="reader-outline"
                  title="No readable content"
                  action={<Button label="Open original" onPress={handleOpenOriginal} />}
                />
                )}
              </View>
            </ScreenContent>
          </ThemedScrollView>
        </View>
        ) : null}
        </>
      )}

      {contentsShortcutVisible && actionPanel === null && !controlsOpen && !showWebsiteView ? (
        <FABLayer maxWidth={layout.maxLibraryWidth}>
          <FAB
            icon="list-outline"
            accessibilityLabel="Table of contents"
            accessibilityHint="Jump to a section in this article."
            onPress={() => {
              setActionPanel("contents");
            }}
            right={spacing[20]}
            bottom={spacing[20] + (safeBottom ? insets.bottom : 0)}
          />
        </FABLayer>
      ) : null}

      <ReaderControlsSheet
        visible={controlsOpen}
        onDismiss={() => setControlsOpen(false)}
        preferences={preferences}
        onUpdate={onUpdatePreferences}
        effectiveDark={effectiveDark}
      />
      <EditTagsSheet
        visible={editTagsOpen}
        bookmark={bookmark ?? null}
        onDismiss={() => setEditTagsOpen(false)}
      />
      <ContextMenu
        visible={actionPanel === "actions"}
        onDismiss={() => setActionPanel(null)}
        anchor={actionsAnchor}
      >
        {hasHtml && articleHeadings.length >= 3 && !showWebsiteView ? (
          <ContextMenuItem
            icon="list-outline"
            label="Table of contents"
            onPress={() => setActionPanel("contents")}
          />
        ) : null}
        {showWebsiteView ? (
          <ContextMenuItem
            icon="refresh-outline"
            label="Refresh"
            onPress={() => {
              setActionPanel(null);
              browserRef.current?.reload();
            }}
          />
        ) : null}
        <ContextMenuItem
          icon="share-social-outline"
          label={showWebsiteView ? "Share page" : "Share article"}
          onPress={() => {
            setActionPanel(null);
            handleShare();
          }}
        />
        <ContextMenuItem
          icon="link-outline"
          label="Copy link"
          onPress={() => {
            setActionPanel(null);
            handleCopyLink();
          }}
        />
        <ContextMenuItem
          icon="pricetags-outline"
          label="Edit tags"
          onPress={() => {
            setActionPanel(null);
            setEditTagsOpen(true);
          }}
        />
        {showWebsiteView && showReadInOrdo ? (
          <ContextMenuItem
            icon="reader-outline"
            label={`Read in ${APP_NAME}`}
            onPress={() => {
              setActionPanel(null);
              setSurface("reader");
            }}
          />
        ) : null}
        {bookmark && bookmarkIsArticle(bookmark) ? (
          <ContextMenuItem
            icon="globe-outline"
            label="Mark as website"
            onPress={() => {
              setActionPanel(null);
              handleClassify(false);
            }}
          />
        ) : bookmark && bookmarkCanBeArticle(bookmark) ? (
          <ContextMenuItem
            icon="reader-outline"
            label="Mark as article"
            onPress={() => {
              setActionPanel(null);
              handleClassify(true);
            }}
          />
        ) : null}
        {!showWebsiteView ? (
          <ContextMenuItem
            icon="globe-outline"
            label="Open original"
            onPress={() => {
              setActionPanel(null);
              handleOpenOriginal();
            }}
          />
        ) : null}
      </ContextMenu>
      <FloatingPanel visible={actionPanel === "contents"} onDismiss={() => setActionPanel(null)}>
        <PanelHeader title="Table of contents" />
        <ThemedScrollView style={styles.tocList}>
          {articleHeadings.map((heading) => (
            <PressableScale
              key={heading.id}
              style={[
                styles.tocRow,
                { paddingLeft: (heading.level - 1) * spacing[16] },
              ]}
              onPress={() => handleHeadingSelect(heading.id)}
              accessibilityRole="button"
              accessibilityLabel={`Go to ${heading.text}`}
            >
              <Text
                variant={heading.level === 1 ? "bodyStrong" : "body"}
                numberOfLines={2}
                style={styles.actionLabel}
              >
                {heading.text}
              </Text>
            </PressableScale>
          ))}
        </ThemedScrollView>
        <Button
          label="Article actions"
          variant="ghost"
          block
          onPress={() => setActionPanel("actions")}
          style={sheetMenuStyles.cancel}
        />
      </FloatingPanel>
    </View>
    </ThemeOverrideProvider>
  );
}

export function ReaderPanePlaceholder() {
  return (
    <View style={styles.stateCenter}>
      <EmptyState
        icon="reader-outline"
        title="Select a bookmark"
        message="Choose a bookmark from the list."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollViewport: { flex: 1 },
  body: { width: "100%" },
  articleColumn: { width: "100%" },
  description: { marginTop: spacing[8] },
  byline: { marginTop: spacing[6] },
  content: { marginTop: spacing[24] },
  actionLabel: { flex: 1 },
  tocList: { maxHeight: 420 },
  tocRow: { minHeight: 44, justifyContent: "center" },
  progressTrack: { height: 2, width: "100%", overflow: "hidden" },
  progressFill: { height: 2, alignSelf: "flex-start" },
  stateBody: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    paddingTop: spacing[16],
    paddingBottom: spacing[16],
  },
  stateCenter: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing[16],
    paddingBottom: spacing[16],
  },
  inlineEmpty: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[32],
  },
  preparingText: { marginTop: spacing[16], textAlign: "center" },
  browserPane: { flex: 1 },
  browserParked: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    zIndex: -1,
  },
});
