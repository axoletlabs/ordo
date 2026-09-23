# Ordo release process: stable, early access, APKs, and OTA

Two independent layers. Keep them separate in your head and everything else follows.

- **Binary (native) layer:** GitHub Releases + the in-app updater. Users sideload APKs from `api.github.com/repos/axoletlabs/ordo/releases`. Any native change needs a new APK. There is no way around this, for anyone.
- **JS layer:** EAS Update. Ships in minutes over the air. Only lands on APKs whose native fingerprint matches. Updates ship unsigned (EAS code signing needs a paid plan); distribution is protected by https only. From a machine: `eas update …` or `eas update:republish --group <id>`.

Branches decide where commits live. Tags decide what ships as a binary. Channels decide which installed APK hears an OTA. You never set a channel by hand; it is derived from the version string in `apps/mobile/app.config.js`.

## Branch map

| Branch | Purpose | OTAs to | APKs |
| --- | --- | --- | --- |
| `main` | next version, all new work | production (stable version) or development (alpha/beta/rc) | when fingerprint changes |
| `release/x.y` | maintenance of shipped v`x.y` | production | when fingerprint changes |
| `preview` | dogfood | preview | when fingerprint changes |
| feature branches | PRs | never (CI analysis only) | never |

Rule: after you tag a stable release, `main` belongs to the NEXT version. Do not chase main back to the released one. Hotfixes live on `release/x.y`.

## The one habit that makes it all work

Nothing. Publishing a GitHub Release automatically creates `release/x.y` at the tag (see "What is automated for you" below). The manual equivalent, if you ever want it:

```bash
git checkout -b release/0.1 v0.1.0
git push origin release/0.1
```

## Scenario 1: routine stable release (mostly JS changes)

1. Land work on `main` (PRs or direct). JS-only pushes OTA automatically to production or development based on the version in `app.config.js`. Native drift mints a dev APK on main. You do nothing.
2. Bump `version` in `apps/mobile/app.config.js` to the release version (CI rejects a tag that does not match it).
3. Tag and publish the GitHub release:
   - Stable: tag `v0.2.0`, "Set as the latest release", pre-release UNCHECKED.
   - Early access: tag `v0.2.0-beta.1`, "This is a pre-release" CHECKED.
4. CI builds signed per-ABI APKs + universal, uploads them to the release. The in-app updater offers the APK to users (early builds only reach users with "include prereleases" on).
5. If you forgot the maintenance branch, cut `release/0.2` from the tag now.

## Scenario 2: your exact accident (native change on main, then a JS fix for the shipped version)

Native commit landed on main after v0.1.0 shipped. The JS fix is supposed to reach v0.1.0 users.

1. Do NOT force-push, do not revert main. Main already belongs to v0.2.0; the native change rides the next APK normally.
2. Ship the fix from the release line:
   ```bash
   git checkout release/0.1
   git cherry-pick <fix-commit>        # or re-implement the JS fix without the native part
   git push origin release/0.1
   ```
3. CI on `release/0.1`: fingerprint unchanged vs the v0.1.0 APK, so it publishes an OTA straight to the production channel, onto exactly the runtime shipped users have. Done in minutes.
4. If the fix can't be separated from the native change, it waits for v0.1.1: cherry-pick everything, push, then commit with `-apk` in the message (or let fingerprint drift trigger it) to mint the v0.1.1 APK, tag `v0.1.1` on the branch, publish the release.
5. Merge the branch back so v0.2.0 inherits the fix:
   ```bash
   git checkout main
   git merge release/0.1
   git push origin main
   ```

## Scenario 3: JS hotfix while nothing is wrong (the common case)

Fix on `release/x.y`, push. OTA to production users within minutes. Tag only when you also want the binary updated; an OTA alone is a complete release for JS fixes.

## Scenario 4: early access (beta/RC) track

- Keep landing on `main` with the version set to `0.3.0-beta.N`.
- Tag `v0.3.0-beta.N` as a pre-release. CI builds its APKs; the OTA channel resolves to `development` because of the version suffix, so beta APKs and beta OTAs never touch stable users.
- Promote by finishing the cycle: set version to `0.3.0`, tag `v0.3.0` as latest. Same commits, new audience.

## Escapes (rare, all non-destructive)

- **Bad JS shipped via OTA:** roll back with one command from your machine: `eas update:republish --group <old-good-group-id>` (find group ids in the EAS dashboard under the update's channel, or `eas update:list`). It re-publishes the previous bundle with a fresh timestamp and every device rewinds at next launch. No force-push involved.
- **Bad APK release:** delete the bad tag/release, fix on `release/x.y`, tag `vX.Y.(Z+1)`. Version codes only move forward, never rewrite.
- **Bad source either way:** `git revert` on the right branch. History stays intact, which is what keeps the fingerprint baselines and embedded commitTime checks in CI working.

## What is automated for you (release.yml)

When you publish a GitHub Release, a second workflow runs alongside the APK build:

1. `release/x.y` does not exist yet? It is created at the tag commit automatically. You never run the branch-cut command by hand.
2. Hotfix tag `vX.Y.(Z+1)` published later? The branch is fast-forwarded to the new tag.
3. The branch is merged back into `main` (no-ff) so the next version inherits every hotfix. If that merge conflicts, it opens a PR for you to resolve instead of failing silently.

## What you never have to think about

- Channel selection: derived from version string + branch.
- Fingerprint baselines, in-flight APK waits, embedded-runtime pinning: `detect` handles it per branch automatically.
- The in-app updater: reads releases, compares semver, picks the right ABI APK. Branch-agnostic.
- versionCode ordering: global run number, monotonic.

## Cheat sheet

```bash
# release
bump version in apps/mobile/app.config.js -> vX.Y.Z tag as latest, pre-release unchecked
# (release.yml auto-creates release/x.y at the tag and merges it back to main)

# early access
version X.Y.Z-alpha.N / -beta.N / -rc.N -> tag as pre-release (checked)

# JS hotfix
git checkout release/x.y; cherry-pick fix; git push   # OTA goes out on its own
# merge-back to main happens automatically when you tag the next vX.Y.* release

# native hotfix (rare)
same, but expect an APK build on the release branch; tag vX.Y.(Z+1) and publish

# OTA rollback (from your machine)
eas update:republish --group <old-good-group-id>
```
