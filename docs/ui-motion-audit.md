# UI motion audit

Audited before implementation on 2026-10-25. Scope: all 31 route files in
`apps/mobile/app`, shared UI primitives, and feature components for bookmarks,
folders, tags, reader/browser, authentication, settings, imports and updates.

## Findings and changes

| Area | Abrupt behavior found | Treatment |
| --- | --- | --- |
| Context menus | Nested pages and live content changed surface dimensions immediately | Spring measured height and width; preserve placement and outgoing page |
| Dialogs and content sheets | Errors, forms and asynchronous states changed surface height immediately | Shared measured-height spring; preserve scroll limits and keyboard positioning |
| Supporting text | Helper/error rows appeared and disappeared immediately | Retained measured disclosure with height and opacity motion |
| Disclosures | Export folders, import Advanced, dependent settings and extraction status jumped | Shared `AnimatedDisclosure` |
| Exclusive states | Authentication steps, security state, reminder sections, hosting and update phases cut between contents | Retained fade-through and measured surface resizing |
| Floating actions | Keyboard and selection changes removed actions immediately | Keep mounted, spring opacity/position, disable interaction immediately |
| Selection headers | Library, folder and tag headers cut to selection mode | Shared Material transitions with stable header footprint |
| Reader/browser | Progress tracks and surface changes cut between states | Retain existing state ownership and animate visibility/layout |
| Notifications | External dismissal removed toasts before exit; dock clearance jumped | Retain outgoing toast, finish-exit fallback and animated clearance |
| Offline cover | Connectivity gate appeared and disappeared immediately | Retained fade with active-only focus and accessibility ownership |

## Route coverage

- Root and app/auth/tab layouts; library and search redirect.
- Folder detail, tag index/detail and reader detail.
- Settings: index, about, account, appearance, browser, controls, data,
  delete account, display name, email, password, security, server, sessions,
  and email verification.
- Authentication: login, registration, MFA, forgotten password, password
  reset and email verification.

Shared and feature review included ContextMenu, FloatingPanel, overlay
presence/page/focus ownership, PressableScale, grouped/segmented controls,
FABs, toasts, tooltip, spinner, progress, selection toolbar and row feedback;
LibraryHeader/Filters, bookmark/folder rows, save/unlock/move/folder actions,
ReaderPane/Controls/Contents/Actions, BookmarkBrowser, ImportFlow,
AppPalettePicker, OfflineGate and NativeUpdateProgress.

## Constraints preserved

- Use the app's Standard/Expressive Material spatial and effects schemes.
- Reduced motion assigns final geometry directly and stops decorative motion;
  progress indicators remain visible.
- Closing content stays painted until its exit finishes but becomes inert
  immediately. Preserve Back/Escape, focus restoration and picker ownership.
- Resize text/input surfaces with layout dimensions rather than scaled text
  or web FLIP transforms. Measure children independently of animated viewports.
- Viewport and keyboard geometry changes use fresh layout constraints rather
  than adding a competing content-size spring.
- Existing press shapes, selection toolbar, row feedback, adaptive sheets and
  overlay entry/exit transitions already use shared motion and are retained.

## Validation

Live web checks use the actual Expo application with the local backend and
sample library. Frame-by-frame geometry sampling confirmed intermediate
menu, dialog and disclosure heights, including interrupted/reversed motion.
The final validation results and capture details are recorded below after
integration.
