import { emptyInstallSignals, mergeInstallSignals, resolveSignalTimestamp } from "./install-signals.js";

const NOW = new Date("2026-09-23T15:00:00.000Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("install signals", () => {
  it("keeps sign-in and registration independent and never shrinks a count", () => {
    const registered = mergeInstallSignals(null, {
      ...emptyInstallSignals(),
      opens: 2,
      registered: true,
      timeouts: 1,
    });
    expect(registered.loggedIn).toBe(false);
    expect(registered.registered).toBe(true);

    const merged = mergeInstallSignals(registered, {
      ...emptyInstallSignals(),
      opens: 1,
      loggedIn: true,
      registered: false,
      timeouts: 0,
      startupSlow: 1,
    });
    expect(merged).toMatchObject({
      opens: 2,
      loggedIn: true,
      registered: true,
      timeouts: 1,
      startupSlow: 1,
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
