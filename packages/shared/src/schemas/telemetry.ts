import { z } from "zod";

const telemetryCount = z.number().int().min(0).max(500).default(0);

/**
 * Anonymous install ping. No account, email, IP, device name, or server URL.
 * Health fields are coarse counts; accounts and sign-ins come from the
 * server's own User/Session tables, not from this ping.
 */
const DailyHeartbeatSchema = z.object({
  installId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      { message: "installId must be a UUID." },
    ),
  /** Only a UTC calendar day is needed; do not send exact event times. */
  day: z.iso.date(),
  /** Times the app came to the foreground this day. */
  opens: telemetryCount,
  timeouts: telemetryCount,
  serverErrors: telemetryCount,
  signInFailures: telemetryCount,
});

// Old releases send ts/appVersion. Convert their timestamp to a day at the
// boundary, then strip those fields along with every other unknown field.
// Keep this compatibility path until the old native releases are retired.
export const TelemetryHeartbeatSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  if (Object.hasOwn(input, "day") || !Number.isSafeInteger(input.ts)) return raw;
  const date = new Date((input.ts as number) * 1000);
  if (!Number.isFinite(date.getTime())) return raw;
  return { ...input, day: date.toISOString().slice(0, 10) };
}, DailyHeartbeatSchema);

export type TelemetryHeartbeatInput = z.infer<typeof TelemetryHeartbeatSchema>;
