import request from "supertest";
import { ErrorCode, TelemetryRoutes } from "@ordo/shared";
import { createTestApp, teardownApp, type TestCtx } from "./utils.js";

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const INSTALL_B = "22222222-2222-4222-8222-222222222222";

describe("Telemetry (e2e)", () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp({ config: { telemetryStatsSecret: "stats-secret" } });
  });

  afterAll(async () => {
    await teardownApp(ctx);
  });

  beforeEach(async () => {
    await ctx.prisma.appInstallDay.deleteMany();
    await ctx.prisma.appInstallSnapshot.deleteMany();
    await ctx.prisma.appInstall.deleteMany();
  });

  it("records an anonymous heartbeat and counts it once per day", async () => {
    const ping = {
      installId: INSTALL_A,
      platform: "android",
      hosting: "selfhosted",
      appVersion: "0.1.0",
    };
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping)
      .expect(200)
      .expect({ ok: true });

    await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(ping).expect(200);

    const stats = await request(ctx.app.getHttpServer())
      .get(TelemetryRoutes.stats.path)
      .set("Authorization", "Bearer stats-secret")
      .expect(200);

    expect(stats.body.current.total).toBe(1);
    expect(stats.body.current.dau).toBe(1);
    expect(stats.body.current.newCount).toBe(1);
    expect(stats.body.current.hosting).toEqual({ selfhosted: 1 });
    expect(stats.body.current.platform).toEqual({ android: 1 });
    expect(stats.body.history.at(-1)?.dau).toBe(1);
  });

  it("splits cloud and self-host installs", async () => {
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send({
        installId: INSTALL_A,
        platform: "android",
        hosting: "cloud",
        appVersion: "0.1.0",
      })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send({
        installId: INSTALL_B,
        platform: "ios",
        hosting: "selfhosted",
        appVersion: "0.1.0",
      })
      .expect(200);

    const stats = await request(ctx.app.getHttpServer())
      .get(TelemetryRoutes.stats.path)
      .set("Authorization", "Bearer stats-secret")
      .expect(200);

    expect(stats.body.current.total).toBe(2);
    expect(stats.body.current.hosting).toEqual({ cloud: 1, selfhosted: 1 });
  });

  it("hides stats without the secret and serves html to browsers", async () => {
    await request(ctx.app.getHttpServer())
      .get(TelemetryRoutes.stats.path)
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
      });

    const html = await request(ctx.app.getHttpServer())
      .get(`${TelemetryRoutes.stats.path}?secret=stats-secret`)
      .set("Accept", "text/html")
      .expect(200);

    expect(html.headers["content-type"]).toMatch(/html/);
    expect(html.text).toContain("ordo installs");
    expect(html.text).toContain("Daily");
  });

  it("rejects a heartbeat that includes extra identifying fields by ignoring them", async () => {
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send({
        installId: INSTALL_A,
        platform: "web",
        hosting: "cloud",
        appVersion: "0.1.0",
        email: "nope@example.com",
        serverUrl: "https://evil.example",
      })
      .expect(200);

    const row = await ctx.prisma.appInstall.findUnique({ where: { id: INSTALL_A } });
    expect(row).toMatchObject({
      platform: "web",
      hosting: "cloud",
      appVersion: "0.1.0",
    });
  });
});
