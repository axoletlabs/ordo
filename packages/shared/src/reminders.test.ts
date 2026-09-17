import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isReminderDue,
  isUnixSeconds,
  parseReminderFilter,
  reminderStatus,
  unixSeconds,
  UNIX_SECONDS_MAX,
} from "./reminders.ts";

test("unixSeconds floors milliseconds", () => {
  assert.equal(unixSeconds(1_000), 1);
  assert.equal(unixSeconds(1_999), 1);
  assert.equal(unixSeconds(new Date(5_000)), 5);
});

test("isUnixSeconds rejects fractions and overflow", () => {
  assert.equal(isUnixSeconds(1_700_000_000), true);
  assert.equal(isUnixSeconds(1.5), false);
  assert.equal(isUnixSeconds(-1), false);
  assert.equal(isUnixSeconds(UNIX_SECONDS_MAX + 1), false);
});

test("reminderStatus treats a past unix time as due until cleared", () => {
  assert.equal(reminderStatus(null, 100), "none");
  assert.equal(reminderStatus(99, 100), "due");
  assert.equal(reminderStatus(100, 100), "due");
  assert.equal(reminderStatus(101, 100), "upcoming");
  assert.equal(isReminderDue(50, 100), true);
  assert.equal(isReminderDue(150, 100), false);
});

test("parseReminderFilter ignores unknown values", () => {
  assert.equal(parseReminderFilter("due"), "due");
  assert.equal(parseReminderFilter("upcoming"), "upcoming");
  assert.equal(parseReminderFilter("all"), undefined);
  assert.equal(parseReminderFilter(""), undefined);
});
