-- AlterTable
ALTER TABLE "User" ADD COLUMN "dekKdfSalt" TEXT;
ALTER TABLE "User" ADD COLUMN "dekPasswordWrapped" TEXT;
ALTER TABLE "User" ADD COLUMN "dekRecoveryWrapped" TEXT;
ALTER TABLE "User" ADD COLUMN "dataEncryptionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "dekWrapped" TEXT;
ALTER TABLE "Session" ADD COLUMN "dekRefreshWrapped" TEXT;
