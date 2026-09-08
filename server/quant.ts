import type { Dimension, Direction, EvidenceRef, Finding, Observation, QuantSummary, Source } from "../shared/types";
import { clamp, round, squash } from "./util";

type NewFinding = Omit<Finding, "id" | "project_id" | "created_at" | "status">;

/**
 * Stage 3 — quantitative lane. Deterministic on purpose: every number in the final
 * report is computed here, never written by a language model. The model may later
 * phrase a finding, but it can only phrase numbers that this function produced.
 */
export function analyseQuantitative(
  observations: Observation[],
  sources: Source[],
): { summaries: QuantSummary[]; findings: NewFinding[] } {
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const measures = observations.filter(
    (o) => o.modality === "measure" && o.value_num !== null && o.dimension !== null,
  );

  const byVariable = new Map<string, Observation[]>();
  for (const o of measures) {
    const key = `${o.source_id}::${o.variable ?? "value"}`;
    const list = byVariable.get(key);
    if (list) list.push(o);
    else byVariable.set(key, [o]);
  }

  const summaries: QuantSummary[] = [];
  const findings: NewFinding[] = [];

  for (const [, group] of byVariable) {
    if (group.length < 3) continue;
    const values = group.map((o) => o.value_num as number);
    const stats = describe(values);
    const first = group[0];
    const scaleMin = first.scale_min;
    const scaleMax = first.scale_max;

    const summary: QuantSummary = {
      variable: first.variable ?? "value",
      dimension: first.dimension,
      n: stats.n,
      mean: round(stats.mean),
      sd: round(stats.sd),
      min: round(stats.min),
      max: round(stats.max),
      median: round(stats.median),
      scale_min: scaleMin,
      scale_max: scaleMax,
      distribution: distribution(values, scaleMin, scaleMax),
      by_group: groupMeans(group),
    };
    summaries.push(summary);

    findings.push(mainFinding(summary, group, sourceName));
    findings.push(...groupGapFindings(summary, group, stats, sourceName));
  }

  return { summaries, findings };
}

function mainFinding(
  s: QuantSummary,
  group: Observation[],
  sourceName: Map<string, string>,
): NewFinding {
  const scaled = s.scale_min !== null && s.scale_max !== null && s.scale_max > s.scale_min;
  const normalized = scaled
    ? (s.mean - (s.scale_min as number)) / ((s.scale_max as number) - (s.scale_min as number))
    : null;

  let direction: Direction = "neutral";
  if (normalized !== null) {
    if (normalized < 0.45) direction = "negative";
    else if (normalized > 0.65) direction = "positive";
    else direction = "mixed";
  }

  const scaleNote = scaled ? ` on a ${s.scale_min}–${s.scale_max} scale` : "";
  const statement = scaled
    ? `${s.variable} scores ${s.mean}${scaleNote} (n = ${s.n}, sd = ${s.sd}).`
    : `${s.variable} averages ${s.mean} across ${s.n} records (range ${s.min}–${s.max}).`;

  // Dispersion matters: a mean with a wide spread is weaker evidence than a tight one.
  const spread = scaled && s.scale_max !== null && s.scale_min !== null
    ? s.sd / Math.max(1, (s.scale_max - s.scale_min) / 2)
    : 0.4;
  const strength = round(clamp(0.35 + Math.min(s.n, 60) / 120 - spread * 0.25, 0.15, 0.95), 2);

  return {
    perspective: "quantitative",
    dimension: s.dimension as Dimension,
    claim_type: "finding",
    statement,
    detail: `Median ${s.median}, spread ${s.min}–${s.max}. ` +
      `Distribution: ${s.distribution.map((d) => `${d.bucket}: ${d.count}`).join(", ")}.`,
    direction,
    strength,
    support_n: s.n,
    method: "descriptive-stats",
    evidence: sampleEvidence(group, sourceName, 5),
  };
}

/**
 * Sub-group differences are where policy-relevant signal usually lives (one
 * neighbourhood, one age band). Flag a group only when it is both far from the
 * overall mean and large enough to mean something.
 */
function groupGapFindings(
  s: QuantSummary,
  group: Observation[],
  stats: ReturnType<typeof describe>,
  sourceName: Map<string, string>,
): NewFinding[] {
  if (!s.by_group || s.by_group.length < 2 || stats.sd === 0) return [];
  const out: NewFinding[] = [];
  for (const g of s.by_group) {
    if (g.n < 4) continue;
    const delta = (g.mean - s.mean) / stats.sd;
    if (Math.abs(delta) < 0.7) continue;
    const members = group.filter((o) => (o.location ?? "—") === g.group);
    out.push({
      perspective: "quantitative",
      dimension: s.dimension as Dimension,
      claim_type: "finding",
      statement: `${g.group} scores ${round(g.mean)} on ${s.variable}, ` +
        `${delta < 0 ? "below" : "above"} the overall mean of ${s.mean} (n = ${g.n}).`,
      detail: `Difference of ${round(Math.abs(g.mean - s.mean))} points, ` +
        `${round(Math.abs(delta))} standard deviations from the overall mean.`,
      direction: delta < 0 ? "negative" : "positive",
      strength: round(clamp(0.3 + Math.abs(delta) * 0.2 + Math.min(g.n, 30) / 150, 0.2, 0.9), 2),
      support_n: g.n,
      method: "descriptive-stats",
      evidence: sampleEvidence(members, sourceName, 4),
    });
  }
  return out;
}

function sampleEvidence(
  observations: Observation[],
  sourceName: Map<string, string>,
  limit: number,
): EvidenceRef[] {
  const step = Math.max(1, Math.floor(observations.length / limit));
  const picked: Observation[] = [];
  for (let i = 0; i < observations.length && picked.length < limit; i += step) picked.push(observations[i]);
  return picked.map((o) => ({
    observation_id: o.id,
    source_id: o.source_id,
    source_name: sourceName.get(o.source_id) ?? o.source_id,
    locator: o.locator,
    excerpt: o.value_num !== null
      ? `${o.variable ?? "value"} = ${o.value_num}${o.location ? ` (${o.location})` : ""}`
      : squash(o.value_text ?? "", 160),
  }));
}

export function describe(values: number[]) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean, sd: Math.sqrt(variance), min: sorted[0], max: sorted[n - 1], median };
}

function distribution(values: number[], scaleMin: number | null, scaleMax: number | null) {
  const integral = values.every((v) => Number.isInteger(v));
  if (integral && scaleMin !== null && scaleMax !== null && scaleMax - scaleMin <= 10) {
    const buckets: { bucket: string; count: number }[] = [];
    for (let v = scaleMin; v <= scaleMax; v++) {
      buckets.push({ bucket: String(v), count: values.filter((x) => x === v).length });
    }
    return buckets;
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const width = (hi - lo) / 5 || 1;
  return Array.from({ length: 5 }, (_, i) => {
    const from = lo + i * width;
    const to = i === 4 ? hi : from + width;
    return {
      bucket: `${round(from, 1)}–${round(to, 1)}`,
      count: values.filter((v) => v >= from && (i === 4 ? v <= to : v < to)).length,
    };
  });
}

function groupMeans(group: Observation[]) {
  const byGroup = new Map<string, number[]>();
  for (const o of group) {
    const key = o.location ?? "—";
    const list = byGroup.get(key);
    if (list) list.push(o.value_num as number);
    else byGroup.set(key, [o.value_num as number]);
  }
  if (byGroup.size < 2 || byGroup.has("—")) return undefined;
  return [...byGroup.entries()]
    .map(([g, values]) => ({
      group: g,
      n: values.length,
      mean: round(values.reduce((a, b) => a + b, 0) / values.length),
    }))
    .sort((a, b) => a.mean - b.mean);
}
