-- CreateTable
CREATE TABLE "AppInstall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "hosting" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppInstallDay" (
    "installId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "hosting" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,

    PRIMARY KEY ("installId", "day"),
    CONSTRAINT "AppInstallDay_installId_fkey" FOREIGN KEY ("installId") REFERENCES "AppInstall" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppInstallSnapshot" (
    "day" TEXT NOT NULL PRIMARY KEY,
    "total" INTEGER NOT NULL,
    "newCount" INTEGER NOT NULL,
    "dau" INTEGER NOT NULL,
    "wau" INTEGER NOT NULL,
    "mau" INTEGER NOT NULL,
    "hosting" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AppInstall_firstSeenAt_idx" ON "AppInstall"("firstSeenAt");

-- CreateIndex
CREATE INDEX "AppInstall_lastSeenAt_idx" ON "AppInstall"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AppInstallDay_day_idx" ON "AppInstallDay"("day");
