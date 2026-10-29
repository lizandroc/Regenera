-- D1 database "regenera-inquiries" (already created). Run with:
--   npx wrangler d1 execute regenera-inquiries --remote --file cloudflare/schema.sql
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  engage TEXT NOT NULL,
  name TEXT NOT NULL,
  org TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  email_sent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  responded_at TEXT NOT NULL DEFAULT '',
  responded_by TEXT NOT NULL DEFAULT '',
  responded_via TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);

-- Added after launch (already applied to the live database):
-- ALTER TABLE inquiries ADD COLUMN responded_at TEXT NOT NULL DEFAULT '';
-- ALTER TABLE inquiries ADD COLUMN responded_by TEXT NOT NULL DEFAULT '';
-- ALTER TABLE inquiries ADD COLUMN responded_via TEXT NOT NULL DEFAULT '';
