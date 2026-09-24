-- Home and folder lists filter by owner + folder and order by createdAt.
-- A separate folderId index still reads the whole row (including article HTML)
-- before it can sort. This index covers that range.
CREATE INDEX "Bookmark_userId_folderId_createdAt_idx" ON "Bookmark"("userId", "folderId", "createdAt");
