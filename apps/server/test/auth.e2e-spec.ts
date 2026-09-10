import request from "supertest";
import { DELETE_ACCOUNT_CONFIRMATION, EMAIL_OTP, ErrorCode } from "@ordo/shared";
import { MailService } from "../src/auth/mail.service.js";
import { machineHostname } from "../src/server/server.service.js";
import {
  authedAgent,
  clearDb,
  createTestApp,
  registerUser,
  teardownApp,
  type TestCtx,
} from "./utils.js";

describe("Auth (e2e)", () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await teardownApp(ctx);
  });

  beforeEach(async () => {
    await clearDb(ctx.prisma);
  });

  describe("registration", () => {
    it("registers a new user, returns tokens for mobile, and creates no folders", async () => {
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .set("x-client-type", "mobile")
        .send({ displayName: "alice", email: "alice@ordo.app", password: "supersecret" })
        .expect(201);

      expect(res.body.user.email).toBe("alice@ordo.app");
      expect(res.body.user.displayName).toBe("alice");
      expect(res.body.user.mfaEnabled).toBe(false);
      expect(res.body.user.hasAvatar).toBe(false);
      expect(res.body.user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(res.body.tokens.accessToken).toBeTruthy();
      expect(res.body.tokens.refreshToken).toBeTruthy();
      expect(res.body.tokens.expiresIn).toBeGreaterThan(0);

      // Accounts start empty — bookmarks may live outside any folder (unfiled).
      const folders = await ctx.prisma.folder.findMany({
        where: { userId: res.body.user.id },
      });
      expect(folders).toHaveLength(0);
    });

    it("does not return tokens in the body for web clients (cookies instead)", async () => {
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .send({ displayName: "webuser", email: "web@ordo.app", password: "supersecret" })
        .expect(201);

      expect(res.body.tokens.accessToken).toBe("");
      expect(res.body.tokens.refreshToken).toBe("");
      const cookies = res.headers["set-cookie"] as string[];
      expect(cookies?.some((c) => c.startsWith("ordo_access="))).toBe(true);
    });

    it("rejects duplicate emails with 409", async () => {
      await registerUser(ctx.app, "dup@ordo.app");
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .set("x-client-type", "mobile")
        .send({ displayName: "dupagain", email: "dup@ordo.app", password: "supersecret" })
        .expect(409);
      expect(res.body.error.code).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
    });

    it("allows duplicate display names", async () => {
      await registerUser(ctx.app, "first@ordo.app", "supersecret", "same-name");
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .set("x-client-type", "mobile")
        .send({ displayName: "same-name", email: "second@ordo.app", password: "supersecret" })
        .expect(201);
      expect(res.body.user.displayName).toBe("same-name");
    });

    it("validates the payload", async () => {
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .send({ email: "not-an-email", password: "short" })
        .expect(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe("login", () => {
    it("logs in with correct credentials", async () => {
      await registerUser(ctx.app, "bob@ordo.app", "supersecret");
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ email: "bob@ordo.app", password: "supersecret" })
        .expect(200);
      expect(res.body.tokens.accessToken).toBeTruthy();
    });

    it("rejects a username-shaped identifier with a validation error", async () => {
      await registerUser(ctx.app, "username-login@ordo.app", "supersecret", "login-name");
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "login-name", password: "supersecret" })
        .expect(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it("rejects wrong password with 401", async () => {
      await registerUser(ctx.app, "bob2@ordo.app", "supersecret");
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "bob2@ordo.app", password: "wrongpassword" })
        .expect(401);
      expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });

    it("does not reveal whether email exists (same error)", async () => {
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "ghost@ordo.app", password: "whatever123" })
        .expect(401);
      expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });
  });

  describe("server info", () => {
    it("reports smtpConfigured false when SMTP_URL is unset", async () => {
      const host = machineHostname();
      const res = await request(ctx.app.getHttpServer()).get("/api/server/info").expect(200);
      expect(res.body).toMatchObject({
        name: host,
        hostname: host,
        registrationEnabled: true,
        emailVerificationRequired: false,
        smtpConfigured: false,
        mfaRequired: false,
        avatarAllowAnimated: false,
        folderLockTypes: true,
      });
      expect(res.body.profilePictureMaxBytes).toBe(2 * 1024 * 1024);
    });

    it("lets a signed-in user rename the instance", async () => {
      const host = machineHostname();
      await request(ctx.app.getHttpServer())
        .patch("/api/server/name")
        .send({ name: "Home lab" })
        .expect(401);

      const agent = await authedAgent(ctx.app, "server-name@ordo.app");
      const renamed = await agent.patch("/api/server/name").send({ name: "  Home lab  " }).expect(200);
      expect(renamed.body).toMatchObject({ name: "Home lab", hostname: host });

      const info = await request(ctx.app.getHttpServer()).get("/api/server/info").expect(200);
      expect(info.body.name).toBe("Home lab");
      expect(info.body.hostname).toBe(host);
    });
  });

  describe("authenticated routes", () => {
    it("rejects requests without a token", async () => {
      const res = await request(ctx.app.getHttpServer()).get("/api/auth/me").expect(401);
      expect(res.body.error.code).toBe(ErrorCode.UNAUTHORIZED);
    });

    it("returns the current user with a valid bearer token", async () => {
      const agent = await authedAgent(ctx.app, "carol@ordo.app");
      const res = await agent.get("/api/auth/me").expect(200);
      expect(res.body.email).toBe("carol@ordo.app");
      expect(res.body.preferences).toEqual({
        fontFamily: "serif",
        fontSize: "medium",
        theme: "system",
        amoled: false,
      });
    });

    it("lists active sessions and marks the current one", async () => {
      const agent = await authedAgent(ctx.app, "dan@ordo.app");
      const res = await agent.get("/api/auth/sessions").expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].current).toBe(true);
    });

    it("captures the device name and type for a session", async () => {
      const auth = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .set("x-client-type", "mobile")
        .set("x-device-name", encodeURIComponent("Riley's Pixel"))
        .set("x-device-type", "phone")
        .send({ displayName: "Riley", email: "riley@ordo.app", password: "password123" })
        .expect(201);

      expect(auth.body.session).toMatchObject({
        deviceName: "Riley's Pixel",
        deviceType: "phone",
      });

      const sessions = await request(ctx.app.getHttpServer())
        .get("/api/auth/sessions")
        .auth(auth.body.tokens.accessToken, { type: "bearer" })
        .expect(200);
      expect(sessions.body[0]).toMatchObject({
        deviceName: "Riley's Pixel",
        deviceType: "phone",
        current: true,
      });
    });
  });

  describe("refresh + logout", () => {
    it("rotates tokens on refresh and invalidates the old refresh", async () => {
      const auth = await registerUser(ctx.app, "eve@ordo.app");
      const res1 = await request(ctx.app.getHttpServer())
        .post("/api/auth/refresh")
        .set("x-client-type", "mobile")
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(200);
      expect(res1.body.tokens.accessToken).toBeTruthy();
      expect(res1.body.tokens.refreshToken).not.toBe(auth.tokens.refreshToken);

      // old refresh token no longer works
      await request(ctx.app.getHttpServer())
        .post("/api/auth/refresh")
        .set("x-client-type", "mobile")
        .send({ refreshToken: auth.tokens.refreshToken })
        .expect(401);

      // old access token is invalidated by rotation (lookup by hash fails).
      // Clients should refresh, not treat this as a hard logout.
      const stale = await request(ctx.app.getHttpServer())
        .get("/api/auth/me")
        .set("authorization", `Bearer ${auth.tokens.accessToken}`)
        .expect(401);
      expect(stale.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });

    it("logs out and revokes the session instantly", async () => {
      const auth = await registerUser(ctx.app, "frank@ordo.app");
      const agent = request
        .agent(ctx.app.getHttpServer())
        .auth(auth.tokens.accessToken, { type: "bearer" });

      await agent.post("/api/auth/logout").expect(200);

      // access token no longer valid
      await request(ctx.app.getHttpServer())
        .get("/api/auth/me")
        .set("authorization", `Bearer ${auth.tokens.accessToken}`)
        .expect(401);
    });

    it("asks clients to refresh when a bearer token is unknown", async () => {
      const res = await request(ctx.app.getHttpServer())
        .get("/api/auth/me")
        .set("authorization", "Bearer not-a-real-token")
        .expect(401);
      expect(res.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
    });

    it("revokes another session by id", async () => {
      const auth = await registerUser(ctx.app, "grace@ordo.app");
      // create a second session
      const second = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "grace@ordo.app", password: "password123" })
        .expect(200);

      const agent = request
        .agent(ctx.app.getHttpServer())
        .auth(auth.tokens.accessToken, { type: "bearer" });

      const sessions = await agent.get("/api/auth/sessions").expect(200);
      expect(sessions.body).toHaveLength(2);

      // revoke the second session
      const secondSession = sessions.body.find((s: { id: string }) => !s.current);
      await agent.delete(`/api/auth/sessions/${secondSession.id}`).expect(200);

      // second session's token is now dead
      await request(ctx.app.getHttpServer())
        .get("/api/auth/me")
        .set("authorization", `Bearer ${second.body.tokens.accessToken}`)
        .expect(401);
    });
  });

  describe("profile edits", () => {
    let pctx: TestCtx;
    const sent: { to: string; token: string }[] = [];

    beforeAll(async () => {
      pctx = await createTestApp({
        customize: (b) =>
          b
            .overrideProvider(MailService)
            .useValue({
              isConfigured: true,
              sendVerification: async (to: string, token: string) => {
                sent.push({ to, token });
              },
              sendPasswordReset: async (to: string, token: string) => {
                sent.push({ to, token });
              },
              sendMfaRecovery: async (to: string, token: string) => {
                sent.push({ to, token });
              },
            }),
      });
    });

    afterAll(async () => {
      await teardownApp(pctx);
    });

    beforeEach(async () => {
      await clearDb(pctx.prisma);
      sent.length = 0;
    });

    describe("display name", () => {
      it("changes the display name without a password", async () => {
        const agent = await authedAgent(pctx.app, "username@ordo.app");
        const res = await agent
          .post("/api/auth/display-name")
          .send({ displayName: "New Name" })
          .expect(200);
        expect(res.body.displayName).toBe("New Name");
      });

      it("validates the new display name", async () => {
        const agent = await authedAgent(pctx.app, "username2@ordo.app");
        const res = await agent
          .post("/api/auth/display-name")
          .send({ displayName: "" })
          .expect(400);
        expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      });

      it("requires authentication", async () => {
        await request(pctx.app.getHttpServer())
          .post("/api/auth/display-name")
          .send({ displayName: "x" })
          .expect(401);
      });
    });

    describe("email change", () => {
      it("rejects a wrong current password", async () => {
        const agent = await authedAgent(pctx.app, "email1@ordo.app");
        const res = await agent
          .post("/api/auth/email/change")
          .send({ currentPassword: "wrongpassword", newEmail: "new@ordo.app" })
          .expect(401);
        expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      });

      it("rejects an email already in use", async () => {
        await registerUser(pctx.app, "taken@ordo.app");
        const agent = await authedAgent(pctx.app, "email2@ordo.app");
        const res = await agent
          .post("/api/auth/email/change")
          .send({ currentPassword: "password123", newEmail: "taken@ordo.app" })
          .expect(409);
        expect(res.body.error.code).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
      });

      it("completes after verifying the code sent to the new address", async () => {
        const agent = await authedAgent(pctx.app, "change@ordo.app");
        await agent
          .post("/api/auth/email/change")
          .send({ currentPassword: "password123", newEmail: "changed@ordo.app" })
          .expect(200);

        const last = sent[sent.length - 1];
        expect(last.to).toBe("changed@ordo.app");
        expect(last.token).toMatch(/^\d{6}$/);

        const res = await agent
          .post("/api/auth/email/verify-change")
          .send({ token: last.token })
          .expect(200);
        expect(res.body.email).toBe("changed@ordo.app");
        expect(res.body.emailVerified).toBe(true);

        // pending email is cleared
        const dbUser = await pctx.prisma.user.findUnique({ where: { email: "changed@ordo.app" } });
        expect(dbUser?.pendingEmail).toBeNull();
      });

      it("resends the verification code on demand", async () => {
        const agent = await authedAgent(pctx.app, "resend@ordo.app");
        await agent
          .post("/api/auth/email/change")
          .send({ currentPassword: "password123", newEmail: "resended@ordo.app" })
          .expect(200);
        const afterFirst = sent.length;
        await agent.post("/api/auth/email/change/resend").expect(200);
        expect(sent.length).toBeGreaterThan(afterFirst);
      });

      it("rejects an invalid verification code", async () => {
        const agent = await authedAgent(pctx.app, "badcode@ordo.app");
        await agent
          .post("/api/auth/email/change")
          .send({ currentPassword: "password123", newEmail: "badcode2@ordo.app" })
          .expect(200);
        const real = sent[sent.length - 1].token;
        const wrong = real === "000000" ? "111111" : "000000";
        const res = await agent
          .post("/api/auth/email/verify-change")
          .send({ token: wrong })
          .expect(400);
        expect(res.body.error.code).toBe(ErrorCode.INVALID_VERIFICATION_TOKEN);
      });

      it("invalidates the code after too many failed attempts", async () => {
        const agent = await authedAgent(pctx.app, "lockout@ordo.app");
        await agent
          .post("/api/auth/email/change")
          .send({ currentPassword: "password123", newEmail: "lockout2@ordo.app" })
          .expect(200);
        const real = sent[sent.length - 1].token;
        const wrong = real === "000000" ? "111111" : "000000";
        for (let i = 0; i < EMAIL_OTP.MAX_ATTEMPTS; i++) {
          const res = await agent
            .post("/api/auth/email/verify-change")
            .send({ token: wrong })
            .expect(400);
          expect(res.body.error.code).toBe(ErrorCode.INVALID_VERIFICATION_TOKEN);
        }
        const res = await agent
          .post("/api/auth/email/verify-change")
          .send({ token: real })
          .expect(400);
        expect(res.body.error.code).toBe(ErrorCode.INVALID_VERIFICATION_TOKEN);
      });

    it("rejects a non-numeric code before lookup", async () => {
      const agent = await authedAgent(pctx.app, "badshape@ordo.app");
      await agent
        .post("/api/auth/email/change")
        .send({ currentPassword: "password123", newEmail: "badshape2@ordo.app" })
        .expect(200);
      const res = await agent
        .post("/api/auth/email/verify-change")
        .send({ token: "not-a-real-token" })
        .expect(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe("password reset", () => {
    it("does not reveal whether the email exists", async () => {
      const res = await request(pctx.app.getHttpServer())
        .post("/api/auth/forgot-password")
        .send({ email: "ghost-reset@ordo.app" })
        .expect(200);
      expect(res.body).toEqual({ success: true });
      expect(sent).toHaveLength(0);
    });

    it("resets the password with the emailed code and revokes sessions", async () => {
      const auth = await registerUser(pctx.app, "resetme@ordo.app");
      await request(pctx.app.getHttpServer())
        .post("/api/auth/forgot-password")
        .send({ email: "resetme@ordo.app" })
        .expect(200);

      const last = sent[sent.length - 1];
      expect(last.to).toBe("resetme@ordo.app");
      expect(last.token).toMatch(/^\d{6}$/);

      await request(pctx.app.getHttpServer())
        .post("/api/auth/reset-password")
        .send({
          email: "resetme@ordo.app",
          token: last.token,
          newPassword: "brandnewpass",
        })
        .expect(200);

      await request(pctx.app.getHttpServer())
        .get("/api/auth/me")
        .auth(auth.tokens.accessToken, { type: "bearer" })
        .expect(401);

      await request(pctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "resetme@ordo.app", password: "brandnewpass" })
        .expect(200);

      await request(pctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "resetme@ordo.app", password: "password123" })
        .expect(401);
    });

    it("rejects an email-change code on the reset endpoint", async () => {
      const agent = await authedAgent(pctx.app, "cross@ordo.app");
      await agent
        .post("/api/auth/email/change")
        .send({ currentPassword: "password123", newEmail: "cross2@ordo.app" })
        .expect(200);
      const changeCode = sent[sent.length - 1].token;

      const res = await request(pctx.app.getHttpServer())
        .post("/api/auth/reset-password")
        .send({
          email: "cross@ordo.app",
          token: changeCode,
          newPassword: "brandnewpass",
        })
        .expect(400);
      expect(res.body.error.code).toBe(ErrorCode.INVALID_VERIFICATION_TOKEN);
    });
  });

  describe("password change", () => {
      it("rejects a wrong current password", async () => {
        const agent = await authedAgent(pctx.app, "pwd1@ordo.app");
        const res = await agent
          .post("/api/auth/password")
          .send({ currentPassword: "wrongpassword", newPassword: "brandnew123" })
          .expect(401);
        expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
      });

      it("changes the password and revokes other sessions (keeping the current one)", async () => {
        const auth = await registerUser(pctx.app, "pwd2@ordo.app");
        // create a second session
        const second = await request(pctx.app.getHttpServer())
          .post("/api/auth/login")
          .set("x-client-type", "mobile")
          .send({ identifier: "pwd2@ordo.app", password: "password123" })
          .expect(200);

        const agent = request
          .agent(pctx.app.getHttpServer())
          .auth(auth.tokens.accessToken, { type: "bearer" });

        const before = await agent.get("/api/auth/sessions").expect(200);
        expect(before.body).toHaveLength(2);

        const changed = await agent
          .post("/api/auth/password")
          .set("x-client-type", "mobile")
          .send({ currentPassword: "password123", newPassword: "brandnew123" })
          .expect(200);

        // Both old sessions are revoked and the response provides a fresh current session.
        await request(pctx.app.getHttpServer())
          .get("/api/auth/me")
          .set("authorization", `Bearer ${second.body.tokens.accessToken}`)
          .expect(401);
        await agent.get("/api/auth/me").expect(401);
        await request(pctx.app.getHttpServer())
          .get("/api/auth/me")
          .auth(changed.body.tokens.accessToken, { type: "bearer" })
          .expect(200);
      });
    });

    describe("reader preferences", () => {
      it("merges a partial patch into the stored preferences", async () => {
        const agent = await authedAgent(pctx.app, "prefs@ordo.app");

        const first = await agent
          .patch("/api/auth/preferences")
          .send({ theme: "sepia" })
          .expect(200);
        expect(first.body.preferences).toEqual({
          fontFamily: "serif",
          fontSize: "medium",
          theme: "sepia",
          amoled: false,
        });

        const second = await agent
          .patch("/api/auth/preferences")
          .send({ fontFamily: "serif", fontSize: "large", amoled: true })
          .expect(200);
        expect(second.body.preferences).toEqual({
          fontFamily: "serif",
          fontSize: "large",
          theme: "sepia",
          amoled: true,
        });

        // persisted — /auth/me reports the same synced preferences
        const me = await agent.get("/api/auth/me").expect(200);
        expect(me.body.preferences).toEqual(second.body.preferences);
      });

      it("validates preference values and requires a field", async () => {
        const agent = await authedAgent(pctx.app, "prefs2@ordo.app");

        const bad = await agent
          .patch("/api/auth/preferences")
          .send({ theme: "hotdog" })
          .expect(400);
        expect(bad.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

        const empty = await agent.patch("/api/auth/preferences").send({}).expect(400);
        expect(empty.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

        await request(pctx.app.getHttpServer())
          .patch("/api/auth/preferences")
          .send({ theme: "dark" })
          .expect(401);
      });

      it("falls back to defaults when stored preferences are malformed", async () => {
        const agent = await authedAgent(pctx.app, "prefs3@ordo.app");
        const me = await agent.get("/api/auth/me").expect(200);
        await pctx.prisma.user.update({
          where: { id: me.body.id },
          data: { preferences: "{not json at all" },
        });

        const after = await agent.get("/api/auth/me").expect(200);
        expect(after.body.preferences).toEqual({
          fontFamily: "serif",
          fontSize: "medium",
          theme: "system",
          amoled: false,
        });

        // a patch on top of malformed data still works
        const patched = await agent
          .patch("/api/auth/preferences")
          .send({ theme: "dark" })
          .expect(200);
        expect(patched.body.preferences).toEqual({
          fontFamily: "serif",
          fontSize: "medium",
          theme: "dark",
          amoled: false,
        });
      });
    });

    describe("account deletion", () => {
      it("requires the exact phrase and password, then deletes all account data", async () => {
        const auth = await registerUser(pctx.app, "delete@ordo.app");
        // Accounts start folderless: create one folder plus unfiled + filed bookmarks.
        const folder = await pctx.prisma.folder.create({
          data: { userId: auth.user.id, name: "To delete" },
        });
        await pctx.prisma.folderToken.create({
          data: {
            folderId: folder.id,
            tokenHash: "delete-account-folder-token",
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await pctx.prisma.bookmark.create({
          data: {
            userId: auth.user.id,
            folderId: folder.id,
            url: "https://example.com/article",
            title: "Example article",
            domain: "example.com",
          },
        });
        await pctx.prisma.bookmark.create({
          data: {
            userId: auth.user.id,
            folderId: null,
            url: "https://example.com/unfiled",
            title: "Unfiled article",
            domain: "example.com",
          },
        });

        const agent = request
          .agent(pctx.app.getHttpServer())
          .auth(auth.tokens.accessToken, { type: "bearer" });

        const invalidConfirmation = await agent
          .delete("/api/auth/account")
          .send({ currentPassword: "password123", confirmation: "delete my account" })
          .expect(400);
        expect(invalidConfirmation.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

        const invalidPassword = await agent
          .delete("/api/auth/account")
          .send({ currentPassword: "wrongpassword", confirmation: DELETE_ACCOUNT_CONFIRMATION })
          .expect(401);
        expect(invalidPassword.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

        await agent
          .delete("/api/auth/account")
          .send({ currentPassword: "password123", confirmation: DELETE_ACCOUNT_CONFIRMATION })
          .expect(200, { success: true });

        expect(await pctx.prisma.user.count({ where: { id: auth.user.id } })).toBe(0);
        expect(await pctx.prisma.folder.count({ where: { userId: auth.user.id } })).toBe(0);
        expect(await pctx.prisma.bookmark.count({ where: { userId: auth.user.id } })).toBe(0);
        expect(await pctx.prisma.session.count({ where: { userId: auth.user.id } })).toBe(0);
        expect(await pctx.prisma.folderToken.count({ where: { folderId: folder.id } })).toBe(0);

        await request(pctx.app.getHttpServer())
          .get("/api/auth/me")
          .auth(auth.tokens.accessToken, { type: "bearer" })
          .expect(401);
      });
    });
  });
});

describe("signup email verification (e2e)", () => {
  let vctx: TestCtx;
  const sent: { to: string; token: string }[] = [];

  beforeAll(async () => {
    vctx = await createTestApp({
      config: { emailVerificationRequired: true },
      customize: (b) =>
        b.overrideProvider(MailService).useValue({
          isConfigured: true,
          sendVerification: async (to: string, token: string) => {
            sent.push({ to, token });
          },
        }),
    });
  });

  afterAll(async () => {
    await teardownApp(vctx);
  });

  beforeEach(async () => {
    await clearDb(vctx.prisma);
    sent.length = 0;
  });

  it("emails a 6-digit code and verifies with email + code", async () => {
    await request(vctx.app.getHttpServer())
      .post("/api/auth/register")
      .set("x-client-type", "mobile")
        .send({ displayName: "verifyme", email: "verifyme@ordo.app", password: "supersecret" })
      .expect(201);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("verifyme@ordo.app");
    expect(sent[0].token).toMatch(/^\d{6}$/);

    const blocked = await request(vctx.app.getHttpServer())
      .post("/api/auth/login")
      .set("x-client-type", "mobile")
      .send({ identifier: "verifyme@ordo.app", password: "supersecret" })
      .expect(401);
    expect(blocked.body.error.code).toBe(ErrorCode.EMAIL_NOT_VERIFIED);

    await request(vctx.app.getHttpServer())
      .post("/api/auth/verify-email")
      .send({ email: "verifyme@ordo.app", token: sent[0].token })
      .expect(200);

    await request(vctx.app.getHttpServer())
      .post("/api/auth/login")
      .set("x-client-type", "mobile")
      .send({ identifier: "verifyme@ordo.app", password: "supersecret" })
      .expect(200);
  });

  it("rejects a code without the matching email", async () => {
    await request(vctx.app.getHttpServer())
      .post("/api/auth/register")
      .set("x-client-type", "mobile")
        .send({ displayName: "noemail", email: "noemail@ordo.app", password: "supersecret" })
      .expect(201);

    const missingEmail = await request(vctx.app.getHttpServer())
      .post("/api/auth/verify-email")
      .send({ token: sent[0].token })
      .expect(400);
    expect(missingEmail.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

    const wrongEmail = await request(vctx.app.getHttpServer())
      .post("/api/auth/verify-email")
      .send({ email: "other@ordo.app", token: sent[0].token })
      .expect(400);
    expect(wrongEmail.body.error.code).toBe(ErrorCode.INVALID_VERIFICATION_TOKEN);
  });
});
