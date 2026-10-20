# Library lists: menus, mutations and large-catalogue work

Scope: `use-library-search`, the three list screens, `BookmarkRow`/`FolderRow`.
Measured on the 4-core ARM build box unless noted. These are JS-thread and
network-behaviour measurements, not device frame traces.

## Findings and fixes

### 1. Screen-local state re-rendered the virtualized list

Menu/sheet/anchor state lives in the screens, so every open/close re-rendered
the whole screen including the FlatList. Rows were already `React.memo`, so
cells did not deeply re-render, but the VirtualizedList component itself
re-rendered and reconciled every mounted cell.

Isolated reproduction (react-native-web's real VirtualizedList under jsdom, `flushSync`,
120 rows, 12+ mounted cells, memoized rows — 30 toggles):

| list placement | median | p95 | row renders |
| --- | --- | --- | --- |
| inline in screen (before) | 7.20 ms | 11.99 ms | 0 |
| `React.memo` list child (after) | 1.21 ms | 1.30 ms | 0 |

Fix: each screen renders its list through a module-scope `React.memo` child
(`LibraryList`, `FolderBookmarkList`, `TagBookmarkList`) whose props are all
stable callbacks or primitives; the empty state is a memoized element prop.
Menus and sheets can skip the list subtree when its inputs are unchanged.

### 2. Cache-write bursts recomputed cached search matches repeatedly

While searching, every successful refetch/removal of a `bookmarks`-prefixed
query bumped `cacheRevision` and re-ran `collectCachedBookmarks` + compile:

- `collectCachedBookmarks`, 10k cached rows: median 6.80 ms, p95 14.30 ms
- `compileSearchResults`, 10k rows, 3-char query: median 12.25 ms, p95 16.91 ms

An invalidation refetches every active bookmarks query (visible list,
catalogue, reminders, progress), so one move/mark-all fired several ~20 ms
recomputes back-to-back. Fix: `createCacheWriteCoalescer`
(`src/lib/search-bookmarks.ts`) collapses a burst into a flush 150 ms after
the first write. Later writes share that deadline rather than postponing it,
so continuous writes cannot starve updates. The visible list still updates via
its own query data; only cached-only rows (unopened folders) wait out the
window. Per-keystroke compile is unchanged — that is the live-filter feature.

### 3. Remaining finding: stale catalogue replays warmed pages

React Query (5.102.8) refetches every stored page of a stale infinite query on
observer remount and on focus — sequentially, following fresh cursors
(`infiniteQueryBehavior` walks `getNextPageParam` after each page). A warmed
10k-bookmark catalogue holds ~100 pages, so returning to the library tab or
foregrounding the app replayed ~100 requests plus re-indexing. Verified with a
QueryObserver probe (5 warmed pages): remount 5 fetches, focus 5 fetches,
with `refetchOnMount:false, refetchOnWindowFocus:false` 0 fetches, explicit
invalidation still 5. Those flags were evaluated but **not retained**: disabling
refresh introduces an unbounded cross-device staleness window in a retained
screen, and does not prevent stale refetches when `enabled` changes from false
to true. Existing freshness behavior remains unchanged. A paced replacement
catalogue needs separate correctness and consistency work.

### 4. Scroll gestures prefetched every touched row

RN Pressable fires `onPressIn` at touch-down even when the gesture becomes a
scroll. Warming (bookmark detail = article HTML; folder first page) ran in
`onPressIn`, so flinging a list fetched each row the finger started on. Warm
now runs inside the press handler after the drag/hold guards — the same tick
as navigation, losing only the press-and-hold duration and sharing the
in-flight request with the reader screen.

## Shared issues (other owners)

- `invalidateQueries({ queryKey: ["bookmarks"] })` (moves/batch moves) also
  refetches the active catalogue, sequentially replaying every warmed page on
  the library screen. Consider excluding `library-index` or accepting it.
- `prefetchFolderBookmarks` uses `prefetchInfiniteQuery` with default
  `staleTime: 0`, so every warm refetches even fresh folders. A short
  `staleTime` would dedupe repeated taps.
- Per-keystroke `compileSearchResults` over a fully warmed cache costs
  ~12 ms/10k rows. A cheap prefilter (folded per-document haystack +
  `includes(token)` gate, skipped when fuzzy matching is on) in
  `packages/shared/src/search.ts` would cut most of that; word-prefix matches
  always contain the token as a substring, so the gate cannot drop real hits.

## Device check

Use a release build and fixed library (small + 10k), reset `dumpsys gfxinfo`,
then toggle the row overflow
menu 20×, the library overflow 20×, and toggle read/unread 20× while scrolled
mid-list. Compare janky-frame %, p95/p99 before/after.
