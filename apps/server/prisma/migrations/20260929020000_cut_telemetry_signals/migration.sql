/* Cut telemetry to the signals the dashboard uses:
   opens, timeouts, server errors, sign-in failures, appVersion.
   Platform, hosting, sign-in/registration flags and startup buckets go.
   Accounts and sign-ins come from User/Session instead. */

ALTER TABLE "AppInstall" DROP COLUMN "platform";
ALTER TABLE "AppInstall" DROP COLUMN "hosting";

ALTER TABLE "AppInstallDay" DROP COLUMN "platform";
ALTER TABLE "AppInstallDay" DROP COLUMN "hosting";
ALTER TABLE "AppInstallDay" DROP COLUMN "loggedIn";
ALTER TABLE "AppInstallDay" DROP COLUMN "registered";
ALTER TABLE "AppInstallDay" DROP COLUMN "startupFast";
ALTER TABLE "AppInstallDay" DROP COLUMN "startupOk";
ALTER TABLE "AppInstallDay" DROP COLUMN "startupSlow";

DROP TABLE IF EXISTS "AppInstallSnapshot";
