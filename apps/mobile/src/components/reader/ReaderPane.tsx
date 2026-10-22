/**
 * Reader: distraction-free article surface for a bookmark.
 *
 * Renders the server's sanitized semantic HTML natively (no WebView/JS) in a
 * reader-themed surface independent of the app theme, with account-synced
 * font/size/theme preferences and reading-progress tracking. Non-articles
 * open according to the website-browser setting; "Read in ordo" appears when
 * extraction actually produced an article.
 */
import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  findNodeHandle,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useWindowDimensions } from "react-native";
import { useSystemColorScheme } from "../../theme/use-system-color-scheme";
import { useSceneColumnInsets } from "../../hooks/use-scene-column-insets";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useComposedEventHandler, useSharedValue, type SharedValue } from "react-native-reanimated";
import { StatusBar, setStatusBarStyle } from "expo-status-bar";
import { useAppRouter as useRouter } from "../../hooks/use-app-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  HIGHLIGHT_QUOTE_MAX_LENGTH,
  HIGHLIGHTS_PER_BOOKMARK_MAX,
  READ_COMPLETION_THRESHOLD,
  formatHighlightQuote,
  planUnhighlight,
  selectionHighlightState,
  unionWithHighlights,
} from "@ordo/shared";
import type {
  HighlightAnchor,
  HighlightDto,
} from "@ordo/shared";
import { Header, HeaderActions, HeaderIconButton } from "../ui/Header";
import { ScreenContent } from "../ui/ScreenContent";
import { Text } from "../ui/Text";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { ThemedScrollView } from "../ui/ThemedScrollView";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import type { ArticleHeading } from "./ArticleHtml";
import { ReaderArticle } from "./ReaderArticle";
import { ReaderContents, type ReaderContentsHandle } from "./ReaderContents";
import { ReaderActions, type ReaderActionsHandle } from "./ReaderActions";
import { createReaderWorkScheduler } from "./reader-work";
import type { HighlightSelectDraft } from "./article-highlight-ui";
import { ReaderControlsSheet, type ReaderControlsSheetHandle } from "./ReaderControlsSheet";
import { LockPrompt } from "../bookmarks/LockPrompt";
import { READER_BODY_SIZE, resolveReaderFont, type ReaderContentPreferences } from "./reader-typography";
import { useReaderFontFamily } from "../../theme/fonts";
import { ThemeOverrideProvider, useTheme } from "../../theme/ThemeProvider";
import { resolveReaderPalette } from "../../theme/reader-theme";
import { pinSystemChrome } from "../../theme/pin-system-chrome";
import type { Palette } from "../../theme/theme";
import { currentAppPalette } from "../../theme/current-app-palette";
import { useDeviceColors } from "../../theme/device-colors";
import { LinearProgress } from "../ui/LinearProgress";
import { queryClient } from "../../lib/query-client";
import { bookmarksApi } from "../../lib/api/bookmarks";
import { findBookmarkInCache, updateBookmarkEverywhere } from "../../lib/cache-helpers";
import {
  useBookmarkDetail,
  useCreateHighlight,
  useRemoveHighlight,
  useUpdateHighlight,
} from "../../hooks/use-bookmarks";
import * as bookmarkHooks from "../../hooks/use-bookmarks";
import { useFolders } from "../../hooks/queries";
import { useReaderPreferences } from "../../hooks/use-reader-preferences";
import { useReaderChrome } from "../../hooks/use-reader-chrome";
import { useSettingsStore } from "../../store/settings";
import { domainFromUrl, formatDate } from "../../lib/format";
import { errorMessage, folderProtectedId, isFolderProtected } from "../../lib/error-message";
import { haptics } from "../../lib/haptics";
import { layout, spacing } from "../../theme/tokens";
import { toast } from "../ui/toast-store";
import { isMenuAnchorRect, type MenuAnchorRect } from "../../lib/menu-anchor";
import { BookmarkBrowser, type BookmarkBrowserHandle } from "../browser/BookmarkBrowser";
import {
  bookmarkOpensAsWebsite,
  canReadInOrdo,
} from "../../lib/bookmark-reader";
import { copyLink, copyText } from "../../lib/copy-link";
import { ackBookmarkOpened, openExternalBrowser, openLivePage } from "../../lib/open-website";
import { reminderClearsOnOpen } from "../../lib/bookmark-reminders";
import {
  measureReadingProgress,
  reconcileReadingProgress,
  restoreReadingOffset,
  scrollReadingProgress,
  shouldFlushReadingProgress,
  READING_RESTORE_MIN,
  READING_SHORT_SETTLE_MS,
  type ReadingProgress,
} from "../../lib/reading-progress";
import { fabContentPadding } from "../../lib/fab-layout";
import { useReducedMotionPreference } from "../../hooks/use-reduced-motion-preference";
import { createLatestWriteQueue } from "../../lib/latest-write-queue";
import { captureSessionScope, isSessionScopeCurrent, type SessionScope } from "../../lib/session-scope";
import { useAuthStore } from "../../store/auth";

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
/** Movement (dp) before the first restore that counts as the reader's own
 * position. A tap, bounce, or queued mount report must not cancel the saved
 * position, but a real scroll while sections are still mounting must. */
const USER_SCROLL_INTENT_MIN = 4;
const SELECT_OPEN_MS = 280;const SELECT_CLOSE_MS = 140;

// Survive reader unmount/reopen: a late write from the previous screen must
// not race the new screen's progress for the same account/server/article.
const saveProgress = createLatestWriteQueue(
  async (write: { id: string; folderId: string | null; progress: number; userId: string | undefined; server: string; scope: SessionScope }) => {
    if (!isSessionScopeCurrent(write.scope) || !write.userId || useAuthStore.getState().user?.id !== write.userId || useSettingsStore.getState().serverUrl !== write.server) return null;
    return bookmarksApi.update(write.id, { readProgress: write.progress }, { folderId: write.folderId });
  },
  (updated, write) => {
    if (!updated || !isSessionScopeCurrent(write.scope) || useAuthStore.getState().user?.id !== write.userId || useSettingsStore.getState().serverUrl !== write.server) return;
    // A concurrent move/tag edit is unrelated to progress. Do not restore its
    // older folder/tags from the full DTO returned by this request.
    updateBookmarkEverywhere(queryClient, write.id, (bookmark) => reconcileReadingProgress(bookmark, updated));
  },
);

/** Collapse whitespace/newlines so stored titles render as one line-ish. */
function normalizeTitle(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** True when the dek is the title again, or the title jammed into the next sentence. */
function isRedundantReaderDescription(title: string, description: string): boolean {
  if (!title || !description) return false;
  if (description === title) return true;
  return (
    description.startsWith(title) &&
    description.length > title.length &&
    !/\s/.test(description[title.length]!)
  );
}

const EMPTY_HIGHLIGHTS: HighlightDto[] = [];

/** Reading progress rule; keeps the announced whole percent as local state. */
function ReaderProgressBar({ animatedValue, labelRef, initialValue }: {
  animatedValue: SharedValue<number>;
  labelRef: React.MutableRefObject<(value: number) => void>;
  initialValue: number;
}) {
  const [progress, setProgress] = useState(() =>
    Number.isFinite(initialValue) ? Math.min(1, Math.max(0, initialValue)) : 0);
  useLayoutEffect(() => {
    labelRef.current = (value) => setProgress((previous) =>
      Math.round(previous * 100) === Math.round(value * 100) ? previous : value);
    return () => {
      labelRef.current = () => {};
    };
  }, [labelRef]);
  return (
    <LinearProgress label="Reading progress" value={progress} animatedValue={animatedValue}
      style={{ maxWidth: layout.maxReaderWidth, alignSelf: "center" }} />
  );
}

/**
 * ReaderPane resolves the account-synced reader preferences + palette and
 * themes the entire reader surface (header, article, controls sheet) with
 * them, independent of the app theme.
 */
export function ReaderPane(props: ReaderPaneProps) {
  const systemScheme = useSystemColorScheme();
  const { preferences } = useReaderPreferences();
  const materialYouColors = useSettingsStore((s) => s.materialYouColors);
  const deviceColors = useDeviceColors();
  const expressive = useSettingsStore((s) => s.expressive);
  const contrast = useSettingsStore((s) => s.themeContrast);
  const readerPalette = useMemo(
    () => resolveReaderPalette(preferences.theme, preferences.amoled, systemScheme, { expressive, contrast, deviceColors: materialYouColors ? deviceColors : null }),
    [preferences.theme, preferences.amoled, systemScheme, deviceColors, materialYouColors, expressive, contrast],
  );
  // Commit control feedback first; let a long article reflow at interruptible
  // priority. Only layout fields are deferred and compared: palette/theme and
  // server acknowledgements with equal values must not hand the article a new
  // preference object (or reconcile its sections) for unchanged text.
  const deferredFontFamily = useDeferredValue(preferences.fontFamily);
  const deferredFontSize = useDeferredValue(preferences.fontSize);
  const deferredLineSpacing = useDeferredValue(preferences.lineSpacing);
  const contentPreferences = useMemo<ReaderContentPreferences>(
    () => ({
      fontFamily: deferredFontFamily,
      fontSize: deferredFontSize,
      lineSpacing: deferredLineSpacing,
    }),
    [deferredFontFamily, deferredFontSize, deferredLineSpacing],
  );

  // The reader surface owns the status bar (full-screen stack usage only);
  // on unmount, restore the style the app theme expects.
  useEffect(() => {
    return () => {
      const appMode = currentAppPalette().mode;
      setStatusBarStyle(appMode === "dark" ? "light" : "dark");
    };
  }, []);

  return (
    <ReaderPaneInner
      {...props}
      contentPreferences={contentPreferences}
      readerPalette={readerPalette}
    />
  );
}

interface ReaderPaneInnerProps extends ReaderPaneProps {
  /** Article layout preferences trail the controls by one deferred pass;
   * palette and the controls panel update immediately. */
  contentPreferences: ReaderContentPreferences;
  readerPalette: Palette;
}

const ReaderPaneInner = React.memo(function ReaderPaneInner({
  bookmarkId,
  embedded = false,
  onBack,
  safeBottom = !embedded,
  initialSurface = "auto",
  contentPreferences,
  readerPalette,
}: ReaderPaneInnerProps) {
  const { palette: appPalette } = useTheme();
  const forceWebsiteDark = useSettingsStore((s) => s.forceWebsiteDark);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const { sceneWidth } = useSceneColumnInsets();

  // The row is only a first-paint fallback; detail is the live query. Do not
  // scan every loaded folder/search page whenever reader chrome changes.
  const cached = useMemo(() => bookmarkId ? findBookmarkInCache(queryClient, bookmarkId) : undefined, [bookmarkId]);
  const reducedMotion = useReducedMotionPreference();
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
  const hasContent = hasHtml;
  const preparingContent = bookmark?.fetchStatus === "pending";
  // Ok row whose detail (HTML) hasn't arrived yet, or failed to arrive.
  const waitingForHtml =
    !hasContent && bookmark?.fetchStatus === "ok" && detail.isLoading;
  const detailFetchFailed =
    !hasContent &&
    bookmark?.fetchStatus === "ok" &&
    !detail.isLoading &&
    !!detail.error;

  const controlsRef = useRef<ReaderControlsSheetHandle>(null);
  const openControls = useCallback(() => controlsRef.current?.open(), []);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const actionsRef = useRef<ReaderActionsHandle>(null);
  const contentsRef = useRef<ReaderContentsHandle>(null);
  const [headingState, setHeadingState] = useState<{
    bookmarkId: string;
    headings: readonly ArticleHeading[];
  }>({ bookmarkId: "", headings: [] });
  const [articleWidth, setArticleWidth] = useState(0);
  // Scroll progress drives the bar on the UI thread (progressSV); the whole
  // percent only feeds assistive tech. ReaderProgressBar owns that state so a
  // reading scroll re-renders the bar, not this entire pane, at every 1%.
  const progressLabelRef = useRef<(value: number) => void>(() => {});
  const [surface, setSurface] = useState<"auto" | "reader" | "browser">(
    initialSurface === "browser" ? "browser" : "auto",
  );
  const [selectionMenu, setSelectionMenu] = useState<{
    draft: HighlightSelectDraft;
    anchor: MenuAnchorRect;
  } | null>(null);
  const selectionMenuRef = useRef(selectionMenu);
  selectionMenuRef.current = selectionMenu;
  // Scrolling while the menu is open rewrites only its anchor. Keep the draft
  // separate so that anchor-only updates neither re-run the article scan for
  // highlight overlap nor rebuild selection callbacks.
  const selectionDraft = selectionMenu?.draft ?? null;
  const selectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuScrollY = useRef(0);

  const setContentKind = useSetContentKind();
  const createHighlight = useCreateHighlight();
  const updateHighlight = useUpdateHighlight();
  const removeHighlight = useRemoveHighlight();
  const markedRef = useRef<string | null>(null);
  const browserRef = useRef<BookmarkBrowserHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const readerWork = useMemo(() => createReaderWorkScheduler(), [bookmarkId]);
  useEffect(() => () => readerWork.dispose(), [readerWork]);
  const offsetRef = useRef(0);
  // Chrome (header + progress rule) overlays the article and slides away on
  // real user drags only; programmatic scrolls (position restore, TOC jumps)
  // never yank it around. The article scrolls underneath the overlay.
  const chromeHeightSV = useSharedValue(0);
  const collapsingFab = useReaderChrome(!!selectionMenu, chromeHeightSV);
  const expandChromeRef = useRef(collapsingFab.expand);
  expandChromeRef.current = collapsingFab.expand;
  const chromeHeightRef = useRef(0);
  const [chromeHeight, setChromeHeight] = useState(0);
  // Capture only the shared value: the controller also owns a JS-only native
  // event registration that Worklets cannot serialize onto the UI thread.
  const chromeHidden = collapsingFab.hidden;
  const chromeShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(chromeHeightSV.value, Math.max(0, chromeHidden.value)) }],
  }));
  const websiteViewRef = useRef(false);
  const [keptBrowserId, setKeptBrowserId] = useState<string | null>(null);
  const [pageHost, setPageHost] = useState<string | null>(null);

  // Auto-mark read on open — filed and unfiled (folderId null) alike.
  // Completion is driven by reading progress, never by opening.
  // A due reminder clears on open; upcoming reminders stay until they fire.
  useEffect(() => {
    if (protectedDetail) return;
    if (!bookmark) return;
    if (markedRef.current === bookmark.id) return;
    const due = reminderClearsOnOpen(bookmark.remindAt);
    if (bookmark.isRead && !due) return;
    markedRef.current = bookmark.id;
    ackBookmarkOpened(bookmark);
  }, [bookmark?.id, bookmark?.isRead, bookmark?.remindAt, protectedDetail]);

  useEffect(() => {
    setUnlockOpen(protectedDetail && Boolean(lockedFolderId));
  }, [lockedFolderId, protectedDetail]);

  const domain = bookmark ? bookmark.domain || domainFromUrl(bookmark.url) : "";
  const displayTitle = bookmark
    ? normalizeTitle(bookmark.title) || domainFromUrl(bookmark.url)
    : "";
  const descriptionRaw = bookmark ? normalizeTitle(bookmark.description) : "";
  const description =
    descriptionRaw && !isRedundantReaderDescription(displayTitle, descriptionRaw)
      ? descriptionRaw
      : "";
  const byline = bookmark
    ? [
        bookmark.author?.trim() || null,
        bookmark.publishedAt ? formatDate(bookmark.publishedAt) : null,
        bookmark.readingTimeMinutes ? `${bookmark.readingTimeMinutes} min read` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const readerBodySize = READER_BODY_SIZE[contentPreferences.fontSize];
  // Reading faces load per family; until the chosen one is ready the article
  // keeps the previous family (or a skeleton on the very first open).
  const readerFamily = useReaderFontFamily(contentPreferences.fontFamily);
  const articlePreferences = useMemo(
    () => readerFamily && readerFamily !== contentPreferences.fontFamily
      ? { ...contentPreferences, fontFamily: readerFamily }
      : contentPreferences,
    [contentPreferences, readerFamily],
  );
  const readerFont = resolveReaderFont(articlePreferences.fontFamily);
  const readerBoldFont = resolveReaderFont(articlePreferences.fontFamily, "700");
  const articleHeadings = headingState.bookmarkId === bookmark?.id ? headingState.headings : [];
  const highlights = detail.data?.highlights ?? EMPTY_HIGHLIGHTS;

  const handleHeadingsChange = useCallback(
    (headings: readonly ArticleHeading[]) => {
      if (bookmark?.id) setHeadingState({ bookmarkId: bookmark.id, headings });
    },
    [bookmark?.id],
  );

  const handleBack = () => {
    if (websiteViewRef.current && browserRef.current?.goBack()) return true;
    if (onBack) {
      return onBack();
    }
    return router.canGoBack() ? router.back() : router.replace("/");
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

  const handleTextSelect = useCallback((draft: HighlightSelectDraft | null) => {
    if (selectTimer.current) {
      clearTimeout(selectTimer.current);
      selectTimer.current = null;
    }
    if (!draft) {
      selectTimer.current = setTimeout(() => {
        selectTimer.current = null;
        setSelectionMenu(null);
      }, SELECT_CLOSE_MS);
      return;
    }
    const open = () => {
      if (!isMenuAnchorRect(draft.anchor)) return;
      menuScrollY.current = offsetRef.current;
      // A tap on a saved highlight addresses the whole highlight: resolve the
      // stored quote so copy/remove operate on it, not the tapped fragment.
      let resolved = draft;
      if (draft.whole && draft.highlightId) {
        const record = highlights.find((row) => row.id === draft.highlightId);
        if (record) {
          resolved = {
            ...draft,
            exact: record.exact,
            prefix: record.prefix ?? "",
            suffix: record.suffix ?? "",
            href: record.href ?? null,
          };
        }
      }
      setSelectionMenu({ draft: resolved, anchor: draft.anchor });
      actionsRef.current?.close();
    };
    if (selectionMenuRef.current) {
      open();
      return;
    }
    selectTimer.current = setTimeout(() => {
      selectTimer.current = null;
      open();
    }, SELECT_OPEN_MS);
  }, [highlights]);

  const dismissSelectionMenu = useCallback(() => {
    if (selectTimer.current) {
      clearTimeout(selectTimer.current);
      selectTimer.current = null;
    }
    setSelectionMenu(null);
  }, []);

  const saveHighlight = useCallback(
    (draft: HighlightAnchor & { href?: string | null }) => {
      if (!bookmark) return;
      const html = detail.data?.contentHtml;
      let quote = draft;
      let absorbIds: string[] = [];
      if (html) {
        const union = unionWithHighlights(html, highlights, draft);
        if (!union) {
          toast.error("That passage is not in the article.");
          return;
        }
        quote = union.quote;
        absorbIds = union.absorbIds;
      }
      if (quote.exact.length > HIGHLIGHT_QUOTE_MAX_LENGTH) {
        toast.error("Select a shorter passage.");
        return;
      }
      if (highlights.length - absorbIds.length >= HIGHLIGHTS_PER_BOOKMARK_MAX) {
        toast.error(`A bookmark can have at most ${HIGHLIGHTS_PER_BOOKMARK_MAX} highlights.`);
        return;
      }
      createHighlight.mutate(
        {
          id: bookmark.id,
          folderId: bookmark.folderId,
          exact: quote.exact,
          prefix: quote.prefix ?? "",
          suffix: quote.suffix ?? "",
          href: quote.href ?? null,
          absorbIds,
        },
        {
          onSuccess: () => {
            toast.success(absorbIds.length > 0 ? "Highlight updated" : "Highlighted");
          },
          onError: (err) => toast.error(errorMessage(err, "Couldn't save the highlight.")),
        },
      );
    },
    [bookmark, createHighlight, detail.data?.contentHtml, highlights],
  );

  const dropHighlight = useCallback(
    (highlightId: string) => {
      if (!bookmark) return;
      haptics.light();
      dismissSelectionMenu();
      removeHighlight.mutate(
        { id: bookmark.id, highlightId, folderId: bookmark.folderId },
        {
          onSuccess: () => toast.success("Highlight removed"),
          onError: (err) => toast.error(errorMessage(err, "Couldn't remove the highlight.")),
        },
      );
    },
    [bookmark, dismissSelectionMenu, removeHighlight],
  );

  const highlightChoice = useMemo(() => {
    if (!selectionDraft) return { overlappingIds: [] as string[], canHighlight: false, canRemove: false };
    const html = detail.data?.contentHtml;
    if (!html) return { overlappingIds: [], canHighlight: true, canRemove: false };
    return selectionHighlightState(html, highlights, selectionDraft);
  }, [detail.data?.contentHtml, highlights, selectionDraft]);

  const unhighlightSelection = useCallback(async () => {
    if (!bookmark || !selectionDraft) return;
    const html = detail.data?.contentHtml;
    if (!html) return;
    haptics.light();
    const plan = planUnhighlight(html, highlights, selectionDraft);
    if (plan.kind === "none") {
      toast.error("Couldn't update the highlight.");
      return;
    }
    if (highlights.length - plan.deleteIds.length + plan.creates.length > HIGHLIGHTS_PER_BOOKMARK_MAX) {
      toast.error(`A bookmark can have at most ${HIGHLIGHTS_PER_BOOKMARK_MAX} highlights.`);
      return;
    }
    try {
      dismissSelectionMenu();
      for (const row of plan.updates) {
        await updateHighlight.mutateAsync({
          id: bookmark.id,
          highlightId: row.id,
          folderId: bookmark.folderId,
          exact: row.quote.exact,
          prefix: row.quote.prefix ?? "",
          suffix: row.quote.suffix ?? "",
          href: row.quote.href ?? null,
        });
      }
      for (const extra of plan.creates) {
        await createHighlight.mutateAsync({
          id: bookmark.id,
          folderId: bookmark.folderId,
          exact: extra.exact,
          prefix: extra.prefix ?? "",
          suffix: extra.suffix ?? "",
          href: extra.href ?? null,
        });
      }
      for (const highlightId of plan.deleteIds) {
        await removeHighlight.mutateAsync({
          id: bookmark.id,
          highlightId,
          folderId: bookmark.folderId,
        });
      }
      const removedOnly = plan.deleteIds.length > 0 && plan.updates.length === 0 && plan.creates.length === 0;
      toast.success(removedOnly ? "Highlight removed" : "Highlight updated");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the highlight."));
    }
  }, [
    bookmark,
    createHighlight,
    detail.data?.contentHtml,
    dismissSelectionMenu,
    highlights,
    removeHighlight,
    selectionDraft,
    updateHighlight,
  ]);

  useEffect(() => {
    return () => {
      if (selectTimer.current) clearTimeout(selectTimer.current);
    };
  }, []);

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
  const hasContents = articleHeadings.length >= 3 && hasContent && !showWebsiteView;
  const contentsFabBottom = spacing[20] + (safeBottom ? insets.bottom : 0);
  // Reserve clearance even while selection or the contents panel hides the FAB,
  // so opening/dismissing overlays never changes the article's scroll range.
  const readerBottomPadding = hasContents
    ? fabContentPadding(insets.bottom, contentsFabBottom, spacing[8])
    : spacing[16] + (safeBottom ? insets.bottom : 0);
  const websiteChrome = forceWebsiteDark
    ? currentAppPalette("dark").background
    : palette.background;
  const effectiveDark = palette.mode === "dark";

  useEffect(() => {
    if (embedded || showWebsiteView) return;
    void pinSystemChrome(readerPalette).catch(() => {});
  }, [embedded, showWebsiteView, readerPalette]);

  // Restore on exit only. Restoring between palette updates flashes app
  // chrome through the reader's new theme and races asynchronous window writes.
  useEffect(() => {
    if (embedded || showWebsiteView) return;
    return () => {
      const app = currentAppPalette();
      void pinSystemChrome(app).catch(() => {});
      setStatusBarStyle(app.mode === "dark" ? "light" : "dark");
    };
  }, [embedded, showWebsiteView]);

  useEffect(() => {
    setSurface(initialSurface === "browser" ? "browser" : "auto");
    setPageHost(null);
  }, [bookmarkId, initialSurface]);

  // The website view sits below the app header: never leave it half-hidden.
  useEffect(() => {
    if (showWebsiteView) collapsingFab.expand(offsetRef.current);
  }, [collapsingFab, showWebsiteView]);

  useEffect(() => {
    if (showWebsiteView && bookmarkId) setKeptBrowserId(bookmarkId);
  }, [showWebsiteView, bookmarkId]);

  /* ------------------------------ reading progress ----------------------------- */

  const trackProgressRef = useRef(false);
  const currentArticleRef = useRef<{ id: string; folderId: string | null } | null>(null);
  // Capture ownership before navigation/logout cleanup can change global auth.
  // An outgoing reader must never enqueue its article against the next account.
  const progressOwner = useRef({ userId: useAuthStore.getState().user?.id, server: useSettingsStore.getState().serverUrl, scope: captureSessionScope() }).current;
  const initialProgressRef = useRef(0);
  // Last user-observed position that may be written. Measurements alone do not
  // update it: late images/font swaps move the bar, not the stored position.
  const latestProgressRef = useRef(0);
  const displayedProgressRef = useRef(0);
  const persistedProgressRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const userScrolledRef = useRef(false);
  const restoreTargetRef = useRef<number | null>(null);
  const restoreFromRef = useRef<number | null>(null);
  const restoreIssuedAtRef = useRef(0);
  const restoredContentHeightRef = useRef(0);
  const restoredViewportRef = useRef(0);
  const readingStartedRef = useRef(false);
  const htmlReadyRef = useRef(false);
  const viewHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const contentSettledRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingRefs = useRef(new Map<string, View>());
  const pendingHeading = useRef<string | null>(null);
  const selectHeadingRef = useRef<(id: string) => void>(() => {});
  const headingFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(headingFrame.current), []);

  const handleContentsRef = useCallback((handle: ReaderContentsHandle | null) => {
    contentsRef.current = handle;
    // Selection temporarily removes the Contents trigger. A remounted trigger
    // can prepare immediately if the article's one-time ready event already ran.
    if (htmlReadyRef.current) handle?.prepare();
  }, []);

  const handleHeadingRef = useCallback((id: string, view: View | null) => {
    if (view) {
      headingRefs.current.set(id, view);
      if (pendingHeading.current === id) {
        pendingHeading.current = null;
        headingFrame.current = requestAnimationFrame(() => selectHeadingRef.current(id));
      }
    }
    else headingRefs.current.delete(id);
  }, []);

  const handleHeadingSelect = useCallback((id: string) => {
    cancelAnimationFrame(headingFrame.current);
    const heading = headingRefs.current.get(id);
    const scroll = scrollRef.current;
    pendingHeading.current = null;
    if (!heading) { pendingHeading.current = id; return; }
    if (!scroll) return;
    haptics.light();
    // Re-sync the chrome machine with the current offset so the jump's own
    // scroll deltas don't toggle the header mid-flight.
    collapsingFab.expand(offsetRef.current);
    const jump = (contentY: number) => {
      if (!Number.isFinite(contentY)) return;
      scroll.scrollTo({ y: Math.max(0, contentY - spacing[16]), animated: !reducedMotion });
    };
    // Content-space Y = heading window Y - content-origin window Y, measured
    // in the same frame. measureLayout against the inner view silently no-ops
    // under Fabric; view-level window measurement works on Fabric and web
    // (RN-web attaches measureInWindow to host nodes).
    const withWindowY = (view: unknown) =>
      new Promise<number | null>((resolve) => {
        let settled = false;
        const done = (value: number | null) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };
        setTimeout(() => done(null), 200);
        const finish = (_x: number, y: number, width: number, height: number) => {
          done(!Number.isFinite(y) || (width === 0 && height === 0) ? null : y);
        };
        const measurable = view as {
          measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
        } | null;
        if (typeof measurable?.measureInWindow === "function") {
          measurable.measureInWindow(finish);
          return;
        }
        try {
          const handle = findNodeHandle(view as View);
          if (handle != null && typeof UIManager.measureInWindow === "function") {
            UIManager.measureInWindow(handle, finish);
            return;
          }
        } catch {
          // web: findNodeHandle is unsupported; host nodes carry measureInWindow.
        }
        done(null);
      });
    const inner = scroll.getInnerViewNode?.();
    void Promise.all([withWindowY(heading), withWindowY(inner)]).then(
      ([headingY, originY]) => {
        if (headingY == null || originY == null) return;
        jump(headingY - originY);
      },
    );
  }, [collapsingFab, reducedMotion]);
  selectHeadingRef.current = handleHeadingSelect;

  const persistProgress = useCallback(
    (id: string, folderId: string | null, value: number) => {
      const { userId, server, scope } = progressOwner;
      if (!isSessionScopeCurrent(scope) || !userId || useAuthStore.getState().user?.id !== userId || useSettingsStore.getState().serverUrl !== server) return;
      const rounded = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
      // Optimistic: reflect in the detail + list caches immediately.
      updateBookmarkEverywhere(queryClient, id, (b) => ({
        ...b,
        readProgress: rounded,
        ...(rounded >= READ_COMPLETION_THRESHOLD
          ? { isRead: true, completedAt: b.completedAt ?? new Date().toISOString() }
          : {}),
      }));
      saveProgress(`${server}:${userId}:${scope.generation}:${id}`, { id, folderId, progress: rounded, userId, server, scope });
    },
    [progressOwner],
  );

  const flushProgress = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const article = currentArticleRef.current;
    if (!article || !trackProgressRef.current) return;
    const value = latestProgressRef.current;
    if (!Number.isFinite(value)) return;
    const last = persistedProgressRef.current;
    if (last !== null && Math.abs(value - last) < 0.005) return;
    persistedProgressRef.current = value;
    persistProgress(article.id, article.folderId, value);
  }, [persistProgress]);

  const progressSV = useSharedValue(0);
  const progressTrackingSV = useSharedValue(false);
  const progressScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      if (!progressTrackingSV.value) return;
      const content = event.contentSize.height;
      const viewport = event.layoutMeasurement.height;
      // Keep the last bar through transient zero-size resize frames.
      if (!(content > 0) || !(viewport > 0)) return;
      progressSV.value = scrollReadingProgress(event.contentOffset.y, viewport, content);
    },
  });
  const readerScrollHandler = useComposedEventHandler([collapsingFab.scrollHandler, progressScrollHandler]);

  const measureProgress = useCallback(() => measureReadingProgress({
    offset: offsetRef.current,
    viewportHeight: viewHeightRef.current,
    contentHeight: contentHeightRef.current,
    // Readiness is the article tree finishing its commit, not merely detail
    // HTML arriving: the placeholder ScrollView is not a reading surface.
    ready: trackProgressRef.current && htmlReadyRef.current,
    settled: contentSettledRef.current,
  }), []);

  const applyReadingProgress = useCallback((reading: ReadingProgress, persist: boolean, paint: boolean) => {
    if (reading.measured) {
      displayedProgressRef.current = reading.fraction;
      // User scrolls are painted on the UI thread by progressScrollHandler;
      // a sampled JS write would race it backwards. Layout/restore changes
      // must paint immediately from the measured dimensions.
      if (paint) progressSV.value = reading.fraction;
      progressLabelRef.current(reading.fraction);
      // The UI-thread sampler only reads real overflow offsets. Short content
      // is completed by the settled JS measurement; leaving tracking armed
      // would let a bounce or resize frame overwrite it with 0.
      progressTrackingSV.value = !reading.short;
    } else {
      // No dimensions yet (or the article is empty): do not move the bar.
      progressTrackingSV.value = false;
    }
    // A restored position (or any real measured overflow) counts as reading
    // even when this sample is programmatic/measurement-only. That lets a
    // later scroll back to the top persist 0 instead of tripping the
    // completed-row guard below. Short content has no offset and must not mark
    // the row as started: it can grow into a real article under the top guard.
    if (reading.measured && !reading.short && reading.fraction > READING_RESTORE_MIN) {
      readingStartedRef.current = true;
    }
    if (!persist || !reading.measured || !trackProgressRef.current) return;
    // Fully visible content has no scroll position. The bar may show completion
    // after the settle window, but storage keeps the saved position/states.
    if (reading.short || reading.position === "empty") return;
    const last = persistedProgressRef.current;
    // A sample equal to the stored value is not a progress change. Adopt it and
    // drop any pending idle write before the completed-at-top guard: scrolling
    // back to the top from a sub-restore fraction never set readingStartedRef.
    if (last !== null && Math.abs(reading.fraction - last) < 0.005) {
      latestProgressRef.current = reading.fraction;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      return;
    }
    // A completed article opens at the top. A tap/overscroll at the top must
    // not rewrite its stored completion before the reader moves down.
    if (reading.atTop && !readingStartedRef.current) return;
    // Sample non-equal positions before deciding on an eager or idle write.
    latestProgressRef.current = reading.fraction;
    if (shouldFlushReadingProgress(reading.fraction, last, PROGRESS_DELTA, READ_COMPLETION_THRESHOLD, {
      completionEligible: reading.canComplete,
    })) {
      flushProgress();
      return;
    }
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushProgress, PROGRESS_DEBOUNCE_MS);
  }, [flushProgress, progressSV, progressTrackingSV]);

  const syncProgress = useCallback((persist: boolean, paint = !persist) => {
    const reading = measureProgress();
    applyReadingProgress(reading, persist, paint);
    return reading;
  }, [applyReadingProgress, measureProgress]);

  const armContentSettle = useCallback(() => {
    contentSettledRef.current = false;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      contentSettledRef.current = true;
      // Measurement-only: settled short content may show 100%, but a viewport
      // that could still be a placeholder never writes completion.
      syncProgress(false);
    }, READING_SHORT_SETTLE_MS);
  }, [syncProgress]);

  // Per-article baseline from the server; flush best-effort when leaving.
  useEffect(() => {
    const id = bookmark?.id;
    if (!id) return;
    const baseline = bookmark.readProgress ?? 0;
    currentArticleRef.current = { id, folderId: bookmark.folderId ?? null };
    initialProgressRef.current = baseline;
    latestProgressRef.current = baseline;
    displayedProgressRef.current = 0;
    persistedProgressRef.current = baseline;
    restoredRef.current = false;
    userScrolledRef.current = false;
    restoreTargetRef.current = null;
    restoreFromRef.current = null;
    restoreIssuedAtRef.current = 0;
    restoredContentHeightRef.current = 0;
    restoredViewportRef.current = 0;
    readingStartedRef.current = false;
    htmlReadyRef.current = false;
    contentSettledRef.current = false;
    viewHeightRef.current = 0;
    contentHeightRef.current = 0;
    trackProgressRef.current = false;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    progressTrackingSV.value = false;
    pendingHeading.current = null;
    cancelAnimationFrame(headingFrame.current);
    offsetRef.current = 0;
    expandChromeRef.current(0);
    chromeHeightSV.value = chromeHeightRef.current;
    // The bar represents the current viewport, never the saved row: completed
    // articles open at the top and partial positions appear only after the
    // restore scroll has been acknowledged by a real measurement.
    progressSV.value = 0;
    progressLabelRef.current(0);
    if (selectTimer.current) {
      clearTimeout(selectTimer.current);
      selectTimer.current = null;
    }
    setSelectionMenu(null);
    return () => {
      flushProgress();
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [bookmark?.id, chromeHeightSV, flushProgress, progressSV, progressTrackingSV]);

  // A persisted list row can be older than the freshly fetched detail. Accept
  // its canonical position until rendering finishes, never after a user jump.
  useEffect(() => {
    if (bookmark?.id !== currentArticleRef.current?.id || restoredRef.current || htmlReadyRef.current || offsetRef.current > 8) return;
    const baseline = bookmark?.readProgress ?? 0;
    initialProgressRef.current = baseline;
    latestProgressRef.current = baseline;
    persistedProgressRef.current = baseline;
  }, [bookmark?.id, bookmark?.readProgress]);

  // Restore the saved reading position once layout + content size are known.
  // Returns true when a scroll command was issued: the caller must then wait
  // for the scroll acknowledgement instead of painting the old offset.
  const maybeRestore = useCallback((): boolean => {
    if (!trackProgressRef.current || !htmlReadyRef.current) return false;
    if (userScrolledRef.current) return false;
    const viewH = viewHeightRef.current;
    const contentH = contentHeightRef.current;
    const target = restoreReadingOffset(initialProgressRef.current, viewH, contentH);
    if (target == null) {
      // Nothing to restore (completed/top saved row) or the article still fits
      // the viewport. Lock only after a real overflow exists, so a placeholder
      // that grows can still be restored.
      if (viewH > 0 && contentH > viewH) restoredRef.current = true;
      return false;
    }
    const scroll = scrollRef.current;
    if (!scroll) return false;
    // Keep the saved fraction under the reader while late images/fonts change
    // the scrollable range, until the reader scrolls for themselves.
    if (restoredRef.current
      && Math.abs(contentH - restoredContentHeightRef.current) < 2
      && Math.abs(viewH - restoredViewportRef.current) < 2) return false;
    restoredRef.current = true;
    restoredContentHeightRef.current = contentH;
    restoredViewportRef.current = viewH;
    restoreFromRef.current = offsetRef.current;
    restoreTargetRef.current = target;
    restoreIssuedAtRef.current = Date.now();
    // Web scroll events include programmatic restoration. Rebase the chrome
    // before issuing the command so that jump is not interpreted as a drag
    // which hides the header (and its progress bar) immediately on opening.
    expandChromeRef.current(target);
    // The scroll event is the acknowledgement: it updates offsetRef and paints
    // the fraction. Do not paint the saved value from the command alone, so a
    // failed restore still shows the real current viewport.
    scroll.scrollTo({ y: target, animated: false });
    return true;
  }, []);

  const handleArticleReady = useCallback(() => {
    htmlReadyRef.current = true;
    armContentSettle();
    const restoring = maybeRestore();
    if (!restoring) syncProgress(false);
    contentsRef.current?.prepare();
    controlsRef.current?.prepare();
    actionsRef.current?.prepare();
  }, [armContentSettle, maybeRestore, syncProgress]);

  // Start tracking once content exists; retry restore in case the native
  // layout events fired before tracking was armed.
  useEffect(() => {
    trackProgressRef.current = hasContent;
    if (!hasContent) {
      progressTrackingSV.value = false;
      return;
    }
    if (!maybeRestore()) syncProgress(false);
  }, [bookmark?.id, hasContent, maybeRestore, progressTrackingSV, syncProgress]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      if (contentSize.height - contentOffset.y - layoutMeasurement.height > layoutMeasurement.height * 2) readerWork.scrolling();
      else readerWork.resume();
      offsetRef.current = contentOffset.y;
      viewHeightRef.current = layoutMeasurement.height;
      const contentChanged = Math.abs(contentSize.height - contentHeightRef.current) >= 1;
      contentHeightRef.current = contentSize.height;
      if (contentChanged) armContentSettle();
      // Chrome follows user drags on native (programmatic scrolls — position
      // restore, TOC jumps — never yank it around). Web wheel scrolling has no
      // drag events, so there the chrome simply follows the scroll.
      const menu = selectionMenuRef.current;
      if (menu) {
        const dy = contentOffset.y - menuScrollY.current;
        if (Math.abs(dy) >= 0.5) {
          menuScrollY.current = contentOffset.y;
          const nextY = menu.anchor.y - dy;
          if (nextY + menu.anchor.height < 0 || nextY > windowHeight) {
            setSelectionMenu(null);
          } else {
            setSelectionMenu({ ...menu, anchor: { ...menu.anchor, y: nextY } });
          }
        }
      }
      // Sections and late images mount before the article reports ready. A
      // reader who scrolls in that window has chosen their own position: the
      // pending restore must not yank them back when readiness arrives.
      const target = restoreTargetRef.current;
      let programmatic = false;
      if (target != null) {
        // The target itself is the acknowledgement. A frame at the pre-restore
        // offset is a stale mount/layout report; anything else is real intent.
        const staleFrame = restoreFromRef.current != null
          && Math.abs(contentOffset.y - restoreFromRef.current) <= 2
          && Date.now() - restoreIssuedAtRef.current < 250;
        programmatic = Math.abs(contentOffset.y - target) <= 2 || staleFrame;
        if (!programmatic) {
          userScrolledRef.current = true;
          restoreTargetRef.current = null;
        }
      } else if (!restoredRef.current && contentOffset.y > USER_SCROLL_INTENT_MIN) {
        userScrolledRef.current = true;
      }
      syncProgress(!programmatic, programmatic);
    },
    [armContentSettle, readerWork, syncProgress, windowHeight],
  );

  // Recompute when content settles/grows (images loading, HTML rendering).
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      const changed = Math.abs(h - contentHeightRef.current) >= 1;
      contentHeightRef.current = h;
      if (changed) armContentSettle();
      // A new restore command supersedes the old offset; its scroll
      // acknowledgement paints the saved fraction. Painting the stale offset
      // here made late images briefly drop the bar.
      if (!maybeRestore()) syncProgress(false);
    },
    [armContentSettle, maybeRestore, syncProgress],
  );

  const onScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewHeightRef.current = event.nativeEvent.layout.height;
      // Orientation/window changes move the fraction immediately from the
      // measured viewport instead of waiting for the next scroll event.
      if (!maybeRestore()) syncProgress(false);
    },
    [maybeRestore, syncProgress],
  );

  /* ---------------------------------- render ---------------------------------- */

  const fallbackArticleWidth = Math.min(sceneWidth, layout.maxReaderWidth) - spacing[16] * 2;
  // Non-scrolling states keep their content below the chrome overlay.
  const chromePad = useMemo(() => ({ paddingTop: chromeHeight }), [chromeHeight]);

  const rightActions = bookmark ? (
    <HeaderActions>
      {showWebsiteView ? null : (
        <HeaderIconButton
          name="options-outline"
          color={palette.text}
          onPress={openControls}
          accessibilityLabel="Reader settings"
          accessibilityHint="Adjust text size, typeface, and reading theme."
          measureOnPress={false}
        />
      )}
      <ReaderActions key={bookmark.id} ref={actionsRef} bookmark={bookmark} highlights={highlights}
        workScheduler={readerWork}
        hasHtml={hasHtml} hasContents={hasContents} website={showWebsiteView} canRead={showReadInOrdo}
        onOpen={dismissSelectionMenu} onContents={() => contentsRef.current?.open()}
        onShare={handleShare} onCopyLink={handleCopyLink} onOpenOriginal={handleOpenOriginal}
        onOpenExternal={handleOpenSystemBrowser} onRefresh={() => browserRef.current?.reload()}
        onRead={() => setSurface("reader")} onClassify={handleClassify} onRemoveHighlight={dropHighlight} />
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
      <Animated.View
        style={[styles.chromeOverlay, chromeShiftStyle]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          chromeHeightRef.current = height;
          chromeHeightSV.value = height;
          setChromeHeight((prev) => (Math.abs(prev - height) < 0.5 ? prev : height));
        }}
      >
      <Header
        title={bookmark ? (showWebsiteView && pageHost ? pageHost : domain) : "Reader"}
        variant="tonal"
        showBack={!embedded}
        onBack={!embedded ? handleBack : undefined}
        safeTop={!embedded}
        alignTo={embedded ? "parent" : "scene"}
        maxWidth={layout.maxReaderWidth}
        right={rightActions}
        onTitleLongPress={bookmark ? handleCopyLink : undefined}
        titleAccessibilityHint={bookmark ? "Copies the link." : undefined}
      />

      {hasContent && !showWebsiteView ? (
        <ReaderProgressBar key={bookmark?.id ?? "article"} animatedValue={progressSV} labelRef={progressLabelRef}
          initialValue={bookmark && currentArticleRef.current?.id === bookmark.id ? displayedProgressRef.current : 0} />
      ) : null}
      </Animated.View>

      {loading ? (
        <ScreenContent alignTo={embedded ? "parent" : "scene"} style={[styles.stateBody, chromePad]}>
          <Skeleton width="80%" height={28} />
          <Skeleton width="100%" height={16} style={{ marginTop: spacing[16] }} />
          <Skeleton width="100%" height={16} style={{ marginTop: spacing[8] }} />
          <Skeleton width="65%" height={16} style={{ marginTop: spacing[8] }} />
        </ScreenContent>
      ) : protectedDetail ? (
        <ScreenContent alignTo={embedded ? "parent" : "scene"} style={[styles.stateCenter, chromePad]}>
          <EmptyState
            icon="lock-closed-outline"
            title="This folder is locked"
            message="Unlock the folder to read it."
            action={
              lockedFolderId ? (
                <Button label="Unlock" onPress={() => setUnlockOpen(true)} />
              ) : undefined
            }
          />
        </ScreenContent>
      ) : !bookmark ? (
        <ScreenContent alignTo={embedded ? "parent" : "scene"} style={[styles.stateCenter, chromePad]}>
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
            { backgroundColor: websiteChrome, paddingLeft: insets.left, paddingRight: insets.right, paddingTop: chromeHeight },
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
            keyboardShouldPersistTaps="handled"
            canCancelContentTouches={false}
            onLayout={onScrollViewLayout}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            onScrollBeginDrag={readerWork.scrolling}
            animatedScrollHandler={readerScrollHandler}
            scrollEventThrottle={16}
            contentContainerStyle={{
              // The chrome is an overlay: pad the content so it starts below
              // the bar and scrolls underneath it once the bar slides away.
              paddingTop: chromeHeight + spacing[12],
              paddingBottom: readerBottomPadding,
            }}
          >
            <ScreenContent maxWidth={layout.maxReaderWidth} alignTo={embedded ? "parent" : "scene"} style={styles.body}>
              <View
                style={styles.articleColumn}
                onLayout={(e) => setArticleWidth(e.nativeEvent.layout.width)}
              >
                {!readerFamily ? (
                <View accessibilityLabel="Loading article" style={styles.inlineEmpty}>
                  <Skeleton width="80%" height={28} />
                  <Skeleton width="100%" height={16} style={{ marginTop: spacing[16] }} />
                  <Skeleton width="92%" height={16} style={{ marginTop: spacing[8] }} />
                </View>
                ) : <>
                {articleHead}

                {hasHtml ? (
                <View style={styles.content}>
                  <ReaderArticle
                    html={detail.data?.contentHtml ?? ""}
                    preferences={articlePreferences}
                    contentWidth={articleWidth || fallbackArticleWidth}
                    highlights={highlights}
                    onTextSelect={handleTextSelect}
                    onHeadingsChange={handleHeadingsChange}
                    onHeadingRef={handleHeadingRef}
                    onReady={handleArticleReady}
                    workScheduler={readerWork}
                  />
                </View>
              ) : detailFetchFailed ? (
                <EmptyState
                  compact
                  icon="cloud-offline-outline"
                  title="Couldn't load the article"
                  message={detail.error ? errorMessage(detail.error) : undefined}
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
                </>}
              </View>
            </ScreenContent>
          </ThemedScrollView>
        </View>
        ) : null}
        </>
      )}

      {hasContents && !selectionMenu ? (
        <ReaderContents key={bookmark?.id} ref={handleContentsRef} headings={articleHeadings}
          onSelect={handleHeadingSelect} expansion={collapsingFab.expansion}
          embedded={embedded} bottom={contentsFabBottom} sceneWidth={sceneWidth} workScheduler={readerWork} />
      ) : null}

      <ReaderControlsSheet
        key={bookmarkId}
        ref={controlsRef}
        onOpen={dismissSelectionMenu}
        effectiveDark={effectiveDark}
        workScheduler={readerWork}
      />
      <LockPrompt
        visible={unlockOpen && Boolean(lockedFolderId)}
        folderId={lockedFolderId ?? ""}
        folderName={lockedFolder?.name}
        lockType={lockedFolder?.lockType}
        pinLength={lockedFolder?.pinLength}
        onDismiss={() => setUnlockOpen(false)}
        onUnlocked={() => {
          setUnlockOpen(false);
          void detail.refetch();
        }}
      />
      <ContextMenu
        visible={selectionMenu !== null && !showWebsiteView}
        onDismiss={dismissSelectionMenu}
        anchor={selectionMenu?.anchor ?? null}
        backdrop={false}
        preferredPlacement="above"
        estimatedHeight={168}
      >
        {highlightChoice.canHighlight ? (
          <ContextMenuItem
            icon="color-fill-outline"
            label="Highlight"
            busy={createHighlight.isPending}
            disabled={
              createHighlight.isPending || updateHighlight.isPending || removeHighlight.isPending
            }
            onPress={() => {
              if (!selectionMenu) return;
              haptics.light();
              dismissSelectionMenu();
              saveHighlight(selectionMenu.draft);
            }}
          />
        ) : null}
        <ContextMenuItem
          icon="copy-outline"
          label="Copy"
          onPress={() => {
            if (!selectionMenu) return;
            dismissSelectionMenu();
            void copyText(formatHighlightQuote(selectionMenu.draft.exact));
          }}
        />
        {selectionMenu?.draft.href ? (
          <ContextMenuItem
            icon="link-outline"
            label="Copy link"
            onPress={() => {
              const href = selectionMenu.draft.href;
              dismissSelectionMenu();
              if (href) void copyLink(href);
            }}
          />
        ) : null}
        {highlightChoice.canRemove ? (
          <ContextMenuItem
            icon="trash-outline"
            label="Remove highlight"
            tone="danger"
            busy={
              removeHighlight.isPending || updateHighlight.isPending || createHighlight.isPending
            }
            disabled={
              removeHighlight.isPending || updateHighlight.isPending || createHighlight.isPending
            }
            onPress={() => void unhighlightSelection()}
          />
        ) : null}
      </ContextMenu>
    </View>
    </ThemeOverrideProvider>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  chromeOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    backgroundColor: "transparent",
  },
  scrollViewport: { flex: 1 },
  body: { width: "100%" },
  articleColumn: { width: "100%" },
  description: { marginTop: spacing[8] },
  byline: { marginTop: spacing[6] },
  content: { marginTop: spacing[24] },
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
    ...StyleSheet.absoluteFill,
    opacity: 0,
    zIndex: -1,
  },
});
