-- AlterTable
ALTER TABLE "Bookmark" ADD COLUMN "remindAt" INTEGER;

-- CreateIndex
CREATE INDEX "Bookmark_userId_remindAt_idx" ON "Bookmark"("userId", "remindAt");
