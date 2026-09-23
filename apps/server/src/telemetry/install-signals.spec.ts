import { emptyInstallSignals, mergeInstallSignals, resolveSignalDay } from "./install-signals.js";

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

  it("accepts today and yesterday, and drops counters for any other day", () => {
    expect(resolveSignalDay(undefined, "2026-09-23")).toEqual({
      day: "2026-09-23",
      keepSignals: true,
    });
    expect(resolveSignalDay("2026-09-22", "2026-09-23")).toEqual({
      day: "2026-09-22",
      keepSignals: true,
    });
    expect(resolveSignalDay("2026-01-01", "2026-09-23")).toEqual({
      day: "2026-09-23",
      keepSignals: false,
    });
  });
});
