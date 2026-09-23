import { z } from "zod";

export const TELEMETRY_PLATFORMS = [
  "android",
  "ios",
  "web",
  "web-android",
  "web-ios",
  "web-desktop",
  "desktop",
  "other",
] as const;
export const TELEMETRY_HOSTING = ["cloud", "selfhosted"] as const;

export const TelemetryPlatformSchema = z.enum(TELEMETRY_PLATFORMS);
export const TelemetryHostingSchema = z.enum(TELEMETRY_HOSTING);

const telemetryCount = z.number().int().min(0).max(500).default(0);

/**
 * Anonymous install ping. No account, email, IP, device name, or server URL.
 * Sign-in and registration are separate flags. Health fields are coarse counts.
 */
export const TelemetryHeartbeatSchema = z.object({
  installId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      { message: "installId must be a UUID." },
    ),
  platform: TelemetryPlatformSchema,
  hosting: TelemetryHostingSchema,
  appVersion: z
    .string()
    .trim()
    .min(1, { message: "Enter an app version." })
    .max(32, { message: "App version must be 32 characters or fewer." }),
  /** UTC day these counters belong to (`YYYY-MM-DD`). Omitted pings count as today. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  opens: telemetryCount,
  loggedIn: z.boolean().default(false),
  registered: z.boolean().default(false),
  timeouts: telemetryCount,
  serverErrors: telemetryCount,
  signInFailures: telemetryCount,
  startupFast: telemetryCount,
  startupOk: telemetryCount,
  startupSlow: telemetryCount,
});

export type TelemetryHeartbeatInput = z.infer<typeof TelemetryHeartbeatSchema>;
export type TelemetryPlatform = z.infer<typeof TelemetryPlatformSchema>;
export type TelemetryHosting = z.infer<typeof TelemetryHostingSchema>;
