import { addUtcDays, dayStartUtc, utcDay } from "./utc-day.js";

describe("utc-day", () => {
  it("formats and shifts UTC calendar days", () => {
    expect(utcDay(new Date("2026-09-20T23:30:00.000Z"))).toBe("2026-09-20");
    expect(addUtcDays("2026-09-20", 1)).toBe("2026-09-21");
    expect(addUtcDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(dayStartUtc("2026-09-20").toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });
});
