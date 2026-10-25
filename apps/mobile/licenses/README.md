# Bundled open source notices

The app's About page links to a searchable offline catalog of license and
copyright text. Ordo's own AGPL text is also bundled and readable in the app.

## Generation

Run `pnpm --filter @ordo/mobile licenses:generate` after installing dependencies.
Metro runs the same generator whenever it starts, including for development,
native builds, web exports, and OTA updates. Mobile typechecking and the CI
`licenses:check` step also generate the catalog. No network access is needed.
The generated `src/generated/open-source-licenses.json` is ignored by Git.

The generator walks the installed mobile production dependencies, transitive
runtime dependencies, workspace dependencies, and installed peer dependencies.
It preserves separate versions and all discovered LICENSE, COPYING, COPYRIGHT,
NOTICE, and font license files. A README is used only when its license section
contains actual terms, rather than just a license name or link.

This is a conservative dependency catalog, not a list inferred from one Metro
bundle: it includes host tools reachable through production packages such as
Expo. `@expo/xcpretty` and `@react-native/debugger-frontend` are explicitly omitted
because they only run on the build/development host and do not ship in the app.

## Maintenance

Ordinary dependency entries and their license text are generated automatically.
Do not edit the generated JSON or maintain a list of npm package names by hand.

Some npm releases omit their license files. `package-fallbacks.json` maps those
exact package versions to checked-in upstream texts in `upstream/`.
`sources.json` records where those texts came from and their upstream blob SHAs
where available. The Watchman packages declare Apache-2.0, so their fallback
uses the Apache-era upstream license. fb-watchman's installed source header
also names MIT, so its notice retains both texts.

Generation fails when a required dependency is missing, a component has no
license identifier or text, or a fallback's declared license changes. On an
upgrade that drops its license text, retrieve the applicable upstream license,
retain copyright and NOTICE text, record the source, and review/update that
version's fallback. Never substitute a generic template or assume the latest
upstream license applies to an older package.

Bundled reader fonts, the Material Icons subset, and adapted AndroidX loading
shapes are explicit asset entries in `scripts/generate-licenses.cjs`, reading
their existing checked-in notices. Add an entry when adding a new local asset
or copied/adapted source. This small asset list and upstream exceptions require
occasional human review; the dependency catalog does not.

This generator does not resolve Maven/CocoaPods graphs. Native libraries added
outside npm, or fetched by Gradle/CocoaPods inside a module, need their own
license review and explicit notices. An npm license inventory alone is not a
complete native distribution license audit.

## Verification

`pnpm --filter @ordo/mobile licenses:check` verifies the installed graph and
runs fixture tests for dependency traversal, notice retention, missing-text
failures, and deterministic output. About, Build details, and license screens
are exempt from the offline gate so their bundled text stays accessible. The
offline/server-unavailable screens offer signed-in users an About Ordo action.
