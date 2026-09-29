import request from "supertest";
import { TelemetryHeartbeatSchema, TelemetryRoutes } from "@ordo/shared";
import { addUtcDays, utcDay } from "../src/telemetry/utc-day.js";
import { createTestApp, teardownApp, type TestCtx } from "./utils.js";

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const INSTALL_B = "22222222-2222-4222-8222-222222222222";

const ping = (overrides: Record<string, unknown> = {}) => ({
  installId: INSTALL_A,
  day: utcDay(new Date()),
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
    });
    expect(installs[0]?.firstSeenAt.toISOString()).toBe(`${ping().day}T00:00:00.000Z`);
    expect(installs[0]?.lastSeenAt.toISOString()).toBe(`${ping().day}T00:00:00.000Z`);
    expect(installs[0]).not.toHaveProperty("appVersion");
    expect(days[0]).not.toHaveProperty("appVersion");
    expect(days[0]).not.toHaveProperty("lastPingAt");
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
        appVersion: "old-release",
        ts: Math.floor(Date.now() / 1000),
        startupFast: 10,
      })
      .expect(200);

    const installs = await ctx.prisma.appInstall.findMany();
    expect(installs).toHaveLength(1);
    expect(Object.keys(installs[0]!).sort()).toEqual(["firstSeenAt", "id", "lastSeenAt"]);
  });

  it("keeps counters monotonic through the day", async () => {
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping({ opens: 3, timeouts: 2 }))
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post(TelemetryRoutes.heartbeat.path)
      .send(ping({ opens: 1, signInFailures: 4 }))
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

  it("accepts old native payloads but retains only their day and useful counters", async () => {
    const legacy = {
      installId: INSTALL_A, appVersion: "0.1.0", ts: Math.floor(Date.now() / 1000),
      opens: 2, startupSlow: 10, hosting: "cloud", loggedIn: true,
    };
    expect(TelemetryHeartbeatSchema.parse(legacy)).toEqual({
      installId: INSTALL_A, day: utcDay(new Date()), opens: 2,
      timeouts: 0, serverErrors: 0, signInFailures: 0,
    });
    await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(legacy).expect(200);
    expect(await ctx.prisma.appInstallDay.findFirst()).toMatchObject({ opens: 2, day: ping().day });
  });

  it("keeps yesterday's flush on yesterday rather than recording activity today", async () => {
    const yesterday = addUtcDays(utcDay(new Date()), -1);
    await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path)
      .send(ping({ day: yesterday, opens: 2, timeouts: 1 })).expect(200);
    expect(await ctx.prisma.appInstallDay.findMany()).toEqual([
      expect.objectContaining({ day: yesterday, opens: 2, timeouts: 1 }),
    ]);
    const install = await ctx.prisma.appInstall.findFirst();
    expect(install?.firstSeenAt.toISOString()).toBe(`${yesterday}T00:00:00.000Z`);
  });

  it("acknowledges stale/future reports without storing them or counting a new install", async () => {
    const today = utcDay(new Date());
    for (const day of [addUtcDays(today, -2), addUtcDays(today, 1)]) {
      await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path)
        .send(ping({ day, opens: 4 })).expect(200);
    }
    expect(await ctx.prisma.appInstall.count()).toBe(0);
    expect(await ctx.prisma.appInstallDay.count()).toBe(0);
  });

  it("rejects invalid dates and malformed legacy timestamps", async () => {
    for (const payload of [ping({ day: "2026-02-30" }), { installId: INSTALL_A, ts: 1.5 }]) {
      await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(payload).expect(400);
    }
    expect(await ctx.prisma.appInstall.count()).toBe(0);
  });

  it("does not lose counters when reports arrive concurrently", async () => {
    await request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(ping()).expect(200);
    await Promise.all([
      request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(ping({ opens: 5 })).expect(200),
      request(ctx.app.getHttpServer()).post(TelemetryRoutes.heartbeat.path).send(ping({ timeouts: 3 })).expect(200),
    ]);
    expect(await ctx.prisma.appInstallDay.findFirst()).toMatchObject({ opens: 5, timeouts: 3 });
  });
});
