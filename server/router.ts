import type {
  ColumnSpec, FindingStatus, Perspective, Project, ProjectStatus,
  QuantSummary, SectionStatus, Source, StageId,
} from "../shared/types";
import * as db from "./db";
import { toSourceSummary } from "./db";
import { llmAvailable, modelFor } from "./llm";
import { analyseText } from "./qual";
import { analyseQuantitative } from "./quant";
import { generateReport } from "./report";
import { seedDemoProject } from "./seed";
import { standardizeSource } from "./standardize";
import { triangulate } from "./triangulate";
import { toHtml, toMarkdown } from "./exporter";
import {
  badRequest, HttpError, json, notFound, readBody, text, type Env,
} from "./util";

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return json({ ok: true });
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    console.error("api error", message);
    return json({ error: message }, 500);
  }
}

function requireAuth(request: Request, env: Env): void {
  const expected = env.APP_PASSWORD?.trim();
  if (!expected) return;
  if (request.headers.get("x-app-password") === expected) return;
  throw new HttpError(401, "Authentication required");
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "").split("/").filter(Boolean);
  const method = request.method;
  const [head, ...rest] = parts;

  if (head === "health") {
    return json({
      ok: true,
      llm_available: llmAvailable(env),
      model: llmAvailable(env) ? modelFor(env) : null,
      auth_required: Boolean(env.APP_PASSWORD?.trim()),
    });
  }

  requireAuth(request, env);
  if (head !== "projects") throw notFound(`No route for /api/${parts.join("/")}`);

  /* ------------------------------------------------------------ projects -- */

  if (rest.length === 0) {
    if (method === "GET") return json({ projects: await db.listProjects(env.DB) });
    if (method === "POST") {
      const body = await readBody<{ demo?: boolean; name?: string } & Partial<Project>>(request);
      if (body.demo) {
        const projectId = await seedDemoProject(env.DB);
        return json({ project: await db.getProject(env.DB, projectId) }, 201);
      }
      if (!body.name?.trim()) throw badRequest("A project name is required");
      return json({ project: await db.createProject(env.DB, { ...body, name: body.name.trim() }) }, 201);
    }
    throw notFound();
  }

  const projectId = rest[0];
  const tail = rest.slice(1);

  if (tail.length === 0) {
    if (method === "GET") return json(await projectStatus(env, projectId));
    if (method === "PATCH") {
      const patch = await readBody<Partial<Project>>(request);
      return json({ project: await db.updateProject(env.DB, projectId, patch) });
    }
    if (method === "DELETE") {
      await db.deleteProject(env.DB, projectId);
      return json({ ok: true });
    }
    throw notFound();
  }

  /* ------------------------------------------------------------- sources -- */

  if (tail[0] === "sources") {
    if (tail.length === 1) {
      if (method === "GET") {
        const sources = await db.listSources(env.DB, projectId);
        return json({ sources: sources.map(toSourceSummary) });
      }
      if (method === "POST") {
        await db.getProject(env.DB, projectId);
        const body = await readBody<Partial<Source> & { name?: string }>(request);
        if (!body.name?.trim()) throw badRequest("A source name is required");
        if (!body.kind || !body.perspective || !body.format) {
          throw badRequest("kind, perspective and format are required");
        }
        const hasContent = Boolean(body.raw_text?.trim()) || Boolean(body.rows?.length);
        if (!hasContent) throw badRequest("A source needs either raw_text or rows");
        const source = await db.insertSource(env.DB, projectId, {
          name: body.name.trim(), kind: body.kind, perspective: body.perspective,
          format: body.format, collected_at: body.collected_at ?? null,
          notes: body.notes ?? null, raw_text: body.raw_text ?? null,
          columns: body.columns ?? null, rows: body.rows ?? null,
        });
        return json({ source: toSourceSummary(source) }, 201);
      }
      throw notFound();
    }

    const sourceId = tail[1];
    if (method === "GET") {
      const source = await db.getSource(env.DB, sourceId);
      // Trim the payload: the UI only previews the head of a large sheet.
      return json({ source: { ...source, rows: source.rows?.slice(0, 200) ?? null } });
    }
    if (method === "PATCH") {
      const body = await readBody<{ columns: ColumnSpec[] }>(request);
      if (!Array.isArray(body.columns)) throw badRequest("columns must be an array");
      await db.updateSourceColumns(env.DB, sourceId, body.columns);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await db.deleteSource(env.DB, projectId, sourceId);
      return json({ ok: true });
    }
    throw notFound();
  }

  /* ------------------------------- stage 2 — standardized research model -- */

  if (tail[0] === "standardize" && method === "POST") {
    const started = Date.now();
    const body = await readBody<{ source_ids?: string[] }>(request).catch(() => ({ source_ids: undefined }));
    const all = await db.listSources(env.DB, projectId);
    const selected = body.source_ids?.length
      ? all.filter((s) => body.source_ids?.includes(s.id))
      : all;
    if (!selected.length) throw badRequest("There are no sources to standardize");

    const observations = selected.flatMap((s) => standardizeSource(s));
    const count = await db.replaceObservations(env.DB, projectId, selected.map((s) => s.id), observations);
    await db.markSourcesStandardized(env.DB, projectId, selected.map((s) => s.id));
    await db.recordRun(env.DB, projectId, {
      stage: "model", engine: "deterministic", status: "ok",
      message: `${count} observations from ${selected.length} source(s)`,
      detail: {
        by_perspective: countBy(observations, (o) => o.perspective),
        by_modality: countBy(observations, (o) => o.modality),
        untagged: observations.filter((o) => !o.dimension).length,
      },
      duration_ms: Date.now() - started,
    });
    return json({ observations: count, sources: selected.length });
  }

  if (tail[0] === "observations" && method === "GET") {
    const perspective = url.searchParams.get("perspective") as Perspective | null;
    return json({
      observations: await db.listObservations(env.DB, projectId, {
        perspective: perspective ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 500),
      }),
    });
  }

  /* --------------------------------------------- stage 3 — analysis lanes -- */

  if (tail[0] === "analyse" && method === "POST") {
    const body = await readBody<{ lane?: "quantitative" | "resident" | "expert" | "all" }>(request)
      .catch(() => ({ lane: "all" as const }));
    const lane = body.lane ?? "all";
    return json(await runAnalysis(env, projectId, lane));
  }

  if (tail[0] === "findings") {
    if (tail.length === 1 && method === "GET") {
      const perspective = url.searchParams.get("perspective") as Perspective | null;
      return json({ findings: await db.listFindings(env.DB, projectId, perspective ?? undefined) });
    }
    if (tail.length === 2 && method === "PATCH") {
      const body = await readBody<{ status: FindingStatus }>(request);
      if (!["open", "accepted", "rejected"].includes(body.status)) throw badRequest("Invalid status");
      await db.setFindingStatus(env.DB, projectId, tail[1], body.status);
      return json({ ok: true });
    }
    throw notFound();
  }

  /* ---------------------------------------------- stage 5 — triangulation -- */

  if (tail[0] === "triangulate" && method === "POST") {
    const started = Date.now();
    const findings = await db.listFindings(env.DB, projectId);
    if (!findings.length) throw badRequest("Run the analysis lanes before triangulating");
    const observations = await db.listObservations(env.DB, projectId, { limit: 4000 });
    const useLlm = llmAvailable(env);

    try {
      const result = await triangulate(env, { findings, observations, useLlm });
      const saved = await db.replaceTriangulations(env.DB, projectId, result.triangulations);
      await db.recordRun(env.DB, projectId, {
        stage: "triangulate", engine: engineLabel(env, result.engine), status: "ok",
        message: `${saved.length} dimensions triangulated`,
        detail: { by_convergence: countBy(saved, (t) => t.convergence) },
        input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
        duration_ms: Date.now() - started,
      });
      return json({ triangulations: saved, engine: engineLabel(env, result.engine) });
    } catch (error) {
      await recordFailure(env, projectId, "triangulate", error, Date.now() - started);
      throw error;
    }
  }

  if (tail[0] === "triangulations" && method === "GET") {
    return json({ triangulations: await db.listTriangulations(env.DB, projectId) });
  }

  /* --------------------------- stages 6+7 — grounded generation and draft -- */

  if (tail[0] === "report") {
    if (tail.length === 1 && method === "GET") {
      return json({ report: await db.getLatestReport(env.DB, projectId) });
    }
    if (tail.length === 1 && method === "POST") {
      const started = Date.now();
      const project = await db.getProject(env.DB, projectId);
      const [sources, findings, triangulations] = await Promise.all([
        db.listSources(env.DB, projectId),
        db.listFindings(env.DB, projectId),
        db.listTriangulations(env.DB, projectId),
      ]);
      if (!findings.length) throw badRequest("There is no evidence to generate from yet");
      const useLlm = llmAvailable(env);

      try {
        const result = await generateReport(env, {
          project, sources,
          findings: findings.filter((f) => f.status !== "rejected"),
          triangulations, useLlm,
        });
        const engine = engineLabel(env, result.engine);
        const report = await db.createReport(
          env.DB, projectId, `Onderzoeksrapport — ${project.name}`, engine, result.sections,
        );
        await db.recordRun(env.DB, projectId, {
          stage: "generate", engine, status: "ok",
          message: `${report.sections.length} sections, ` +
            `${report.sections.reduce((a, s) => a + s.citations.length, 0)} source references`,
          detail: {
            sections: report.sections.map((s) => ({
              key: s.section_key, words: countWords(s.body_md), citations: s.citations.length,
            })),
          },
          input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
          duration_ms: Date.now() - started,
        });
        return json({ report });
      } catch (error) {
        await recordFailure(env, projectId, "generate", error, Date.now() - started);
        throw error;
      }
    }
    if (tail.length === 1 && method === "PATCH") {
      const body = await readBody<{ status: "draft" | "in-review" | "approved" }>(request);
      await db.setReportStatus(env.DB, projectId, body.status);
      return json({ report: await db.getLatestReport(env.DB, projectId) });
    }

    /* ---------------------------------------- stage 8 — researcher review -- */

    if (tail[1] === "sections" && tail[2] && method === "PATCH") {
      const body = await readBody<{
        body_md?: string; status?: SectionStatus; reviewer_note?: string | null; edited_by?: string | null;
      }>(request);
      const section = await db.updateSection(env.DB, projectId, tail[2], body);
      if (body.status) {
        await db.recordRun(env.DB, projectId, {
          stage: "validate", engine: "researcher", status: "ok",
          message: `"${section.title}" marked ${body.status}`,
          detail: { section_key: section.section_key, by: body.edited_by ?? null },
        });
      }
      return json({ section });
    }
    throw notFound();
  }

  /* -------------------------------------------------------------- export -- */

  if (tail[0] === "export" && method === "GET") {
    const project = await db.getProject(env.DB, projectId);
    const report = await db.getLatestReport(env.DB, projectId);
    if (!report) throw badRequest("No report has been generated yet");
    const [findings, triangulations] = await Promise.all([
      db.listFindings(env.DB, projectId),
      db.listTriangulations(env.DB, projectId),
    ]);
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    return url.searchParams.get("format") === "html"
      ? text(toHtml(project, report, findings, triangulations), "text/html; charset=utf-8", `${slug}.html`)
      : text(toMarkdown(project, report, findings, triangulations), "text/markdown; charset=utf-8", `${slug}.md`);
  }

  if (tail[0] === "runs" && method === "GET") {
    return json({ runs: await db.listRuns(env.DB, projectId) });
  }

  throw notFound(`No route for /api/${parts.join("/")}`);
}

/* ------------------------------------------------------------- analysis -- */

async function runAnalysis(
  env: Env, projectId: string, lane: "quantitative" | "resident" | "expert" | "all",
) {
  const observations = await db.listObservations(env.DB, projectId, { limit: 6000 });
  if (!observations.length) {
    throw badRequest("Standardize at least one source before running the analysis");
  }
  const sources = await db.listSources(env.DB, projectId);
  const useLlm = llmAvailable(env);
  const lanes: ("quantitative" | "resident" | "expert")[] =
    lane === "all" ? ["quantitative", "resident", "expert"] : [lane];

  const report: Record<string, { findings: number; engine: string; note?: string }> = {};
  let summaries: QuantSummary[] = [];

  for (const current of lanes) {
    const started = Date.now();
    try {
      if (current === "quantitative") {
        const result = analyseQuantitative(observations, sources);
        summaries = result.summaries;
        const saved = await db.replaceFindings(env.DB, projectId, "quantitative", result.findings);
        await db.recordRun(env.DB, projectId, {
          stage: "analyse", engine: "deterministic", status: "ok",
          message: `quantitative: ${saved.length} findings over ${result.summaries.length} variables`,
          detail: { lane: "quantitative", summaries: result.summaries },
          duration_ms: Date.now() - started,
        });
        report.quantitative = { findings: saved.length, engine: "deterministic" };
        continue;
      }

      const result = await analyseText(env, {
        perspective: current, observations, sources, useLlm,
      });
      const saved = await db.replaceFindings(env.DB, projectId, current, result.findings);
      const engine = engineLabel(env, result.engine);
      await db.recordRun(env.DB, projectId, {
        stage: "analyse", engine, status: "ok",
        message: `${current}: ${saved.length} findings` +
          (result.dropped ? `, ${result.dropped} unverifiable quotes discarded` : ""),
        detail: { lane: current, dropped_quotes: result.dropped },
        input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
        duration_ms: Date.now() - started,
      });
      report[current] = {
        findings: saved.length, engine,
        note: result.dropped ? `${result.dropped} quotes failed verbatim verification and were discarded` : undefined,
      };
    } catch (error) {
      await recordFailure(env, projectId, "analyse", error, Date.now() - started);
      throw error;
    }
  }

  return { lanes: report, quant_summaries: summaries };
}

/* -------------------------------------------------------------- helpers -- */

async function projectStatus(env: Env, projectId: string): Promise<ProjectStatus> {
  const project = await db.getProject(env.DB, projectId);
  const [sources, observations, findings, triangulations, report, runs] = await Promise.all([
    db.listSources(env.DB, projectId),
    db.listObservations(env.DB, projectId, { limit: 10000 }),
    db.listFindings(env.DB, projectId),
    db.listTriangulations(env.DB, projectId),
    db.getLatestReport(env.DB, projectId),
    db.listRuns(env.DB, projectId),
  ]);

  return {
    project,
    counts: {
      sources: sources.length,
      sources_standardized: sources.filter((s) => s.standardized).length,
      observations: observations.length,
      findings: findings.length,
      findings_by_perspective: {
        quantitative: findings.filter((f) => f.perspective === "quantitative").length,
        resident: findings.filter((f) => f.perspective === "resident").length,
        expert: findings.filter((f) => f.perspective === "expert").length,
      },
      triangulations: triangulations.length,
      sections: report?.sections.length ?? 0,
      sections_approved: report?.sections.filter((s) => s.status === "approved").length ?? 0,
    },
    report_id: report?.id ?? null,
    runs,
    llm_available: llmAvailable(env),
  };
}

const engineLabel = (env: Env, engine: string) =>
  engine === "claude" ? `claude:${modelFor(env)}` : engine;

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

async function recordFailure(
  env: Env, projectId: string, stage: StageId, error: unknown, durationMs: number,
): Promise<void> {
  await db.recordRun(env.DB, projectId, {
    stage, engine: engineLabel(env, llmAvailable(env) ? "claude" : "heuristic"), status: "error",
    message: error instanceof Error ? error.message : String(error),
    duration_ms: durationMs,
  });
}
