# Self-hosting the ordo server

Everything you need to run your own ordo backend: one command to install,
one file of settings, one folder to back up. This guide walks through each
step, explains every question the installer asks, and covers running behind
HTTPS, updating, backups, and removal.

The short version:

```bash
curl -fsSL https://ordo.axolet.com/install | bash
```

## 1. Before you start

| You need | Details |
| --- | --- |
| A Linux/macOS machine | Any always-on box works: a VPS, a home server, a Raspberry Pi. |
| Node.js 22.13 or newer | `node -v` to check. From <https://nodejs.org> if missing. |
| pnpm 11 | Optional — if missing, the installer offers to install it for you. |
| A free port | Default 3000. The installer warns you if something else uses it. |
| SMTP credentials | Optional. Without mail, sign-up codes print to the server log. |

Nothing else: the database is SQLite (a file), the web server is built in,
and secrets are generated for you during setup.

## 2. Install

```bash
curl -fsSL https://ordo.axolet.com/install | bash
```

What happens, in order:

1. The script checks Node.js and pnpm, offering to install pnpm if absent.
2. It downloads the latest release into `~/ordo` and verifies its sha256
   checksum. (Set `ORDO_DIR=/some/path` before the command for another
   folder, `--release v0.2.0` for a specific version, `--pre` for
   pre-releases.)
3. It hands over to the setup wizard, which asks a few questions, writes a
   complete `apps/server/.env`, and installs everything.

Non-interactive (CI, scripts): add `--yes` and any flags — see
`./scripts/deploy-server --help` for the full list:

```bash
curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes --port 8080 --trust-proxy 1
```

## 3. The wizard, question by question

Move with the arrow keys, press enter to select, and press enter on a blank
line to keep the default. Nothing is written until you confirm the summary
at the end; you can also answer again or cancel there.

**Step 1 — Port.** The port the server listens on. `3000` is fine if it is
free; the installer suggests the next one if something already sits there.
Browsers and reverse proxies connect to this port.

**Step 2 — Accounts.** Who may create an account: only the first one
(private, recommended), or anyone who can reach the server. The first
sign-up always becomes the instance owner, so a closed instance can still
be bootstrapped.

**Step 3 — Sign-up email.** Whether new accounts must confirm with a
one-time code. Straight in is fine for a private instance. If you enable
it without mail, the code prints to the server log.

**Step 4 — Mail.** An SMTP URL like `smtp://user:pass@smtp.example.com:587`
and the From address people see. Leave it empty to print codes in the log
instead. With SMTP set, codes are only ever sent by email (`SMTP_REQUIRED`
becomes true) — a mail outage is an error, not a silent fallback.
587 is STARTTLS; use `smtps://…:465` for implicit TLS.

**Step 5 — Network.** Either *no proxy* (then: this machine only, or this
machine and the LAN for a phone on the same Wi-Fi) or *a reverse proxy in
front* (nginx, Caddy, Cloudflare — then say how many hops, usually 1).

**Summary.** You see every choice, where the server will listen, and where
the database lands. `Install now` proceeds, `Answer the questions again`
restarts, `Cancel` leaves without changing anything (esc works too).

## 4. What setup does, and what it creates

After you confirm, the installer:

1. writes `apps/server/.env` — every setting documented, including the two
   generated secrets (`JWT_SECRET` signs sessions, `LIBRARY_KEK` wraps the
   per-library encryption keys);
2. installs dependencies (`pnpm install --frozen-lockfile`);
3. compiles the server;
4. creates the SQLite database and applies migrations (backing up the file
   first if this is an update).

The folder layout afterwards:

```
~/ordo/
├── apps/server/.env             settings + secrets — back this up
├── apps/server/prisma/ordo.db   the database — back this up
├── apps/server/prisma/*.bak-*   automatic pre-migration snapshots
├── apps/server/ordo.log         log when started in the background
└── scripts/deploy-server        the update/uninstall tool
```

## 5. Start it

Setup usually leaves the server stopped. Start it in the foreground:

```bash
cd ~/ordo/apps/server
NODE_ENV=production pnpm start
```

Check that it answers:

```bash
curl http://127.0.0.1:3000/api/server/info
```

To keep it running after you close the terminal, use systemd — see
`deploy/systemd-ordo.service.example` in the repo for a ready unit:

```bash
sudo cp deploy/systemd-ordo.service.example /etc/systemd/system/ordo.service
# edit User and paths to match your install, then:
sudo systemctl daemon-reload && sudo systemctl enable --now ordo
journalctl -u ordo -f          # follow the log
```

## 6. Point the app at your server

In the ordo app, choose **Use your own server** on the sign-in screen,
agree that you operate it, and enter the address — for example
`https://ordo.example.com` behind a proxy, or `http://192.168.1.20:3000`
on your LAN. You can switch later under Settings → Hosting (switching signs
you out; libraries are not copied between servers).

## 7. HTTPS and a reverse proxy

The server binds `127.0.0.1` by default. For anything internet-facing, put
nginx or Caddy in front — both terminate TLS for you. Ready-made examples
live in `deploy/` (`nginx.conf.example`, `Caddyfile.example`):

```
ordo.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

When a proxy is in front, `TRUST_PROXY=1` must be set in
`apps/server/.env` (the wizard's "a proxy is in front" answer does this)
so rate limiting sees real visitor addresses. Caddy also gives you
Let's Encrypt certificates automatically.

## 8. Update

From the install folder. `.env`, the database, backups, and avatars are
kept; a running server is stopped, migrated, and started again:

```bash
cd ~/ordo
./scripts/deploy-server update
```

The release menu lists published versions (arrow keys, or type a tag).
If your `.env` predates explicit secrets, update offers to rewrite it in
the documented format — every value, secret, and custom key is preserved.
Non-interactive: `./scripts/deploy-server update --yes [--release v0.2.0]`.

## 9. Backups and restore

Keep copies of exactly two things:

- `apps/server/prisma/ordo.db` — the database (all accounts, bookmarks);
- `apps/server/.env` — the settings, including the secrets.

Without `JWT_SECRET` every session is invalidated; without `LIBRARY_KEK`
encrypted libraries cannot be reopened. Restore by copying both files back
and running `./scripts/deploy-server` once — it applies any pending
migrations, including to an older database file. Updates also snapshot
the database automatically next to it before migrating.

## 10. Change settings later

Edit `apps/server/.env` (every key is commented there, and listed in
`apps/server/.env.example`), then restart the server. Common changes:

- open sign-ups: `REGISTRATION_ENABLED=true`
- require the email code: `EMAIL_VERIFICATION_REQUIRED=true`
- add mail: `SMTP_URL`, `SMTP_FROM`, `SMTP_REQUIRED=true`
- behind a proxy: `TRUST_PROXY=1`

Or just re-run the wizard — `cd ~/ordo && ./scripts/deploy-server install`
— and answer the questions again; it offers to keep or replace the file.

## 11. Uninstall

Stops the server and removes the install folder, database included. It asks
first; a database stored outside the folder is left in place.

```bash
~/ordo/scripts/deploy-server uninstall
# or from anywhere:
curl -fsSL https://ordo.axolet.com/install | bash -s -- uninstall
```

## 12. Troubleshooting

- **"Port 3000 is already used by …"** — another program owns the port.
  Stop it, or re-run setup and take the suggested next port.
- **`Node.js … Ordo needs 22.13 or newer`** — upgrade Node.
- **Sign-up codes in the log** — expected without SMTP; they look like
  `one-time code: 123456` in the server output. Configure mail to have
  them emailed instead.
- **`This server can't send email`** — `SMTP_REQUIRED=true` is set but
  `SMTP_URL` is missing or the provider rejects the login. Check the URL,
  or run setup again to re-enter it.
- **401/403 from the app after a restore** — the `JWT_SECRET` changed;
  sign in again on each device.
- **Something looks wrong after an update** — the pre-migration snapshot
  sits next to the database (`ordo.db.bak-<timestamp>`); copy it back over
  `ordo.db` while the server is stopped.

Further reference: `./scripts/deploy-server --help` for every flag, and
`apps/server/.env.example` for every setting.
