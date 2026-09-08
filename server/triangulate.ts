import { z } from "zod";
import type { Convergence, Dimension, Finding, Observation, Perspective, Triangulation } from "../shared/types";
import { DIMENSIONS, DIMENSION_LABELS } from "../shared/types";
import { extract, type Usage } from "./llm";
import { clamp, round, squash, type Env } from "./util";

type NewTriangulation = Omit<Triangulation, "id" | "project_id" | "created_at">;

const SummarySchema = z.object({
  groups: z.array(
    z.object({
      dimension: z.enum(DIMENSIONS),
      title: z.string().describe("A short, concrete headline for what the sources jointly show."),
      summary: z.string().describe("Three to five sentences: what each perspective contributes, where they agree, where they conflict, and what remains unresolved."),
    }),
  ),
});

const TRIANGULATION_SYSTEM = `You are a senior researcher at InnoBeweegLab performing cross-source
triangulation for a study of active-friendly public space.

You are given, per design dimension, the findings that three independent perspectives produced:
resident voice, expert assessment, and quantitative measurement. Your job is to state how they
relate — not to add new claims.

Rules:
- Work only from the findings given. Introduce no new facts, numbers or examples.
- Say explicitly where perspectives agree, where they contradict each other, and what none of
  them answers. A contradiction is a result, not a problem to smooth over.
- Never resolve a contradiction by inventing a reason. Name it and leave it open for the researcher.
- Be concrete. A summary that would fit any neighbourhood is worthless.
- No recommendations here. This stage establishes what is known, not what to do.`;

/**
 * Stage 5 — cross-source triangulation.
 *
 * The grouping and the convergence verdict are computed deterministically, so the
 * classification cannot drift. Only the prose summary is written by the model, and
 * only over findings that are already in the evidence store.
 */
export async function triangulate(
  env: Env,
  args: { findings: Finding[]; observations: Observation[]; useLlm: boolean },
): Promise<{ triangulations: NewTriangulation[]; usage: Usage; engine: string }> {
  const groups = groupByDimension(args.findings);
  const gaps = findGaps(args.findings, args.observations);
  const base = [...groups, ...gaps];

  if (!base.length || !args.useLlm) {
    return { triangulations: base, usage: { input_tokens: 0, output_tokens: 0 }, engine: args.useLlm ? "claude" : "heuristic" };
  }

  const withFindings = base.filter((t) => t.finding_ids.length > 0);
  if (!withFindings.length) {
    return { triangulations: base, usage: { input_tokens: 0, output_tokens: 0 }, engine: "claude" };
  }

  const { data, usage } = await extract(env, {
    system: TRIANGULATION_SYSTEM,
    user: buildPrompt(withFindings, args.findings),
    schema: SummarySchema,
    maxTokens: 16000,
    effort: "high",
  });

  const written = new Map(data.groups.map((g) => [g.dimension, g]));
  const triangulations = base.map((t) => {
    const w = written.get(t.dimension);
    return w ? { ...t, title: w.title.trim(), summary: w.summary.trim() } : t;
  });

  return { triangulations, usage, engine: "claude" };
}

function buildPrompt(groups: NewTriangulation[], findings: Finding[]): string {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const blocks = groups.map((g) => {
    const lines = g.finding_ids.map((fid) => {
      const f = byId.get(fid);
      if (!f) return "";
      const evidence = f.evidence.slice(0, 3)
        .map((e) => `      · ${e.source_name} [${e.locator}]: "${squash(e.excerpt, 180)}"`)
        .join("\n");
      return `  [${f.perspective}] ${f.statement}
      direction: ${f.direction} · strength: ${f.strength} · supported by: ${f.support_n} · method: ${f.method}
      ${f.detail ? `nuance: ${squash(f.detail, 300)}` : ""}
${evidence}`;
    }).filter(Boolean).join("\n\n");

    return `## ${g.dimension} — ${DIMENSION_LABELS[g.dimension]}
perspectives present: ${g.perspectives.join(", ") || "none"}
computed verdict: ${g.convergence}

${lines}`;
  }).join("\n\n");

  return `Write a title and a summary for each of the following dimensions.
The convergence verdict has already been computed from the data — honour it, do not re-classify.

${blocks}`;
}

function groupByDimension(findings: Finding[]): NewTriangulation[] {
  const byDimension = new Map<Dimension, Finding[]>();
  for (const f of findings) {
    if (f.status === "rejected") continue;
    const list = byDimension.get(f.dimension);
    if (list) list.push(f);
    else byDimension.set(f.dimension, [f]);
  }

  const out: NewTriangulation[] = [];
  for (const [dimension, group] of byDimension) {
    const perspectives = [...new Set(group.map((f) => f.perspective))] as Perspective[];
    const convergence = classify(group, perspectives);
    const meanStrength = group.reduce((a, f) => a + f.strength, 0) / group.length;
    out.push({
      dimension,
      title: defaultTitle(dimension, convergence),
      convergence,
      summary: defaultSummary(group, perspectives, convergence),
      perspectives,
      finding_ids: group.map((f) => f.id),
      confidence: confidenceFor(convergence, perspectives.length, meanStrength, group),
      });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function classify(group: Finding[], perspectives: Perspective[]): Convergence {
  if (perspectives.length < 2) return "single-source";
  const directions = new Set(group.map((f) => f.direction).filter((d) => d !== "neutral"));
  // Opposing directions from different perspectives is the signal worth surfacing.
  const conflicting = directions.has("positive") && directions.has("negative");
  if (!conflicting) return "converging";
  const positivePerspectives = new Set(group.filter((f) => f.direction === "positive").map((f) => f.perspective));
  const negativePerspectives = new Set(group.filter((f) => f.direction === "negative").map((f) => f.perspective));
  const acrossPerspectives = [...positivePerspectives].some((p) => !negativePerspectives.has(p));
  return acrossPerspectives ? "diverging" : "converging";
}

function confidenceFor(
  convergence: Convergence, perspectiveCount: number, meanStrength: number, group: Finding[],
): number {
  const support = Math.min(group.reduce((a, f) => a + f.support_n, 0), 80) / 80;
  const base = { converging: 0.45, diverging: 0.3, "single-source": 0.22, gap: 0.1 }[convergence];
  return round(clamp(base + perspectiveCount * 0.1 + meanStrength * 0.25 + support * 0.15, 0.05, 0.97), 2);
}

function defaultTitle(dimension: Dimension, convergence: Convergence): string {
  const label = DIMENSION_LABELS[dimension];
  return {
    converging: `${label}: sources agree`,
    diverging: `${label}: sources disagree`,
    "single-source": `${label}: single perspective only`,
    gap: `${label}: evidence gap`,
  }[convergence];
}

function defaultSummary(group: Finding[], perspectives: Perspective[], convergence: Convergence): string {
  const parts = perspectives.map((p) => {
    const own = group.filter((f) => f.perspective === p);
    return `${p}: ${own.length} finding(s), ${own.map((f) => f.direction).join("/")}`;
  });
  const head = {
    converging: "The available perspectives point the same way.",
    diverging: "The perspectives point in opposite directions and need researcher judgement.",
    "single-source": "Only one perspective covers this dimension; it is not yet corroborated.",
    gap: "No perspective produced a finding here.",
  }[convergence];
  return `${head} ${parts.join("; ")}.`;
}

/**
 * A gap is a dimension the material clearly touches — residents mention it, or a
 * measure covers it — but which no lane turned into a finding. Surfacing gaps is
 * as much a research result as surfacing agreement.
 */
function findGaps(findings: Finding[], observations: Observation[]): NewTriangulation[] {
  const covered = new Set(findings.map((f) => f.dimension));
  const touched = new Map<Dimension, number>();
  for (const o of observations) {
    if (!o.dimension || covered.has(o.dimension)) continue;
    touched.set(o.dimension, (touched.get(o.dimension) ?? 0) + 1);
  }
  return [...touched.entries()]
    .filter(([, count]) => count >= 3)
    .map(([dimension, count]) => ({
      dimension,
      title: defaultTitle(dimension, "gap"),
      convergence: "gap" as const,
      summary: `${count} observations touch on ${DIMENSION_LABELS[dimension].toLowerCase()}, ` +
        `but no analysis lane produced a supported finding. Either the material is too thin ` +
        `to conclude anything, or this dimension needs targeted follow-up in the field.`,
      perspectives: [],
      finding_ids: [],
      confidence: 0.1,
    }));
}
