import { SetMetadata } from "@nestjs/common";

export const ALLOW_UNVERIFIED_EMAIL_KEY = "ordo:allowUnverifiedEmail";

/** Session is enough; a verified inbox is not required even when EMAIL_VERIFICATION_REQUIRED. */
export const AllowUnverifiedEmail = () => SetMetadata(ALLOW_UNVERIFIED_EMAIL_KEY, true);
