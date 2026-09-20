import request from "supertest";
import { TelemetryRoutes } from "@ordo/shared";
import { createTestApp, teardownApp, type TestCtx } from "./utils.js";

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const INSTALL_B = "22222222-2222-4222-8222-222222222222";

describe("Telemetry (e2e)", () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
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

    const installs = await ctx.prisma.appInstall.findMany();
    const days = await ctx.prisma.appInstallDay.findMany();
    expect(installs).toHaveLength(1);
    expect(days).toHaveLength(1);
    expect(installs[0]).toMatchObject({
      id: INSTALL_A,
      platform: "android",
      hosting: "selfhosted",
    });
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

    const rows = await ctx.prisma.appInstall.findMany({ orderBy: { hosting: "asc" } });
    expect(rows.map((row) => row.hosting).sort()).toEqual(["cloud", "selfhosted"]);
  });

  it("does not expose a stats page on the API", async () => {
    await request(ctx.app.getHttpServer()).get("/api/telemetry/stats").expect(404);
  });

  it("ignores extra identifying fields on a heartbeat", async () => {
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
