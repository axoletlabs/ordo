"""Exercise the real migration chain and indexed list order using SQLite."""
import sqlite3
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "prisma" / "migrations"


class BookmarkQueryPlans(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for migration in sorted(MIGRATIONS.glob("*/migration.sql")):
            self.db.executescript(migration.read_text())

    def tearDown(self):
        self.db.close()

    def test_folder_and_global_date_orders_never_need_temporary_sorting(self):
        for scope in ['"userId" = ? AND "folderId" IS NULL', '"userId" = ?']:
            for direction in ["ASC", "DESC"]:
                sql = f'SELECT "id", "title" FROM "Bookmark" WHERE {scope} ORDER BY "createdAt" {direction}, "id" {direction} LIMIT 101'
                plan = self.db.execute("EXPLAIN QUERY PLAN " + sql, ["owner"]).fetchall()
                self.assertFalse(any("TEMP B-TREE" in row[3] for row in plan), plan)
                self.assertTrue(any("USING INDEX" in row[3] for row in plan), plan)

    def test_folder_title_order_uses_covering_index_in_both_directions(self):
        for direction in ["ASC", "DESC"]:
            sql = f'SELECT "id", "title" FROM "Bookmark" WHERE "userId" = ? AND "folderId" = ? ORDER BY "title" {direction}, "id" {direction} LIMIT 101'
            plan = self.db.execute("EXPLAIN QUERY PLAN " + sql, ["owner", "folder"]).fetchall()
            self.assertTrue(any("COVERING INDEX Bookmark_userId_folderId_title_id_idx" in row[3] for row in plan), plan)
            self.assertFalse(any("TEMP B-TREE" in row[3] for row in plan), plan)

    def test_sort_migration_is_additive_and_repeatable(self):
        indexes = list(self.db.execute("PRAGMA index_list('Bookmark')"))
        self.assertNotIn("Bookmark_userId_folderId_createdAt_idx", [row[1] for row in indexes])
        self.db.executescript((MIGRATIONS / "20261017120000_bookmark_sort_indexes" / "migration.sql").read_text())
        self.assertEqual(indexes, list(self.db.execute("PRAGMA index_list('Bookmark')")))
        self.assertEqual([], self.db.execute("PRAGMA foreign_key_check").fetchall())


if __name__ == "__main__":
    unittest.main()
