import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "ordo:rateLimit";

export type RateLimitPolicyName =
  | "register"
  | "forgot-password"
  | "reset-password"
  | "bookmark-create"
  | "bookmark-prefetch"
  | "mfa-verify"
  | "avatar-upload"
  | "import-upload"
  | "export";

/** Bind a consume-on-request rate-limit policy to a handler. */
export const RateLimit = (policy: RateLimitPolicyName) => SetMetadata(RATE_LIMIT_KEY, policy);
