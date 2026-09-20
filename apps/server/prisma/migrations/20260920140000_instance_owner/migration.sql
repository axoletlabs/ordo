-- Who may rename this instance. Null until the first account is created.
ALTER TABLE "InstanceSettings" ADD COLUMN "ownerUserId" TEXT;

UPDATE "InstanceSettings"
SET "ownerUserId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
WHERE "ownerUserId" IS NULL;
