ALTER TABLE tasks ALTER COLUMN due_at DROP NOT NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_domain text NOT NULL DEFAULT 'agent';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'open';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'queued';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_state text NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date date;

UPDATE tasks
SET body = payload->>'body',
    task_domain = COALESCE(NULLIF(payload->>'taskDomain', ''), 'agent'),
    lifecycle_status = COALESCE(NULLIF(payload->>'lifecycleStatus', ''), CASE WHEN status = 'completed' THEN 'completed' WHEN status = 'cancelled' THEN 'cancelled' ELSE 'open' END),
    execution_status = COALESCE(NULLIF(payload->>'executionStatus', ''), CASE WHEN status = 'completed' THEN 'succeeded' WHEN status = 'running' THEN 'running' WHEN status = 'failed' THEN 'failed' WHEN status = 'blocked' THEN 'blocked' WHEN status = 'cancelled' THEN 'idle' ELSE 'queued' END),
    remind_at = NULLIF(payload->>'remindAt', '')::timestamptz,
    reminder_state = COALESCE(NULLIF(payload->>'reminderState', ''), 'none'),
    due_date = NULLIF(payload->>'dueDate', '')::date
WHERE payload IS NOT NULL;

UPDATE tasks
SET execution_status = 'idle'
WHERE status = 'cancelled' AND execution_status = 'queued';

-- Keep the JSON compatibility surface in sync for clients that still read
-- payload directly instead of selecting the additive columns.
UPDATE tasks
SET payload = payload || jsonb_strip_nulls(jsonb_build_object(
  'body', body,
  'taskDomain', task_domain,
  'lifecycleStatus', lifecycle_status,
  'executionStatus', execution_status,
  'dueAt', due_at,
  'dueDate', due_date::text,
  'remindAt', remind_at,
  'reminderState', reminder_state,
  'startedAt', started_at,
  'completedAt', completed_at
))
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_domain_lifecycle_idx ON tasks (task_domain, lifecycle_status, updated_at DESC);
