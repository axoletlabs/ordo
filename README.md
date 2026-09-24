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
anonymous counts to ordo Cloud: installs, opens, sign-ins, registrations, and
coarse health (timeouts, server errors, sign-in failures, startup speed), plus
platform, version, and Cloud or self-host. Sign-ins and registrations are
counted separately. It does not include your account, server URL, or library.
A server you host does not receive these pings.

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
proxy), then installs, builds, and migrates SQLite. The API binds
`127.0.0.1` so it is not on the LAN until you put nginx or Caddy in front
(`deploy/nginx.conf.example`, `TRUST_PROXY=1`) or pass `--public`. Check it:

```bash
curl http://localhost:3000/api/server/info
```

You should see JSON with `name` (`ordo` until renamed), `version`, and
`registrationEnabled` (`true` until the first account exists). The payload
does not include the machine hostname.

### Update

On a machine that already has ordo, pull, rebuild, and migrate without
touching `apps/server/.env`:

```bash
./scripts/deploy-server update
./scripts/deploy-server update --yes
```

If you omit the command and `.env` or a database is already there, **update**
is assumed. `update` runs `git pull --ff-only` (skip with `--no-pull`). A dirty
worktree stops the pull before anything else changes; untracked files are fine.
If that pull checks out a newer copy of this script, the new copy finishes the
update. When `node_modules` already matches `pnpm-lock.yaml`, install is skipped.

The script then builds, snapshots SQLite next to the live file, and applies
pending Prisma migrations — including adopting an older `db push` database.
Do not run `prisma migrate deploy` yourself on a file that has no
`_prisma_migrations` table.

If ordo is already listening, the script stops it before touching the database
and starts it again in the background (`apps/server/ordo.log`). `--start` still
attaches to the foreground. `--no-start` leaves it stopped. Another program on
the same port is not killed.

`pnpm deploy:server:update` is the same as `./scripts/deploy-server update`.

### Non-interactive

Same steps, no prompts. Flags override defaults. Use this in scripts and CI.

```bash
./scripts/deploy-server --yes
./scripts/deploy-server --yes --port 8080 --trust-proxy 1 --start
./scripts/deploy-server --yes --public --registration true
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
**Use your own server** and register there. The first account can always
register. After that, sign-ups stay closed unless you pass
`--registration true` or set `REGISTRATION_ENABLED=true` in
`apps/server/.env` and restart.

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
| `LISTEN_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` or `--public` if you skip a reverse proxy |
| `DATABASE_URL` | `file:./ordo.db` | SQLite file (under `apps/server/prisma/`) |
| `JWT_SECRET` | auto-saved to `.ordo-secret` | Session secret. Keep this file. |
| `LIBRARY_KEK` | auto-saved to `.ordo-library-key` | Wraps library encryption keys so email password reset still works. Keep this file. |
| `REGISTRATION_ENABLED` | `false` | Allow sign-ups after the first account. The first account can always register |
| `EMAIL_VERIFICATION_REQUIRED` | `false` (on for ordo Cloud) | Require a code on sign-up |
| `SMTP_URL` | unset | Mail for verification, reset, and account notices. Leave empty to print codes in the console. Resend: `smtp://resend:re_…@smtp.resend.com:587` (use 2465 if you need implicit TLS; 465 is often blocked) |
| `SMTP_FROM` | `ordo <noreply@ordo.local>` | From address when SMTP is set. Use a domain you verified with the provider. |
| `SMTP_REQUIRED` | `false` (on for ordo Cloud) | Never print codes. Missing or failed SMTP is an error. |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx, Caddy, or Cloudflare. See `deploy/nginx.conf.example` |
| `MFA_REQUIRED` | `false` | Require MFA for every account |
| `INSTANCE_RENAME_ENABLED` | `true` (off for ordo Cloud) | Allow the owner to rename this instance from the app |
| `INSTANCE_ADMIN_EMAIL` | unset | If set, only this email may rename. Otherwise the first account. |
| `CORS_ALLOWED_ORIGINS` | this origin + localhost | Comma-separated extra origins. Empty never echoes strangers. ordo Cloud sets the website. |

## Layout

```
packages/shared   typed API contract (zod schemas, routes, error codes)
apps/server       NestJS + Prisma + SQLite
apps/mobile       Expo / React Native client
```

## License

[AGPL-3.0](LICENSE)
