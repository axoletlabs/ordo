# Ordo releases: development, early access, APKs and OTA

## Version sources

- `apps/mobile/app.config.js`'s `version` is the native app version. A release
  tag must be exactly `v<version>`. Versions are `X.Y.Z` or
  `X.Y.Z-(alpha|beta|rc)[.N]`, without leading zeroes or build metadata.
- `apps/server/release.json` records the installed server's version, tag,
  commit and archive. CI creates it; the installer retains its source-file
  ownership list to remove stale files on later archive installs.
- Private workspace package versions and the server's development fallback
  are package metadata, not the installed release version. `main` can keep
  a base app version while builds are identified by their commit and channel.
- `scripts/release-policy.js` is shared by Expo config, CI, the mobile updater
  and server installer. There are no separate CI/mobile semver rules.

## Streams and channels

| Branch/version | Update channel | Automatic distribution |
| --- | --- | --- |
| `main` | `development` | OTA for JS-only changes; APK artifact for native changes |
| `release/x.y.z`, stable version | `production` | OTA for compatible JS changes; APK artifact for native changes |
| `release/x.y.z`, alpha/beta/rc | `early-access` | Same behavior, isolated from main and stable |
| Feature branch | `development-<escaped branch>` | Checks only; APK via dispatch or a commit headline ending in `-apk` |

Feature channels escape branch punctuation without collisions. For example,
`t3code/material-three-redesign` uses
`development-t3code-2Fmaterial-2Dthree-2Dredesign`. A feature APK cannot be
overwritten by main's OTA even when their native dependencies match. Feature
pushes do not publish OTA; publish manually to their own channel if needed.

Channels are baked into APKs. The early-access toggle controls **GitHub APK
selection**, not the OTA channel. Beta installs default that toggle on when no
preference exists; an explicit saved preference is retained. Taking the matching
stable APK moves a beta install onto production. Existing APKs with old channel
headers need a new APK to adopt the new stream layout.

Local prebuilds infer the channel from the git branch and version. Detached local
checkouts default to development. `ORDO_BUILD_BRANCH` and `EXPO_UPDATES_CHANNEL`
can set the build context explicitly. A release branch/version mismatch fails.
The manifest plugin preserves other update headers, including signing headers.

## CI gates and native compatibility

Pushes, pull requests, dispatches and published releases run typecheck, lint,
workspace tests, updater tests, script/installer tests and the production
dependency audit. APKs, server archives and OTA all depend on those gates.
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

EAS CLI is pinned to 24.8.0. Channels are created and linked before first use.
SDK 57 requires `--environment` on every OTA publication: production uses the
`production` EAS environment, early access uses `preview`, and development uses
`development`. Native prebuild, fingerprinting and publication all receive the
same channel. EAS build profiles use local version sources; the GitHub/Gradle
pipeline is the canonical release APK builder and signing authority.

The C++ layer dominates APK build time and would recompile from scratch on
every fresh checkout, so CI wraps clang with ccache (`ORDO_ENABLE_CCACHE`) and
carries `~/.ccache` across runs. Fresh runners get new compiler timestamps, so
the compiler is verified by content. Kotlin/Java reuse Gradle's build cache.

Every APK of a build — the universal package and all four ABI splits — shares
one `versionCode`: the CI run number. Android treats an equal-code install as a
replace, so switching splits of the same build is a reinstall, and any later
build outranks every earlier one because the run counter only grows. A workflow
re-run reuses its run's code, and the immutability check refuses replacing
published assets with different bytes. The single published release (v0.1.0)
is the only APK generation under this scheme, so the run counter is the only
ordering that remains.

Development APKs do not offer published-release APK updates: their code can
already exceed a published release, which Android rejects as a downgrade.
They receive OTA on their own channel and native APKs as CI artifacts. Switching
to an older published APK may require removing the development install first;
export your library before removing local app data.

## Ship a version

1. Cut `release/x.y.z` from the intended source and set `version` in
   `apps/mobile/app.config.js` to that exact version (or its prerelease).
2. Commit and push the release branch before creating the tag.
3. Tag that commit, push the tag, and publish its GitHub Release with target
   **`release/x.y.z`**. Stable tags use the stable release marker; alpha/beta/rc
   tags use the prerelease marker. Publishing from main is rejected, even if
   the commit also exists on a release branch.
4. Wait for CI. It compiles the server, uploads its source archive and checksum,
   and attaches a universal APK plus all four signed ABI splits. Missing gates
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
gh release create v0.2.0 --target release/0.2.0 --title "0.2.0" --generate-notes --latest
```

`v0.2.0-beta.1` uses `release/0.2.0` too; publish with `--prerelease` and without
`--latest`. Promotion sets the branch's version to `0.2.0` and publishes a new
`v0.2.0` tag. The changed native version/channel requires a new APK.

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
The archive is tagged source, including the release manifest. Hosts install
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
pnpm -r test
pnpm --filter @ordo/mobile test:updates
pnpm test:scripts
pnpm audit --prod --audit-level=high
pnpm --filter @ordo/server build
pnpm test:release-runtime
shellcheck -S warning .github/scripts/*.sh
```

The runtime smoke test prebuilds four channel manifests, checks deterministic
fingerprints, runtime pinning and JS/native routing, then exports Android JS and
Hermes bytecode. Use `--no-bytecode` only for a host whose x86 Hermes compiler
cannot run correctly; that verifies JS export, not bytecode or an APK. A full
signed APK build and device installation still require the Android toolchain,
the stored upload key and a device. Script tests exercise routing, GitHub waits,
runtime lookup, APK download/cancel/install state, archive integrity and data
preservation with deterministic fixtures without publishing updates.
