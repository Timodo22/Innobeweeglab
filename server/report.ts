import type { Citation, Finding, Project, Source, Triangulation } from "../shared/types";
import { DIMENSION_LABELS } from "../shared/types";
import { generateGrounded, type GroundingDocument, type Usage } from "./llm";
import { squash, type Env } from "./util";

export interface DraftSection {
  section_key: string;
  title: string;
  body_md: string;
  citations: Citation[];
}

/** The InnoBeweegLab report skeleton. Order and intent are fixed; prose is generated. */
export const TEMPLATE: { key: string; title: string; brief: string }[] = [
  { key: "summary", title: "Management summary",
    brief: "Six to ten sentences for a councillor or programme manager who will read nothing else. Lead with what was found, not with what was done." },
  { key: "approach", title: "Research approach and sources",
    brief: "What material this study rests on: which sources, which perspectives, how much of each, over what period. State the method plainly." },
  { key: "observations-residents", title: "What residents experience",
    brief: "Observations and findings from the resident and stakeholder perspective. Quote residents where a quote carries the point better than a paraphrase." },
  { key: "observations-experts", title: "Expert assessment",
    brief: "Observations and findings from professional assessments. Say what the experts judged and on what grounds." },
  { key: "observations-quantitative", title: "The measured picture",
    brief: "Findings from the datasets and measurements. Every number must come from the evidence; state n alongside each figure." },
  { key: "synthesis", title: "Cross-source synthesis",
    brief: "Where the three perspectives converge, where they contradict each other, and what none of them covers. Contradictions stay contradictions." },
  { key: "conclusions", title: "Conclusions",
    brief: "What can now be concluded. A conclusion is an interpretive step beyond a finding — mark it as such, and never conclude past the evidence." },
  { key: "recommendations", title: "Recommendations",
    brief: "Short-term (within a year) and long-term (multi-year) recommendations, split under two sub-headings. Each one must trace to a specific finding and name a concrete intervention in this area." },
  { key: "limitations", title: "Limitations and evidence gaps",
    brief: "What this study cannot say: thin material, single-source dimensions, gaps found during triangulation, and what fieldwork would close them." },
];

const REPORT_SYSTEM = `You are drafting a research report for InnoBeweegLab, which studies how public
space can invite people to move, be active and stay healthy, and advises municipalities on it.

The reader is a municipal policy officer, urban planner or designer. They are intelligent,
short of time, and will act on what you write.

House style:
- Dutch research practice: sober, concrete, no marketing language. Plain sentences.
- Distinguish four levels explicitly and never blur them: an OBSERVATION is what was recorded;
  a FINDING is a pattern across observations; a CONCLUSION is an interpretation; a
  RECOMMENDATION is a proposed action. Use the words.
- Write in the language of the evidence pack. If the source material is Dutch, write Dutch.

Absolute constraints:
- Every substantive claim must come from the evidence documents supplied. You have no other
  knowledge of this neighbourhood.
- Never invent a number, a percentage, a quote, a place name or a respondent. If a figure is
  not in the evidence, do not write a figure.
- Where the evidence is thin or the perspectives disagree, say so in the text. Hedged accuracy
  beats confident invention.
- Recommendations must be specific to this area and traceable to a named finding. A
  recommendation that could be pasted into any report in the country is a failure — cut it.
- You are drafting for a researcher who will validate and edit every line. Leave the judgement
  calls visible rather than smoothing them away.`;

/* --------------------------------------------------------- evidence pack -- */

interface Block { id: string; kind: "finding" | "triangulation"; label: string; start: number; end: number }
interface PackDocument extends GroundingDocument { blocks: Block[] }

/**
 * Render the evidence store as plain-text documents and remember the character
 * range of every block. When the model cites a span, the range tells us exactly
 * which finding it drew on — that is what makes the report's references real
 * rather than decorative.
 */
function buildEvidencePack(
  project: Project, sources: Source[], findings: Finding[], triangulations: Triangulation[],
): PackDocument[] {
  const documents: PackDocument[] = [];

  const brief = [
    `PROJECT: ${project.name}`,
    project.municipality ? `MUNICIPALITY: ${project.municipality}` : "",
    project.neighbourhood ? `AREA: ${project.neighbourhood}` : "",
    project.period ? `FIELDWORK PERIOD: ${project.period}` : "",
    project.research_question ? `RESEARCH QUESTION: ${project.research_question}` : "",
    "",
    "SOURCES USED:",
    ...sources.map((s) =>
      `- ${s.name} — ${s.kind}, ${s.perspective} perspective, ${s.format}` +
      `${s.row_count ? `, ${s.row_count} records` : ""}${s.collected_at ? `, collected ${s.collected_at}` : ""}` +
      `${s.notes ? ` — ${s.notes}` : ""}`),
  ].filter(Boolean).join("\n");
  documents.push({ title: "Project brief", content: brief, blocks: [] });

  documents.push(renderBlocks(
    "Evidence store — findings",
    findings.filter((f) => f.status !== "rejected").map((f) => ({
      id: f.id,
      kind: "finding" as const,
      label: `${f.perspective} · ${DIMENSION_LABELS[f.dimension]}`,
      text: [
        `[${f.id}] ${f.perspective.toUpperCase()} PERSPECTIVE · ${DIMENSION_LABELS[f.dimension]}`,
        `Type: ${f.claim_type} · direction: ${f.direction} · evidential strength: ${f.strength} · supported by: ${f.support_n} · method: ${f.method}`,
        `Statement: ${f.statement}`,
        f.detail ? `Nuance: ${f.detail}` : "",
        f.evidence.length ? "Underlying evidence:" : "",
        ...f.evidence.map((e) => `  - ${e.source_name} [${e.locator}]: "${squash(e.excerpt, 300)}"`),
      ].filter(Boolean).join("\n"),
    })),
  ));

  documents.push(renderBlocks(
    "Cross-source triangulation",
    triangulations.map((t) => ({
      id: t.id,
      kind: "triangulation" as const,
      label: `${DIMENSION_LABELS[t.dimension]} · ${t.convergence}`,
      text: [
        `[${t.id}] ${t.title}`,
        `Dimension: ${DIMENSION_LABELS[t.dimension]} · verdict: ${t.convergence} · confidence: ${t.confidence}`,
        `Perspectives involved: ${t.perspectives.join(", ") || "none"}`,
        `Synthesis: ${t.summary}`,
        `Based on findings: ${t.finding_ids.join(", ") || "—"}`,
      ].join("\n"),
    })),
  ));

  return documents;
}

function renderBlocks(
  title: string, items: { id: string; kind: "finding" | "triangulation"; label: string; text: string }[],
): PackDocument {
  const blocks: Block[] = [];
  let content = "";
  for (const item of items) {
    const start = content.length;
    content += `${item.text}\n\n`;
    blocks.push({ id: item.id, kind: item.kind, label: item.label, start, end: content.length });
  }
  return { title, content: content || "(no entries)", blocks };
}

/* ------------------------------------------------------------- generation -- */

const MARKER = (key: string) => `<<<SECTION:${key}>>>`;

export async function generateReport(
  env: Env,
  args: {
    project: Project; sources: Source[]; findings: Finding[];
    triangulations: Triangulation[]; useLlm: boolean;
  },
): Promise<{ sections: DraftSection[]; usage: Usage; engine: string }> {
  const documents = buildEvidencePack(args.project, args.sources, args.findings, args.triangulations);

  if (!args.useLlm) {
    return {
      sections: assembleDeterministic(args.project, args.sources, args.findings, args.triangulations),
      usage: { input_tokens: 0, output_tokens: 0 },
      engine: "heuristic",
    };
  }

  const instruction = [
    `Draft the research report for "${args.project.name}"` +
    `${args.project.neighbourhood ? ` (${args.project.neighbourhood}${args.project.municipality ? `, ${args.project.municipality}` : ""})` : ""}.`,
    "",
    "Emit the sections below in this exact order. Start each one with its marker on its own",
    "line, then the section body in Markdown. Do not repeat the section title as a heading —",
    "the marker supplies it. Do not write anything before the first marker or after the last section.",
    "",
    ...TEMPLATE.map((s) => `${MARKER(s.key)}\n${s.title} — ${s.brief}`),
    "",
    "Cite the evidence documents as you write. A claim without a citation will be flagged for",
    "the researcher as unsupported, so ground each one in the finding or triangulation it rests on.",
  ].join("\n");

  const { spans, usage } = await generateGrounded(env, {
    system: REPORT_SYSTEM,
    instruction,
    documents,
    maxTokens: 32000,
  });

  return { sections: splitIntoSections(spans, documents), usage, engine: "claude" };
}

/**
 * Reassemble the streamed spans into sections and attribute each citation to the
 * section it was written in, then resolve it to the evidence block it points at.
 */
function splitIntoSections(
  spans: { text: string; citations: { document_index: number; cited_text: string; start: number; end: number }[] }[],
  documents: PackDocument[],
): DraftSection[] {
  let full = "";
  const positioned = spans.map((s) => {
    const at = full.length;
    full += s.text;
    return { at, ...s };
  });

  const bounds = TEMPLATE.map((section) => {
    const marker = MARKER(section.key);
    const index = full.indexOf(marker);
    return { ...section, index, contentStart: index >= 0 ? index + marker.length : -1 };
  });

  return bounds.map((section, i) => {
    if (section.index < 0) {
      return { section_key: section.key, title: section.title, body_md: "", citations: [] };
    }
    const nextIndex = bounds.slice(i + 1).find((b) => b.index >= 0)?.index ?? full.length;
    const body = full.slice(section.contentStart, nextIndex).trim();

    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const span of positioned) {
      if (span.at + span.text.length <= section.contentStart || span.at >= nextIndex) continue;
      for (const c of span.citations) {
        const resolved = resolveCitation(documents, c);
        if (!resolved) continue;
        const key = `${resolved.evidence_id}::${resolved.cited_text.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        citations.push(resolved);
      }
    }
    return { section_key: section.key, title: section.title, body_md: body, citations };
  });
}

function resolveCitation(
  documents: PackDocument[],
  c: { document_index: number; cited_text: string; start: number; end: number },
): Citation | null {
  const doc = documents[c.document_index];
  if (!doc) return null;
  const block = doc.blocks.find((b) => c.start >= b.start && c.start < b.end);
  if (!block) return null;
  return {
    evidence_id: block.id,
    kind: block.kind,
    label: block.label,
    cited_text: squash(c.cited_text, 240),
  };
}

/* ----------------------------------------------------- deterministic mode -- */

/**
 * Without an API key the report is assembled directly from the evidence store.
 * The prose is mechanical, but the structure, the numbers and the references are
 * the real ones — so the validation stage has something genuine to work on.
 */
function assembleDeterministic(
  project: Project, sources: Source[], findings: Finding[], triangulations: Triangulation[],
): DraftSection[] {
  const live = findings.filter((f) => f.status !== "rejected");
  const cite = (items: { id: string; label: string; statement: string }[], kind: "finding" | "triangulation"): Citation[] =>
    items.map((f) => ({ evidence_id: f.id, kind, label: f.label, cited_text: squash(f.statement, 200) }));

  const perspectiveSection = (
    key: string, title: string, perspective: Finding["perspective"], lead: string,
  ): DraftSection => {
    const own = live.filter((f) => f.perspective === perspective)
      .sort((a, b) => b.strength - a.strength);
    return {
      section_key: key,
      title,
      body_md: own.length
        ? `${lead}\n\n${own.map((f) =>
            `**${DIMENSION_LABELS[f.dimension]}** — ${f.statement} *(${f.claim_type}, ${f.direction}, ` +
            `strength ${f.strength}, n = ${f.support_n})*` +
            (f.detail ? `\n\n${f.detail}` : "") +
            (f.evidence.length
              ? `\n\n${f.evidence.slice(0, 3).map((e) => `> "${squash(e.excerpt, 220)}"\n> — ${e.source_name} [${e.locator}]`).join("\n>\n")}`
              : "")).join("\n\n")}`
        : `_No findings were produced from the ${perspective} perspective._`,
      citations: cite(own.map((f) => ({ id: f.id, label: `${f.perspective} · ${DIMENSION_LABELS[f.dimension]}`, statement: f.statement })), "finding"),
    };
  };

  const converging = triangulations.filter((t) => t.convergence === "converging");
  const diverging = triangulations.filter((t) => t.convergence === "diverging");
  const single = triangulations.filter((t) => t.convergence === "single-source");
  const gaps = triangulations.filter((t) => t.convergence === "gap");
  const negatives = triangulations
    .filter((t) => t.convergence !== "gap" && t.confidence >= 0.4)
    .sort((a, b) => b.confidence - a.confidence);

  return [
    {
      section_key: "summary",
      title: "Management summary",
      body_md: [
        `This draft covers **${project.name}**` +
        `${project.neighbourhood ? ` in ${project.neighbourhood}` : ""}${project.municipality ? `, ${project.municipality}` : ""}.`,
        `The study draws on ${sources.length} source(s) across ` +
        `${new Set(sources.map((s) => s.perspective)).size} perspective(s), producing ${live.length} findings ` +
        `and ${triangulations.length} triangulated dimensions.`,
        converging.length
          ? `The sources converge on: ${converging.map((t) => DIMENSION_LABELS[t.dimension].toLowerCase()).join(", ")}.`
          : "",
        diverging.length
          ? `They diverge on: ${diverging.map((t) => DIMENSION_LABELS[t.dimension].toLowerCase()).join(", ")} — these need researcher judgement.`
          : "",
        "",
        "_Assembled without a language model. Prose is templated; figures and references are taken directly from the evidence store._",
      ].filter(Boolean).join("\n\n"),
      citations: cite(converging.map((t) => ({ id: t.id, label: `${DIMENSION_LABELS[t.dimension]} · ${t.convergence}`, statement: t.title })), "triangulation"),
    },
    {
      section_key: "approach",
      title: "Research approach and sources",
      body_md: [
        `The analysis combines the three perspectives InnoBeweegLab works with: resident and`,
        `stakeholder voice, expert assessment, and quantitative measurement.`,
        "",
        "| Source | Kind | Perspective | Volume |",
        "| --- | --- | --- | --- |",
        ...sources.map((s) =>
          `| ${s.name} | ${s.kind} | ${s.perspective} | ${s.row_count ? `${s.row_count} records` : "text"} |`),
      ].join("\n"),
      citations: [],
    },
    perspectiveSection("observations-residents", "What residents experience", "resident",
      "Coded from resident and stakeholder material."),
    perspectiveSection("observations-experts", "Expert assessment", "expert",
      "Coded from professional observations and assessments."),
    perspectiveSection("observations-quantitative", "The measured picture", "quantitative",
      "Computed directly from the datasets. Every figure below is calculated, not estimated."),
    {
      section_key: "synthesis",
      title: "Cross-source synthesis",
      body_md: triangulations.length
        ? triangulations.map((t) =>
            `### ${t.title}\n\n*${t.convergence}, confidence ${t.confidence}, perspectives: ` +
            `${t.perspectives.join(", ") || "none"}*\n\n${t.summary}`).join("\n\n")
        : "_Triangulation has not been run yet._",
      citations: cite(triangulations.map((t) => ({ id: t.id, label: `${DIMENSION_LABELS[t.dimension]} · ${t.convergence}`, statement: t.summary })), "triangulation"),
    },
    {
      section_key: "conclusions",
      title: "Conclusions",
      body_md: [
        "The following conclusions are interpretive steps beyond the findings above and are the",
        "researcher's to confirm.",
        "",
        ...converging.map((t) => `- On **${DIMENSION_LABELS[t.dimension].toLowerCase()}**, multiple independent perspectives point the same way (confidence ${t.confidence}).`),
        ...diverging.map((t) => `- On **${DIMENSION_LABELS[t.dimension].toLowerCase()}**, the perspectives conflict; no conclusion is drawn here.`),
        ...single.map((t) => `- **${DIMENSION_LABELS[t.dimension]}** rests on a single perspective and is not yet corroborated.`),
      ].join("\n"),
      citations: cite(triangulations.map((t) => ({ id: t.id, label: `${DIMENSION_LABELS[t.dimension]} · ${t.convergence}`, statement: t.title })), "triangulation"),
    },
    {
      section_key: "recommendations",
      title: "Recommendations",
      body_md: [
        "_Placeholder directions derived mechanically from the triangulated dimensions. These are",
        "deliberately unfinished: without a language model the system cannot phrase a recommendation",
        "that is specific to this area, and a generic recommendation is worse than none._",
        "",
        "### Short term",
        ...negatives.slice(0, 4).map((t) =>
          `- Review **${DIMENSION_LABELS[t.dimension].toLowerCase()}** in the study area — ${squash(t.title, 120)}.`),
        "",
        "### Long term",
        ...negatives.slice(4, 8).map((t) =>
          `- Structural attention to **${DIMENSION_LABELS[t.dimension].toLowerCase()}** in area development.`),
      ].join("\n"),
      citations: cite(negatives.map((t) => ({ id: t.id, label: `${DIMENSION_LABELS[t.dimension]} · ${t.convergence}`, statement: t.title })), "triangulation"),
    },
    {
      section_key: "limitations",
      title: "Limitations and evidence gaps",
      body_md: [
        gaps.length
          ? `Dimensions touched by the material but not supported by any finding: ` +
            `${gaps.map((t) => DIMENSION_LABELS[t.dimension].toLowerCase()).join(", ")}.`
          : "No unresolved evidence gaps were detected.",
        "",
        single.length
          ? `Single-perspective dimensions (not corroborated): ${single.map((t) => DIMENSION_LABELS[t.dimension].toLowerCase()).join(", ")}.`
          : "",
        "",
        "This draft was assembled without a language model, so no interpretive synthesis was performed.",
      ].filter(Boolean).join("\n"),
      citations: cite(gaps.map((t) => ({ id: t.id, label: `${DIMENSION_LABELS[t.dimension]} · gap`, statement: t.summary })), "triangulation"),
    },
  ];
}
