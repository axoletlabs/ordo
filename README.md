<p align="center">
  <img src="apps/mobile/assets/icon.png" width="96" alt="ordo" />
</p>

<h1 align="center">ordo</h1>

<p align="center"><strong>The app that keeps your life in order.</strong></p>

<p align="center">
  A bookmark manager. Save links, read them in a clean reader,
  and keep them on ordo Cloud.
</p>

## What you get

- **Bookmarks** with a reader that pulls out the article
- **Folders and tags** so things stay easy to find
- **Import and export** as JSON, HTML, or CSV
- **Accounts** with MFA and profile pictures if you want them
- **ordo Cloud** by default — [api.ordo.axolet.com](https://api.ordo.axolet.com)
- Optional **your own backend** on SQLite, if you want to run a server

The app talks to ordo Cloud unless you opt into a server you host. Existing
installs keep the server URL they already saved. The official app also sends
one anonymous daily ping to ordo Cloud so we can count installs (app vs
browser, coarse OS, version, Cloud or self-host). It does not include your
account, server URL, or library. A server you host does not receive these
pings.

## Use ordo Cloud

1. Install the Android APK from [Releases](https://github.com/axoletlabs/ordo/releases).
2. Sign in. New installs use ordo Cloud — there is nothing to configure.

To run the app from source instead of the APK, you need **Node.js 22.13+**
and **[pnpm](https://pnpm.io)** (this repo uses pnpm 11):

```bash
pnpm --filter @ordo/mobile start
```

## Run your own server

Optional. You run it: keep it online, updated, and backed up. Axolet does not
operate, monitor, or back up a server you host. Same Node.js and pnpm as above.

```bash
git clone https://github.com/axoletlabs/ordo.git
cd ordo
./scripts/deploy-server
```

On a terminal the script asks a few questions (port, sign-ups, mail, reverse
proxy), then installs, builds, and migrates SQLite. Check it:

```bash
curl http://localhost:3000/api/server/info
```

You should see JSON with `name` (`ordo` until renamed), `version`, and `registrationEnabled`. The payload does not include the machine hostname.

### Update

On a machine that already has ordo, pull, rebuild, and migrate without
touching `apps/server/.env`:

```bash
./scripts/deploy-server update
./scripts/deploy-server update --yes
```

If you omit the command and `.env` or a database is already there, **update**
is assumed. `update` runs `git pull --ff-only` (skip with `--no-pull`), snapshots
SQLite next to the live file, then applies pending Prisma migrations — including
adopting an older `db push` database. Do not run `prisma migrate deploy` yourself
on a file that has no `_prisma_migrations` table.

`pnpm deploy:server:update` is the same as `./scripts/deploy-server update`.

### Non-interactive

Same steps, no prompts. Flags override defaults. Use this in scripts and CI.

```bash
./scripts/deploy-server --yes
./scripts/deploy-server --yes --port 8080 --trust-proxy 1 --registration false --start
```

`./scripts/deploy-server --help` lists every flag. `--dry-run` prints the plan
without changing anything. `pnpm deploy:server` is the same command.

The first install writes `apps/server/.env`. Updates leave that file alone
unless you pass `--force-env`. The server reads `.env` on boot; values already
in the environment still win.

Back up `apps/server/prisma/ordo.db` and `apps/server/.ordo-secret`. The deploy
script snapshots the database before schema changes; the secret file is created
on first start if you don't set `JWT_SECRET`.

For day-to-day hacking without a production build:

```bash
pnpm --filter @ordo/server dev
```

### Create an account

On ordo Cloud, open the app and sign in. On a server you run, complete
**Use your own server** and register there. Registration on a self-hosted
server is on by default.

If you don't want anyone else creating an account, pass
`--registration false` to the deploy script, or set
`REGISTRATION_ENABLED=false` in `apps/server/.env` and restart.

If you skip SMTP, one-time email codes are printed in the server console.

## Point the app at your server

1. Install the Android APK from [Releases](https://github.com/axoletlabs/ordo/releases).
2. On the sign-in screen, choose **Use your own server**.
3. Read the warnings, agree that you run the server, then enter your URL.
4. Register or sign in.

You can switch later under Settings → Hosting. Switching signs you out; libraries
are not copied between ordo Cloud and a server you run.

## Configuration

Everything is optional. `./scripts/deploy-server` writes `apps/server/.env` on
first run. You can also copy `apps/server/.env.example` yourself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `file:./ordo.db` | SQLite file (under `apps/server/prisma/`) |
| `JWT_SECRET` | auto-saved to `.ordo-secret` | Session secret. Keep this file. |
| `LIBRARY_KEK` | auto-saved to `.ordo-library-key` | Wraps library encryption keys so email password reset still works. Keep this file. |
| `REGISTRATION_ENABLED` | `true` | Allow new sign-ups |
| `EMAIL_VERIFICATION_REQUIRED` | `false` (on for ordo Cloud) | Require a code on sign-up |
| `SMTP_URL` | unset | Mail for verification and reset codes. Leave empty to print codes in the console. |
| `SMTP_FROM` | `ordo <noreply@ordo.local>` | From address when SMTP is set |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx, Caddy, or Cloudflare |
| `MFA_REQUIRED` | `false` | Require MFA for every account |
| `INSTANCE_RENAME_ENABLED` | `true` (off for ordo Cloud) | Allow the owner to rename this instance from the app |
| `INSTANCE_ADMIN_EMAIL` | unset | If set, only this email may rename. Otherwise the first account. |
| `CORS_ALLOWED_ORIGINS` | reflect the request | Comma-separated origins. Empty allows the caller. |

## Layout

```
packages/shared   typed API contract (zod schemas, routes, error codes)
apps/server       NestJS + Prisma + SQLite
apps/mobile       Expo / React Native client
```

## License

[AGPL-3.0](LICENSE)
