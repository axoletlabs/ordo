import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "../prisma/client.js";
import { type TelemetryHeartbeatInput, type TelemetryDayDto } from "@ordo/shared";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { addUtcDays, asCount, dayStartUtc, eachUtcDay, utcDay } from "./utc-day.js";

const SNAPSHOT_MS = 60 * 60 * 1000;
const WAU_DAYS = 6;
const MAU_DAYS = 29;
const HISTORY_CAP_DAYS = 365;

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => {
      void this.refreshHistory().catch((err) => {
        this.logger.warn(`Telemetry snapshot failed: ${(err as Error).message}`);
      });
    }, SNAPSHOT_MS);
    this.timer.unref?.();
    void this.refreshHistory().catch((err) => {
      this.logger.warn(`Telemetry snapshot failed: ${(err as Error).message}`);
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async heartbeat(input: TelemetryHeartbeatInput, ip: string): Promise<{ ok: true }> {
    this.rateLimit.consumeHeartbeat(ip);
    const existing = await this.prisma.appInstall.findUnique({
      where: { id: input.installId },
      select: { id: true },
    });
    if (!existing) this.rateLimit.consumeHeartbeatNew(ip);

    const now = new Date();
    const day = utcDay(now);
    await this.prisma.$transaction([
      this.prisma.appInstall.upsert({
        where: { id: input.installId },
        create: {
          id: input.installId,
          platform: input.platform,
          hosting: input.hosting,
          appVersion: input.appVersion,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          platform: input.platform,
          hosting: input.hosting,
          appVersion: input.appVersion,
          lastSeenAt: now,
        },
      }),
      this.prisma.appInstallDay.upsert({
        where: { installId_day: { installId: input.installId, day } },
        create: {
          installId: input.installId,
          day,
          platform: input.platform,
          hosting: input.hosting,
          appVersion: input.appVersion,
        },
        update: {
          platform: input.platform,
          hosting: input.hosting,
          appVersion: input.appVersion,
        },
      }),
    ]);
    return { ok: true };
  }

  async refreshHistory(now = new Date()): Promise<TelemetryDayDto[]> {
    const today = utcDay(now);
    const earliest = await this.earliestDay();
    const from = earliest ? maxDay(earliest, addUtcDays(today, -(HISTORY_CAP_DAYS - 1))) : today;
    const days = eachUtcDay(from, today);
    const history = [];
    for (const day of days) {
      history.push(await this.persistSnapshot(day, now));
    }
    return history;
  }

  private async earliestDay(): Promise<string | null> {
    const [ping, snap] = await Promise.all([
      this.prisma.appInstallDay.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
      this.prisma.appInstallSnapshot.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
    ]);
    const days = [ping?.day, snap?.day].filter((day): day is string => Boolean(day));
    if (days.length === 0) return null;
    return days.reduce((min, day) => (day < min ? day : min));
  }

  private async persistSnapshot(day: string, takenAt: Date) {
    const row = await this.snapshotForDay(day);
    await this.prisma.appInstallSnapshot.upsert({
      where: { day },
      create: {
        day,
        total: row.total,
        newCount: row.newCount,
        dau: row.dau,
        wau: row.wau,
        mau: row.mau,
        hosting: JSON.stringify(row.hosting),
        platform: JSON.stringify(row.platform),
        version: JSON.stringify(row.version),
        takenAt,
      },
      update: {
        total: row.total,
        newCount: row.newCount,
        dau: row.dau,
        wau: row.wau,
        mau: row.mau,
        hosting: JSON.stringify(row.hosting),
        platform: JSON.stringify(row.platform),
        version: JSON.stringify(row.version),
        takenAt,
      },
    });
    return row;
  }

  private async snapshotForDay(day: string) {
    const start = dayStartUtc(day);
    const next = dayStartUtc(addUtcDays(day, 1));
    const wauFrom = addUtcDays(day, -WAU_DAYS);
    const mauFrom = addUtcDays(day, -MAU_DAYS);
    const [total, newCount, dau, wau, mau, hosting, platform, version] = await Promise.all([
      this.prisma.appInstall.count({ where: { firstSeenAt: { lt: next } } }),
      this.prisma.appInstall.count({
        where: { firstSeenAt: { gte: start, lt: next } },
      }),
      this.prisma.appInstallDay.count({ where: { day } }),
      this.distinctInstalls(wauFrom, day),
      this.distinctInstalls(mauFrom, day),
      this.breakdown(day, "hosting"),
      this.breakdown(day, "platform"),
      this.breakdown(day, "appVersion"),
    ]);
    return {
      day,
      total,
      newCount,
      dau,
      wau,
      mau,
      hosting,
      platform,
      version,
    };
  }

  private async distinctInstalls(from: string, to: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint | number }>>(
      Prisma.sql`SELECT COUNT(DISTINCT "installId") AS n FROM "AppInstallDay" WHERE "day" >= ${from} AND "day" <= ${to}`,
    );
    return asCount(rows[0]?.n);
  }

  private async breakdown(day: string, column: "hosting" | "platform" | "appVersion") {
    const rows = await this.prisma.appInstallDay.groupBy({
      by: [column],
      where: { day },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of rows) {
      const key = row[column];
      if (!key) continue;
      out[key] = row._count._all;
    }
    return out;
  }
}

function maxDay(left: string, right: string): string {
  return left > right ? left : right;
}
