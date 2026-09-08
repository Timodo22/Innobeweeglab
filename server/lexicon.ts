import type { Dimension } from "../shared/types";
import { DIMENSIONS } from "../shared/types";

/**
 * Keyword lexicon for the active-friendly design dimensions, in Dutch and English.
 * InnoBeweegLab's field data is predominantly Dutch, so both languages are needed.
 *
 * This drives two things:
 *  - heuristic mode, where the pipeline runs with no LLM at all;
 *  - a deterministic pre-pass in LLM mode, so segments are pre-tagged and the
 *    model is asked to code a bounded, relevant set of text rather than everything.
 */
const KEYWORDS: Record<Dimension, string[]> = {
  accessibility: ["toegankelijk", "drempel", "rolstoel", "rollator", "scootmobiel", "obstakel",
    "helling", "stoep", "trottoir", "bereikbaar", "accessible", "wheelchair", "kerb", "curb",
    "step-free", "ramp", "barrier"],
  safety: ["veilig", "onveilig", "veiligheid", "verkeer", "auto", "snelheid", "hard rijden",
    "oversteken", "kruispunt", "eng", "donker", "criminaliteit", "hangjongeren",
    "safety", "unsafe", "traffic", "speeding", "crossing", "crime", "scary"],
  greenery: ["groen", "boom", "bomen", "beplanting", "gras", "plantsoen", "bloemen", "park",
    "natuur", "schaduwrijk", "green", "tree", "trees", "planting", "grass", "nature",
    "attractive", "aantrekkelijk", "mooi", "lelijk", "steenachtig", "versteend"],
  facilities: ["speeltuin", "speeltoestel", "sporttoestel", "fitness", "veldje", "voetbalveld",
    "basketbal", "toilet", "drinkwater", "watertappunt", "prullenbak", "fietsenstalling",
    "playground", "equipment", "sports", "pitch", "court", "toilet", "drinking water", "bin"],
  comfort: ["bankje", "bankjes", "zitten", "zitplek", "schaduw", "verlichting", "lantaarn",
    "licht", "beschutting", "luifel", "rust", "bench", "seating", "shade", "lighting",
    "shelter", "rest"],
  connectivity: ["route", "pad", "wandelpad", "fietspad", "verbinding", "doorsteek", "omweg",
    "netwerk", "rondje", "ommetje", "path", "trail", "cycle", "route", "connection", "detour",
    "loop", "network"],
  inclusivity: ["ouderen", "senioren", "kinderen", "jongeren", "gezin", "beperking", "handicap",
    "iedereen", "meisjes", "jongens", "cultuur", "taal", "elderly", "seniors", "children",
    "youth", "disability", "everyone", "inclusive", "girls", "boys"],
  maintenance: ["onderhoud", "vuil", "zwerfafval", "afval", "hondenpoep", "kapot", "vernield",
    "graffiti", "onkruid", "schoon", "verwaarloosd", "maintenance", "litter", "rubbish",
    "dog", "broken", "vandalism", "weeds", "clean", "neglected"],
  "social-encounter": ["ontmoeten", "ontmoeting", "buren", "praatje", "samen", "sociaal",
    "eenzaam", "verbinding met buurt", "meet", "encounter", "neighbours", "neighbors",
    "social", "lonely", "together", "community"],
  programming: ["activiteit", "les", "buurtsport", "beweegles", "evenement", "markt",
    "programma", "vereniging", "buurtcoach", "activity", "class", "event", "programme",
    "program", "club", "coach", "lesson"],
  nuisance: ["overlast", "geluid", "lawaai", "herrie", "stank", "drukte", "scooters",
    "brommers", "rommel", "nuisance", "noise", "smell", "crowded", "mopeds", "disturbance"],
  wayfinding: ["bewegwijzering", "bordje", "bord", "wegwijzer", "verdwalen", "onduidelijk",
    "zichtbaar", "vindbaar", "signage", "sign", "signpost", "lost", "unclear", "visible",
    "findable", "wayfinding"],
};

const POSITIVE = ["fijn", "prettig", "mooi", "goed", "leuk", "blij", "tevreden", "veilig",
  "schoon", "gezellig", "rustig", "genieten", "top", "geweldig", "verbeterd", "good", "nice",
  "pleasant", "safe", "clean", "enjoy", "great", "improved", "happy", "love"];
const NEGATIVE = ["niet", "geen", "slecht", "vies", "onveilig", "eng", "kapot", "jammer",
  "mist", "ontbreekt", "te weinig", "te druk", "overlast", "bang", "vervelend", "irritant",
  "gevaarlijk", "verwaarloosd", "bad", "dirty", "unsafe", "broken", "missing", "lack",
  "too few", "too busy", "afraid", "annoying", "dangerous", "neglected", "never", "no "];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

/** Score a piece of text against every dimension; returns matches sorted by hit count. */
export function tagDimensions(input: string): { dimension: Dimension; hits: string[] }[] {
  const t = norm(input);
  const out: { dimension: Dimension; hits: string[] }[] = [];
  for (const dim of DIMENSIONS) {
    const hits = KEYWORDS[dim].filter((k) => t.includes(norm(k)));
    if (hits.length) out.push({ dimension: dim, hits });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length);
}

export function primaryDimension(input: string): Dimension | null {
  return tagDimensions(input)[0]?.dimension ?? null;
}

/** Crude polarity, only used to give heuristic-mode findings a direction. */
export function polarity(input: string): { direction: "positive" | "negative" | "mixed" | "neutral"; score: number } {
  const t = norm(input);
  const pos = POSITIVE.filter((w) => t.includes(norm(w))).length;
  const neg = NEGATIVE.filter((w) => t.includes(norm(w))).length;
  if (pos === 0 && neg === 0) return { direction: "neutral", score: 0 };
  if (pos > 0 && neg > 0 && Math.abs(pos - neg) <= 1) return { direction: "mixed", score: 0 };
  return neg > pos
    ? { direction: "negative", score: -(neg - pos) }
    : { direction: "positive", score: pos - neg };
}

/** Split a transcript into speaker turns or paragraphs, keeping char offsets for provenance. */
export function segment(text: string): { start: number; end: number; speaker: string | null; body: string }[] {
  const segments: { start: number; end: number; speaker: string | null; body: string }[] = [];
  const re = /(^|\n)\s*([A-Z][\w .'-]{0,28}?|R\d{1,3}|Respondent \d{1,3}|Interviewer)\s*:\s*/g;
  const marks: { index: number; speaker: string; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    marks.push({ index: m.index + m[1].length, speaker: m[2].trim(), length: m[0].length - m[1].length });
  }
  if (marks.length >= 2) {
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index + marks[i].length;
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      const body = text.slice(start, end).trim();
      if (body.length > 2) segments.push({ start, end, speaker: marks[i].speaker, body });
    }
    return segments;
  }
  // No speaker labels — fall back to paragraphs.
  let cursor = 0;
  for (const para of text.split(/\n{2,}/)) {
    const start = text.indexOf(para, cursor);
    if (start < 0) continue;
    cursor = start + para.length;
    const body = para.trim();
    if (body.length > 2) segments.push({ start, end: start + para.length, speaker: null, body });
  }
  return segments;
}
