-- AlterTable
ALTER TABLE "User" ADD COLUMN "libraryState" TEXT NOT NULL DEFAULT 'plaintext';

-- Accounts that already installed a library key get one idempotent verification
-- pass on their next sign-in. `dataEncryptionVersion = 1` alone cannot reveal
-- plaintext rows left behind by a crash between the key write and the field
-- rewrite, so mark them as unfinished and let the normal resume path seal them.
UPDATE "User" SET "libraryState" = 'migrating' WHERE "dataEncryptionVersion" >= 1;
