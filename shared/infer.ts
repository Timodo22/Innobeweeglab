import type { ColumnSpec, Dimension } from "./types";

type Cell = string | number | null;

const LIKERT_HINTS = /(score|rating|beoordeling|cijfer|rapportcijfer|tevreden|eens|schaal|scale|likert)/i;
const ID_HINTS = /^(id|respondent|respondentid|resp|nr|nummer|case|record)$/i;
const GROUP_HINTS = /(buurt|wijk|locatie|gebied|plek|straat|leeftijd|geslacht|groep|categorie|type|park|neighbourhood|neighborhood|district|location|area|age|gender|group|category|segment)/i;
const TEXT_HINTS = /(opmerking|toelichting|antwoord|open|waarom|wat |suggestie|comment|remark|answer|why|explain|feedback|quote|notitie|note)/i;

const isBlank = (v: Cell) => v === null || v === undefined || String(v).trim() === "";

function numericRatio(values: Cell[]): number {
  const filled = values.filter((v) => !isBlank(v));
  if (!filled.length) return 0;
  const numeric = filled.filter((v) => typeof v === "number" || /^-?\d+([.,]\d+)?$/.test(String(v).trim()));
  return numeric.length / filled.length;
}

export function toNumber(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort column typing for an uploaded sheet. The researcher confirms or
 * overrides this in the Standardize stage before anything is committed — the
 * guess is a starting point, never the final word.
 */
export function inferColumns(header: string[], rows: Cell[][]): ColumnSpec[] {
  return header.map((name, i) => {
    const column = rows.map((r) => r[i] ?? null);
    const filled = column.filter((v) => !isBlank(v));
    const ratio = numericRatio(column);
    const distinct = new Set(filled.map((v) => String(v).trim().toLowerCase()));
    const avgLength = filled.length
      ? filled.reduce((total: number, v) => total + String(v).length, 0) / filled.length
      : 0;

    if (ID_HINTS.test(name.trim())) {
      return { name, type: "text", role: "id", dimension: null };
    }

    if (ratio > 0.85) {
      const nums = column.map(toNumber).filter((n): n is number => n !== null);
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const integral = nums.every((n) => Number.isInteger(n));
      const looksLikeScale =
        integral && min >= 0 && max <= 10 && distinct.size <= 11 &&
        (LIKERT_HINTS.test(name) || distinct.size >= 3);
      return {
        name,
        type: looksLikeScale ? "scale" : "number",
        role: "measure",
        dimension: guessDimension(name),
        scale_min: looksLikeScale ? Math.min(min, 1) : null,
        scale_max: looksLikeScale ? Math.max(max, 5) : null,
        unit: null,
      };
    }

    if (avgLength > 25 || TEXT_HINTS.test(name)) {
      return { name, type: "text", role: "open-text", dimension: guessDimension(name) };
    }

    if (distinct.size > 0 && distinct.size <= Math.max(12, rows.length * 0.3)) {
      return {
        name,
        type: "category",
        role: GROUP_HINTS.test(name) ? "group" : "ignore",
        dimension: null,
      };
    }

    return { name, type: "text", role: "ignore", dimension: null };
  });
}

const DIMENSION_HINTS: [Dimension, RegExp][] = [
  ["safety", /(veilig|safety|verkeer|traffic|criminal|crime)/i],
  ["accessibility", /(toegankelijk|access|drempel|rolstoel|wheelchair)/i],
  ["greenery", /(groen|green|boom|tree|natuur|nature|aantrekkelijk|attractive)/i],
  ["facilities", /(voorziening|facilit|speel|play|sport|toilet|equipment)/i],
  ["comfort", /(bank|bench|zit|seat|schaduw|shade|verlichting|light|comfort)/i],
  ["connectivity", /(route|pad|path|fiets|cycl|verbind|connect|wandel|walk)/i],
  ["inclusivity", /(inclusi|ouderen|elderly|kind|child|beperking|disab|leeftijd|age)/i],
  ["maintenance", /(onderhoud|maintenance|schoon|clean|afval|litter|vuil)/i],
  ["social-encounter", /(ontmoet|social|buren|neighbour|neighbor|samen|community)/i],
  ["programming", /(activiteit|activit|programma|program|les|event)/i],
  ["nuisance", /(overlast|nuisance|geluid|noise|stank|smell|druk|crowd)/i],
  ["wayfinding", /(bewegwijzering|wayfind|bord|sign|verdwaal|lost)/i],
];

export function guessDimension(name: string): Dimension | null {
  for (const [dim, re] of DIMENSION_HINTS) if (re.test(name)) return dim;
  return null;
}
