import type { Observation, Source } from "../shared/types";
import { toNumber } from "../shared/infer";
import { primaryDimension, segment } from "./lexicon";
import { squash } from "./util";

type NewObservation = Omit<Observation, "id" | "created_at">;

/**
 * Stage 2 — map heterogeneous sources onto the standardized research model.
 *
 * Everything downstream (all three analysis lanes, triangulation, generation)
 * reads observations only. That is the whole point of this stage: one shape, one
 * dimension vocabulary, and a `locator` on every row that points back into the
 * original file so any claim can be traced to the cell or sentence it came from.
 */
export function standardizeSource(source: Source): NewObservation[] {
  return source.format === "csv" || source.format === "xlsx"
    ? standardizeTabular(source)
    : standardizeText(source);
}

function standardizeTabular(source: Source): NewObservation[] {
  const columns = source.columns ?? [];
  const rows = source.rows ?? [];
  const out: NewObservation[] = [];

  const idIndex = columns.findIndex((c) => c.role === "id");
  const groupIndexes = columns.map((c, i) => (c.role === "group" ? i : -1)).filter((i) => i >= 0);

  rows.forEach((row, rowIndex) => {
    const respondent = idIndex >= 0 ? stringOrNull(row[idIndex]) : `r${rowIndex + 1}`;
    const location = groupIndexes.length ? stringOrNull(row[groupIndexes[0]]) : null;

    columns.forEach((col, colIndex) => {
      const raw = row[colIndex] ?? null;
      if (raw === null || String(raw).trim() === "") return;

      if (col.role === "measure") {
        const value = toNumber(raw);
        if (value === null) return;
        out.push({
          project_id: source.project_id,
          source_id: source.id,
          perspective: source.perspective,
          modality: "measure",
          dimension: col.dimension ?? null,
          variable: col.name,
          location,
          respondent,
          value_num: value,
          value_text: null,
          unit: col.unit ?? null,
          scale_min: col.scale_min ?? null,
          scale_max: col.scale_max ?? null,
          locator: `row:${rowIndex + 1}:${col.name}`,
        });
        return;
      }

      if (col.role === "open-text") {
        const value = String(raw).trim();
        if (value.length < 3) return;
        out.push({
          project_id: source.project_id,
          source_id: source.id,
          perspective: source.perspective,
          modality: "statement",
          dimension: col.dimension ?? primaryDimension(value),
          variable: col.name,
          location,
          respondent,
          value_num: null,
          value_text: value,
          unit: null,
          scale_min: null,
          scale_max: null,
          locator: `row:${rowIndex + 1}:${col.name}`,
        });
      }
    });
  });

  return out;
}

function standardizeText(source: Source): NewObservation[] {
  const text = source.raw_text ?? "";
  if (!text.trim()) return [];
  const modality = source.perspective === "expert" ? "assessment" : "statement";

  return segment(text)
    // An interviewer's question is not evidence; only the answers are.
    .filter((s) => !/^(interviewer|onderzoeker|moderator|i)$/i.test(s.speaker ?? ""))
    .filter((s) => s.body.length >= 15)
    .map((s) => ({
      project_id: source.project_id,
      source_id: source.id,
      perspective: source.perspective,
      modality,
      dimension: primaryDimension(s.body),
      variable: null,
      location: null,
      respondent: s.speaker,
      value_num: null,
      value_text: squash(s.body, 1200),
      unit: null,
      scale_min: null,
      scale_max: null,
      locator: `char:${s.start}-${s.end}`,
    }));
}

function stringOrNull(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
