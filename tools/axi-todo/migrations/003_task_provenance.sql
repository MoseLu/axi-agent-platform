-- M4: mirror the M2 JSON-side provenance extension onto the PG `tasks` table.
-- M2 added `source` + `importedAt` to JSON tasks and `bin/axi-todo-import-postgres.mjs`
-- writes `source: "import-postgres"` + an ISO timestamp for every imported row.
-- Until now the PG `tasks` table had no matching columns, so the provenance was
-- trapped inside the `payload` jsonb blob — not queryable, not indexable. This
-- migration adds the columns and backfills from `payload`, then reverse-syncs
-- the new columns into `payload` so JSON-side readers continue to see the same
-- fields without further code changes.
--
-- Idempotency: every ALTER is `ADD COLUMN IF NOT EXISTS`, every UPDATE uses
-- `COALESCE(NULLIF(...), default)` so re-running this script is a no-op once
-- the columns exist and the backfill has been applied.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS imported_at timestamptz;

-- Backfill from the `payload` jsonb column. Empty / missing payload fields
-- fall back to the column defaults above; the `payload->>'...'` extraction
-- uses NULLIF to treat empty strings as missing.
UPDATE tasks
SET source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
    imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
WHERE payload IS NOT NULL;

-- Keep the JSON compatibility surface in sync. Clients that still read
-- `payload` directly (e.g. the Swift desktop bridge, which reads JSON and
-- sees the imported task via the JSON side) continue to see `source` /
-- `importedAt` keys without code changes here.
UPDATE tasks
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'source', source,
  'importedAt', imported_at::text
))
WHERE payload IS NOT NULL;

-- Reconciler / future consumer queries on provenance need an index. The
-- cardinality of `source` is small (a handful of values), but reconciler
-- jobs that scan `WHERE source = 'import-postgres'` benefit from this.
CREATE INDEX IF NOT EXISTS tasks_source_idx ON tasks (source);
