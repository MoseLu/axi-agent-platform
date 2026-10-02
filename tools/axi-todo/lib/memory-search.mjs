// Canonical text-search fields for the planning-memory surface.
//
// M3 motivation: the JSON and PG `searchPlanningMemory` implementations used
// different algorithms — JSON did `JSON.stringify(record).includes(needle)`
// (which matched UUIDs and serialised jsonb blobs), while PG did `LIKE` against
// a narrow hand-picked column list per collection. They returned different
// rows on identical queries. This module is the single source of truth that
// both stores consume.
//
// `MEMORY_SEARCH_FIELDS` mirrors the four planning-memory collections declared
// in `migrations/001_task_memory.sql`. Each entry lists the PG column names
// (snake_case, schema-of-truth) and the JSON object keys (camelCase, derived
// by the existing schema normalisation). A field only enters this list when
// its column has a usable full-text surface (typically a `text` column).
// jsonb columns are deliberately excluded — they hold structured data
// (arrays / objects) and don't round-trip through `LIKE lower(...)` usefully.

export const MEMORY_SEARCH_FIELDS = Object.freeze({
  planning_records: Object.freeze({
    pgColumns: Object.freeze([
      "planning_summary",
      "split_rationale",
      "granularity_assessment",
      "model_rationale",
    ]),
    jsonFields: Object.freeze([
      "planningSummary",
      "splitRationale",
      "granularityAssessment",
      "modelRationale",
    ]),
  }),
  failure_analyses: Object.freeze({
    pgColumns: Object.freeze([
      "root_cause",
      "trigger",
      "failure_stage",
      "recovery_action",
      "avoid_next_time",
    ]),
    jsonFields: Object.freeze([
      "rootCause",
      "trigger",
      "failureStage",
      "recoveryAction",
      "avoidNextTime",
    ]),
  }),
  completion_summaries: Object.freeze({
    pgColumns: Object.freeze(["summary", "next_time_notes"]),
    jsonFields: Object.freeze(["summary", "nextTimeNotes"]),
  }),
  memory_cards: Object.freeze({
    pgColumns: Object.freeze(["title", "content"]),
    jsonFields: Object.freeze(["title", "content"]),
  }),
});

// JSON-side filter: returns true if any of the whitelisted text fields on the
// record contain `needle` (case-insensitive substring match). Used by
// `lib/store.mjs` `searchPlanningMemory` so the JSON store never matches
// against UUIDs / serialised jsonb (the leak the M2 algorithm had).
export function searchCollectionText(record, source, needle) {
  const fields = MEMORY_SEARCH_FIELDS[source]?.jsonFields;
  if (!fields) return false;
  if (!needle) return true; // empty needle = match all, mirrors old behaviour
  const lowered = String(needle).toLowerCase();
  for (const field of fields) {
    const value = record?.[field];
    if (value == null) continue;
    if (String(value).toLowerCase().includes(lowered)) return true;
  }
  return false;
}

// PG-side SQL builder. Returns:
//   { sql, params }
// where `sql` is the UNION ALL of four `to_jsonb(<table>.*)` selects filtered
// by `lower(coalesce(<col1>, '') || ' ' || coalesce(<col2>, '') || ...) like $1`,
// ordered then truncated by `limit $2`. `params` is `[like, limit]` — the
// caller is expected to pass `[needlePattern, limitNumber]`.
//
// `needlePattern` should already be wrapped in `%` (callers typically build it
// as `%${needle.toLowerCase()}%`). We don't wrap here so the helper stays
// composable with callers that want exact match or prefix match.
export function buildPlanningMemoryLikeExpression({ needlePattern, limit = 20 } = {}) {
  if (typeof needlePattern !== "string") {
    throw new Error("buildPlanningMemoryLikeExpression: needlePattern must be a string");
  }
  const sources = Object.keys(MEMORY_SEARCH_FIELDS);
  const parts = sources.map((source, index) => {
    const cols = MEMORY_SEARCH_FIELDS[source].pgColumns;
    const concat = cols
      .map((col) => `coalesce(${col}, '')`)
      .join(" || ' ' || ");
    return (
      `select '${source}' as source, to_jsonb(${source}.*) as payload ` +
      `from ${source} where lower(${concat}) like $1`
    );
  });
  // LIMIT applies after the union — Postgres allows `... UNION ALL ... LIMIT N`
  // as a final clause. We bind $2 to `limit`.
  return {
    sql: `${parts.join(" union all ")} limit $2`,
    params: [needlePattern, limit],
  };
}
