import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCalendarInput, parseCalendarInput } from "./calendar-input.ts";

test("date entry validates leap years, month bounds and calendar rollover", () => {
  assert.deepEqual(parseCalendarInput("2028-02-29"), { year: 2028, month: 1, day: 29 });
  for (const input of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00", "2026-1-1", "2026-10-01extra", ""]) {
    assert.equal(parseCalendarInput(input), null, input);
  }
});

test("date entry preserves the local calendar, not the UTC date", () => {
  const unix = new Date(2026, 9, 12, 23, 59).getTime() / 1000;
  assert.equal(formatCalendarInput(unix), "2026-10-12");
});
