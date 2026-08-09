/**
 * The DDL exactly as it shipped in the first public release (2c3f8ba,
 * 2026-07-25). Frozen on purpose: it is the oldest database shape a real
 * user can still be carrying, and the migration path has to carry it forward.
 * Never edit this to match a newer schema — that would make the test that
 * uses it agree with whatever the code does, which is the opposite of the job.
 */
export const RELEASE_DDL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0, target_role TEXT, file_path TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY, job_info TEXT NOT NULL, status TEXT NOT NULL,
  jd_text TEXT, notes TEXT, applied_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, status TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0, application_info TEXT, resume_id TEXT,
  cover_letter_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jd_analyses (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, doc TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fit_analyses (
  id TEXT PRIMARY KEY, application_id TEXT NOT NULL, doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, doc TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fill_handoffs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, application_id TEXT NOT NULL,
  apply_link TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_application ON agent_tasks(application_id);
CREATE INDEX IF NOT EXISTS idx_jd_analyses_application ON jd_analyses(application_id);
CREATE INDEX IF NOT EXISTS idx_fit_analyses_application ON fit_analyses(application_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_fill_handoffs_task ON fill_handoffs(task_id);
`;
