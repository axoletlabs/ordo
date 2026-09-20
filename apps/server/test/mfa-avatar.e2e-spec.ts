import request from "supertest";
import * as OTPAuth from "otpauth";
import { DELETE_ACCOUNT_CONFIRMATION, ErrorCode, MFA } from "@ordo/shared";
import { MailService } from "../src/auth/mail.service.js";
import {
  authedAgent,
  clearDb,
  createTestApp,
  registerUser,
  teardownApp,
  type TestCtx,
} from "./utils.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function totpNow(secret: string, email: string): string {
  return new OTPAuth.TOTP({
    issuer: MFA.ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: MFA.TOTP_DIGITS,
    period: MFA.TOTP_PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

describe("MFA + avatars (e2e)", () => {
  let ctx: TestCtx;
  const sent: { to: string; token: string }[] = [];
  const notices: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({
      customize: (b) =>
        b.overrideProvider(MailService).useValue({
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
          sendMfaRecoveryNotice: async (to: string) => {
            notices.push(to);
          },
          sendEmailChangeNotice: async () => undefined,
          sendEmailChangedNotice: async () => undefined,
        }),
    });
  });

  afterAll(async () => {
    await teardownApp(ctx);
  });

  beforeEach(async () => {
    await clearDb(ctx.prisma);
    sent.length = 0;
    notices.length = 0;
  });

  async function enrollTotp(email: string) {
    const auth = await registerUser(ctx.app, email, "supersecret", "Pat");
    const agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, { type: "bearer" });
    const begin = await agent.post("/api/auth/mfa/totp/begin").send({}).expect(200);
    const secret = begin.body.secret as string;
    const confirm = await agent
      .post("/api/auth/mfa/totp/confirm")
      .send({ code: totpNow(secret, email) })
      .expect(200);
    return {
      auth,
      agent,
      secret,
      backupCodes: confirm.body.backupCodes as string[],
    };
  }

  describe("TOTP", () => {
    it("enrolls, then requires a second step at login", async () => {
      const { secret, backupCodes } = await enrollTotp("mfa@ordo.app");
      expect(backupCodes).toHaveLength(MFA.BACKUP_CODE_COUNT);
      expect(backupCodes[0]).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);

      const challenge = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "mfa@ordo.app", password: "supersecret" })
        .expect(200);
      expect(challenge.body.mfaRequired).toBe(true);
      expect(challenge.body.challengeToken).toBeTruthy();
      expect(challenge.body.tokens).toBeUndefined();

      const done = await request(ctx.app.getHttpServer())
        .post("/api/auth/login/mfa")
        .set("x-client-type", "mobile")
        .send({
          challengeToken: challenge.body.challengeToken,
          code: totpNow(secret, "mfa@ordo.app"),
        })
        .expect(200);
      expect(done.body.user.mfaEnabled).toBe(true);
      expect(done.body.tokens.accessToken).toBeTruthy();
    });

    it("accepts a backup code at login", async () => {
      const { backupCodes } = await enrollTotp("backup@ordo.app");
      const challenge = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ email: "backup@ordo.app", password: "supersecret" })
        .expect(200);

      const done = await request(ctx.app.getHttpServer())
        .post("/api/auth/login/mfa")
        .set("x-client-type", "mobile")
        .send({ challengeToken: challenge.body.challengeToken, code: backupCodes[0] })
        .expect(200);
      expect(done.body.tokens.accessToken).toBeTruthy();

      const again = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ email: "backup@ordo.app", password: "supersecret" })
        .expect(200);
      const reused = await request(ctx.app.getHttpServer())
        .post("/api/auth/login/mfa")
        .set("x-client-type", "mobile")
        .send({ challengeToken: again.body.challengeToken, code: backupCodes[0] })
        .expect(401);
      expect(reused.body.error.code).toBe(ErrorCode.MFA_INVALID);
    });

    it("email recovery signs in once without disabling MFA; forgot-password does not disable MFA", async () => {
      const { secret } = await enrollTotp("recover@ordo.app");
      await ctx.prisma.user.update({
        where: { email: "recover@ordo.app" },
        data: { emailVerifiedAt: new Date() },
      });

      const challenge = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "recover@ordo.app", password: "supersecret" })
        .expect(200);
      expect(challenge.body.emailRecoveryAvailable).toBe(true);

      await request(ctx.app.getHttpServer())
        .post("/api/auth/login/mfa/email")
        .send({ challengeToken: challenge.body.challengeToken })
        .expect(200);
      expect(sent.at(-1)?.to).toBe("recover@ordo.app");

      const recovered = await request(ctx.app.getHttpServer())
        .post("/api/auth/login/mfa/email/verify")
        .set("x-client-type", "mobile")
        .send({ challengeToken: challenge.body.challengeToken, token: sent.at(-1)!.token })
        .expect(200);
      expect(recovered.body.user.mfaEnabled).toBe(true);
      expect(notices).toContain("recover@ordo.app");

      const recoveredUser = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: "recover@ordo.app" },
      });
      expect(recoveredUser.totpEnabledAt).not.toBeNull();
      expect(recoveredUser.totpSecretEnc).toBeTruthy();

      const again = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .set("x-client-type", "mobile")
        .send({ identifier: "recover@ordo.app", password: "supersecret" })
        .expect(200);
      expect(again.body.mfaRequired).toBe(true);

      const { auth: stayon } = await enrollTotp("stayon@ordo.app");
      await ctx.prisma.user.update({
        where: { email: "stayon@ordo.app" },
        data: { emailVerifiedAt: new Date() },
      });
      sent.length = 0;
      await request(ctx.app.getHttpServer())
        .post("/api/auth/forgot-password")
        .send({ email: "stayon@ordo.app" })
        .expect(200);
      await request(ctx.app.getHttpServer())
        .post("/api/auth/reset-password")
        .send({
          email: "stayon@ordo.app",
          token: sent.at(-1)!.token,
          newPassword: "brandnewpass",
        })
        .expect(200);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: "stayon@ordo.app" } });
      expect(user.totpEnabledAt).not.toBeNull();
      expect(user.totpSecretEnc).toBeTruthy();
      void secret;
    });

    it("requires MFA to change the password once it is enrolled", async () => {
      const { agent, secret } = await enrollTotp("stepup@ordo.app");
      const missing = await agent
        .post("/api/auth/password")
        .send({ currentPassword: "supersecret", newPassword: "anothersecret" })
        .expect(401);
      expect(missing.body.error.code).toBe(ErrorCode.MFA_REQUIRED);

      const changed = await agent
        .post("/api/auth/password")
        .send({
          currentPassword: "supersecret",
          newPassword: "anothersecret",
          mfaCode: totpNow(secret, "stepup@ordo.app"),
        })
        .expect(200);
      expect(changed.body.user.email).toBe("stepup@ordo.app");
    });

    it("requires MFA to request an email change once it is enrolled", async () => {
      const { agent, secret } = await enrollTotp("email-mfa@ordo.app");
      const missing = await agent
        .post("/api/auth/email/change")
        .send({ currentPassword: "supersecret", newEmail: "email-mfa-2@ordo.app" })
        .expect(401);
      expect(missing.body.error.code).toBe(ErrorCode.MFA_REQUIRED);

      await agent
        .post("/api/auth/email/change")
        .send({
          currentPassword: "supersecret",
          newEmail: "email-mfa-2@ordo.app",
          mfaCode: totpNow(secret, "email-mfa@ordo.app"),
        })
        .expect(200);
    });

    it("requires MFA to delete the account once it is enrolled", async () => {
      const { agent, secret } = await enrollTotp("delete-mfa@ordo.app");
      const missing = await agent
        .delete("/api/auth/account")
        .send({ currentPassword: "supersecret", confirmation: DELETE_ACCOUNT_CONFIRMATION })
        .expect(401);
      expect(missing.body.error.code).toBe(ErrorCode.MFA_REQUIRED);
      expect(await ctx.prisma.user.count({ where: { email: "delete-mfa@ordo.app" } })).toBe(1);

      await agent
        .delete("/api/auth/account")
        .send({
          currentPassword: "supersecret",
          confirmation: DELETE_ACCOUNT_CONFIRMATION,
          mfaCode: totpNow(secret, "delete-mfa@ordo.app"),
        })
        .expect(200, { success: true });
      expect(await ctx.prisma.user.count({ where: { email: "delete-mfa@ordo.app" } })).toBe(0);
    });

    it("still requires MFA to turn the authenticator off", async () => {
      const { agent } = await enrollTotp("keep-mfa@ordo.app");
      const missing = await agent.post("/api/auth/mfa/totp/disable").send({}).expect(400);
      expect(missing.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const wrong = await agent
        .post("/api/auth/mfa/totp/disable")
        .send({ mfaCode: "000000" })
        .expect(401);
      expect(wrong.body.error.code).toBe(ErrorCode.MFA_INVALID);
    });

    it("removes a folder lock with the account password even when MFA is on", async () => {
      const { agent } = await enrollTotp("folder-mfa@ordo.app");
      const folder = await agent.post("/api/folders").send({ name: "Vault" }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

      await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ accountPassword: "supersecret" })
        .expect(200);
    });

    it("removes a folder lock with the folder password even when MFA is on", async () => {
      const { agent } = await enrollTotp("folder-pw@ordo.app");
      const folder = await agent.post("/api/folders").send({ name: "Vault" }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);
      await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ folderPassword: "1234" })
        .expect(200);
    });
  });

  describe("MFA_REQUIRED", () => {
    let required: TestCtx;

    beforeAll(async () => {
      required = await createTestApp({ config: { mfaRequired: true } });
    });

    afterAll(async () => {
      await teardownApp(required);
    });

    beforeEach(async () => {
      await clearDb(required.prisma);
    });

    it("blocks other routes until TOTP is enabled", async () => {
      const agent = await authedAgent(required.app, "needmfa@ordo.app");
      const blocked = await agent.get("/api/folders").expect(403);
      expect(blocked.body.error.code).toBe(ErrorCode.MFA_ENROLLMENT_REQUIRED);

      await agent.get("/api/auth/me").expect(200);
      const begin = await agent.post("/api/auth/mfa/totp/begin").send({}).expect(200);
      await agent
        .post("/api/auth/mfa/totp/confirm")
        .send({ code: totpNow(begin.body.secret, "needmfa@ordo.app") })
        .expect(200);
      await agent.get("/api/folders").expect(200);
    });
  });

  describe("avatars", () => {
    it("uploads, serves, and deletes a profile picture", async () => {
      const agent = await authedAgent(ctx.app, "pic@ordo.app");
      const uploaded = await agent
        .post("/api/auth/avatar")
        .attach("file", PNG_1X1, { filename: "me.png", contentType: "image/png" })
        .expect(200);
      expect(uploaded.body.hasAvatar).toBe(true);
      expect(uploaded.body.avatarUpdatedAt).toBeTruthy();

      const get = await agent.get("/api/auth/avatar").expect(200);
      expect(get.headers["content-type"]).toMatch(/image\/webp/);
      expect(get.body.length).toBeGreaterThan(0);

      const removed = await agent.delete("/api/auth/avatar").expect(200);
      expect(removed.body.hasAvatar).toBe(false);
      await agent.get("/api/auth/avatar").expect(404);
    });

    it("rejects unsupported types and oversize files", async () => {
      const agent = await authedAgent(ctx.app, "badpic@ordo.app");
      const type = await agent
        .post("/api/auth/avatar")
        .attach("file", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), {
          filename: "x.svg",
          contentType: "image/svg+xml",
        })
        .expect(400);
      expect(type.body.error.code).toBe(ErrorCode.AVATAR_UNSUPPORTED_TYPE);

      const huge = await agent
        .post("/api/auth/avatar")
        .attach("file", Buffer.alloc(3 * 1024 * 1024, 0xff), {
          filename: "huge.jpg",
          contentType: "image/jpeg",
        })
        .expect(413);
      expect(huge.body.error.code).toBe(ErrorCode.AVATAR_TOO_LARGE);
    });

    it("stores bytes in the database when configured", async () => {
      const dbCtx = await createTestApp({ config: { avatarStorage: "database" } });
      try {
        const agent = await authedAgent(dbCtx.app, "dbpic@ordo.app");
        await agent
          .post("/api/auth/avatar")
          .attach("file", PNG_1X1, { filename: "me.png", contentType: "image/png" })
          .expect(200);
        const row = await dbCtx.prisma.user.findUniqueOrThrow({ where: { email: "dbpic@ordo.app" } });
        expect(row.avatarBytes).toBeTruthy();
        expect(row.avatarMime).toBe("image/webp");
        await agent.get("/api/auth/avatar").expect(200);
      } finally {
        await teardownApp(dbCtx);
      }
    });
  });
});
