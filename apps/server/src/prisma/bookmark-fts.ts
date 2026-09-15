import { Prisma } from "./client.js";
import { MIN_FUZZY_TOKEN_LENGTH, searchSqlToken } from "@ordo/shared";

/**
 * Contentless FTS5 index for bookmark search. Documents are not stored again —
 * title/url/domain/extra/body are supplied at INSERT time and discarded, leaving
 * only the inverted index. `rowid` matches `Bookmark.rowid` so JOIN stays cheap.
 */
export const BOOKMARK_FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS BookmarkFts USING fts5(
  title,
  url,
  domain,
  extra,
  body,
  tokenize = 'unicode61 remove_diacritics 2',
  content = '',
  contentless_delete = 1
)`;

const FTS_PRIMARY_COLUMNS = "title url domain";
const FTS_ALL_COLUMNS = "title url domain extra body";

type SqlExecutor = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<T>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

/**
 * Create the FTS index, copy any leftover `contentText` into it, drop the
 * duplicate markdown/text columns, and install triggers. Idempotent.
 */
export async function ensureBookmarkSearchIndex(db: SqlExecutor): Promise<void> {
  const tables = await db.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Bookmark'`,
  );
  if (tables.length === 0) return;

  await installBookmarkFts(db);
  const columns = (await db.$queryRawUnsafe(`PRAGMA table_info("Bookmark")`)) as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  const bodySql = names.has("contentText")
    ? `coalesce(nullif(b."contentText", ''), b."contentHtml", '')`
    : `coalesce(b."contentHtml", '')`;
  await backfillBookmarkFts(db, bodySql);
  for (const column of ["contentMarkdown", "contentText"] as const) {
    if (!names.has(column)) continue;
    await db.$executeRawUnsafe(`ALTER TABLE "Bookmark" DROP COLUMN "${column}"`);
  }
  await createBookmarkFtsTriggers(db);
}

/** Prefix MATCH expression, or null when every token is FTS-empty. */
export function ftsPrefixQuery(
  tokens: readonly string[],
  opts: { fuzzy?: boolean; includeHidden?: boolean; op?: "AND" | "OR" } = {},
): string | null {
  const clauses = tokens
    .map((token) => ftsTokenClause(token, !!opts.fuzzy))
    .filter((clause): clause is string => clause != null);
  if (clauses.length === 0) return null;
  const op = opts.op === "OR" ? " OR " : " AND ";
  const columns = opts.includeHidden ? FTS_ALL_COLUMNS : FTS_PRIMARY_COLUMNS;
  const expr = clauses.length === 1 ? clauses[0]! : `(${clauses.join(op)})`;
  return `{${columns}} : ${expr}`;
}

/** Body-only MATCH so the JS ranker can tell title hits from article-text hits. */
export function ftsBodyQuery(tokens: readonly string[], fuzzy = false): string | null {
  const clauses = tokens
    .map((token) => ftsTokenClause(token, fuzzy))
    .filter((clause): clause is string => clause != null);
  if (clauses.length === 0) return null;
  const expr = clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`;
  return `{body} : ${expr}`;
}

export async function installBookmarkFts(db: SqlExecutor): Promise<void> {
  await db.$executeRawUnsafe(BOOKMARK_FTS_DDL);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS Bookmark_fts_ai`);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS Bookmark_fts_au`);
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS Bookmark_fts_ad`);
}

export async function backfillBookmarkFts(db: SqlExecutor, bodySql: string): Promise<void> {
  await db.$executeRawUnsafe(`
    INSERT INTO BookmarkFts(rowid, title, url, domain, extra, body)
    SELECT
      b.rowid,
      b.title,
      b.url,
      b.domain,
      trim(coalesce(b.description, '') || ' ' || coalesce(b.author, '')),
      ${bodySql}
    FROM Bookmark b
    WHERE NOT EXISTS (SELECT 1 FROM BookmarkFts f WHERE f.rowid = b.rowid)
  `);
}

export async function createBookmarkFtsTriggers(db: SqlExecutor): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TRIGGER Bookmark_fts_ai AFTER INSERT ON Bookmark BEGIN
      INSERT INTO BookmarkFts(rowid, title, url, domain, extra, body)
      VALUES (
        new.rowid,
        new.title,
        new.url,
        new.domain,
        trim(coalesce(new.description, '') || ' ' || coalesce(new.author, '')),
        coalesce(new.contentHtml, '')
      );
    END
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER Bookmark_fts_au AFTER UPDATE OF
      title, url, domain, description, author, contentHtml ON Bookmark
    BEGIN
      DELETE FROM BookmarkFts WHERE rowid = old.rowid;
      INSERT INTO BookmarkFts(rowid, title, url, domain, extra, body)
      VALUES (
        new.rowid,
        new.title,
        new.url,
        new.domain,
        trim(coalesce(new.description, '') || ' ' || coalesce(new.author, '')),
        coalesce(new.contentHtml, '')
      );
    END
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER Bookmark_fts_ad AFTER DELETE ON Bookmark BEGIN
      DELETE FROM BookmarkFts WHERE rowid = old.rowid;
    END
  `);
}

export async function findFtsBookmarkIds(
  db: SqlExecutor,
  args: { userId: string; match: string; limit: number },
): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT b.id AS id
      FROM BookmarkFts
      INNER JOIN "Bookmark" b ON b.rowid = BookmarkFts.rowid
      WHERE BookmarkFts MATCH ${args.match}
        AND b."userId" = ${args.userId}
      LIMIT ${args.limit}
    `,
  );
  return rows.map((row) => row.id);
}

function ftsTokenClause(token: string, fuzzy: boolean): string | null {
  const parts = ftsTerms(token);
  if (parts.length === 0) return null;
  const primary = joinAnd(parts.map(ftsPrefix));
  if (!fuzzy || token.length < MIN_FUZZY_TOKEN_LENGTH) return primary;
  const stem = searchSqlToken(token).slice(0, -1);
  const stemParts = ftsTerms(stem);
  if (stemParts.length === 0 || stemParts.join("\0") === parts.join("\0")) return primary;
  return `(${unwrap(primary)} OR ${unwrap(joinAnd(stemParts.map(ftsPrefix)))})`;
}

function ftsTerms(token: string): string[] {
  return token
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0);
}

function ftsPrefix(term: string): string {
  return `${term}*`;
}

function joinAnd(parts: string[]): string {
  return parts.length === 1 ? parts[0]! : `(${parts.join(" AND ")})`;
}

function unwrap(clause: string): string {
  return clause.startsWith("(") && clause.endsWith(")") ? clause.slice(1, -1) : clause;
}
