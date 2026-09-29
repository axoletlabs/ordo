/* Only daily presence and the four dashboard counters are useful.
   Old clients may still send versions/timestamps; they are no longer stored. */
ALTER TABLE "AppInstall" DROP COLUMN "appVersion";
ALTER TABLE "AppInstallDay" DROP COLUMN "appVersion";
ALTER TABLE "AppInstallDay" DROP COLUMN "lastPingAt";

/* Keep first/last seen for install counts and retention, at day precision. */
UPDATE "AppInstall" SET
  "firstSeenAt" = COALESCE(CASE WHEN typeof("firstSeenAt") IN ('integer', 'real')
    THEN CAST("firstSeenAt" / 86400000 AS INTEGER) * 86400000
    ELSE CAST(strftime('%s', "firstSeenAt", 'start of day') AS INTEGER) * 1000 END, "firstSeenAt"),
  "lastSeenAt" = COALESCE(CASE WHEN typeof("lastSeenAt") IN ('integer', 'real')
    THEN CAST("lastSeenAt" / 86400000 AS INTEGER) * 86400000
    ELSE CAST(strftime('%s', "lastSeenAt", 'start of day') AS INTEGER) * 1000 END, "lastSeenAt");
