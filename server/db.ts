import type {
  ColumnSpec, Dimension, Direction, EvidenceRef, Finding, Observation,
  Perspective, Project, Report, ReportSection, Run, Source, SourceSummary,
  StageId, Triangulation, Citation, Convergence, SectionStatus, FindingStatus,
  SourceFormat, SourceKind,
} from "../shared/types";
import { HttpError, id, now, parseJson } from "./util";

/* ------------------------------------------------------------------ rows -- */

interface SourceRow {
  id: string; project_id: string; name: string; kind: string; perspective: string;
  format: string; collected_at: string | null; notes: string | null;
  raw_text: string | null; columns_json: string | null; rows_json: string | null;
  row_count: number; standardized: number; created_at: string;
}

function toSource(r: SourceRow): Source {
  return {
    id: r.id, project_id: r.project_id, name: r.name,
    kind: r.kind as SourceKind, perspective: r.perspective as Perspective,
    format: r.format as SourceFormat, collected_at: r.collected_at, notes: r.notes,
    raw_text: r.raw_text,
    columns: parseJson<ColumnSpec[] | null>(r.columns_json, null),
    rows: parseJson<(string | number | null)[][] | null>(r.rows_json, null),
    row_count: r.row_count, standardized: r.standardized === 1, created_at: r.created_at,
  };
}

export function toSourceSummary(s: Source): SourceSummary {
  const { raw_text, rows, ...rest } = s;
  void rows;
  return { ...rest, text_length: raw_text?.length ?? 0 };
}

interface FindingRow {
  id: string; project_id: string; perspective: string; dimension: string;
  claim_type: string; statement: string; detail: string | null; direction: string;
  strength: number; support_n: number; method: string; evidence_json: string;
  status: string; created_at: string;
}

function toFinding(r: FindingRow): Finding {
  return {
    id: r.id, project_id: r.project_id, perspective: r.perspective as Perspective,
    dimension: r.dimension as Dimension,
    claim_type: r.claim_type as "observation" | "finding",
    statement: r.statement, detail: r.detail, direction: r.direction as Direction,
    strength: r.strength, support_n: r.support_n, method: r.method,
    evidence: parseJson<EvidenceRef[]>(r.evidence_json, []),
    status: r.status as FindingStatus, created_at: r.created_at,
  };
}

/* --------------------------------------------------------------- projects -- */

export async function listProjects(db: D1Database): Promise<Project[]> {
  const { results } = await db
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all<Project>();
  return results;
}

export async function getProject(db: D1Database, projectId: string): Promise<Project> {
  const row = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<Project>();
  if (!row) throw new HttpError(404, `Project ${projectId} not found`);
  return row;
}

export async function createProject(
  db: D1Database,
  input: Partial<Project> & { name: string },
): Promise<Project> {
  const ts = now();
  const project: Project = {
    id: id("prj"),
    name: input.name,
    municipality: input.municipality ?? null,
    neighbourhood: input.neighbourhood ?? null,
    research_question: input.research_question ?? null,
    period: input.period ?? null,
    created_at: ts,
    updated_at: ts,
  };
  await db
    .prepare(
      `INSERT INTO projects (id, name, municipality, neighbourhood, research_question, period, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(project.id, project.name, project.municipality, project.neighbourhood,
      project.research_question, project.period, ts, ts)
    .run();
  return project;
}

export async function updateProject(
  db: D1Database,
  projectId: string,
  patch: Partial<Project>,
): Promise<Project> {
  const current = await getProject(db, projectId);
  const next = { ...current, ...patch, id: current.id, updated_at: now() };
  await db
    .prepare(
      `UPDATE projects SET name = ?, municipality = ?, neighbourhood = ?,
       research_question = ?, period = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(next.name, next.municipality, next.neighbourhood, next.research_question,
      next.period, next.updated_at, projectId)
    .run();
  return next;
}

export async function touchProject(db: D1Database, projectId: string): Promise<void> {
  await db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
    .bind(now(), projectId).run();
}

export async function deleteProject(db: D1Database, projectId: string): Promise<void> {
  // D1 does not enforce ON DELETE CASCADE unless foreign_keys pragma is on, so
  // clear children explicitly.
  for (const t of ["report_sections", "reports", "triangulations", "findings",
    "observations", "sources", "runs"]) {
    await db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).bind(projectId).run();
  }
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId).run();
}

/* ---------------------------------------------------------------- sources -- */

export async function listSources(db: D1Database, projectId: string): Promise<Source[]> {
  const { results } = await db
    .prepare("SELECT * FROM sources WHERE project_id = ? ORDER BY created_at")
    .bind(projectId)
    .all<SourceRow>();
  return results.map(toSource);
}

export async function getSource(db: D1Database, sourceId: string): Promise<Source> {
  const row = await db.prepare("SELECT * FROM sources WHERE id = ?")
    .bind(sourceId).first<SourceRow>();
  if (!row) throw new HttpError(404, `Source ${sourceId} not found`);
  return toSource(row);
}

export async function insertSource(
  db: D1Database,
  projectId: string,
  s: Omit<Source, "id" | "project_id" | "created_at" | "standardized" | "row_count">,
): Promise<Source> {
  const ts = now();
  const sourceId = id("src");
  const rowCount = s.rows?.length ?? 0;
  await db
    .prepare(
      `INSERT INTO sources (id, project_id, name, kind, perspective, format, collected_at,
        notes, raw_text, columns_json, rows_json, row_count, standardized, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(sourceId, projectId, s.name, s.kind, s.perspective, s.format,
      s.collected_at ?? null, s.notes ?? null, s.raw_text ?? null,
      s.columns ? JSON.stringify(s.columns) : null,
      s.rows ? JSON.stringify(s.rows) : null, rowCount, ts)
    .run();
  await touchProject(db, projectId);
  return { ...s, id: sourceId, project_id: projectId, row_count: rowCount, standardized: false, created_at: ts };
}

export async function updateSourceColumns(
  db: D1Database, sourceId: string, columns: ColumnSpec[],
): Promise<void> {
  await db.prepare("UPDATE sources SET columns_json = ? WHERE id = ?")
    .bind(JSON.stringify(columns), sourceId).run();
}

export async function markSourcesStandardized(
  db: D1Database, projectId: string, sourceIds: string[],
): Promise<void> {
  for (const sid of sourceIds) {
    await db.prepare("UPDATE sources SET standardized = 1 WHERE id = ? AND project_id = ?")
      .bind(sid, projectId).run();
  }
}

export async function deleteSource(db: D1Database, projectId: string, sourceId: string): Promise<void> {
  await db.prepare("DELETE FROM observations WHERE source_id = ?").bind(sourceId).run();
  await db.prepare("DELETE FROM sources WHERE id = ? AND project_id = ?")
    .bind(sourceId, projectId).run();
  await touchProject(db, projectId);
}

/* ----------------------------------------------------------- observations -- */

export async function listObservations(
  db: D1Database, projectId: string, opts: { perspective?: Perspective; limit?: number } = {},
): Promise<Observation[]> {
  const clauses = ["project_id = ?"];
  const binds: unknown[] = [projectId];
  if (opts.perspective) { clauses.push("perspective = ?"); binds.push(opts.perspective); }
  let sql = `SELECT * FROM observations WHERE ${clauses.join(" AND ")} ORDER BY created_at, id`;
  if (opts.limit) { sql += " LIMIT ?"; binds.push(opts.limit); }
  const { results } = await db.prepare(sql).bind(...binds).all<Observation & { dimension: string | null }>();
  return results as Observation[];
}

export async function replaceObservations(
  db: D1Database, projectId: string, sourceIds: string[],
  observations: Omit<Observation, "id" | "created_at">[],
): Promise<number> {
  for (const sid of sourceIds) {
    await db.prepare("DELETE FROM observations WHERE source_id = ?").bind(sid).run();
  }
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO observations (id, project_id, source_id, perspective, modality, dimension,
      variable, location, respondent, value_num, value_text, unit, scale_min, scale_max,
      locator, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const batch = observations.map((o) =>
    stmt.bind(id("obs"), projectId, o.source_id, o.perspective, o.modality, o.dimension,
      o.variable, o.location, o.respondent, o.value_num, o.value_text, o.unit,
      o.scale_min, o.scale_max, o.locator, ts));
  // D1 caps a batch; chunk to stay well inside it.
  for (let i = 0; i < batch.length; i += 80) await db.batch(batch.slice(i, i + 80));
  await touchProject(db, projectId);
  return observations.length;
}

/* --------------------------------------------------------------- findings -- */

export async function listFindings(
  db: D1Database, projectId: string, perspective?: Perspective,
): Promise<Finding[]> {
  const sql = perspective
    ? "SELECT * FROM findings WHERE project_id = ? AND perspective = ? ORDER BY dimension, strength DESC"
    : "SELECT * FROM findings WHERE project_id = ? ORDER BY dimension, strength DESC";
  const binds = perspective ? [projectId, perspective] : [projectId];
  const { results } = await db.prepare(sql).bind(...binds).all<FindingRow>();
  return results.map(toFinding);
}

export async function replaceFindings(
  db: D1Database, projectId: string, perspective: Perspective,
  findings: Omit<Finding, "id" | "project_id" | "created_at" | "status">[],
): Promise<Finding[]> {
  await db.prepare("DELETE FROM findings WHERE project_id = ? AND perspective = ?")
    .bind(projectId, perspective).run();
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO findings (id, project_id, perspective, dimension, claim_type, statement,
      detail, direction, strength, support_n, method, evidence_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  );
  const created: Finding[] = [];
  const batch = findings.map((f) => {
    const fid = id("fnd");
    created.push({ ...f, id: fid, project_id: projectId, status: "open", created_at: ts });
    return stmt.bind(fid, projectId, f.perspective, f.dimension, f.claim_type, f.statement,
      f.detail, f.direction, f.strength, f.support_n, f.method,
      JSON.stringify(f.evidence), ts);
  });
  for (let i = 0; i < batch.length; i += 60) await db.batch(batch.slice(i, i + 60));
  await touchProject(db, projectId);
  return created;
}

export async function setFindingStatus(
  db: D1Database, projectId: string, findingId: string, status: FindingStatus,
): Promise<void> {
  await db.prepare("UPDATE findings SET status = ? WHERE id = ? AND project_id = ?")
    .bind(status, findingId, projectId).run();
  await touchProject(db, projectId);
}

/* ---------------------------------------------------------- triangulation -- */

interface TriRow {
  id: string; project_id: string; dimension: string; title: string; convergence: string;
  summary: string; perspectives_json: string; finding_ids_json: string;
  confidence: number; created_at: string;
}

export async function listTriangulations(
  db: D1Database, projectId: string,
): Promise<Triangulation[]> {
  const { results } = await db
    .prepare("SELECT * FROM triangulations WHERE project_id = ? ORDER BY confidence DESC")
    .bind(projectId).all<TriRow>();
  return results.map((r) => ({
    id: r.id, project_id: r.project_id, dimension: r.dimension as Dimension,
    title: r.title, convergence: r.convergence as Convergence, summary: r.summary,
    perspectives: parseJson<Perspective[]>(r.perspectives_json, []),
    finding_ids: parseJson<string[]>(r.finding_ids_json, []),
    confidence: r.confidence, created_at: r.created_at,
  }));
}

export async function replaceTriangulations(
  db: D1Database, projectId: string,
  items: Omit<Triangulation, "id" | "project_id" | "created_at">[],
): Promise<Triangulation[]> {
  await db.prepare("DELETE FROM triangulations WHERE project_id = ?").bind(projectId).run();
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO triangulations (id, project_id, dimension, title, convergence, summary,
      perspectives_json, finding_ids_json, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const created: Triangulation[] = [];
  const batch = items.map((t) => {
    const tid = id("tri");
    created.push({ ...t, id: tid, project_id: projectId, created_at: ts });
    return stmt.bind(tid, projectId, t.dimension, t.title, t.convergence, t.summary,
      JSON.stringify(t.perspectives), JSON.stringify(t.finding_ids), t.confidence, ts);
  });
  for (let i = 0; i < batch.length; i += 60) await db.batch(batch.slice(i, i + 60));
  await touchProject(db, projectId);
  return created;
}

/* ---------------------------------------------------------------- reports -- */

interface SectionRow {
  id: string; report_id: string; project_id: string; section_key: string; title: string;
  position: number; body_md: string; citations_json: string; status: string;
  reviewer_note: string | null; edited_by: string | null;
  created_at: string; updated_at: string;
}

function toSection(r: SectionRow): ReportSection {
  return {
    id: r.id, report_id: r.report_id, project_id: r.project_id,
    section_key: r.section_key, title: r.title, position: r.position,
    body_md: r.body_md, citations: parseJson<Citation[]>(r.citations_json, []),
    status: r.status as SectionStatus, reviewer_note: r.reviewer_note,
    edited_by: r.edited_by, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function getLatestReport(
  db: D1Database, projectId: string,
): Promise<Report | null> {
  const row = await db
    .prepare("SELECT * FROM reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(projectId).first<Omit<Report, "sections">>();
  if (!row) return null;
  const { results } = await db
    .prepare("SELECT * FROM report_sections WHERE report_id = ? ORDER BY position")
    .bind(row.id).all<SectionRow>();
  return { ...row, sections: results.map(toSection) };
}

export async function createReport(
  db: D1Database, projectId: string, title: string, engine: string,
  sections: { section_key: string; title: string; body_md: string; citations: Citation[] }[],
): Promise<Report> {
  await db.prepare("DELETE FROM report_sections WHERE project_id = ?").bind(projectId).run();
  await db.prepare("DELETE FROM reports WHERE project_id = ?").bind(projectId).run();
  const ts = now();
  const reportId = id("rep");
  await db.prepare(
    `INSERT INTO reports (id, project_id, title, template, engine, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ibl-standard', ?, 'draft', ?, ?)`,
  ).bind(reportId, projectId, title, engine, ts, ts).run();

  const stmt = db.prepare(
    `INSERT INTO report_sections (id, report_id, project_id, section_key, title, position,
      body_md, citations_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
  );
  await db.batch(sections.map((s, i) =>
    stmt.bind(id("sec"), reportId, projectId, s.section_key, s.title, i, s.body_md,
      JSON.stringify(s.citations), ts, ts)));
  await touchProject(db, projectId);
  const report = await getLatestReport(db, projectId);
  if (!report) throw new HttpError(500, "Report was written but could not be read back");
  return report;
}

export async function updateSection(
  db: D1Database, projectId: string, sectionId: string,
  patch: { body_md?: string; status?: SectionStatus; reviewer_note?: string | null; edited_by?: string | null },
): Promise<ReportSection> {
  const row = await db
    .prepare("SELECT * FROM report_sections WHERE id = ? AND project_id = ?")
    .bind(sectionId, projectId).first<SectionRow>();
  if (!row) throw new HttpError(404, `Section ${sectionId} not found`);
  const current = toSection(row);
  const next = {
    body_md: patch.body_md ?? current.body_md,
    status: patch.status ?? current.status,
    reviewer_note: patch.reviewer_note !== undefined ? patch.reviewer_note : current.reviewer_note,
    edited_by: patch.edited_by !== undefined ? patch.edited_by : current.edited_by,
    updated_at: now(),
  };
  await db.prepare(
    `UPDATE report_sections SET body_md = ?, status = ?, reviewer_note = ?, edited_by = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(next.body_md, next.status, next.reviewer_note, next.edited_by, next.updated_at, sectionId).run();
  await db.prepare("UPDATE reports SET updated_at = ? WHERE id = ?")
    .bind(next.updated_at, current.report_id).run();
  await touchProject(db, projectId);
  return { ...current, ...next };
}

export async function setReportStatus(
  db: D1Database, projectId: string, status: Report["status"],
): Promise<void> {
  await db.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE project_id = ?")
    .bind(status, now(), projectId).run();
  await touchProject(db, projectId);
}

/* ------------------------------------------------------------------- runs -- */

interface RunRow {
  id: string; project_id: string; stage: string; engine: string; status: string;
  message: string | null; detail_json: string | null; input_tokens: number;
  output_tokens: number; duration_ms: number; created_at: string;
}

export async function recordRun(
  db: D1Database, projectId: string, run: {
    stage: StageId; engine: string; status: "ok" | "error"; message?: string;
    detail?: Record<string, unknown>; input_tokens?: number; output_tokens?: number;
    duration_ms?: number;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO runs (id, project_id, stage, engine, status, message, detail_json,
      input_tokens, output_tokens, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id("run"), projectId, run.stage, run.engine, run.status, run.message ?? null,
    run.detail ? JSON.stringify(run.detail) : null, run.input_tokens ?? 0,
    run.output_tokens ?? 0, run.duration_ms ?? 0, now()).run();
}

export async function listRuns(db: D1Database, projectId: string, limit = 40): Promise<Run[]> {
  const { results } = await db
    .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .bind(projectId, limit).all<RunRow>();
  return results.map((r) => ({
    id: r.id, project_id: r.project_id, stage: r.stage as StageId, engine: r.engine,
    status: r.status as "ok" | "error", message: r.message,
    detail: parseJson<Record<string, unknown> | null>(r.detail_json, null),
    input_tokens: r.input_tokens, output_tokens: r.output_tokens,
    duration_ms: r.duration_ms, created_at: r.created_at,
  }));
}
