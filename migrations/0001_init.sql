-- InnoBeweegLab Evidence Engine — D1 schema
-- Mirrors the pipeline: ingestion -> standardized model -> analysis -> evidence
-- -> triangulation -> grounded generation -> draft report -> validation.

DROP TABLE IF EXISTS report_sections;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS triangulations;
DROP TABLE IF EXISTS findings;
DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS projects;

CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  municipality      TEXT,
  neighbourhood     TEXT,
  research_question TEXT,
  period            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Stage 1: data ingestion. One row per uploaded / pasted source.
CREATE TABLE sources (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,              -- dataset | survey | interview | expert
  perspective  TEXT NOT NULL,              -- quantitative | resident | expert
  format       TEXT NOT NULL,              -- csv | xlsx | docx | text
  collected_at TEXT,
  notes        TEXT,
  raw_text     TEXT,                       -- text sources: transcripts, assessments
  columns_json TEXT,                       -- tabular sources: column descriptors
  rows_json    TEXT,                       -- tabular sources: row values
  row_count    INTEGER NOT NULL DEFAULT 0,
  standardized INTEGER NOT NULL DEFAULT 0, -- 1 once mapped into the research model
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_sources_project ON sources(project_id);

-- Stage 2: the standardized research model. Every source collapses to observations.
CREATE TABLE observations (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  perspective   TEXT NOT NULL,   -- quantitative | resident | expert
  modality      TEXT NOT NULL,   -- measure | statement | assessment
  dimension     TEXT,            -- active-friendly design dimension
  variable      TEXT,            -- column name / question / topic
  location      TEXT,
  respondent    TEXT,
  value_num     REAL,
  value_text    TEXT,
  unit          TEXT,
  scale_min     REAL,
  scale_max     REAL,
  locator       TEXT NOT NULL,   -- "row:12" | "char:840-1024" — provenance inside the source
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_obs_project ON observations(project_id);
CREATE INDEX idx_obs_source ON observations(source_id);
CREATE INDEX idx_obs_dimension ON observations(project_id, dimension);

-- Stages 3+4: analysis output lands in the evidence / finding store.
CREATE TABLE findings (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  perspective    TEXT NOT NULL,   -- quantitative | resident | expert
  dimension      TEXT NOT NULL,
  claim_type     TEXT NOT NULL,   -- observation | finding
  statement      TEXT NOT NULL,
  detail         TEXT,
  direction      TEXT NOT NULL,   -- positive | negative | mixed | neutral
  strength       REAL NOT NULL,   -- 0..1 evidential strength
  support_n      INTEGER NOT NULL DEFAULT 0,
  method         TEXT NOT NULL,   -- descriptive-stats | thematic-coding | expert-scoring
  evidence_json  TEXT NOT NULL,   -- [{observation_id, source_id, locator, excerpt}]
  status         TEXT NOT NULL DEFAULT 'open', -- open | accepted | rejected
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_find_project ON findings(project_id);
CREATE INDEX idx_find_dimension ON findings(project_id, dimension);

-- Stage 5: cross-source triangulation.
CREATE TABLE triangulations (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dimension         TEXT NOT NULL,
  title             TEXT NOT NULL,
  convergence       TEXT NOT NULL,   -- converging | diverging | single-source | gap
  summary           TEXT NOT NULL,
  perspectives_json TEXT NOT NULL,   -- ["resident","expert"]
  finding_ids_json  TEXT NOT NULL,
  confidence        REAL NOT NULL,   -- 0..1
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_tri_project ON triangulations(project_id);

-- Stages 6+7: grounded generation produces a draft report with source references.
CREATE TABLE reports (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  template   TEXT NOT NULL DEFAULT 'ibl-standard',
  engine     TEXT NOT NULL,   -- claude:<model> | heuristic
  status     TEXT NOT NULL DEFAULT 'draft', -- draft | in-review | approved
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reports_project ON reports(project_id);

CREATE TABLE report_sections (
  id             TEXT PRIMARY KEY,
  report_id      TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL,
  section_key    TEXT NOT NULL,
  title          TEXT NOT NULL,
  position       INTEGER NOT NULL,
  body_md        TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  -- Stage 8: researcher validation
  status         TEXT NOT NULL DEFAULT 'draft', -- draft | approved | revised | rejected
  reviewer_note  TEXT,
  edited_by      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_sections_report ON report_sections(report_id, position);

-- Audit trail: every stage execution is recorded so a researcher can see
-- what ran, with which engine, over how much evidence.
CREATE TABLE runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  engine      TEXT NOT NULL,
  status      TEXT NOT NULL,   -- ok | error
  message     TEXT,
  detail_json TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_runs_project ON runs(project_id, created_at DESC);
