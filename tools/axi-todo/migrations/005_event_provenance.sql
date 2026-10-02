-- M7: extend the M4 / M6 sticky source/imported_at provenance mirror onto the
-- two PG tables that carry the runtime audit + history trail:
--   - `audit_reviews` (one row per audit pass / fail / pending decision)
--   - `task_events` (one row per state-transition event: claimed, completed,
--     audit_waiting, failure, retry_scheduled, …)
--
-- M6 only mirrored provenance onto the four collection tables
-- (`completion_summaries`, `failure_analyses`, `planning_records`,
-- `memory_cards`). M7 closes the same gap for the event trail: without these
-- columns a future reconciler cannot tell a natively-created `audit_reviews`
-- row from one brought in by `bin/axi-todo-import-postgres.mjs`, and the
-- Swift bridge's `source` / `importedAt` keys would only show up if the
-- caller had manually written them into the `payload` jsonb blob.
--
-- Pattern (mirrors 003_task_provenance.sql and 004_collection_provenance.sql
-- exactly):
--   1. ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native'
--   2. ADD COLUMN IF NOT EXISTS imported_at timestamptz
--   3. Backfill from existing payload jsonb (COALESCE + NULLIF for empty strings)
--   4. Reverse-sync into payload so JSON-side readers still see provenance keys
--   5. CREATE INDEX IF NOT EXISTS <table>_source_idx ON <table> (source)
--
-- All 5 ops repeat for every table, giving 10 statements total (2 × 5). The
-- script is idempotent: every ALTER uses IF NOT EXISTS, every UPDATE uses
-- COALESCE / NULLIF so a re-run is a safe no-op once the columns exist.
--
-- Sticky semantics: like `tasks` (M4) and the four collection tables (M6),
-- `source` / `imported_at` are written on the first INSERT and DELIBERATELY
-- omitted from the ON CONFLICT DO UPDATE SET in `lib/postgres-store.mjs`.
-- Re-upserts preserve the original import timestamp — this matters for the
-- importer workflow, where the first INSERT carries `source = 'import-postgres'`
-- and any later daemon-driven re-upsert must not flip the row back to
-- "native". Both `recordTaskEvent` and `recordAuditReview` add the same
-- ON CONFLICT clause + payload reverse-sync on their INSERTs.

ALTER TABLE audit_reviews ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE audit_reviews ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE audit_reviews
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

UPDATE audit_reviews
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_reviews_source_idx ON audit_reviews (source);


ALTER TABLE task_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE task_events
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

UPDATE task_events
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS task_events_source_idx ON task_events (source);