# ordo

A self-hostable bookmark manager. Save URLs, read them in a clean reader mode, organize into folders.

Built as a TypeScript monorepo: a NestJS + Prisma backend, a shared contract package, and an Expo (React Native) mobile client.

```
ordo/
  packages/
    shared/   zod schemas, DTOs, typed API contract, error codes, constants
  apps/
    server/   NestJS + Prisma (SQLite by default, Postgres ready)
    mobile/   Expo (React Native) + Expo Router
```

## Quick start

```bash
pnpm install
pnpm db:generate            # generate prisma client + create sqlite db
pnpm --filter server dev    # backend → http://localhost:3000
pnpm --filter mobile start  # expo app (i/a/w for ios/android/web)
```

The server boots with zero config (SQLite at `apps/server/prisma/ordo.db`). The mobile app defaults to `http://localhost:3000` and can be re-pointed at any instance from **Settings → Server**.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start all workspaces (turbo) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck the whole repo |
| `pnpm lint` | ESLint (flat config, repo-wide) |
| `pnpm test` | Run all tests |
| `pnpm db:generate` | Generate the Prisma client |

## Architecture

### Shared contract (`packages/shared`)
A single typed source of truth: zod input schemas, response DTOs, a route table (`contract.ts`) giving every endpoint a typed `path/method/body/query/response`, stable error codes, and shared constants (header names, token TTLs, pagination). Both server controllers and the mobile API client import from here, so the wire is end-to-end typed.

### Backend (`apps/server`)
NestJS with constructor injection, Prisma ORM, and a global error filter that normalizes every failure into `{ error: { code, message, details? } }`. Auth is session-based (opaque, sha256-hashed tokens — not JWTs) with a rotating refresh token and a Postgres/SQLite-backed session table. Bookmarks fetch and extract clean article content (Readability + sanitize-html → markdown + text) at creation. See `apps/server/README`-inline docs for the full endpoint map.

### Mobile (`apps/mobile`)
Expo Router (file-based navigation), Reanimated 3 for physics-based motion, and a custom design-token system (no styling library — pure `StyleSheet` + tokens for full control over the light/dark/AMOLED themes).

**State management — why two libraries:**
- **TanStack Query** owns *server state* (folders, bookmarks, sessions, server info). It gives us stale-while-revalidate caching (no flicker on navigation), cursor pagination via `useInfiniteQuery`, and optimistic mutations with rollback — directly satisfying the "instant UI, reconcile with server" requirement.
- **Zustand** owns *client/UI state* (auth tokens, server URL, theme, AMOLED, the folder-unlock-token cache). Small, explicit, and hydrated from persistence on launch.

This keeps the two concerns cleanly separated and avoids overloading either tool.

**Auth & tokens:** access + refresh tokens live in `expo-secure-store` (Keychain/Keystore). The API client always sends `x-client-type: mobile` (so the server returns tokens in the body), attaches `Authorization` and `x-folder-token` headers automatically, performs **single-flight transparent refresh** on `token_expired` (then replays the original request), and schedules a proactive refresh just before expiry.

**Protected folders:** a `folder_protected` 403 triggers a password prompt; on success a 10-minute folder-scoped token is cached per folder and injected on subsequent requests.

**Reader:** renders article content from a custom, themeable Markdown renderer (the server returns `contentMarkdown` in list responses, so the reader usually needs no extra fetch). AMOLED swaps surfaces to pure `#000000`.

## Environment (all optional)

| Var | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend port |
| `DATABASE_URL` | `file:./ordo.db` | SQLite path (or a Postgres URL) |
| `JWT_SECRET` | auto-generated + persisted | App secret (token pepper) |
| `REGISTRATION_ENABLED` | `true` | Allow new sign-ups |
| `CORS_ALLOWED_ORIGINS` | reflect origin | Comma-separated origins |
| `EMAIL_VERIFICATION_REQUIRED` | `false` | Require email verification on signup |
| `SMTP_URL` | — | SMTP for verification, email-change, and password-reset codes. When unset, the one-time code is printed to the server console. Mailpit (or any fake SMTP) is optional. |
| `SMTP_FROM` | `ordo <noreply@ordo.local>` | From address used when SMTP is configured |
| `RATE_LIMIT_ENABLED` | `true` (off in Jest) | Login / register / password-reset / reader rate limits. In-memory, per process; set `false` to disable in local dev |
| `TRUST_PROXY` | `0` | Reverse-proxy hops to trust for `X-Forwarded-For`. `0` uses the socket address (clients cannot spoof it). Set to `1` behind nginx, Caddy, or a Cloudflare tunnel |
