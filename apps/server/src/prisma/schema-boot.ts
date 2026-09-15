import { ensureBookmarkSearchIndex } from "./bookmark-fts.js";
import { ensurePrismaSchema, type SchemaMigrateResult, type SchemaSqlClient } from "./schema-migrate.js";

type BootClient = SchemaSqlClient & {
  $connect: () => Promise<unknown>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

/**
 * Same SQLite pragmas, versioned migrations, legacy db-push adopt, and FTS
 * index that PrismaService runs on boot. Used by the deploy-server update CLI
 * so a restart is not required to finish a schema upgrade.
 */
export async function applyDatabaseUpgrades(
  client: BootClient,
  databaseUrl: string,
  log?: (message: string) => void,
): Promise<SchemaMigrateResult> {
  await client.$connect();
  if (databaseUrl.startsWith("file:")) {
    await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await client.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
    await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  }
  const result = await ensurePrismaSchema(client, { databaseUrl, log });
  if (result === "repaired-and-baselined") {
    log?.("Legacy database adopted onto Prisma migrate");
  }
  if (databaseUrl.startsWith("file:")) {
    await ensureBookmarkSearchIndex(client);
  }
  return result;
}
