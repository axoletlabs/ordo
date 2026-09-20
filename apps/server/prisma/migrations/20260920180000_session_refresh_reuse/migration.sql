-- Remember the last refresh hash so presenting it again revokes the session.
ALTER TABLE "Session" ADD COLUMN "previousRefreshTokenHash" TEXT;

CREATE UNIQUE INDEX "Session_previousRefreshTokenHash_key" ON "Session"("previousRefreshTokenHash");
