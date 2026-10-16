// Versioned SQLite schema. Migrations are append-only: never edit a released
// step, add a new one. Each step runs inside one transaction together with the
// bump of PRAGMA user_version.

export interface SchemaMigration {
  version: number
  name: string
  sql: string
}

const INITIAL = /* sql */ `
-- ---------------------------------------------------------------- technical
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- Global data revision, incremented by every committed write.
CREATE TABLE data_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);
INSERT INTO data_revision (id, revision) VALUES (1, 0);

-- One-shot imports (legacy JSON, renderer preferences, builtin packages).
CREATE TABLE import_markers (
  kind TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  source_fingerprint TEXT,
  report_id TEXT
);

CREATE TABLE migration_reports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  created_at TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  report_json TEXT NOT NULL
);

-- References whose target did not exist at import time or disappeared since.
-- The original value is kept; no fake business object is created.
CREATE TABLE unresolved_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_scope TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  original_json TEXT,
  reason TEXT NOT NULL,
  report_id TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX unresolved_refs_source ON unresolved_refs (source_kind, source_id);
CREATE INDEX unresolved_refs_target ON unresolved_refs (target_kind, target_id);

-- Values that could not be converted (invalid week slots, malformed entries).
CREATE TABLE legacy_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  location TEXT NOT NULL,
  reason TEXT NOT NULL,
  value_json TEXT NOT NULL
);

-- Idempotency of creations: replaying the same operation id returns the
-- first result instead of creating a second object.
CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Local diagnostics (codes, identities, versions, steps). No personal content.
CREATE TABLE diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  scope TEXT NOT NULL,
  code TEXT NOT NULL,
  package_id TEXT,
  version TEXT,
  step TEXT,
  message TEXT NOT NULL
);

-- ----------------------------------------------------------- taxonomy
CREATE TABLE categories (
  name TEXT PRIMARY KEY,
  position INTEGER NOT NULL
);

CREATE TABLE platforms (
  project_type TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_type, name)
);

-- ------------------------------------------------------------- folders
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'smart')),
  display_mode TEXT NOT NULL CHECK (display_mode IN ('category', 'group')),
  description TEXT,
  -- NULL: no filter (manual folders); JSON array of tags otherwise.
  tag_filter_json TEXT,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT
);

-- ------------------------------------------------------------ projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  description TEXT,
  path TEXT,
  -- 1 when the legacy object had a "stack" array (possibly empty).
  has_stack INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  -- Unknown legacy fields, re-exposed untouched.
  extra_json TEXT
);

CREATE TABLE project_platforms (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  platform TEXT NOT NULL,
  PRIMARY KEY (project_id, position)
);

CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (project_id, position)
);
CREATE INDEX project_tags_tag ON project_tags (tag);

CREATE TABLE project_stack (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (project_id, position)
);

-- Child identifiers are only unique within their project.
CREATE TABLE tasks (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, parent_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE
);
CREATE INDEX tasks_parent ON tasks (project_id, parent_id, position);

CREATE TABLE checklist_items (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  link TEXT,
  project_ref TEXT REFERENCES projects (id) ON DELETE SET NULL,
  date TEXT,
  description TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE deadlines (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE project_links (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT,
  PRIMARY KEY (project_id, id)
);

-- Blocks placed in a project. The placement identity is (project, block);
-- config_json keeps the raw configuration (titles, table data, chart values as
-- typed text). An unknown contribution stays stored and is shown unavailable.
CREATE TABLE project_blocks (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  package_id TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, block_id)
);
CREATE INDEX project_blocks_contribution ON project_blocks (package_id, contribution_id);

-- --------------------------------------------------------------- notes
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  -- NULL keeps "raw" absent, 0/1 when explicitly set.
  raw INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT
);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, position)
);

CREATE TABLE project_notes (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, note_id)
);
CREATE INDEX project_notes_note ON project_notes (note_id);

-- Deleted notes. The note leaves "notes"; its content and the former links
-- and blocks are kept for restoration. A link to a vanished project stays
-- describable (project_id is a soft reference with a name snapshot).
CREATE TABLE trashed_notes (
  note_id TEXT PRIMARY KEY,
  note_json TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE trashed_note_links (
  note_id TEXT NOT NULL REFERENCES trashed_notes (note_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT,
  modules_json TEXT NOT NULL,
  PRIMARY KEY (note_id, position)
);

-- -------------------------------------------------------------- errors
CREATE TABLE errors (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  causes TEXT NOT NULL,
  solution TEXT NOT NULL,
  created_at TEXT NOT NULL,
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  extra_json TEXT
);

-- Errors pinned in a project (project side, ordered).
CREATE TABLE project_errors (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  error_id TEXT NOT NULL REFERENCES errors (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, error_id)
);
CREATE INDEX project_errors_error ON project_errors (error_id);

-- Projects affected by an error (error side, ordered). Kept distinct from
-- project_errors: unpinning from a project leaves this history untouched.
CREATE TABLE error_projects (
  error_id TEXT NOT NULL REFERENCES errors (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (error_id, project_id)
);

-- ----------------------------------------------- packages and extensions
CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('package', 'extension')),
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  active_version TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'disabled', 'suspended', 'uninstalled')),
  state_reason TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('bundled', 'archive', 'folder')),
  storage_version INTEGER NOT NULL,
  granted_permissions_json TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE package_versions (
  package_id TEXT NOT NULL REFERENCES packages (id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  -- Directory name under the managed packages directory.
  files_dir TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'ready', 'active', 'retired', 'failed')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);

CREATE TABLE package_dependencies (
  package_id TEXT NOT NULL REFERENCES packages (id) ON DELETE CASCADE,
  dependency_id TEXT NOT NULL,
  version_range TEXT NOT NULL,
  PRIMARY KEY (package_id, dependency_id)
);

-- Persistent install journal: lets a crashed install/update be resumed or
-- cleaned on the next start.
CREATE TABLE install_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  version TEXT,
  action TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'done', 'failed', 'rolled-back')),
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX install_journal_operation ON install_journal (operation_id);

-- Linked source folder (v1: a single folder).
CREATE TABLE package_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('folder')),
  path TEXT NOT NULL,
  added_at TEXT NOT NULL
);

-- Active theme per target package (one at most).
CREATE TABLE theme_selection (
  target_package_id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL REFERENCES packages (id) ON DELETE CASCADE
);

-- ---------------------------------------- third-party instances and storage
-- Not tied to "packages" by a foreign key: data survives uninstallation and is
-- imported before the builtin package itself is installed.
CREATE TABLE major_instances (
  package_id TEXT NOT NULL,
  major_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (package_id, major_id, instance_id)
);

CREATE TABLE active_instances (
  package_id TEXT NOT NULL,
  major_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  PRIMARY KEY (package_id, major_id),
  FOREIGN KEY (package_id, major_id, instance_id) REFERENCES major_instances (package_id, major_id, instance_id) ON DELETE CASCADE
);

-- Private JSON documents of a package: package / scope / collection / id.
-- instance_scope is '' for package-wide documents.
CREATE TABLE package_documents (
  package_id TEXT NOT NULL,
  instance_scope TEXT NOT NULL DEFAULT '',
  collection TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, instance_scope, collection, doc_id)
);

-- --------------------------------------------------------- composition
CREATE TABLE dashboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX dashboards_single_default ON dashboards (is_default) WHERE is_default = 1;

CREATE TABLE dashboard_widgets (
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  package_id TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  layouts_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (dashboard_id, placement_id)
);

CREATE TABLE sidebar_entries (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  target_json TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  position INTEGER NOT NULL,
  default_key TEXT UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1
);

-- --------------------------------------------------------- preferences
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
`

export const SCHEMA_MIGRATIONS: SchemaMigration[] = [{ version: 1, name: 'initial', sql: INITIAL }]

export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1].version
