import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type TelemetryHeartbeatInput } from "@ordo/shared";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mergeInstallSignals, resolveSignalDay } from "./install-signals.js";
import { addUtcDays, dayStartUtc, utcDay } from "./utc-day.js";

const RETENTION_DAYS = 365;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Keep only the dashboard's one-year window, including on long-lived servers. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.schedulePurge();
    this.purgeTimer = setInterval(() => this.schedulePurge(), PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  private schedulePurge(): void {
    void this.purgeOldData(utcDay(new Date())).catch((err) => {
      this.logger.warn(`Telemetry purge failed: ${(err as Error).message}`);
    });
  }

  async heartbeat(input: TelemetryHeartbeatInput, ip: string): Promise<{ ok: true }> {
    this.rateLimit.consumeHeartbeat(ip);
    const now = new Date();
    const day = resolveSignalDay(input.day, now);
    // Acknowledge stale reports so clients can discard them, without adding
    // fake current-day activity or minting a new install from an old report.
    if (!day) return { ok: true };
    const existing = await this.prisma.appInstall.findUnique({
      where: { id: input.installId },
      select: { id: true },
    });
    if (!existing) this.rateLimit.consumeHeartbeatNew(ip);

    const seenDay = dayStartUtc(utcDay(now));
    await this.prisma.$transaction(async (tx) => {
      const existingDay = await tx.appInstallDay.findUnique({
        where: { installId_day: { installId: input.installId, day } },
      });
      const signals = mergeInstallSignals(existingDay, input);
      await tx.appInstall.upsert({
        where: { id: input.installId },
        create: {
          id: input.installId,
          firstSeenAt: dayStartUtc(day),
          lastSeenAt: seenDay,
        },
        update: {
          lastSeenAt: seenDay,
        },
      });
      await tx.appInstallDay.upsert({
        where: { installId_day: { installId: input.installId, day } },
        create: {
          installId: input.installId,
          day,
          ...signals,
        },
        update: {
          ...signals,
        },
      });
    });
    return { ok: true };
  }

  private async purgeOldData(today: string): Promise<void> {
    const cutoffDay = addUtcDays(today, -(RETENTION_DAYS - 1));
    await this.prisma.$transaction([
      this.prisma.appInstallDay.deleteMany({ where: { day: { lt: cutoffDay } } }),
      this.prisma.appInstall.deleteMany({
        where: { lastSeenAt: { lt: dayStartUtc(cutoffDay) } },
      }),
    ]);
  }
}
