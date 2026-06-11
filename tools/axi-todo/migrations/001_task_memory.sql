CREATE TABLE IF NOT EXISTS task_charters (
  id text PRIMARY KEY,
  goal text NOT NULL,
  scope text,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  charter_id text REFERENCES task_charters(id),
  title text NOT NULL,
  prompt text NOT NULL,
  cwd text NOT NULL,
  status text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  due_at timestamptz NOT NULL DEFAULT now(),
  verify_command text,
  expected_result text,
  acceptance_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_level text NOT NULL DEFAULT 'none',
  risk_level text NOT NULL DEFAULT 'medium',
  task_kind text NOT NULL DEFAULT 'task',
  parent_id text,
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_granularity text,
  model_selection_reason text,
  rejected_approaches jsonb NOT NULL DEFAULT '[]'::jsonb,
  wait_state jsonb,
  checkpoint text,
  heartbeat_at timestamptz,
  run_manifest_path text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS planning_records (
  id text PRIMARY KEY,
  charter_id text REFERENCES task_charters(id),
  task_id text REFERENCES tasks(id),
  planning_summary text NOT NULL,
  split_rationale text,
  granularity_assessment text,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_locks jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_rationale text,
  rejected_approaches jsonb NOT NULL DEFAULT '[]'::jsonb,
  historical_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_runs (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  task_id text NOT NULL REFERENCES tasks(id),
  status text NOT NULL,
  model text,
  cwd text,
  quota jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_ms bigint,
  exit_code integer,
  output_path text,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_events (
  id text PRIMARY KEY,
  task_id text REFERENCES tasks(id),
  run_id text,
  event_type text NOT NULL,
  actor text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id text PRIMARY KEY,
  task_id text REFERENCES tasks(id),
  run_id text,
  artifact_type text NOT NULL,
  uri text NOT NULL,
  content_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS failure_analyses (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  run_id text,
  root_cause text NOT NULL,
  trigger text,
  failure_stage text,
  recovery_action text,
  avoid_next_time text,
  retryable boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_reviews (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  run_id text,
  audit_level text NOT NULL,
  verdict text NOT NULL,
  reason text,
  evidence_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  release_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id text PRIMARY KEY,
  task_id text REFERENCES tasks(id),
  preference text NOT NULL,
  source text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.8,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completion_summaries (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  run_id text,
  status text NOT NULL,
  summary text NOT NULL,
  duration_ms bigint,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_verdict text,
  next_time_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_cards (
  id text PRIMARY KEY,
  task_id text REFERENCES tasks(id),
  run_id text,
  type text NOT NULL,
  title text,
  content text NOT NULL,
  concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_status text NOT NULL DEFAULT 'pending',
  synced_at timestamptz,
  sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_status_due_priority_idx ON tasks (status, due_at, priority DESC);
CREATE INDEX IF NOT EXISTS tasks_charter_id_idx ON tasks (charter_id);
CREATE INDEX IF NOT EXISTS task_events_task_created_idx ON task_events (task_id, created_at);
CREATE INDEX IF NOT EXISTS planning_records_charter_created_idx ON planning_records (charter_id, created_at);
CREATE INDEX IF NOT EXISTS failure_analyses_task_created_idx ON failure_analyses (task_id, created_at);
CREATE INDEX IF NOT EXISTS audit_reviews_task_created_idx ON audit_reviews (task_id, created_at);
CREATE INDEX IF NOT EXISTS completion_summaries_task_created_idx ON completion_summaries (task_id, created_at);
CREATE INDEX IF NOT EXISTS memory_cards_type_status_idx ON memory_cards (type, sync_status);
