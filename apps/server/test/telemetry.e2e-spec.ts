import request from "supertest";
import { TelemetryRoutes } from "@ordo/shared";
import { createTestApp, teardownApp, type TestCtx } from "./utils.js";

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const INSTALL_B = "22222222-2222-4222-8222-222222222222";

const ping = (overrides: Record<string, unknown> = {}) => ({
  installId: INSTALL_A,
  appVersion: "0.1.0",
  ts: Math.floor(Date.now() / 1000),
  ...overrides,
});

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
    await ctx.prisma.appInstall.deleteMany();
  });

  it("records an anonymous heartbeat and counts it once per day", async () => {
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping())
      .expect(200)
      .expect({ ok: true });

    await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(ping()).expect(200);

    const installs = await ctx.prisma.appInstall.findMany();
    const days = await ctx.prisma.appInstallDay.findMany();
    expect(installs).toHaveLength(1);
    expect(days).toHaveLength(1);
    expect(installs[0]).toMatchObject({
      id: INSTALL_A,
      appVersion: "0.1.0",
    });
    expect(days[0]?.lastPingAt).toBeGreaterThan(1_700_000_000);
  });

  it("does not expose a stats page on the API", async () => {
    await request(ctx.app.getHttpServer()).get("/api/telemetry/stats").expect(404);
  });

  it("ignores extra identifying fields on a heartbeat", async () => {
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send({
        ...ping(),
        platform: "web",
        hosting: "cloud",
        email: "nope@example.com",
        serverUrl: "https://evil.example",
      })
      .expect(200);

    const installs = await ctx.prisma.appInstall.findMany();
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({ appVersion: "0.1.0" });
  });

  it("keeps counters monotonic through the day", async () => {
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping({ appVersion: "0.2.0", opens: 3, timeouts: 2 }))
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping({ appVersion: "0.2.0", opens: 1, signInFailures: 4 }))
      .expect(200);

    const row = await ctx.prisma.appInstallDay.findFirst({ where: { installId: INSTALL_A } });
    expect(row).toMatchObject({
      opens: 3,
      timeouts: 2,
      signInFailures: 4,
    });
  });

  it("keeps the second install as its own row", async () => {
    await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(ping()).expect(200);
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping({ installId: INSTALL_B }))
      .expect(200);

    const installs = await ctx.prisma.appInstall.findMany();
    expect(installs).toHaveLength(2);
  });
});
