<p align="center">
  <img src="apps/mobile/assets/icon.png" width="96" alt="ordo" />
</p>

<h1 align="center">ordo</h1>

<p align="center">A bookmark manager. Save a link, read the article, and keep it.</p>

## Install

Download the Android app from [Releases](https://github.com/axoletlabs/ordo/releases) and sign in. New installs use [ordo Cloud](https://api.ordo.axolet.com). There is nothing to configure.

The official app sends anonymous counts to ordo Cloud: installs, opens, sign-ins, registrations, and coarse health, plus platform, version, and whether you use Cloud or a server you host. It does not include your account, server URL, or library. A server you host does not receive these counts.

To run the app from source you need Node.js 22.13+ and [pnpm](https://pnpm.io) 11:

```bash
pnpm --filter @ordo/mobile start
```

## Your own server

Optional. You keep it online, updated, and backed up. Axolet does not operate a server you host. You need Node.js 22.13 or newer.

```bash
curl -fsSL https://ordo.axolet.com/install | bash
```

That installs the latest release into `~/ordo`. Set `ORDO_DIR` to use another folder. On a terminal, pick a release with the arrow keys and answer a few questions. The server listens on `127.0.0.1`. Put nginx or Caddy in front (`deploy/nginx.conf.example`) or pass `--public`.

```bash
curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes
curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes --release v0.1.0
```

When it is up:

```bash
curl http://localhost:3000/api/server/info
```

Update an existing server from a published release. `.env`, secrets, the database, backups, and avatars stay put.

```bash
cd ~/ordo
./scripts/deploy-server update
./scripts/deploy-server update --yes --release v0.1.0
```

Type a version in the menu to jump to that tag. If ordo is already running, the script restarts it. `./scripts/deploy-server --help` lists the rest. `--from-git` pulls the current branch instead of a release.

Back up `apps/server/prisma/ordo.db` and `apps/server/.ordo-secret`. The script snapshots the database before a migration. Let it apply migrations. Don't run `prisma migrate deploy` yourself on a database that has no `_prisma_migrations` table. The first account can always register. Later sign-ups stay closed unless you turn them on. Without SMTP, one-time codes print in the server console.

For day-to-day work on the server:

```bash
pnpm --filter @ordo/server dev
```

## Point the app at your server

On the sign-in screen, choose **Use your own server**, agree that you run it, and enter the URL. You can switch later under Settings → Hosting. Switching signs you out. Libraries are not copied between ordo Cloud and a server you run.

## Configuration

`./scripts/deploy-server` writes `apps/server/.env` on first install and leaves it alone after that. You can also copy `apps/server/.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `LISTEN_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` or `--public` if you skip a reverse proxy |
| `DATABASE_URL` | `file:./ordo.db` | SQLite file, under `apps/server/prisma/` |
| `JWT_SECRET` | saved to `.ordo-secret` | Session secret. Keep this file |
| `LIBRARY_KEK` | saved to `.ordo-library-key` | Lets password reset still unlock the library. Keep this file |
| `REGISTRATION_ENABLED` | `false` | Sign-ups after the first account. The first account can always register |
| `EMAIL_VERIFICATION_REQUIRED` | `false` | Require a code on sign-up. On for ordo Cloud |
| `SMTP_URL` | unset | Mail for verification and reset. Empty prints codes in the console |
| `SMTP_FROM` | `ordo <noreply@ordo.local>` | From address when SMTP is set |
| `SMTP_REQUIRED` | `false` | Refuse to print codes. On for ordo Cloud |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx, Caddy, or Cloudflare |
| `MFA_REQUIRED` | `false` | Require MFA for every account |
| `INSTANCE_RENAME_ENABLED` | `true` | Let the owner rename this instance. Off for ordo Cloud |
| `INSTANCE_ADMIN_EMAIL` | unset | If set, only this email may rename. Otherwise the first account |
| `CORS_ALLOWED_ORIGINS` | this origin + localhost | Extra browser origins, comma-separated |

## Layout

```
packages/shared   API contract
apps/server       NestJS, Prisma, SQLite
apps/mobile       Expo app
```

## License

[AGPL-3.0](LICENSE)
