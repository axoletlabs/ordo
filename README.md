<p align="center">
  <img src="apps/mobile/assets/icon.png" width="96" alt="ordo" />
</p>

<h1 align="center">ordo</h1>

<p align="center">A bookmark manager. Save a link, read the article, and keep it.</p>

## App

Download the Android app from [Releases](https://github.com/axoletlabs/ordo/releases) and sign in. New installs use [ordo Cloud](https://api.ordo.axolet.com).

The app sends anonymous counts to ordo Cloud: installs, opens, sign-ins, registrations, and coarse health, plus platform, version, and whether you use Cloud or a server you host. It does not include your account, server URL, or library. A server you host does not receive these counts.

To run from source you need Node.js 22.13+ and [pnpm](https://pnpm.io) 11:

```bash
pnpm --filter @ordo/mobile start
pnpm --filter @ordo/server dev
```

## Server

Optional. You keep it online, updated, and backed up. Axolet does not operate a server you host.

Node.js 22.13 or newer. If pnpm is missing, the script offers to install it.

```bash
curl -fsSL https://ordo.axolet.com/install | bash
```

The latest release is downloaded into `~/ordo` and checked against its checksum. Set `ORDO_DIR` to use another folder.

On a terminal, a short setup follows. Arrow keys move, enter selects, and enter on a blank line keeps the default. The highlighted choice is the usual one.

- **Port.** 3000, if it is free.
- **Accounts.** Only the first sign-up, or anyone who can reach the server. The first account can always register.
- **Sign-up.** Straight in, or a one-time email code.
- **Mail.** Empty prints codes in the server log. Or an SMTP URL, then a From address.
- **Network.** This machine only, this machine and the LAN, or a reverse proxy in front (nginx, Caddy, Cloudflare).
- **Start.** Leave it stopped, or run it in this terminal.

It writes `apps/server/.env`, installs dependencies, builds, snapshots the database, and applies migrations. Compiling can take a few minutes. Later runs leave `.env` alone. The server listens on `127.0.0.1` unless you chose the LAN. Proxy examples are in `deploy/`.

Skip the questions and leave the server stopped:

```bash
curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes
curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes --release v0.1.0
```

The usual choice leaves it stopped. Start it in that terminal:

```bash
cd ~/ordo/apps/server && NODE_ENV=production pnpm start
```

From another terminal:

```bash
curl http://localhost:3000/api/server/info
```

### Update

From the install folder. `.env`, secrets, the database, backups, and avatars stay. If the server is running, it stops, migrates, and starts again. Type a version in the menu to jump to that tag.

```bash
cd ~/ordo
./scripts/deploy-server update
```

### Uninstall

Stops the server and removes `~/ordo`, including the database. It asks first. `--yes` skips the question. A database stored outside that folder is left in place.

```bash
curl -fsSL https://ordo.axolet.com/install | bash -s -- uninstall
```

Keep a copy of `apps/server/prisma/ordo.db`, `apps/server/.ordo-secret`, and `apps/server/.ordo-library-key`. Let the script apply migrations, including on an older database. `./scripts/deploy-server --help` lists the rest, and `apps/server/.env.example` lists each setting.

## Point the app at your server

On the sign-in screen, choose **Use your own server**, agree that you run it, and enter the URL. You can switch later under Settings → Hosting. Switching signs you out. Libraries are not copied between ordo Cloud and a server you run.

## Layout

```
packages/shared   API contract
apps/server       NestJS, Prisma, SQLite
apps/mobile       Expo app
```

## License

[AGPL-3.0](LICENSE)
