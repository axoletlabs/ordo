-- Existing accounts were created while verification was optional. Treat them
-- as verified so turning EMAIL_VERIFICATION_REQUIRED on does not lock them out.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
