-- Match the full stable order, including its id tie-breaker. These indexes
-- avoid temporary sorting of an entire library for each 100-row page.
CREATE INDEX IF NOT EXISTS "Bookmark_userId_folderId_createdAt_id_idx" ON "Bookmark"("userId", "folderId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "Bookmark_userId_createdAt_id_idx" ON "Bookmark"("userId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "Bookmark_userId_folderId_title_id_idx" ON "Bookmark"("userId", "folderId", "title", "id");
-- The replacement covers the old prefix as well; don't pay to maintain both.
DROP INDEX IF EXISTS "Bookmark_userId_folderId_createdAt_idx";
