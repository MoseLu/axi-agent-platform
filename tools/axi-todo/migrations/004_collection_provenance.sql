-- M6: extend the M4 provenance mirror pattern (`source` + `imported_at`) to the
-- four auxiliary collections the canonical axi-todo ledger carries alongside
-- `tasks`: `completion_summaries`, `failure_analyses`, `planning_records`, and
-- `memory_cards`. M2 only added JSON-side `source` / `importedAt` to the tasks
-- shape, and M4 mirrored that onto PG only for the `tasks` table. The other
-- collections also carry JSON-side provenance (the Swift bridge sees
-- `source` / `importedAt` through the per-record fields) but had no queryable,
-- indexable PG column. This migration closes that gap.
--
-- Pattern (mirrors 003_task_provenance.sql exactly):
--   1. ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native'
--   2. ADD COLUMN IF NOT EXISTS imported_at timestamptz
--   3. Backfill from existing payload jsonb (COALESCE + NULLIF for empty strings)
--   4. Reverse-sync into payload so JSON-side readers still see provenance keys
--   5. CREATE INDEX IF NOT EXISTS <table>_source_idx ON <table> (source)
--
-- All 5 ops repeat for every table, giving 20 statements total (4 × 5). The
-- script is idempotent: every ALTER uses IF NOT EXISTS, every UPDATE uses
-- COALESCE / NULLIF so a re-run is a safe no-op once the columns exist.
--
-- Sticky semantics: like `tasks`, `source` / `imported_at` are written on the
-- first INSERT and DELIBERATELY omitted from the ON CONFLICT DO UPDATE SET in
-- lib/postgres-store.mjs. Re-upserts preserve the original import timestamp —
-- this matters for the importer workflow, where the first INSERT carries
-- `source = 'import-postgres'` and any later daemon-driven re-upsert must not
-- flip the row back to "native".

ALTER TABLE completion_summaries ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE completion_summaries ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE completion_summaries
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

UPDATE completion_summaries
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS completion_summaries_source_idx ON completion_summaries (source);


ALTER TABLE failure_analyses ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE failure_analyses ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE failure_analyses
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

UPDATE failure_analyses
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS failure_analyses_source_idx ON failure_analyses (source);


ALTER TABLE planning_records ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE planning_records ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE planning_records
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

UPDATE planning_records
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS planning_records_source_idx ON planning_records (source);


ALTER TABLE memory_cards ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE memory_cards ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE memory_cards
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

UPDATE memory_cards
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_cards_source_idx ON memory_cards (source);