import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "./client.js";
import { repairLegacySchema, type LegacyRepairClient } from "./schema-legacy.js";

export interface SchemaSqlClient extends LegacyRepairClient {
  $queryRaw: PrismaClientRaw;
}

type PrismaClientRaw = <T = unknown>(
  query: TemplateStringsArray | Prisma.Sql,
  ...values: unknown[]
) => Promise<T>;

export type SchemaMigrateResult =
  | "migrated"
  | "baselined"
  | "repaired-and-baselined"
  | "noop";

export interface EnsurePrismaSchemaOptions {
  databaseUrl: string;
  migrationsDir?: string;
  log?: (message: string) => void;
}

const MIGRATIONS_TABLE = `_prisma_migrations`;

export function defaultMigrationsDir(): string {
  return process.env.ORDO_MIGRATIONS_DIR?.trim() || join(process.cwd(), "prisma", "migrations");
}

/**
 * Apply versioned Prisma migrations. Existing databases that were created with
 * `db push` (no `_prisma_migrations` row) are repaired to the init snapshot,
 * then marked as having that first migration so later SQL files still run.
 */
export async function ensurePrismaSchema(
  client: SchemaSqlClient,
  options: EnsurePrismaSchemaOptions,
): Promise<SchemaMigrateResult> {
  if (!options.databaseUrl.startsWith("file:")) return "noop";

  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const migrations = listMigrations(migrationsDir);
  if (migrations.length === 0) {
    throw new Error(`No Prisma migrations found in ${migrationsDir}`);
  }

  const tables = await listUserTables(client);
  const hasMigrationsTable = tables.has(MIGRATIONS_TABLE);
  const hasAppTables = tables.has("User") || tables.has("Bookmark") || tables.has("Folder");

  if (!hasMigrationsTable && hasAppTables) {
    await repairLegacySchema(client);
    await createMigrationsTable(client);
    const [baseline] = migrations;
    if (!baseline) throw new Error("Prisma migration list was empty after listing");
    await markApplied(client, baseline);
    options.log?.(
      `Adopted existing SQLite database onto Prisma migrate (${baseline.name})`,
    );
    const rest = migrations.slice(1);
    for (const migration of rest) {
      await applyMigration(client, migration);
      options.log?.(`Applied Prisma migration ${migration.name}`);
    }
    return rest.length > 0 ? "migrated" : "repaired-and-baselined";
  }

  if (!hasMigrationsTable) {
    await createMigrationsTable(client);
  }

  const applied = await appliedMigrationNames(client);
  let ran = 0;
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await applyMigration(client, migration);
    ran += 1;
    options.log?.(`Applied Prisma migration ${migration.name}`);
  }
  if (ran === 0) return "noop";
  if (!hasAppTables) return "migrated";
  return "migrated";
}

export interface PrismaMigrationFile {
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export function listMigrations(migrationsDir: string): PrismaMigrationFile[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = join(migrationsDir, name, "migration.sql");
      const sql = readFileSync(path, "utf8");
      return {
        name,
        path,
        sql,
        checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      };
    });
}

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => {
      if (!statement) return false;
      const withoutComments = statement
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("--"))
        .join("\n");
      return withoutComments.length > 0;
    });
}

async function applyMigration(client: SchemaSqlClient, migration: PrismaMigrationFile): Promise<void> {
  for (const statement of splitSqlStatements(migration.sql)) {
    await client.$executeRawUnsafe(statement);
  }
  await markApplied(client, migration);
}

async function markApplied(client: SchemaSqlClient, migration: PrismaMigrationFile): Promise<void> {
  const id = sqlLiteral(randomUUID());
  const checksum = sqlLiteral(migration.checksum);
  const name = sqlLiteral(migration.name);
  await client.$executeRawUnsafe(
    `INSERT INTO "${MIGRATIONS_TABLE}" (
      "id", "checksum", "finished_at", "migration_name", "logs",
      "rolled_back_at", "started_at", "applied_steps_count"
    ) VALUES (${id}, ${checksum}, CURRENT_TIMESTAMP, ${name}, NULL, NULL, CURRENT_TIMESTAMP, 1)`,
  );
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function createMigrationsTable(client: SchemaSqlClient): Promise<void> {
  await client.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`,
  );
}

async function appliedMigrationNames(client: SchemaSqlClient): Promise<Set<string>> {
  const rows = (await client.$queryRawUnsafe(
    `SELECT "migration_name" AS name FROM "${MIGRATIONS_TABLE}" WHERE "rolled_back_at" IS NULL`,
  )) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

async function listUserTables(client: SchemaSqlClient): Promise<Set<string>> {
  const rows = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );
  return new Set(rows.map((row) => row.name));
}
