import { z } from "zod";

export const TELEMETRY_PLATFORMS = ["android", "ios", "web", "other"] as const;
export const TELEMETRY_HOSTING = ["cloud", "selfhosted"] as const;

export const TelemetryPlatformSchema = z.enum(TELEMETRY_PLATFORMS);
export const TelemetryHostingSchema = z.enum(TELEMETRY_HOSTING);

/** Anonymous once-a-day install ping. No account, email, IP, or server URL. */
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
});

export type TelemetryHeartbeatInput = z.infer<typeof TelemetryHeartbeatSchema>;
export type TelemetryPlatform = z.infer<typeof TelemetryPlatformSchema>;
export type TelemetryHosting = z.infer<typeof TelemetryHostingSchema>;
