import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * Strip query params so better-sqlite3 opens the file, not `file:…?connection_limit=1`.
 * The query-engine pool pin is gone: this adapter is one native handle, so WAL /
 * foreign_keys / busy_timeout apply to every statement without serializing a pool.
 */
export function sqliteAdapterUrl(databaseUrl: string): string {
  const [withoutQuery] = databaseUrl.split("?");
  return withoutQuery ?? databaseUrl;
}

export function createPrismaAdapter(databaseUrl: string): PrismaBetterSqlite3 {
  return new PrismaBetterSqlite3({
    url: sqliteAdapterUrl(databaseUrl),
    timeout: 5000,
  });
}
