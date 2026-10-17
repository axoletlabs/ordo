import assert from "node:assert/strict";
import { test } from "node:test";
import { clockPoint, clockValueAt, stepClockValue } from "./clock-dial.ts";

test("every hour on both 24-hour rings round trips through the clock", () => {
  for (let hour = 0; hour < 24; hour++) {
    const point = clockPoint(hour % 12, 12, hour === 0 || hour > 12);
    assert.equal(clockValueAt(point.x, point.y, "hour", false), hour);
  }
  for (let hour = 1; hour <= 12; hour++) {
    const point = clockPoint(hour % 12, 12);
    assert.equal(clockValueAt(point.x, point.y, "hour", true), hour);
  }
});

test("minute taps snap at all twelve positions, including midnight's seam", () => {
  for (let minute = 0; minute < 60; minute += 5) {
    const point = clockPoint(minute, 60);
    assert.equal(clockValueAt(point.x, point.y, "minute", true), minute);
  }
  assert.equal(clockValueAt(127, 24, "minute", false), 0);
  assert.equal(clockValueAt(129, 24, "minute", false), 0);
  assert.equal(clockValueAt(128, 128, "hour", true), null);
  assert.equal(clockValueAt(NaN, 100, "hour", false), null);
  for (let minute = 0; minute < 60; minute++) {
    const point = clockPoint(minute, 60);
    assert.equal(clockValueAt(point.x, point.y, "minute", false, 1), minute);
  }
});

test("keyboard and accessibility increments wrap without losing minute precision", () => {
  assert.equal(stepClockValue(59, 1, "minute", false), 0);
  assert.equal(stepClockValue(0, -1, "minute", true), 59);
  assert.equal(stepClockValue(12, 1, "hour", true), 1);
  assert.equal(stepClockValue(1, -1, "hour", true), 12);
  assert.equal(stepClockValue(23, 1, "hour", false), 0);
  assert.equal(stepClockValue(13, 5, "minute", true), 18);
});
