# Changelog

## 0.2.0 Preview 2

- Sync the release branch with `main`, preserving the complete commit history.
- Rename launcher labels to `ordo (preview)` and `ordo (dev)`; package IDs and update channels are unchanged.
- Use release-derived Android build numbers for Stable/Preview; only Development uses the CI run number. Preview 2 uses `versionCode=2`.
- Fix CI cache cleanup when native-compatibility detection skips dependency installation, with regression tests for all three early-exit paths.

**Install:** The launcher-label change requires a new APK, not OTA. Preview 1 used Android build number 875, so Preview 2 cannot replace it in-place: uninstall Preview 1 first if present (this clears local settings/cache, not your server library). Later previews increment from this new numbering baseline.

[Full commit history](https://github.com/axoletlabs/ordo/compare/v0.2.0-preview.1...v0.2.0-preview.2)

## 0.2.0 Preview 1

The first preview of Ordo's Material 3 redesign, with a faster library, an immersive reader, and simpler self-hosting.

### Design and navigation

- Material 3 throughout: Roboto typography, Material icons, tonal surfaces, shared controls, and an optional, remembered Expressive mode with shaped selection feedback and motion.
- Android 12+ Material You wallpaper colors, improved contrast, light/dark/AMOLED support, and reduced-motion-aware transitions and loading indicators. Preset app colors are removed.
- One library search app bar and one content pane in every orientation. Settings open from the account icon; bookmarks open a full-screen reader. Separate search, bottom tabs, side rail, and split-pane reading are removed; existing search/reader links still work.
- More accessible forms, authentication, pickers, menus, dialogs, and feedback: larger touch targets, floating labels, validation, screen-reader states, keyboard navigation, focus restoration, and keyboard-safe layouts. Nested pickers preserve drafts; overlays and menu pages exit without jumps or flashes.

### Library and search

- Immediate cached search with progressively indexed, authorized metadata across folders, asynchronous remote results, shared field-weighted ranking, optional fuzzy matching, and in-place filtering. Locked folders stay excluded; the global index stays off disk.
- Accent-insensitive search on client and server, with correct title-highlight offsets and single-pass HTML entity decoding. Article-body indexing is deferred to keep typing responsive.
- Cleaner bookmark, folder, and tag rows, retaining website age, reading time, reminder details, tag names, and overflow counts. Sorting and tag management move to library overflow; folder creation stays in the customizable Create menu.
- Smoother selection, long-press/drag behavior, hover, anchored actions, and native-driven toolbar resizing; tags and copy live under More. Restored native pull-to-refresh gesture handling and Material feedback.
- Tap-first custom reminders with date/time pickers, locale-aware time entry, and consistent selected-date feedback.
- Fix duplicate device-lock prompts and unintended automatic unlocks, stuck extraction status, stale content-type overrides, partial tag-delete recovery, toast timeouts, and reading-completion timestamps.

### Reader

- Immersive reading with scroll-away overlay chrome, an always-available Contents button, working section jumps, and tap-to-manage highlights.
- Five reading typefaces: Libron, NV Legible Next, Garamond, Bitter, and Jost. Add line-spacing controls, a live type specimen, and self-previewing font choices; retire Playfair and map legacy monospace preferences to Sans.
- Adaptive reader colors and backward-compatible Sepia retirement. System follows the real device appearance; typography changes preserve appearance choices, and serialized preference saves cannot overwrite newer selections. Restore app/window colors on exit.

### Startup, sessions, and updates

- Restore cached library data before network requests, bound cold-start fetching, shorten the splash brand beat, and crossfade sign-in/out without blanking outgoing content. Web sessions now survive reloads; corrupt persisted auth is cleared.
- Isolated Stable, Preview, and Development apps, each with separate local storage. Stable and Preview have fixed, separate OTA and APK update streams; Development has neither.
- Harden update checks, downloads, cancellation, retries, and restart state against duplicate requests and stale responses. Ignore incomplete APK assets and retry discovery; unify download, extraction, refresh, and loading feedback.

### Server and self-hosting

- Guided setup with a confirmation summary, complete documented `.env`, generated secrets, private config/log permissions, quieter single-pass progress, actionable failures, and `--verbose`. Expanded setup, HTTPS, backup, update, and systemd documentation.
- Graceful shutdown and cleanup; route-specific body/upload limits and import errors; rate limits on sensitive account/folder changes; concurrency-safe token refresh, reliable logout, concurrent-signup handling, and explicit required-mail failures. Clean expired folder tokens and cancelled extraction jobs; keep databases during cleanup.
- Align bookmark-update validation with immutable URLs and consolidate shared search, sorting, cache, and error handling. Remove unused code, dependencies, font registrations, and oversized legacy assets.

### Release safety and verification

- Safer release-branch/tag validation, isolated variant manifests/channels, signed APK identity checks, immutable uploads, and ancestor/runtime-aware OTA routing that fails closed when compatibility is unknown.
- Faster native builds with C++/Gradle caching; corrected CI package-manager cache setup. Patch high/critical dependency findings and monitor temporary unpublished-patch audit exceptions daily.
- Expanded Material screen/error-state, color/contrast, accessibility, motion, search/reader performance, updater, installer, and release-pipeline regression coverage, with published audit documentation and screenshot evidence.

**Preview install:** `ordo-preview` installs alongside `ordo` and starts with separate local settings/cache; sign in to access the same server library. Stable installs do not receive Preview updates. This redesign and the new app identity require an APK, not an OTA. Self-hosted users can select this exact release with `--release v0.2.0-preview.1` or include previews with `--pre`.

[Full commit history](https://github.com/axoletlabs/ordo/compare/v0.1.0...v0.2.0-preview.1)

## 0.1.0

Initial release. [Release notes](https://github.com/axoletlabs/ordo/releases/tag/v0.1.0).
