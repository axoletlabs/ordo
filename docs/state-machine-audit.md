# Reachable state-machine audit

Audit date: 2026-11-08. Scope covers the server, mobile app (including its web
target), Android generators, persistence, background work and APK/OTA scripts.
There is no separate `apps/web` directory in this checkout.

The criterion for changing a flow was an executable path to a broken state:
overlapping requests/actions, a late completion, a failed native operation, or
process death between durable writes. A boolean used only for rendering did
not qualify by itself.

## Fixed transitions

| Flow | Reachable failure | State and guard |
| --- | --- | --- |
| Legacy encryption | Version advanced before row conversion; interrupted migration never resumed; parallel logins installed different keys | Durable `plaintext → migrating → encrypted`. Conditional key claim, adopt winning key, idempotent transactional pages, atomic completion check. Migration backfills existing keyed accounts to `migrating`. |
| Legacy requests/background work | A null-key request/job could write plaintext after migration finished | Null-key requests, extraction and import jobs share a per-account transition lease with key installation; queued work resolves the durable key when it starts. Encrypted work retains normal concurrency. |
| Password changes/resets | Crash after password write retained old sessions; old-password login inserted a session after reset; first key installation raced a reset's stale plaintext snapshot | Password/wrap, OTP claim, session and challenge revocation commit together. Guard writes on the verified password and key snapshot. New sessions prove the password/MFA snapshot in the same transaction as insertion. |
| OTP/MFA/email changes | Concurrent failures lost increments; capped/expired code could still be consumed; parallel reset/enrollment succeeded twice; stale step-up changed newer MFA; delayed email requests replaced the current target's code or issued recovery codes to an old mailbox | Atomic increments; cap/expiry checks at match and claim. Exact single-use enrollment/login challenge claims. MFA mutations prove the verified credential snapshot. Pending email and OTP replacement commit together; issuance proves the current address and recovery challenge. Email confirmation revokes codes sent to the previous address. |
| Lazy exports | A plaintext request returned its stream before migration installed a key; the generator later read encrypted rows without that key | JSON, HTML and CSV streams resolve the durable key after reading each page/group whenever their captured key is absent. |
| Folder locks | Old tokens survived a crash during lock change; an unlock that verified the old password issued a token after replacement | Lock change and token deletion share a transaction; token issuance rechecks the verified lock inside its transaction. |
| Import jobs | Restart stranded parsing/committing; expiry/cancel removed a running commit; atomic content committed without the completed result | Await boot recovery before HTTP acceptance. Guard `ready → committing`, protect active commits, refresh expiry. Atomic content and completed result commit together. Guard all late status writes. |
| Bookmark patches/read state | Stale classification undo overwrote newer edits; partial reading/undo left read and completion fields disagreeing | Conditional revision/state write with bounded recomputation; paired read/completion writes; explicit mark-read remains independent of saved scroll position. Missing rows return 404. |
| Extraction | Cancelled attempt wrote after re-enqueue or removed the newer controller; failed pending scan or key lookup prevented retries | One per-bookmark `queued/running` record; each callback/cleanup proves attempt ownership, including failures before extraction starts. Pending scan has loading/ready ownership and clears failed attempts. |
| Reader workers | Unexpected clean exit stranded promises; partial pool construction leaked workers; closed pool accepted work | Explicit `workers/inline/closed`; every exit/failure settles pending/queued work; partial startup and close terminate owned workers. |
| HTML cache | First caller's abort killed other waiters; abandoned loader overwrote fresh content; forced/article fetch reused metadata-only results | Shared-flight ownership by live waiters, last-waiter cancellation, identity-guarded cache writes, separate fetch-mode keys. |
| Tag suggestions | Stale scoring recreated suggestions after acceptance | Re-read bookmark revision and accepted/dismissed decisions inside the replacement transaction. |
| Schema boot/instance owner | Crash left unrecorded partial DDL; first-registration create race returned 500 | Migration SQL and applied marker commit together; owner-claim loser adopts the winning row. |
| Auth restoration | Late hydration undid logout/login; old-origin or old-account sidecar was adopted | Session-generation and origin guards. Persist origin and sign-in identity; native rotations must own the same identity. |
| Credential persistence | A slow token/sidecar write restored credentials after logout | One ordered writer per resource, including clears. Sidecar reads wait for queued writes. Server switches clear secrets before persisting the new origin. |
| Native Quick Save | Refresh returned after logout/account replacement and restored old tokens; retried 5xx was reported as sign-in failure | Synchronized native snapshot compare-and-replace, preserving sign-in identity. Classify the retry's actual outcome. |
| Runtime restart/server switch | Two callers ran different commit callbacks; early native failure wedged restart; failed reload left UI busy | Explicit `idle/preparing/presenting/reloading`, reserve before awaits, release on failure. Global switch ownership and synchronous UI action guards. |
| Import UI | Late saved-job restore replaced a fresh upload; old dismissed upload replaced a newer one; transient error forgot a live job; same-frame dismissal forgot a claimed commit | Restore ownership guard; explicit picker/upload attempt identity; late abandoned jobs are cancelled. Refetch the same job on transient failure; one confirmation owns the commit and blocks dismissal until settlement. Cache responses under their returned job identity. |
| Other repeated UI actions | Same-render double taps issued duplicate unlock, reminder, rename or reload operations | Reserve action ownership synchronously, release on settlement/failure, derive pending presentation from it. |
| Reminders | Concurrent sync presented twice; slow schedule recreated a cancelled reminder; failed channel was permanently considered ready | Per-bookmark serialized OS transitions; explicit handler `idle/setting-up/ready`; failed setup/presentation remains retryable. |
| Delete journal/network/fetch | Corrupt journal permanently prevented deletions; duplicate boot listeners accumulated; finished fetch retained abort listeners | Salvage validated journal entries and repair storage; one initialization promise; dispose merged-signal listeners on completion and abort. |
| APK/OTA CI | Skipped single-APK job hid an active/successful release matrix; runtime lookup selected the skipped job | Shared `deciding/building/built/no-apk/failed` classifier for both publishing paths, including partially visible jobs. Require successful publishing before using runtime artifacts. |

## Reviewed without blanket rewrites

Auth refresh already has JS single-flight and session-scope guards. Server
refresh-token reuse rejection remains the existing security policy. A TOTP's
valid time window is an authentication policy, not a new enrollment/login
state; challenges and backup codes are still single-use. Attempt retirement
may lose a race to a final bad guess, but cannot bypass the cap.

Query persistence already catches corrupt restores. Session-scoped mutations,
undo-delete replay, search epochs, native-download epochs, incoming-share
generations and preference write coalescing already reject stale ownership.
Settings hydrate completes before the interactive shell. Native download
cancel/dismiss paths already clear their pending presentation. These flows and
independent rendering/preferences flags were left alone. Unproven reminder
armed/fired persistence rewrites were removed from the change.

## Verification

After dependency installation and Prisma generation:

```sh
pnpm db:generate
pnpm typecheck
pnpm build
pnpm lint
pnpm test:state
pnpm --filter @ordo/server test:bookmark-title
pnpm --filter @ordo/mobile test:state-native
pnpm --filter @ordo/mobile exec expo export --platform all
```

`test:state` exercises real temporary SQLite databases, rollback fault injection,
parallel credential claims, paused async completions, OS/worker fakes and actual
shell scripts with mocked GitHub responses. `test:state-native` compiles the
generated Kotlin and executes refresh/logout/account races and HTTP retry
outcomes against JVM fakes. CI runs these suites; its existing verified Kotlin
compiler supplies `KOTLINC`.

Existing bookmark-title, mobile diagnostics, folder/tag, reader, animation and
native guard suites provide integration coverage. JVM tests and bundle exports
do not replace physical-device Android/iOS instrumentation. Legacy transition
leases follow the existing single-server SQLite deployment model; key claims
and durable lifecycle guards also remain conditional database operations.
