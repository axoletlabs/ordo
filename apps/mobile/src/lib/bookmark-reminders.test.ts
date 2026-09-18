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
  MINUTE_STEPS,
  reminderClearsOnOpen,
  reminderMonthGrid,
  reminderLaterAt,
  reminderNotificationCopy,
  parseUnixSeconds,
  reminderPingAction,
  reminderPingPayload,
  reminderPingPlan,
  reminderPresetAt,
  reminderPresetDetail,
  REMINDER_PING_CATCHUP_SECONDS,
  REMINDER_PING_IMMINENT_SECONDS,
  REMINDER_PING_STUCK_SECONDS,
  scheduledTriggerUnix,
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

test("opening a bookmark clears a due reminder, not an upcoming one", () => {
  const past = unixSeconds(new Date(2026, 8, 17, 9, 0, 0));
  const later = unixSeconds(new Date(2026, 8, 18, 9, 0, 0));
  assert.equal(reminderClearsOnOpen(past, now), true);
  assert.equal(reminderClearsOnOpen(later, now), false);
  assert.equal(reminderClearsOnOpen(null, now), false);
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

test("default custom time rounds forward to five minutes", () => {
  assert.equal(defaultCustomReminderAt(now), unixSeconds(new Date(2026, 8, 17, 21, 35, 0)));
});

test("five-minute steps cover a full hour", () => {
  assert.deepEqual(
    [...MINUTE_STEPS],
    [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
  );
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

test("Later is the one-hour preset from now", () => {
  assert.equal(reminderLaterAt(now), reminderPresetAt("1h", now));
});

test("notification copy is the title plus a Reminder chip and host", () => {
  assert.deepEqual(
    reminderNotificationCopy({ title: "How to remember what you read", domain: "fs.blog" }),
    { title: "How to remember what you read", subtitle: "Reminder", body: "fs.blog" },
  );
  assert.deepEqual(reminderNotificationCopy({ title: "  ", domain: "" }), {
    title: "Saved page",
    subtitle: "Reminder",
  });
  assert.deepEqual(reminderNotificationCopy({ title: "example.com", domain: "example.com" }), {
    title: "example.com",
    subtitle: "Reminder",
  });
});

test("notification actions map Complete, Reschedule, Open, and a default tap", () => {
  assert.equal(reminderPingAction("complete"), "complete");
  assert.equal(reminderPingAction("later"), "complete");
  assert.equal(reminderPingAction("reschedule"), "reschedule");
  assert.equal(reminderPingAction("open"), "open");
  assert.equal(reminderPingAction("expo.modules.notifications.actions.DEFAULT"), "open");
  assert.equal(reminderPingAction("dismiss"), null);
});

test("notification payload reads folderId nulls and remindAt from JSON-ish data", () => {
  assert.deepEqual(
    reminderPingPayload({
      bookmarkId: "b1",
      folderId: null,
      title: "Notes",
      domain: "example.com",
      remindAt: 1_789_664_542,
    }),
    {
      bookmarkId: "b1",
      folderId: null,
      title: "Notes",
      domain: "example.com",
      remindAt: 1_789_664_542,
    },
  );
  assert.equal(reminderPingPayload({ bookmarkId: "b1", folderId: "null" })?.folderId, null);
  assert.equal(reminderPingPayload({ bookmarkId: "b1", folderId: "folder-1" })?.folderId, "folder-1");
  assert.equal(reminderPingPayload({ bookmarkId: "b1", remindAt: "1789664542" })?.remindAt, 1_789_664_542);
  assert.equal(reminderPingPayload({ bookmarkId: "b1", remindAt: 1_789_664_542_000 })?.remindAt, 1_789_664_542);
  assert.equal(reminderPingPayload({ title: "no id" }), null);
  assert.equal(
    reminderPingPayload(JSON.stringify({ bookmarkId: "b2", folderId: "", title: "A", domain: "x.com" }))
      ?.bookmarkId,
    "b2",
  );
  assert.equal(reminderPingPayload({ bookmarkId: "b1" })?.remindAt, null);
});

test("parseUnixSeconds accepts seconds, milliseconds, and numeric strings", () => {
  assert.equal(parseUnixSeconds(1_789_664_542), 1_789_664_542);
  assert.equal(parseUnixSeconds(1_789_664_542_000), 1_789_664_542);
  assert.equal(parseUnixSeconds("1789664542"), 1_789_664_542);
  assert.equal(parseUnixSeconds(new Date(1_789_664_542_000)), 1_789_664_542);
  assert.equal(parseUnixSeconds(0), null);
  assert.equal(parseUnixSeconds("nope"), null);
});

test("scheduledTriggerUnix reads Android DATE value-as-ms and iOS date fields", () => {
  assert.equal(
    scheduledTriggerUnix({ type: "date", repeats: false, value: 1_789_664_542_000 }),
    1_789_664_542,
  );
  assert.equal(scheduledTriggerUnix({ type: "date", date: 1_789_664_542 }), 1_789_664_542);
  assert.equal(scheduledTriggerUnix({ type: "unknown" }), null);
});

test("reminder ping plan leaves matching future DATE schedules alone", () => {
  const at = 1_000_000;
  const remindAt = at + 3600;
  assert.equal(reminderPingPlan({ remindAt, now: at, scheduledAt: remindAt }), "skip");
  assert.equal(reminderPingPlan({ remindAt, now: at }), "schedule");
  assert.equal(reminderPingPlan({ remindAt, now: at, scheduledAt: remindAt + 60 }), "schedule");
});

test("reminder ping plan does not re-present a due ping that already fired", () => {
  const at = 1_000_000;
  const remindAt = at - 5;
  assert.equal(reminderPingPlan({ remindAt, now: at, firedAt: remindAt }), "skip");
  assert.equal(reminderPingPlan({ remindAt, now: at, presented: true }), "skip");
  assert.equal(reminderPingPlan({ remindAt, now: at }), "present");
});

test("reminder ping plan waits briefly for a just-due DATE, then catch-up presents", () => {
  const at = 1_000_000;
  const remindAt = at - 10;
  assert.equal(reminderPingPlan({ remindAt, now: at, scheduledAt: remindAt }), "skip");
  assert.equal(
    reminderPingPlan({
      remindAt: at - REMINDER_PING_STUCK_SECONDS - 1,
      now: at,
      scheduledAt: at - REMINDER_PING_STUCK_SECONDS - 1,
    }),
    "present",
  );
});

test("reminder ping plan presents imminent times that are not already scheduled", () => {
  const at = 1_000_000;
  const remindAt = at + REMINDER_PING_IMMINENT_SECONDS - 1;
  assert.equal(reminderPingPlan({ remindAt, now: at }), "present");
  assert.equal(reminderPingPlan({ remindAt, now: at, scheduledAt: remindAt }), "skip");
});

test("reminder ping plan does not re-banner a long-due reminder on the next launch", () => {
  const at = 1_000_000;
  assert.equal(
    reminderPingPlan({ remindAt: at - REMINDER_PING_CATCHUP_SECONDS - 1, now: at }),
    "skip",
  );
  assert.equal(reminderPingPlan({ remindAt: at - 30, now: at }), "present");
});
