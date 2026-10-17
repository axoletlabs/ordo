/** Isolated SMTP + two real servers. No existing database, account or mailbox.
 * Build @ordo/server and export mobile web first. All external browser traffic
 * is blocked. Results intentionally omit mail bodies, tokens and database rows.
 */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { once } from "node:events";

const base = new URL(process.env.ORDO_UI_URL ?? "http://127.0.0.1:8262");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-stage3-extended";
await mkdir(output, { recursive: true });
const dir = await mkdtemp("/tmp/opencode/ordo-isolated-services-");
const requireServer = createRequire(resolve("apps/server/package.json"));
const Sqlite = requireServer("better-sqlite3");
const { TOTP, Secret } = requireServer("otpauth");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const messages = [], children = [], checks = [], errors = [], captures = [];
const sockets = new Set();
let rejectMail = false, browser, page;
const check = (ok, name) => { checks.push({ name, pass: !!ok }); assert.ok(ok, name); };
const smtp = createServer((socket) => {
  sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
  socket.write("220 audit.local ESMTP\r\n");
  let buffer = "", data = false, lines = [], to = "";
  socket.on("data", (bytes) => {
    buffer += bytes.toString();
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      if (data) {
        if (line === ".") {
          messages.push({ to, body: lines.join("\n") }); data = false; lines = [];
          socket.write("250 queued\r\n");
        } else lines.push(line.replace(/^\.\./, "."));
      } else if (/^(EHLO|HELO)/i.test(line)) socket.write("250-audit.local\r\n250 8BITMIME\r\n");
      else if (/^RCPT TO:/i.test(line)) { to = line; socket.write("250 OK\r\n"); }
      else if (/^DATA/i.test(line)) {
        if (rejectMail) socket.write("451 intentional local delivery failure\r\n");
        else { data = true; socket.write("354 send data\r\n"); }
      } else if (/^QUIT/i.test(line)) { socket.end("221 Bye\r\n"); }
      else socket.write("250 OK\r\n");
    }
  });
});
await new Promise((done) => smtp.listen(0, "127.0.0.1", done));
async function start(name) {
  const portServer = createServer(); await new Promise((done) => portServer.listen(0, "127.0.0.1", done));
  const port = portServer.address().port; await new Promise((done) => portServer.close(done));
  const database = `${dir}/${name}.db`;
  const child = spawn(process.execPath, [resolve("apps/server/dist/main.js")], {
    cwd: dir, env: { ...process.env, NODE_ENV: "test", PORT: String(port), LISTEN_HOST: "127.0.0.1",
      DATABASE_URL: `file:${database}`, JWT_SECRET: "isolated-audit-only-not-a-production-secret", LIBRARY_KEK: "ab".repeat(32),
      ORDO_MIGRATIONS_DIR: resolve("apps/server/prisma/migrations"),
      REGISTRATION_ENABLED: "true", EMAIL_VERIFICATION_REQUIRED: "true", MFA_REQUIRED: "false",
      SMTP_REQUIRED: "true", SMTP_URL: `smtp://127.0.0.1:${smtp.address().port}?ignoreTLS=true`,
      SMTP_FROM: "Audit <noreply@example.test>", CORS_ALLOWED_ORIGINS: base.origin,
      AVATAR_STORAGE: "database" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = ""; child.stdout.on("data", (data) => { logs += data; }); child.stderr.on("data", (data) => { logs += data; });
  children.push({ child, log: () => logs });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) throw new Error(`Disposable ${name} server exited: ${logs}`);
    try { if ((await fetch(`${url}/api/server/info`)).ok) return { url, database }; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Disposable ${name} server did not become ready: ${logs}`);
}
const codeIn = (message) => {
  // Nodemailer sends a short, ASCII plain-text alternative before HTML/logo.
  const match = message?.body.match(/(?:^|\n)(\d{6})(?:\n|$)/);
  assert.ok(match, "SMTP message has a six-digit plaintext alternative"); return match[1];
};
const mail = (email, subject) => {
  const found = messages.findLast((message) => message.to.includes(email) && message.body.toLowerCase().includes(subject.toLowerCase()));
  assert.ok(found, `Local SMTP received ${subject}`); return found;
};
const button = (name) => page.getByRole("button", { name, exact: true });
async function capture(name) {
  await page.waitForTimeout(250); await page.screenshot({ path: `${output}/${name}.png` }); captures.push(name);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: viewport contained`);
}
async function request(server, path, { token, body, method = body ? "POST" : "GET", headers = {}, status } = {}) {
  const response = await fetch(`${server.url}/api${path}`, { method, headers: { "content-type": "application/json", "x-client-type": "mobile",
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (status) assert.equal(response.status, status, `${method} ${path}`);
  else assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
async function login(email, password) {
  await page.goto(new URL("login", base).href);
  await page.locator("#login-username").fill(email); await page.locator("#login-password").fill(password);
  await button("Sign in").click();
}
async function signout() {
  await page.goto(new URL("settings", base).href); await button("Sign out").click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await page.locator("#login-username").waitFor();
}
async function session() {
  return page.evaluate(() => JSON.parse(localStorage.getItem("secure.ordo.auth") ?? "null"));
}
try {
  const a = await start("a"), b = await start("b");
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ server }) => {
    if (!localStorage.getItem("ordo.settings")) localStorage.setItem("ordo.settings", JSON.stringify({ serverUrl: server, themeMode: "light", expressive: true, materialYouColors: false }));
  }, { server: a.url });
  page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => [base.origin, a.url, b.url].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  const email = `extended-${Date.now()}@example.test`, changedEmail = email.replace("extended-", "changed-");
  const password = "Audit-only-passphrase-123!", nextPassword = "Audit-only-new-passphrase-234!";
  await page.goto(new URL("register", base).href);
  await page.locator("#register-name").fill("Extended audit"); await page.locator("#register-username").fill(email);
  await page.locator("#register-password").fill(password); await page.locator("#register-password-confirm").fill(password);
  await button("Create account").click();
  await page.getByRole("button", { name: "Verify", exact: true }).waitFor();
  check(!(await session())?.tokens, "SMTP-required registration does not authenticate before verification");
  const verifyCode = codeIn(mail(email, "verification code"));
  check(true, "registration email reached real local SMTP with text, HTML and inline logo");
  check(mail(email, "verification code").body.includes("text/html") && mail(email, "verification code").body.includes("image/png"), "verification email includes HTML and logo MIME parts");
  await page.locator('input[aria-label^="Verification code"]').first().fill(verifyCode === "000000" ? "111111" : "000000");
  await page.getByRole("alert").first().waitFor(); check(true, "wrong verification code remains inline and retryable");
  await page.locator('input[aria-label^="Verification code"]').first().fill(verifyCode);
  await page.locator("#login-username").waitFor();
  await login(email, password); await button("Library actions").waitFor();
  let auth = await session();
  check(auth.user.libraryEncrypted && auth.user.emailVerified, "verified login provisions an encrypted library");
  const folder = await request(a, "/folders", { token: auth.tokens.accessToken, body: { name: "Encrypted audit folder" } });
  const bookmark = await request(a, "/bookmarks", { token: auth.tokens.accessToken, body: { url: "https://example.test/extended-private", folderId: folder.id } });
  const tag = await request(a, "/tags", { token: auth.tokens.accessToken, body: { name: "Encrypted audit tag" } });
  await request(a, `/bookmarks/${bookmark.id}/tags`, { token: auth.tokens.accessToken, method: "PUT", body: { tagIds: [tag.id] } });
  const db = new Sqlite(a.database, { readonly: true });
  try {
    const stored = db.prepare('SELECT title, url FROM "Bookmark" WHERE id = ?').get(bookmark.id);
    check(Object.values(stored).every((value) => typeof value === "string" && !value.includes("example.test")), "bookmark title and URL are ciphertext at rest");
    check(!db.prepare('SELECT name FROM "Tag" WHERE id = ?').get(tag.id).name.includes("Encrypted audit"), "tag name is ciphertext at rest");
    check(!db.prepare('SELECT name FROM "Folder" WHERE id = ?').get(folder.id).name.includes("Encrypted audit"), "folder name is ciphertext at rest");
  } finally { db.close(); }
  await page.goto(base.href); await page.getByRole("button", { name: /^Encrypted audit folder,/ }).waitFor();
  await capture("encrypted-library");
  await page.goto(new URL("settings/email", base).href);
  await page.getByRole("textbox", { name: "New email", exact: true }).fill(changedEmail);
  await page.locator("#change-email-password").fill(password); await button("Send code").click();
  await page.locator('input[aria-label^="Verification code"]').first().waitFor();
  const changeCode = codeIn(mail(changedEmail, "verification code"));
  check(messages.some((message) => message.to.includes(email) && message.body.includes(changedEmail)), "email change sends a security notice to the original mailbox");
  await page.locator('input[aria-label^="Verification code"]').first().fill(changeCode);
  await button("Sign out").waitFor();
  auth = await session(); check(auth.user.email === changedEmail, "email verification updates the active account");
  await signout();
  await page.goto(new URL("forgot-password", base).href);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(changedEmail); await button("Send reset code").click();
  await page.locator('input[aria-label^="Reset code"]').first().waitFor();
  const resetCode = codeIn(mail(changedEmail, "password reset code"));
  await page.locator('input[aria-label^="Reset code"]').first().fill(resetCode);
  await page.locator("#reset-password").fill(nextPassword); await page.locator("#reset-password-confirm").fill("mismatch");
  await button("Reset password").click(); await page.getByText("New passwords don't match.", { exact: true }).waitFor();
  check(true, "password reset mismatch preserves the code and editable form");
  await page.locator("#reset-password-confirm").fill(nextPassword); await button("Reset password").click();
  await page.locator("#login-username").waitFor(); await login(changedEmail, nextPassword); await button("Library actions").waitFor();
  auth = await session();
  const detail = await request(a, `/bookmarks/${bookmark.id}`, { token: auth.tokens.accessToken });
  check(detail.url === bookmark.url && detail.tags.some((item) => item.name === "Encrypted audit tag"), "SMTP password reset rewraps the key without losing encrypted library content");
  const replay = await request(a, "/auth/reset-password", { body: { email: changedEmail, token: resetCode, newPassword: password }, status: 400 });
  check(!!replay.error, "password reset code cannot be replayed");
  const refreshAuth = await request(a, "/auth/login", { body: { identifier: changedEmail, password: nextPassword } });
  const refreshed = await request(a, "/auth/refresh", { method: "POST", headers: { "x-refresh-token": refreshAuth.tokens.refreshToken } });
  check((await request(a, `/bookmarks/${bookmark.id}`, { token: refreshed.tokens.accessToken })).tags[0].name === detail.tags[0].name, "refresh rotation preserves encrypted-library access");
  await page.goto(new URL("settings/security", base).href);
  const beginning = page.waitForResponse((response) => response.url().endsWith("/auth/mfa/totp/begin"));
  await button("Set up authenticator").click(); const setup = await (await beginning).json();
  await page.locator('input[aria-label^="Authenticator code"]').first().fill(new TOTP({ secret: Secret.fromBase32(setup.secret) }).generate());
  await button("Done").click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
  await signout(); await login(changedEmail, nextPassword);
  await button("Email me a sign-in code").click();
  await page.locator('input[aria-label^="Email sign-in code"]').first().waitFor();
  const mfaCode = codeIn(mail(changedEmail, "sign-in code"));
  await page.locator('input[aria-label^="Email sign-in code"]').first().fill(mfaCode);
  await button("Library actions").waitFor(); auth = await session();
  check(auth.user.mfaEnabled && (await request(a, `/bookmarks/${bookmark.id}`, { token: auth.tokens.accessToken })).title === detail.title, "SMTP MFA recovery keeps the authenticator enabled and decrypts the existing library");
  await capture("mfa-email-recovered");
  // Server-down UX must retain auth, block background keyboard access, recover,
  // and leave the existing library intact. Failure is simulated only in Chromium.
  await page.route(`${a.url}/api/**`, (route) => route.abort("connectionrefused"));
  await page.reload(); await page.getByText("Can't reach your server", { exact: true }).waitFor();
  check((await session())?.user.id === auth.user.id, "offline server cannot sign the user out");
  await capture("server-offline");
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); check(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]')), "offline gate contains keyboard focus"); }
  await page.waitForFunction(() => { const retry = document.querySelector('button[aria-label="Retry"]'); return retry && !retry.disabled; });
  await page.unroute(`${a.url}/api/**`); await button("Retry").click(); await button("Library actions").waitFor();
  await page.getByText("Can't reach your server", { exact: true }).waitFor({ state: "hidden" });
  check((await session())?.user.id === auth.user.id, "Retry restores the same account after server recovery");
  // A second actual account verifies logout/login cache separation on one host.
  const other = email.replace("extended-", "other-");
  await request(a, "/auth/register", { body: { displayName: "Other audit", email: other, password } });
  await request(a, "/auth/verify-email", { body: { email: other, token: codeIn(mail(other, "verification code")) } });
  await signout(); await login(other, password); await button("Library actions").waitFor();
  check(await page.getByRole("button", { name: /^Encrypted audit folder,/ }).count() === 0, "second account never sees the previous encrypted library");
  await page.reload(); await button("Library actions").waitFor();
  check(await page.getByRole("button", { name: /^Encrypted audit folder,/ }).count() === 0, "second account reload cannot restore the previous snapshot");
  await capture("second-account-empty");
  // Signed-in host switching uses the real hosting panel/probe/restart flow.
  await page.goto(new URL("settings/server", base).href); await page.getByRole("button", { name: /^Edit server/ }).click();
  await page.getByRole("textbox", { name: "Address", exact: true }).fill(b.url);
  await button("Change").click();
  const restarted = page.waitForEvent("load");
  await page.getByRole("dialog").getByRole("button", { name: "Switch", exact: true }).click();
  await restarted;
  await page.locator("#login-username").waitFor();
  check(!(await session())?.tokens && (await page.evaluate(() => JSON.parse(localStorage.getItem("ordo.settings")).serverUrl)) === b.url, "signed-in host switch clears auth and commits only the verified server");
  const second = await request(b, "/auth/register", { body: { displayName: "Second host audit", email, password } });
  check(second.pendingEmailVerification, "second isolated host has an independent account namespace");
  await request(b, "/auth/verify-email", { body: { email, token: codeIn(mail(email, "verification code")) } });
  await login(email, password); await button("Library actions").waitFor();
  check(await page.getByRole("button", { name: /^Encrypted audit folder,/ }).count() === 0, "new host cannot inherit the previous host's in-memory or persisted library");
  await capture("second-server-empty");
  rejectMail = true;
  const failureEmail = email.replace("extended-", "failed-");
  await request(b, "/auth/register", { body: { displayName: "Failure audit", email: failureEmail, password }, status: 500 });
  check(!messages.some((message) => message.to.includes(failureEmail)), "SMTP failure cannot claim delivery or create an authenticated session");
  rejectMail = false;
  check(errors.length === 0, "no uncaught browser errors in extended workflows");
  check(children.every(({ log }) => !log().includes("No record was found for a delete")), "logout no longer emits missing-record Prisma errors");
} catch (error) {
  checks.push({ name: "execution", pass: false, error: error.stack });
  if (page && !page.isClosed()) { await page.screenshot({ path: `${output}/failure.png` }); await writeFile(`${output}/failure.html`, await page.content()); }
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, captures, note: "Two fresh loopback databases, local SMTP sink, disposable example.test accounts. No external mail. Native verification excluded." }, null, 2));
  await browser?.close();
  for (const { child } of children) { if (child.exitCode == null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; } }
  for (const socket of sockets) socket.destroy(); await new Promise((done) => smtp.close(done));
}
console.log(JSON.stringify({ checks: checks.length, captures: captures.length, errors }, null, 2));
