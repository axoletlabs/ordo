import { Injectable } from "@nestjs/common";
import { type TelemetryHeartbeatInput } from "@ordo/shared";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mergeInstallSignals, resolveSignalDay } from "./install-signals.js";
import { dayStartUtc, utcDay } from "./utc-day.js";

@Injectable()
export class TelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

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
}
