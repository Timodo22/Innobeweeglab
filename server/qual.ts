import { z } from "zod";
import type { Direction, EvidenceRef, Finding, Observation, Perspective, Source } from "../shared/types";
import { DIMENSIONS, DIMENSION_LABELS } from "../shared/types";
import { polarity, tagDimensions } from "./lexicon";
import { extract, type Usage } from "./llm";
import { clamp, round, squash, type Env } from "./util";

type NewFinding = Omit<Finding, "id" | "project_id" | "created_at" | "status">;

const ThemeSchema = z.object({
  themes: z.array(
    z.object({
      dimension: z.enum(DIMENSIONS),
      statement: z.string().describe("One sentence stating what the material shows. Specific, not generic."),
      detail: z.string().describe("Two or three sentences of nuance: who says it, where, under what conditions, and any counter-signal."),
      direction: z.enum(["positive", "negative", "mixed", "neutral"]),
      evidence: z.array(
        z.object({
          observation_id: z.string().describe("An id from the supplied list."),
          quote: z.string().describe("A word-for-word span copied from that observation. Never paraphrase."),
        }),
      ),
    }),
  ),
});

const CODING_SYSTEM = `You are a research analyst at InnoBeweegLab, which studies how public
space encourages people to move and be active. You perform thematic coding of field material.

Rules you must follow:
- Code only what the supplied material actually says. Never introduce knowledge from elsewhere.
- Every quote must be copied word for word from the observation you attribute it to,
  in its original language (the material is usually Dutch). Quotes that are not exact
  are discarded by the system and the theme loses its support.
- Prefer few, sharp, specific themes over many vague ones. A theme that would read the
  same for any neighbourhood in the country is not a useful theme — drop it.
- Name concrete places, groups, times of day and conditions when the material names them.
- Distinguish what people say from what you infer. You are coding, not recommending.
- Assign each theme to exactly one dimension from the supplied vocabulary.`;

/**
 * Stage 3 — qualitative and expert lanes.
 *
 * Both lanes code free text into themes against the shared dimension vocabulary.
 * The difference is the material (resident voice vs. professional assessment) and
 * therefore the framing of the prompt, not the mechanics.
 */
export async function analyseText(
  env: Env,
  args: {
    perspective: Extract<Perspective, "resident" | "expert">;
    observations: Observation[];
    sources: Source[];
    useLlm: boolean;
  },
): Promise<{ findings: NewFinding[]; usage: Usage; engine: string; dropped: number }> {
  const statements = args.observations.filter(
    (o) => o.perspective === args.perspective && (o.value_text ?? "").trim().length >= 15,
  );
  if (!statements.length) {
    return { findings: [], usage: { input_tokens: 0, output_tokens: 0 }, engine: "none", dropped: 0 };
  }

  if (!args.useLlm) {
    return {
      findings: codeHeuristically(statements, args.sources, args.perspective),
      usage: { input_tokens: 0, output_tokens: 0 },
      engine: "heuristic",
      dropped: 0,
    };
  }

  const byId = new Map(statements.map((o) => [o.id, o]));
  const sourceName = new Map(args.sources.map((s) => [s.id, s.name]));
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const findings: NewFinding[] = [];
  let dropped = 0;

  for (const batch of chunk(statements, 120)) {
    const { data, usage: u } = await extract(env, {
      system: CODING_SYSTEM,
      user: buildCodingPrompt(batch, args.perspective, sourceName),
      schema: ThemeSchema,
      maxTokens: 16000,
      effort: "high",
    });
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;

    for (const theme of data.themes) {
      const { evidence, rejected } = verifyEvidence(theme.evidence, byId, sourceName);
      dropped += rejected;
      // A theme with no surviving verbatim support is not evidence — discard it.
      if (!evidence.length) continue;
      findings.push(toFinding(theme, evidence, args.perspective, byId));
    }
  }

  return { findings: mergeSimilar(findings), usage, engine: "claude", dropped };
}

function buildCodingPrompt(
  observations: Observation[],
  perspective: "resident" | "expert",
  sourceName: Map<string, string>,
): string {
  const material = observations
    .map((o) => {
      const who = o.respondent ? ` · ${o.respondent}` : "";
      const where = o.location ? ` · ${o.location}` : "";
      const question = o.variable ? ` · in answer to "${o.variable}"` : "";
      return `<observation id="${o.id}" source="${sourceName.get(o.source_id) ?? o.source_id}${who}${where}"${question}>\n${o.value_text}\n</observation>`;
    })
    .join("\n\n");

  const vocabulary = DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_LABELS[d]}`).join("\n");

  const framing = perspective === "resident"
    ? `This is resident and stakeholder material: interviews, co-creation sessions and open survey answers.
Code what residents experience, want and avoid.`
    : `This is expert material: professional observations, site assessments and evaluations by
designers, planners and health professionals. Code what the experts judge and on what grounds.`;

  return `${framing}

Dimension vocabulary — use exactly these keys:
${vocabulary}

Material (${observations.length} observations):

${material}

Produce the themes present in this material. For each theme, attach every observation that
supports it, with a word-for-word quote from that observation.`;
}

/** Grounding gate: a quote that is not verbatim in the cited observation is thrown away. */
function verifyEvidence(
  claimed: { observation_id: string; quote: string }[],
  byId: Map<string, Observation>,
  sourceName: Map<string, string>,
): { evidence: EvidenceRef[]; rejected: number } {
  const evidence: EvidenceRef[] = [];
  let rejected = 0;
  for (const item of claimed) {
    const observation = byId.get(item.observation_id);
    if (!observation) { rejected++; continue; }
    const haystack = normalize(observation.value_text ?? "");
    const needle = normalize(item.quote);
    if (needle.length < 8 || !haystack.includes(needle)) { rejected++; continue; }
    evidence.push({
      observation_id: observation.id,
      source_id: observation.source_id,
      source_name: sourceName.get(observation.source_id) ?? observation.source_id,
      locator: observation.locator,
      excerpt: squash(item.quote, 260),
    });
  }
  return { evidence, rejected };
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();

function toFinding(
  theme: z.infer<typeof ThemeSchema>["themes"][number],
  evidence: EvidenceRef[],
  perspective: "resident" | "expert",
  byId: Map<string, Observation>,
): NewFinding {
  const respondents = new Set(
    evidence.map((e) => byId.get(e.observation_id)?.respondent ?? e.observation_id),
  );
  return {
    perspective,
    dimension: theme.dimension,
    claim_type: "finding",
    statement: theme.statement.trim(),
    detail: theme.detail.trim(),
    direction: theme.direction as Direction,
    strength: strengthFrom(evidence.length, respondents.size),
    support_n: respondents.size,
    method: perspective === "resident" ? "thematic-coding" : "expert-scoring",
    evidence,
  };
}

/** Evidential strength rises with corroboration, and faster with distinct voices. */
function strengthFrom(quoteCount: number, respondentCount: number): number {
  return round(clamp(0.25 + quoteCount * 0.06 + respondentCount * 0.09, 0.2, 0.95), 2);
}

/* -------------------------------------------------------- heuristic mode -- */

/**
 * No API key configured: fall back to lexicon-driven coding. It produces weaker,
 * blunter themes, but every quote is real and every count is real — so the rest of
 * the pipeline behaves identically and the prototype stays demonstrable offline.
 */
function codeHeuristically(
  statements: Observation[],
  sources: Source[],
  perspective: "resident" | "expert",
): NewFinding[] {
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const buckets = new Map<string, Observation[]>();

  for (const o of statements) {
    const dimension = o.dimension ?? tagDimensions(o.value_text ?? "")[0]?.dimension;
    if (!dimension) continue;
    const p = polarity(o.value_text ?? "");
    const key = `${dimension}::${p.direction}`;
    const list = buckets.get(key);
    if (list) list.push(o);
    else buckets.set(key, [o]);
  }

  const findings: NewFinding[] = [];
  for (const [key, group] of buckets) {
    if (group.length < 2) continue;
    const [dimension, direction] = key.split("::") as [(typeof DIMENSIONS)[number], Direction];
    const respondents = new Set(group.map((o) => o.respondent ?? o.id));
    const label = DIMENSION_LABELS[dimension].toLowerCase();
    const verb = direction === "negative" ? "raise concerns about"
      : direction === "positive" ? "speak positively about"
      : "give mixed accounts of";

    findings.push({
      perspective,
      dimension,
      claim_type: "observation",
      statement: `${respondents.size} ${perspective === "resident" ? "respondents" : "assessments"} ${verb} ${label}.`,
      detail: `Keyword-matched from ${group.length} statements across ` +
        `${new Set(group.map((o) => o.source_id)).size} source(s). ` +
        `Coded without a language model — treat as a first pass, not a finished theme.`,
      direction,
      strength: round(clamp(0.15 + respondents.size * 0.06, 0.15, 0.6), 2),
      support_n: respondents.size,
      method: perspective === "resident" ? "thematic-coding (lexicon)" : "expert-scoring (lexicon)",
      evidence: group.slice(0, 6).map((o) => ({
        observation_id: o.id,
        source_id: o.source_id,
        source_name: sourceName.get(o.source_id) ?? o.source_id,
        locator: o.locator,
        excerpt: squash(o.value_text ?? "", 260),
      })),
    });
  }
  return findings;
}

/* ------------------------------------------------------------- utilities -- */

/** Batches can produce near-duplicate themes; fold them so the store stays clean. */
function mergeSimilar(findings: NewFinding[]): NewFinding[] {
  const merged: NewFinding[] = [];
  for (const f of findings) {
    const twin = merged.find(
      (m) => m.dimension === f.dimension && m.direction === f.direction &&
        overlap(m.statement, f.statement) > 0.55,
    );
    if (!twin) { merged.push(f); continue; }
    const seen = new Set(twin.evidence.map((e) => e.observation_id));
    twin.evidence.push(...f.evidence.filter((e) => !seen.has(e.observation_id)));
    twin.support_n = Math.max(twin.support_n, f.support_n);
    twin.strength = Math.max(twin.strength, f.strength);
  }
  return merged;
}

function overlap(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter((w) => w.length > 3));
  const wb = new Set(normalize(b).split(" ").filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
