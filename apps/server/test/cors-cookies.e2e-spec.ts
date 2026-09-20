import request from "supertest";
import { COOKIES, CSRF_TOKEN_HEADER, ErrorCode } from "@ordo/shared";
import { createTestApp, teardownApp, type TestCtx } from "./utils.js";

function setCookies(res: request.Response): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieHeader(jar: string[], name: string): string | undefined {
  return jar.find((row) => row.startsWith(`${name}=`));
}

function isClearedCookie(header: string | undefined): boolean {
  if (!header) return false;
  const value = header.slice(header.indexOf("=") + 1).split(";")[0];
  return value === "" || /Expires=Thu, 01 Jan 1970/i.test(header);
}

describe("CORS, cookies, CSRF (e2e)", () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await teardownApp(ctx);
  });

  describe("CORS", () => {
    it("allows Expo web on loopback when the allowlist is empty", async () => {
      const res = await request(ctx.app.getHttpServer())
        .get("/api/health")
        .set("Origin", "http://localhost:8081")
        .expect(200);
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("does not echo an unknown Origin", async () => {
      const res = await request(ctx.app.getHttpServer())
        .get("/api/health")
        .set("Origin", "https://evil.example")
        .expect(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("allows the same origin as this API", async () => {
      const res = await request(ctx.app.getHttpServer())
        .get("/api/health")
        .set("Host", "api.example:3000")
        .set("Origin", "http://api.example:3000")
        .expect(200);
      expect(res.headers["access-control-allow-origin"]).toBe("http://api.example:3000");
    });

    it("keeps Cloud allowlists from auto-allowing localhost", async () => {
      const cloud = await createTestApp({
        config: { corsAllowedOrigins: ["https://ordo.axolet.com"] },
      });
      try {
        const blocked = await request(cloud.app.getHttpServer())
          .get("/api/health")
          .set("Origin", "http://localhost:8081")
          .expect(200);
        expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();

        const allowed = await request(cloud.app.getHttpServer())
          .get("/api/health")
          .set("Origin", "https://ordo.axolet.com")
          .expect(200);
        expect(allowed.headers["access-control-allow-origin"]).toBe("https://ordo.axolet.com");
      } finally {
        await teardownApp(cloud);
      }
    });
  });

  describe("cookies", () => {
    it("sets httpOnly session cookies and a readable CSRF cookie on HTTP", async () => {
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .send({ displayName: "web", email: "web-cookie@ordo.app", password: "supersecret" })
        .expect(201);

      const jar = setCookies(res);
      const access = cookieHeader(jar, COOKIES.ACCESS);
      const csrf = cookieHeader(jar, COOKIES.CSRF);
      expect(access).toBeTruthy();
      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/Path=\/api/i);
      expect(access).not.toMatch(/Secure/i);
      expect(isClearedCookie(cookieHeader(jar, COOKIES.ACCESS_HOST))).toBe(true);
      expect(csrf).toBeTruthy();
      expect(csrf).not.toMatch(/HttpOnly/i);
      expect(res.headers[CSRF_TOKEN_HEADER]).toBeTruthy();
    });

    it("sets __Host- Secure cookies when the request is HTTPS", async () => {
      const httpsApp = await createTestApp({ config: { trustProxy: 1 } });
      try {
        const res = await request(httpsApp.app.getHttpServer())
          .post("/api/auth/register")
          .set("X-Forwarded-Proto", "https")
          .set("Host", "api.ordo.axolet.com")
          .send({
            displayName: "https",
            email: "https-cookie@ordo.app",
            password: "supersecret",
          })
          .expect(201);

        const jar = setCookies(res);
        const access = cookieHeader(jar, COOKIES.ACCESS_HOST);
        expect(access).toBeTruthy();
        expect(access).toMatch(/Secure/i);
        expect(access).toMatch(/Path=\//i);
        expect(access).not.toMatch(/Path=\/api/i);
        expect(isClearedCookie(cookieHeader(jar, COOKIES.ACCESS))).toBe(true);
      } finally {
        await teardownApp(httpsApp);
      }
    });
  });

  describe("CSRF", () => {
    it("requires the CSRF header on cookie-authenticated writes", async () => {
      const agent = request.agent(ctx.app.getHttpServer());
      const registered = await agent
        .post("/api/auth/register")
        .send({ displayName: "csrf", email: "csrf@ordo.app", password: "supersecret" })
        .expect(201);
      const csrf = registered.headers[CSRF_TOKEN_HEADER] as string;
      expect(csrf).toBeTruthy();

      await agent.get("/api/auth/me").expect(200);

      const missing = await agent.post("/api/auth/logout").expect(403);
      expect(missing.body.error.code).toBe(ErrorCode.CSRF_INVALID);

      const wrong = await agent.post("/api/auth/logout").set(CSRF_TOKEN_HEADER, "nope").expect(403);
      expect(wrong.body.error.code).toBe(ErrorCode.CSRF_INVALID);

      await agent.post("/api/auth/logout").set(CSRF_TOKEN_HEADER, csrf).expect(200);
    });

    it("does not apply to bearer clients or anonymous writes", async () => {
      const auth = await request(ctx.app.getHttpServer())
        .post("/api/auth/register")
        .set("x-client-type", "mobile")
        .send({ displayName: "mobile", email: "csrf-mobile@ordo.app", password: "supersecret" })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .post("/api/auth/logout")
        .auth(auth.body.tokens.accessToken, { type: "bearer" })
        .expect(200);

      await request(ctx.app.getHttpServer())
        .post("/api/telemetry/heartbeat")
        .send({
          installId: "11111111-1111-4111-8111-111111111111",
          platform: "android",
          hosting: "selfhosted",
          appVersion: "0.1.0",
        })
        .expect(200);
    });
  });
});
