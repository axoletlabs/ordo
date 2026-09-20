import { addUtcDays, asCount, dayStartUtc, eachUtcDay, utcDay } from "./utc-day.js";

describe("utc-day", () => {
  it("formats and shifts UTC calendar days", () => {
    expect(utcDay(new Date("2026-09-20T23:30:00.000Z"))).toBe("2026-09-20");
    expect(addUtcDays("2026-09-20", 1)).toBe("2026-09-21");
    expect(addUtcDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(dayStartUtc("2026-09-20").toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(eachUtcDay("2026-09-19", "2026-09-21")).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
    expect(eachUtcDay("2026-09-21", "2026-09-19")).toEqual([]);
  });

  it("coerces sqlite counts", () => {
    expect(asCount(3n)).toBe(3);
    expect(asCount(4)).toBe(4);
    expect(asCount(undefined)).toBe(0);
  });
});
