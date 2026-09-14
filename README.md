<p align="center">
  <img src="apps/mobile/assets/icon.png" width="96" alt="ordo" />
</p>

<h1 align="center">ordo</h1>

<p align="center"><strong>The app that keeps your life in order.</strong></p>

<p align="center">
  A self-hostable bookmark manager. Save links, read them in a clean reader,
  and keep the data on a server you run.
</p>

## What you get

- **Bookmarks** with a reader that pulls out the article
- **Folders and tags** so things stay easy to find
- **Import and export** as JSON, HTML, or CSV
- **Accounts** with MFA and profile pictures if you want them
- **Your own backend**, running on SQLite. Nothing else to install.

There isn't a hosted Ordo cloud. You run the API, then point the app at it.

## Run the backend

You need **Node.js 20+** and **[pnpm](https://pnpm.io)** (this repo uses pnpm 11).

### 1. Clone and install

```bash
git clone https://github.com/axoletlabs/ordo.git
cd ordo
pnpm install
```

### 2. Prepare the database

```bash
pnpm --filter @ordo/shared build
pnpm --filter @ordo/server db:setup
```

That generates the Prisma client and creates a SQLite database at
`apps/server/prisma/ordo.db`. You don't need a `.env` file to start.

### 3. Start the server

```bash
pnpm --filter @ordo/server dev
```

The API listens on [http://localhost:3000](http://localhost:3000). Check it:

```bash
curl http://localhost:3000/api/server/info
```

You should see JSON with `name`, `version`, and `registrationEnabled`.

To run it without file watching:

```bash
pnpm --filter @ordo/shared build
pnpm --filter @ordo/server db:setup
pnpm --filter @ordo/server build
pnpm --filter @ordo/server start
```

Back up `apps/server/prisma/ordo.db` and `apps/server/.ordo-secret`. The secret
file is created on first start if you don't set `JWT_SECRET`.

### 4. Create an account

Open the app, connect to your server, and sign up. Registration is on by default.

If you don't want anyone else creating an account, copy
`apps/server/.env.example` to `apps/server/.env`, set
`REGISTRATION_ENABLED=false`, and restart.

If you skip SMTP, one-time email codes are printed in the server console.

## Point the app at your server

1. Install the Android APK from [Releases](https://github.com/axoletlabs/ordo/releases).
2. On the login screen, tap the server URL and enter yours.
3. Register or sign in.

You can change the URL later under Settings.

To run the app from source instead of the APK:

```bash
pnpm --filter @ordo/mobile start
```

## Configuration

Everything is optional. Copy `apps/server/.env.example` to `apps/server/.env`
only when you want to change a default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `file:./ordo.db` | SQLite file (under `apps/server/prisma/`) |
| `JWT_SECRET` | auto-saved to `.ordo-secret` | Session secret. Keep this file. |
| `REGISTRATION_ENABLED` | `true` | Allow new sign-ups |
| `EMAIL_VERIFICATION_REQUIRED` | `false` | Require a code on sign-up |
| `SMTP_URL` | unset | Mail for verification and reset codes. Leave empty to print codes in the console. |
| `SMTP_FROM` | `ordo <noreply@ordo.local>` | From address when SMTP is set |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx, Caddy, or Cloudflare |
| `MFA_REQUIRED` | `false` | Require MFA for every account |
| `CORS_ALLOWED_ORIGINS` | reflect the request | Comma-separated origins. Empty allows the caller. |

## Layout

```
packages/shared   typed API contract (zod schemas, routes, error codes)
apps/server       NestJS + Prisma + SQLite
apps/mobile       Expo / React Native client
```

## License

[AGPL-3.0](LICENSE)
