# Changelog

## 0.3.0 Preview 4

The fourth preview makes folder deletion more flexible, keeps compatible updates quiet, and improves account security and reliability.

- **Keep bookmarks when deleting a folder:** Tick the bookmarks you want to keep; they move to Bookmarks while the rest are deleted with the folder. Undo and restart-safe deletion recovery remain available.
- **Quiet updates:** Compatible updates download in the background and take effect on the next cold launch, without download banners or restart prompts. Full APK updates still offer Download and Install.
- **Account settings and sign-in:** Fix MFA and account-settings edge cases, and harden email changes, password changes, and MFA operations with additional checks and rate limits.
- **Clearer release names:** Show readable Preview and release names instead of raw version tags in update notices, progress, About, and release history.

**Install:** The Preview 4 APK uses `versionCode=6` and replaces Preview 3 (`versionCode=5`) in place; no uninstall is needed. Install the new APK to receive the updated native launch configuration. Self-hosted: select `--release v0.3.0-preview.4`, or include previews with `--pre`. No new database migrations, native plugins, or runtime dependencies were added since Preview 3.

[Preview 3 → Preview 4 release changes](https://github.com/axoletlabs/ordo/compare/v0.3.0-preview.3...v0.3.0-preview.4)

## 0.3.0 Preview 3

The third preview of the 0.3.0 cycle completes the app-wide Material UI, motion and cache audit, rolls back rejected tag edits, and ships the matching server updates.

### Included in the Preview 3 release

- **App-wide Material audit:** Audited every screen for Material UI, motion and cache hot paths. Dialog focus and scroll bookkeeping are deferred off the interaction path, menu highlights stay synchronized with lightweight control motion, session work is isolated from the UI, and idle time no longer competes with gestures or animations.
- **Reader:** Reduced startup, contents-menu and scroll contention in the reader, with slightly more room for the contents panel.
- **Tag editing:** Edits rejected by the server now roll back across the bookmark caches instead of leaving stale tags behind, and the tag dropdown shares its selection behavior with the other menus.
- **Server:** Added bookmark sort indexes (including a database migration applied on update), isolated session work with verified SMTP workflows, and removed audit-flagged rate-limit and configuration overhead.

### Maintenance and compatibility

- Removed the repository test suite and test infrastructure; audit evidence now ships as measurement documents instead.
- Updated app and server release metadata to `0.3.0-preview.3`. The server update applies the `20261017120000_bookmark_sort_indexes` migration; no native plugins or runtime dependencies changed in this release range.

**Install:** The Preview 3 APK uses `versionCode=5` and updates Preview 2 (`versionCode=4`) in place; no uninstall is needed. Self-hosted: select the tagged server release with `--release v0.3.0-preview.3`, or include previews with `--pre`.

[Preview 2 → Preview 3 release commits](https://github.com/axoletlabs/ordo/compare/v0.3.0-preview.2...v0.3.0-preview.3)

## 0.3.0 Preview 2

The second preview of the 0.3.0 cycle improves release notes, reminder responsiveness, backup-code downloads, and reading comfort.

### Included in the Preview 2 release

- **What's new:** Automatically show the running release's notes once per installed build, including compatible OTA updates. Wait until sign-in and any required MFA are complete and the library is open; do not interrupt incoming shares or a deep-linked reader. Notes remain available from About.
- **Changelog reader:** Clearer typography, more reading space, persistent release navigation and dismissal, and a scroll reset when switching versions. Preserve Markdown formatting, selectable text, and keyboard navigation. Correct the Expressive version chips' pressed-shape animation.
- **Backup codes:** Save `ordo-backup-codes.txt` through the same file-export flow as library exports: Android Save As, iOS file sharing, and web download, with a share-sheet fallback for older Android APKs. Cancelling no longer shows an error or error haptic.
- **Custom reminders:** Reduce repeated date formatting and unnecessary calendar drawing when opening the picker or editing the date/time. Keep localized date labels, month navigation, and the circular today/selected-date indicators.
- **Library feedback:** Keep row selection and press/hover feedback stable during layout resizes and row updates instead of rebuilding their corner-animation graphs.
- **Reader:** Remove redundant article-end margins and reduce excess bottom clearance while keeping the final content clear of the Contents button.

### Follow-up changes on the Preview 2 branch

These JS-only changes were merged after the original `v0.3.0-preview.2` tag. They are eligible for compatible Preview-channel OTA delivery, but are not part of the original tagged APK.

- **Bottom-sheet changelog:** Open What's new from the bottom, with drag-to-dismiss, a minimal heading and version, and one continuous surface without separator lines or segmented note cards. Keep Earlier updates and Got it accessible, adapt to short/wide windows, and respect light/dark themes, Expressive mode, and reduced motion.
- **Release history:** Let Preview users read stable release notes as well as previews. This changes the changelog only; Preview still receives Preview updates, not Stable APKs.
- **Reminder opening:** Avoid starting animations toward unchanged resting states and creating invisible feedback layers for untouched controls. This reduces picker-opening work while retaining feedback for actual interactions, theme changes, and reduced-motion changes.

### Maintenance and compatibility

- Expanded regression coverage for article-end spacing, reminder formatting and interaction, row feedback during resize, backup-code export/cancellation, update announcements, changelog layout, and shared-control animation lifecycles. Performance audit notes distinguish web measurements from unverified native-device performance.
- Updated app and server release metadata to `0.3.0-preview.2`. No server behavior, database schema, native plugins, or runtime dependencies changed in this release range.

**Install:** The Preview 2 APK uses `versionCode=4` and updates Preview 1 (`versionCode=3`) in place; no uninstall is needed. The follow-up JS changes do not require another native rebuild, subject to the OTA compatibility checks. Self-hosted: select the tagged server release with `--release v0.3.0-preview.2`, or include previews with `--pre`.

[Preview 1 → Preview 2 release commits](https://github.com/axoletlabs/ordo/compare/v0.3.0-preview.1...v0.3.0-preview.2) · [Post-tag follow-up commits through the bottom-sheet update](https://github.com/axoletlabs/ordo/compare/v0.3.0-preview.2...b8e265b)

## 0.3.0 Preview 1

The first preview of the 0.3.0 cycle, focused on performance and day-to-day reliability.

- Faster long-article reading and smoother large libraries.
- Smaller downloads: R8 shrinking, compressed libraries, dead assets removed.
- Reliable bookmark moves, with deletion undo that survives restarts.
- Android Back cancels an incoming share instead of leaving the app.
- A compact reader Contents panel that no longer covers the text.
- Clearer reminder date indicators, with preset labels on one line.
- Individually editable OTP digits during sign-in.

**Install:** Requires a new APK, not OTA. Ships `versionCode=3`, continuing the 0.2.0 preview count, so it replaces any earlier preview in place. Self-hosted: select this release with `--release v0.3.0-preview.1`, or include previews with `--pre`.

[Full commit history](https://github.com/axoletlabs/ordo/compare/v0.2.0...v0.3.0-preview.1)

## 0.2.0

The 0.2.0 preview is now stable. Thanks to everyone who tested it!

- A refreshed design with wallpaper colors on supported Android devices.
- Faster search and smoother bookmark browsing and organization.
- A more comfortable reader with new fonts, adjustable line spacing, and easier navigation.
- More reliable sign-in, reminders, and app updates, plus simpler self-hosted setup.

**Preview users:** Install the Stable app (`ordo`) and sign in to access your saved library. It installs separately from Preview; local settings do not transfer.

[All changes since 0.1.0](https://github.com/axoletlabs/ordo/compare/v0.1.0...v0.2.0)

## 0.2.0 Preview 2

- Sync the release branch with `main`, preserving the complete commit history.
- Rename launcher labels to `ordo (preview)` and `ordo (dev)`; package IDs and update channels are unchanged.
- Move bookmarks without the confirmation animation or artificial closing delay.
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
