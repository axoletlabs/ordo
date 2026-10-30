# Ordo releases: Stable, Preview, Development, APKs and OTA

## Version sources

- `apps/mobile/app.config.js`'s `version` is the native app version. A release
  tag must be exactly `v<version>`. Versions are `X.Y.Z` or
  `X.Y.Z-preview[.N]`, without leading zeroes or build metadata. Increment the
  Preview sequence for each new preview APK; there are no alpha/beta/RC releases.
- `apps/server/release.json` records the installed server's version, tag,
  commit and archive. CI creates it; the installer retains its source-file
  ownership list to remove stale files on later archive installs.
- Private workspace package versions and the server's development fallback
  are package metadata, not the installed release version. `main` can keep
  a base app version while builds are identified by their commit and channel.
- `scripts/release-policy.js` is shared by Expo config, CI, the mobile updater
  and server installer. There are no separate CI/mobile semver rules.

## Streams and channels

Exactly three native variants share the source tree, not app storage or update
subscriptions. They can all be installed side by side.

| Variant / launcher name | Android package | OTA channel | Native updater |
| --- | --- | --- | --- |
| Stable / `ordo` | `com.axolet.ordo` | `stable` | Stable releases only |
| Preview / `ordo (preview)` | `com.axolet.ordo.preview` | `preview` | Preview releases only |
| Development / `ordo (dev)` | `com.axolet.ordo.development` | None; OTA disabled natively | Disabled |

There is no early-access preference or stream-switching UI. Preview never
installs Stable, including when the same version graduates to Stable. The
updater reads the installed native application ID, not a mutable OTA manifest.
Stable retains the original package ID. Preview starts with separate local
storage; no migration assistance is provided. Existing APKs need replacement
APKs to adopt this layout; OTA cannot change an application ID.

| Trigger | Distribution |
| --- | --- |
| Published `vX.Y.Z` from `release/x.y.z` | Stable release APKs and server archive |
| Published `vX.Y.Z-preview.N` from `release/x.y.z` | Preview release APKs and server archive |
| Push on matching `release/x.y.z` | Same variant: compatible JS → OTA; native changes → APK artifact |
| `main` / feature push | Checks only; headline ending in `-apk` → Development artifact |
| Actions dispatch with `build_apk=true`, on any branch | Development artifact only |

Manual Development runs are excluded from release OTA baselines, including
dispatches on release branches. There are no per-feature variants or channels.

Local builds infer the variant from branch/version; detached checkouts default
to Development. `ORDO_APP_VARIANT=stable|preview|development` explicitly selects
the identity (also used by the three same-named EAS profiles). Release variants
must match the version suffix. `EXPO_UPDATES_CHANNEL`, if supplied, must match
the variant; it cannot redirect an app. `ORDO_BUILD_BRANCH` sets branch context.
The manifest plugin preserves signing headers for release variants and removes
update request headers entirely for Development.

## CI gates and native compatibility

Pushes, pull requests, dispatches and published releases run typecheck, lint
and the production dependency audit. APKs, server archives and OTA all depend
on those gates.
Forks and pull requests do not distribute artifacts or receive publish secrets.
Branch deletion events do not run builds.

The fingerprint detector compares with an APK-producing ancestor or a shipped
APK on the same branch. JS-only runs are not binary baselines. An unknown or
failed comparison requires an APK. Git metadata and test-script lists are
excluded; native plugins and native dependencies are included.

Before OTA publication, CI waits for older in-flight APK jobs and resolves the
**actual successful APK runtime** from its artifact. A failed APK or unavailable
runtime cannot turn into an unreachable OTA. Compatible older runtimes are
also targeted when available. GitHub API failures fail closed.

In-flight baselines must already be ancestors of the commit being tested; a
later overlapping push is not in the clone and is never used. Concurrency
groups in CI are per-job, never workflow-wide: a workflow-wide group would
cancel an in-flight APK when a later JS-only push starts its OTA, leaving that
native fingerprint with no binary.

Release APKs are signed with one stored upload key (alias `ordo`) from the
`ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` repository secrets.
A missing secret fails the build instead of silently minting a new debug key.
OTA publication and channel management additionally use the `EXPO_TOKEN`
repository secret (an EAS access token).

EAS CLI is pinned to 24.8.0. Channels are created and linked before first use.
SDK 57 requires `--environment` on every OTA publication: Stable uses the
`production` EAS environment and Preview uses `preview`. Development cannot
publish OTA. Native prebuild, fingerprinting and publication all receive the
same variant. EAS build profiles use local version sources; the GitHub/Gradle
pipeline is the canonical release APK builder and signing authority.

The C++ layer dominates APK build time and would recompile from scratch on
every fresh checkout, so CI wraps clang with ccache (`ORDO_ENABLE_CCACHE`) and
carries `~/.ccache` across runs. Fresh runners get new compiler timestamps, so
the compiler is verified by content. Kotlin/Java reuse Gradle's build cache.

Every APK of a build — the universal package and all four ABI splits — shares
one `versionCode`. Only Development uses the CI run number, so its build
numbers keep growing across manual builds. Preview and Stable are separate apps
with release-derived numbers. Stable counts stable tags in version order, so
0.1.0, 0.2.0 and 0.3.0 are 1, 2 and 3, and every later stable release adds
one. CI needs the complete tag history and rejects a new stable version older
than an existing stable tag. Existing published APKs retain their original
numbers: 0.1.0 used 726 and 0.2.0 used 1. Preview adds its sequence number to
the line's offset in
`PREVIEW_CODE_BASES` (`scripts/release-policy.js`) — the count of previews
earlier lines shipped — so the count keeps rising when a new line opens
instead of restarting below the previous line's previews. A re-run reuses its
run's code and the immutability check refuses replacing published assets with
different bytes.

Development APKs are updated manually from Actions artifacts. They cannot
receive OTA or published-release APK updates. Installing Stable or Preview
does not replace Development because each has a different package ID.

## Ship a version

Release notes are for people using the app. Start each release body with a short
headline (`###`), then a plain-language introduction explaining what changed.
Follow with a few named highlights: a bold title and one short explanation per
list item. Use small sections for remaining fixes or necessary installation
guidance. Don't repeat highlights in a second list. Describe visible changes
and useful improvements in terms of what the person can do or notice. Omit build
numbers, branch merges, audits, test infrastructure, dependency details, and
unchanged compatibility information. Include installation guidance only when
the user must take action or could lose local data. The app reads the
published GitHub release body, not a file in this repository.

Compare each Stable release with the previous Stable release, including the
changes that first appeared in Preview. Compare each Preview with the previous
Preview in the same release line; for Preview 1, compare with the previous
Stable release. Check the actual changes between those tags and describe the
result people will see, including fixes and removals where they matter. Do not
repeat earlier Preview notes unless the behavior changed again. If a change was
added and later removed before Stable, do not present it as a Stable feature.
Group notes under clear headings such as New, Improved, and Fixed, and use
simple, medium-length sentences. The first Stable release describes the app
itself because there is no earlier Stable release to compare.

The files in `docs/release-notes/` record the rewritten published history.
When editing a published release, update its file and GitHub release body
together. The GitHub release body remains the source shown in the app.

1. Cut `release/x.y.z` from the intended source and set `version` in
   `apps/mobile/app.config.js` to that exact version (or its prerelease).
2. Commit and push the release branch before creating the tag.
3. Tag that commit, push the tag, and publish its GitHub Release with target
   **`release/x.y.z`**. Stable tags use the stable release marker; Preview
   tags use the prerelease marker. Publishing from main is rejected, even if
   the commit also exists on a release branch.
4. Wait for CI. It compiles the server, uploads its source archive and checksum,
   and attaches a universal APK plus all four signed ABI splits. Stable assets
   are `ordo-vX.Y.Z[-<abi>].apk`; Preview assets are
   `ordo-preview-vX.Y.Z-preview.N[-<abi>].apk`. Missing gates
   or a missing ABI fail the release job. Clients ignore incomplete APK assets
   and retry discovery when a newer release is still waiting for its APKs.

```sh
git checkout -b release/0.2.0
# Set const version = "0.2.0" in apps/mobile/app.config.js
git add apps/mobile/app.config.js
git commit -m "Set the release version to 0.2.0."
git push -u origin release/0.2.0
git tag v0.2.0
git push origin v0.2.0
gh release create v0.2.0 --target release/0.2.0 --title "0.2.0" --notes-file /path/to/reviewed-notes.md --latest
```

`v0.2.0-preview.1` uses `release/0.2.0` too; publish with `--prerelease` and without
`--latest`. Promotion sets the branch's version to `0.2.0` and publishes a new
`v0.2.0` tag. This produces a separate Stable app; Preview users remain on
Preview and only receive later Preview releases. The changed identity, native
version and channel require a new APK.

Published assets are immutable. Upload retries reuse identical digest-matching
bytes; different bytes fail instead of clobbering a user's in-flight download
or cached APK. Server archives are deterministic for the same commit/version.
Publish a new version for a changed binary.

## Maintain and roll back

- Push JS fixes to the exact shipped version's branch to OTA onto that version.
  A native fix produces a CI artifact; publish a **new version** for users to
  receive it through the in-app updater. It compares versions, not commit hashes.
- Copy fixes back to main explicitly with merge or cherry-pick. CI does not
  create release branches or merge them into main.
- For a bad OTA, republish an older compatible update group to the same branch
  with EAS's rollback tools. Rollback publications have a fresh timestamp; the
  app also handles rollback-to-embedded directives. Never republish across
  incompatible runtimes or redirect stable installs onto development.
- For a bad APK, publish the next patch from its matching release branch.
  Keep existing tags/assets intact and revert source as appropriate.

## Self-hosted server

Each GitHub Release contains `ordo-server-vX.Y.Z.tar.gz` and its `.sha256` file.
The archive is tagged source, including the release manifest. First-run setup
is a guided wizard that writes a complete, documented `apps/server/.env` —
secrets generated and stored explicitly — then installs, builds, and prepares
the database; `docs/SERVER-SETUP.md` documents every step. Hosts install
dependencies and compile native modules with Node.js 22.13+ and the pinned pnpm.

```sh
curl -fsSL https://ordo.axolet.com/install | bash
curl -fsSL https://ordo.axolet.com/install | ORDO_DIR=/opt/ordo bash
curl -fsSL https://ordo.axolet.com/install | bash -s -- --pre
./scripts/deploy-server update --yes --release v0.2.0
```

The release menu sorts by version, hides both marked and suffix-only prereleases
unless requested, and allows explicit older tags. Automatic latest selection
does not downgrade an installed newer version. Downloads have deadlines;
official archives require checksums and a valid Ordo tree before applying.

`.env`, secrets, SQLite, backups, avatars and unowned operator files remain.
Archive installs record owned source files so deleted source is removed on the
next update. Git installs detach at the tag without moving the operator's
branch. `/api/server/info` reports the installed manifest's version.

`--from-git` pulls an existing checkout; `--no-release` builds the on-disk copy.
`--require-asset` disallows fallback to an older release's source archive/tag.
`--release latest-pre` and `--pre` work on fresh installs too. `--dry-run` never
downloads or creates a fresh install.

## Verification

Run heavy checks on the builder. From a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @ordo/shared build
pnpm -r typecheck
pnpm -r lint
pnpm audit --prod --audit-level=high
pnpm --filter @ordo/server build
shellcheck -S warning .github/scripts/*.sh
```
