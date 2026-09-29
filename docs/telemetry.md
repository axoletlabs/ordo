# Install telemetry

Production mobile builds report anonymous install activity to Ordo Cloud. The
daily payload has exactly six fields:

```json
{
  "installId": "11111111-1111-4111-8111-111111111111",
  "day": "2026-09-30",
  "opens": 3,
  "timeouts": 0,
  "serverErrors": 0,
  "signInFailures": 0
}
```

The install ID is a random UUID stored locally, not an account or device ID.
Counters are cumulative for a UTC day, capped at 500, and flushed with a
15-minute gap when they change. Retries merge by maximum, never by addition.
The client reports only outside development on the `production` build channel.
Repeated notifications of the same foreground state do not count another open.

## What is deliberately excluded

No app version, exact event/ping timestamp, startup bucket, platform, hosting
mode, account/login flag, bookmark content, account ID, email, device name or
server URL is sent in telemetry. Account and sign-in summaries come from the
server's existing `User`/`Session` records instead of duplicate client events.
The HTTP peer IP is used by the existing rate limiter, not stored in telemetry
tables. Local flush timestamps remain on the device to throttle requests.

## Storage and retention

- `AppInstall` keeps only the anonymous ID and first/last-seen dates at UTC-day
  precision, for install totals and retention.
- `AppInstallDay` keeps only the ID, UTC day and the four counters.
- Today and yesterday are accepted, allowing a midnight/offline flush. Older or
  future reports are acknowledged but discarded; they do not invent activity
  or a healthy report for today.
- Daily rows and inactive install records older than the 365-day window are
  purged on boot and once a day. The cleanup timer stops on server shutdown.
- The private telemetry dashboard reads aggregate counts; the public API has
  no telemetry stats endpoint.

## Updating existing installations

Deploy the server before the updated mobile client. The server accepts older
native payloads with `ts`/`appVersion`, converts `ts` to a UTC day, and strips
unused fields before persistence. New clients send only the daily payload.

The versioned `20260930120000_daily_telemetry_only` migration runs through the
normal server database upgrade path. It drops stored version/last-ping columns
and rounds existing first/last-seen dates while preserving daily counters.
Previous migrations already remove platform, hosting, startup buckets, client
account flags and the unused snapshot table.
