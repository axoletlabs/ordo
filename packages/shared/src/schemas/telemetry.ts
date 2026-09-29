import { z } from "zod";

const telemetryCount = z.number().int().min(0).max(500).default(0);

/**
 * Anonymous install ping. No account, email, IP, device name, or server URL.
 * Health fields are coarse counts; accounts and sign-ins come from the
 * server's own User/Session tables, not from this ping.
 */
export const TelemetryHeartbeatSchema = z.object({
  installId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      { message: "installId must be a UUID." },
    ),
  /** UTC calendar day the counters cover; exact event times are not sent. */
  day: z.iso.date(),
  /** Times the app came to the foreground this day. */
  opens: telemetryCount,
  timeouts: telemetryCount,
  serverErrors: telemetryCount,
  signInFailures: telemetryCount,
});

export type TelemetryHeartbeatInput = z.infer<typeof TelemetryHeartbeatSchema>;
