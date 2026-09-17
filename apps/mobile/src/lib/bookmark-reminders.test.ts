import assert from "node:assert/strict";
import { test } from "node:test";
import { unixSeconds } from "@ordo/shared";
import {
  applyLocalDate,
  applyLocalTime,
  bookmarkReminderStatus,
  defaultCustomReminderAt,
  formatReminderWhen,
  hour12To24,
  reminderMonthGrid,
  reminderPresetAt,
  reminderPresetDetail,
  shiftCalendarMonth,
} from "./bookmark-reminders.ts";

const now = new Date(2026, 8, 17, 21, 33, 0); // Thu Sep 17 2026, 9:33 PM local

test("hour presets add wall-clock time", () => {
  assert.equal(reminderPresetAt("1h", now), unixSeconds(new Date(2026, 8, 17, 22, 33, 0)));
  assert.equal(reminderPresetAt("3h", now), unixSeconds(new Date(2026, 8, 18, 0, 33, 0)));
});

test("tomorrow is the next local calendar day at 9:00", () => {
  assert.equal(reminderPresetAt("tomorrow", now), unixSeconds(new Date(2026, 8, 18, 9, 0, 0)));
});

test("next week is the following Monday at 9:00 local", () => {
  assert.equal(reminderPresetAt("nextWeek", now), unixSeconds(new Date(2026, 8, 21, 9, 0, 0)));
  const monday = new Date(2026, 8, 21, 10, 0, 0);
  assert.equal(reminderPresetAt("nextWeek", monday), unixSeconds(new Date(2026, 8, 28, 9, 0, 0)));
});

test("preset details stay in local time", () => {
  const inOneHour = reminderPresetAt("1h", now);
  const nextWeek = reminderPresetAt("nextWeek", now);
  assert.equal(reminderPresetDetail("1h", inOneHour), formatReminderWhen(inOneHour, now));
  assert.match(reminderPresetDetail("nextWeek", nextWeek), /9:00/);
});

test("due rows stay labeled until the reminder is cleared", () => {
  const past = unixSeconds(new Date(2026, 8, 17, 9, 0, 0));
  assert.equal(bookmarkReminderStatus(past, now), "due");
  assert.match(formatReminderWhen(past, now), /^Due /);
  assert.equal(bookmarkReminderStatus(null, now), "none");
});

test("due labels keep a local date when the ping was on another day", () => {
  const yesterday = new Date(2026, 8, 16, 9, 0, 0);
  const label = formatReminderWhen(unixSeconds(yesterday), now);
  const weekday = yesterday.toLocaleDateString(undefined, { weekday: "short" });
  assert.match(label, /^Due /);
  assert.ok(label.includes(weekday));
});

test("custom date and time apply in local wall-clock fields", () => {
  const at = unixSeconds(new Date(2026, 8, 17, 9, 0, 0));
  assert.equal(applyLocalDate(at, 2026, 8, 18), unixSeconds(new Date(2026, 8, 18, 9, 0, 0)));
  assert.equal(applyLocalTime(at, 21, 15), unixSeconds(new Date(2026, 8, 17, 21, 15, 0)));
});

test("default custom time rounds forward to a quarter hour", () => {
  assert.equal(defaultCustomReminderAt(now), unixSeconds(new Date(2026, 8, 17, 21, 45, 0)));
});

test("12-hour clock maps noon and midnight", () => {
  assert.equal(hour12To24(12, "am"), 0);
  assert.equal(hour12To24(12, "pm"), 12);
  assert.equal(hour12To24(1, "pm"), 13);
});

test("month grid is Sunday-first and marks today", () => {
  const at = unixSeconds(new Date(2026, 8, 18, 9, 0, 0));
  const cells = reminderMonthGrid(2026, 8, at, now);
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[2]?.day, 1);
  assert.equal(cells.find((cell) => cell.selected)?.day, 18);
  assert.equal(cells.find((cell) => cell.isToday)?.day, 17);
  assert.equal(cells.find((cell) => cell.day === 16)?.isPast, true);
});

test("shiftCalendarMonth wraps the year", () => {
  assert.deepEqual(shiftCalendarMonth(2026, 11, 1), { year: 2027, month: 0 });
});
