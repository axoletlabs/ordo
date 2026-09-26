# Ordo release process: stable, early access, APKs, and OTA

Two independent layers. Keep them separate in your head and everything else follows.

- **Binary (native) layer:** GitHub Releases + the in-app updater. Users sideload APKs from `api.github.com/repos/axoletlabs/ordo/releases`. Any native change needs a new APK. There is no way around this, for anyone.
- **JS layer:** EAS Update. Ships in minutes over the air. Only lands on APKs whose native fingerprint matches. Updates ship unsigned (EAS code signing needs a paid plan); distribution is protected by https only. From a machine: `eas update …` or `eas update:republish --group <id>`.

A version is a branch plus a tag. The branch is the full version: `release/0.1.0` for tag `v0.1.0`. `main` is not a version.

## Branch map

| Branch | What a push does | OTAs to | APKs |
| --- | --- | --- | --- |
| `main` | everyday work. no version release | development | development, when the fingerprint changes |
| `release/x.y.z` | that exact version | production when the version is stable, development for alpha/beta/rc | when the fingerprint changes, on that version |
| anything else | CI checks | never | never, unless you dispatch a build by hand |

There is no `preview` branch. A leftover `preview` push does not publish an update or an APK.

`v0.1.0` and `v0.1.0-beta.1` both use `release/0.1.0`. The next patch, `v0.1.1`, is its own branch, `release/0.1.1`. To change 0.1.0, push to `release/0.1.0`. That push does not land on `main`. If you also want the fix on `main`, cherry-pick or merge it yourself.

Publishing a GitHub Release does not create the branch, move it, or merge it into `main`. CI attaches APKs and the server archive only when both of these are true:

- the release target is `release/x.y.z` for that tag (`v0.1.0` and `v0.1.0-beta.1` both belong to `release/0.1.0`)
- the tagged commit is already on that branch

A release targeted at `main` is refused, even if that commit also sits on the release branch.

## Ship a version

1. Keep landing work on `main`. JS-only pushes update development installs. A native change builds a development APK. Nothing here is a version release.
2. When the version is ready, cut its branch and set `apps/mobile/app.config.js` on that branch:

```bash
git checkout -b release/0.2.0
# set version to 0.2.0 (or 0.2.0-beta.1 for early access)
git push -u origin release/0.2.0
```

3. Tag that commit and publish the GitHub Release with target `release/0.2.0`, not `main`.
   - Stable: tag `v0.2.0`, "Set as the latest release", pre-release unchecked.
   - Early access: tag `v0.2.0-beta.1`, "This is a pre-release" checked.
4. CI builds signed per-ABI APKs and the server archive onto that release. The in-app updater offers the APK (early builds only reach users with "include prereleases" on).

## Fix a version that already shipped

Push the fix to that version's branch and nowhere else.

```bash
git checkout release/0.1.0
# commit the fix
git push origin release/0.1.0
```

- JS only: CI publishes an OTA onto the APKs of that version. A stable version goes to production. An alpha/beta/rc version stays on development, so it does not reach stable users.
- Native change that needs a new version number: cut `release/0.1.1`, tag `v0.1.1` there, and publish with target `release/0.1.1`.

`main` stays where it was until you bring the fix across yourself:

```bash
git checkout main
git cherry-pick <fix>
git push origin main
```

## Early access

Early access is the same version branch. Put `0.3.0-beta.1` on `release/0.3.0`, push the branch, and tag `v0.3.0-beta.1` there. Those APKs and OTAs use development, so they never touch stable users. Promote by setting the version to `0.3.0` on `release/0.3.0` and tagging `v0.3.0` with target `release/0.3.0`.

## Escapes (rare, all non-destructive)

- **Bad JS shipped via OTA:** roll back with one command from your machine: `eas update:republish --group <old-good-group-id>` (find group ids in the EAS dashboard under the update's channel, or `eas update:list`). It re-publishes the previous bundle with a fresh timestamp and every device rewinds at next launch. No force-push involved.
- **Bad APK release:** delete the bad tag/release, fix on that version's branch, and tag the next patch from `release/x.y.z` for the new version. Version codes only move forward, never rewrite.
- **Bad source either way:** `git revert` on the right branch. History stays intact, which is what keeps the fingerprint baselines and embedded commitTime checks in CI working.

## What you never have to think about

- Channel selection: `main` is always development. `release/x.y.z` follows the version string (stable → production, alpha/beta/rc → development).
- Fingerprint baselines, in-flight APK waits, embedded-runtime pinning: `detect` handles it per branch automatically.
- The in-app updater: reads releases, compares semver, picks the right ABI APK.
- versionCode ordering: global run number, monotonic.

## What is not automatic

- Cutting `release/x.y.z`. You create the branch and push it.
- Publishing a version from `main`. CI rejects it.
- Copying a fix from a version branch back onto `main`.

## Server

The backend ships on the same GitHub Release as the APKs. Publishing the release runs `package_server`, which compiles `@ordo/server` and, only if that build succeeds, uploads:

- `ordo-server-vX.Y.Z.tar.gz` — source at the tag, plus `apps/server/release.json`
- `ordo-server-vX.Y.Z.tar.gz.sha256`

The host still runs `pnpm install` and compiles native modules. The archive is not a prebuilt `node_modules`.

Self-hosted updates install that release. They do not fast-forward the checked-out branch. On a terminal, move with the arrow keys and press enter. Type a version to jump to a specific tag.

```bash
curl -fsSL https://ordo.axolet.com/install | bash
./scripts/deploy-server update --yes --release v0.1.1
```

`.env`, secrets, the SQLite file, backups, and avatars stay put. `/api/server/info` reports the version in `apps/server/release.json`.

`--from-git` still pulls the current branch. That is the escape hatch, not the normal update. `--no-release` rebuilds whatever is already on disk. `--require-asset` refuses a tag whose release has no server archive (older releases, or a package job that failed).

## Cheat sheet

```bash
# everyday work on main — development updates only, no version release
git push origin main

# cut version 0.1.0
git checkout -b release/0.1.0
# set apps/mobile/app.config.js to 0.1.0
git push -u origin release/0.1.0
git tag v0.1.0 && git push origin v0.1.0
# publish the GitHub Release with target release/0.1.0, not main

# early access of that same version
# version 0.3.0-beta.1 on release/0.3.0, tag v0.3.0-beta.1, target release/0.3.0

# fix 0.1.0
git checkout release/0.1.0
# commit, then:
git push origin release/0.1.0
# a new patch version is a new branch: release/0.1.1, tag v0.1.1, target release/0.1.1

# bring the fix onto main yourself, when you want it there
git checkout main && git cherry-pick <fix> && git push origin main

# OTA rollback (from your machine)
eas update:republish --group <old-good-group-id>

# self-hosted backend (GitHub Release, not the branch tip)
curl -fsSL https://ordo.axolet.com/install | bash
./scripts/deploy-server update --yes --release vX.Y.Z
```
