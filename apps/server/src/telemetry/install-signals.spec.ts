import { emptyInstallSignals, mergeInstallSignals, resolveSignalTimestamp } from "./install-signals.js";

const NOW = new Date("2026-09-23T15:00:00.000Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

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

  it("resolves the UTC day of a recent timestamp and drops stale or future ones", () => {
    expect(resolveSignalTimestamp(sec("2026-09-23T15:00:00.000Z"), NOW)).toEqual({
      day: "2026-09-23",
      keepSignals: true,
    });
    expect(resolveSignalTimestamp(sec("2026-09-22T16:00:00.000Z"), NOW)).toEqual({
      day: "2026-09-22",
      keepSignals: true,
    });
    expect(resolveSignalTimestamp(sec("2026-09-23T15:00:00.000Z") - 24 * 60 * 60, NOW)).toEqual({
      day: "2026-09-22",
      keepSignals: true,
    });
    expect(resolveSignalTimestamp(sec("2026-09-22T14:59:59.000Z"), NOW)).toEqual({
      day: "2026-09-23",
      keepSignals: false,
    });
    expect(resolveSignalTimestamp(sec("2026-09-23T15:00:01.000Z"), NOW)).toEqual({
      day: "2026-09-23",
      keepSignals: false,
    });
    expect(resolveSignalTimestamp(1.5, NOW)).toEqual({
      day: "2026-09-23",
      keepSignals: false,
    });
  });
});
