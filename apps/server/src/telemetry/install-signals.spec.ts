import { emptyInstallSignals, mergeInstallSignals, resolveSignalDay } from "./install-signals.js";

const NOW = new Date("2026-09-23T15:00:00.000Z");

describe("install signals", () => {
  it("never shrinks a counter", () => {
    const first = mergeInstallSignals(null, {
      ...emptyInstallSignals(),
      opens: 2,
      timeouts: 1,
    });
    expect(first.timeouts).toBe(1);

    const merged = mergeInstallSignals(first, {
      ...emptyInstallSignals(),
      opens: 1,
      timeouts: 0,
    });
    expect(merged).toMatchObject({
      opens: 2,
      timeouts: 1,
    });
  });

  it("accepts only today or yesterday without rebucketing stale activity", () => {
    expect(resolveSignalDay("2026-09-23", NOW)).toBe("2026-09-23");
    expect(resolveSignalDay("2026-09-22", NOW)).toBe("2026-09-22");
    expect(resolveSignalDay("2026-09-21", NOW)).toBeNull();
    expect(resolveSignalDay("2026-09-24", NOW)).toBeNull();
    expect(resolveSignalDay("2026-02-30", NOW)).toBeNull();
    expect(resolveSignalDay("invalid", NOW)).toBeNull();
  });
});
