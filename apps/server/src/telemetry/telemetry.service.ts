import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type TelemetryHeartbeatInput } from "@ordo/shared";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { emptyInstallSignals, mergeInstallSignals, resolveSignalTimestamp } from "./install-signals.js";
import { addUtcDays, dayStartUtc, utcDay } from "./utc-day.js";

const RETENTION_DAYS = 400;

@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Keep the 400-day retention promise without the old snapshot interval. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    void this.purgeOldData(utcDay(new Date())).catch((err) => {
      this.logger.warn(`Telemetry purge failed: ${(err as Error).message}`);
    });
  }

  async heartbeat(input: TelemetryHeartbeatInput, ip: string): Promise<{ ok: true }> {
    this.rateLimit.consumeHeartbeat(ip);
    const existing = await this.prisma.appInstall.findUnique({
      where: { id: input.installId },
      select: { id: true },
    });
    if (!existing) this.rateLimit.consumeHeartbeatNew(ip);

    const now = new Date();
    const resolved = resolveSignalTimestamp(input.ts, now);
    const existingDay = await this.prisma.appInstallDay.findUnique({
      where: { installId_day: { installId: input.installId, day: resolved.day } },
    });
    const signals = mergeInstallSignals(
      existingDay,
      resolved.keepSignals ? input : emptyInstallSignals(),
    );
    await this.prisma.$transaction([
      this.prisma.appInstall.upsert({
        where: { id: input.installId },
        create: {
          id: input.installId,
          appVersion: input.appVersion,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          appVersion: input.appVersion,
          lastSeenAt: now,
        },
      }),
      this.prisma.appInstallDay.upsert({
        where: { installId_day: { installId: input.installId, day: resolved.day } },
        create: {
          installId: input.installId,
          day: resolved.day,
          appVersion: input.appVersion,
          lastPingAt: input.ts,
          ...signals,
        },
        update: {
          appVersion: input.appVersion,
          lastPingAt: input.ts,
          ...signals,
        },
      }),
    ]);
    return { ok: true };
  }

  private async purgeOldData(today: string): Promise<void> {
    const cutoffDay = addUtcDays(today, -RETENTION_DAYS);
    await this.prisma.$transaction([
      this.prisma.appInstallDay.deleteMany({ where: { day: { lt: cutoffDay } } }),
      this.prisma.appInstall.deleteMany({
        where: { lastSeenAt: { lt: dayStartUtc(cutoffDay) } },
      }),
    ]);
  }
}
