import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitService } from "../common/rate-limit/rate-limit.service.js";
import { TelemetryService } from "./telemetry.service.js";

describe("telemetry retention", () => {
  it("purges at boot and daily, includes exactly 365 days, and stops on shutdown", async () => {
    const previousEnv = process.env.NODE_ENV;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const prisma = {
      appInstallDay: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      appInstall: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new TelemetryService(prisma as unknown as PrismaService, {} as RateLimitService);
    try {
      process.env.NODE_ENV = "production";
      service.onModuleInit();
      expect(prisma.appInstallDay.deleteMany).toHaveBeenCalledWith({ where: { day: { lt: "2025-10-01" } } });
      expect(prisma.appInstall.deleteMany).toHaveBeenCalledWith({
        where: { lastSeenAt: { lt: new Date("2025-10-01T00:00:00Z") } },
      });
      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.appInstallDay.deleteMany).toHaveBeenLastCalledWith({ where: { day: { lt: "2025-10-02" } } });
      service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      service.onModuleDestroy();
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      jest.useRealTimers();
    }
  });
});
