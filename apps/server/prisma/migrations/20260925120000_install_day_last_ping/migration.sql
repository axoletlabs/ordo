-- Raw ping time in unix seconds. The UTC day bucket stays in "day".
ALTER TABLE "AppInstallDay" ADD COLUMN "lastPingAt" INTEGER NOT NULL DEFAULT 0;
