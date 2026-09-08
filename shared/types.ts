/** Types shared by the React frontend and the Cloudflare Pages Functions API. */

export type Perspective = "quantitative" | "resident" | "expert";
export type SourceKind = "dataset" | "survey" | "interview" | "expert";
export type SourceFormat = "csv" | "xlsx" | "docx" | "text";
export type Modality = "measure" | "statement" | "assessment";
export type Direction = "positive" | "negative" | "mixed" | "neutral";
export type Convergence = "converging" | "diverging" | "single-source" | "gap";
export type SectionStatus = "draft" | "approved" | "revised" | "rejected";
export type FindingStatus = "open" | "accepted" | "rejected";

/**
 * The active-friendly design dimensions InnoBeweegLab reasons about. Findings from
 * all three perspectives are pinned to this shared vocabulary, which is what makes
 * cross-source triangulation possible at all.
 */
export const DIMENSIONS = [
  "accessibility",
  "safety",
  "greenery",
  "facilities",
  "comfort",
  "connectivity",
  "inclusivity",
  "maintenance",
  "social-encounter",
  "programming",
  "nuisance",
  "wayfinding",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  accessibility: "Accessibility",
  safety: "Safety",
  greenery: "Greenery & attractiveness",
  facilities: "Facilities & amenities",
  comfort: "Comfort (seating, shade, light)",
  connectivity: "Routes & connectivity",
  inclusivity: "Inclusivity",
  maintenance: "Maintenance & cleanliness",
  "social-encounter": "Social encounter",
  programming: "Programming & activities",
  nuisance: "Nuisance & noise",
  wayfinding: "Wayfinding",
};

export interface Project {
  id: string;
  name: string;
  municipality: string | null;
  neighbourhood: string | null;
  research_question: string | null;
  period: string | null;
  created_at: string;
  updated_at: string;
}

export interface ColumnSpec {
  name: string;
  type: "number" | "text" | "scale" | "category";
  role: "measure" | "open-text" | "group" | "id" | "ignore";
  dimension?: Dimension | null;
  scale_min?: number | null;
  scale_max?: number | null;
  unit?: string | null;
}

export interface Source {
  id: string;
  project_id: string;
  name: string;
  kind: SourceKind;
  perspective: Perspective;
  format: SourceFormat;
  collected_at: string | null;
  notes: string | null;
  raw_text: string | null;
  columns: ColumnSpec[] | null;
  rows: (string | number | null)[][] | null;
  row_count: number;
  standardized: boolean;
  created_at: string;
}

export type SourceSummary = Omit<Source, "raw_text" | "rows"> & {
  text_length: number;
};

export interface Observation {
  id: string;
  project_id: string;
  source_id: string;
  perspective: Perspective;
  modality: Modality;
  dimension: Dimension | null;
  variable: string | null;
  location: string | null;
  respondent: string | null;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  scale_min: number | null;
  scale_max: number | null;
  locator: string;
  created_at: string;
}

export interface EvidenceRef {
  observation_id: string;
  source_id: string;
  source_name: string;
  locator: string;
  excerpt: string;
}

export interface Finding {
  id: string;
  project_id: string;
  perspective: Perspective;
  dimension: Dimension;
  claim_type: "observation" | "finding";
  statement: string;
  detail: string | null;
  direction: Direction;
  strength: number;
  support_n: number;
  method: string;
  evidence: EvidenceRef[];
  status: FindingStatus;
  created_at: string;
}

export interface Triangulation {
  id: string;
  project_id: string;
  dimension: Dimension;
  title: string;
  convergence: Convergence;
  summary: string;
  perspectives: Perspective[];
  finding_ids: string[];
  confidence: number;
  created_at: string;
}

export interface Citation {
  evidence_id: string;
  kind: "finding" | "triangulation";
  label: string;
  cited_text: string;
}

export interface ReportSection {
  id: string;
  report_id: string;
  project_id: string;
  section_key: string;
  title: string;
  position: number;
  body_md: string;
  citations: Citation[];
  status: SectionStatus;
  reviewer_note: string | null;
  edited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  project_id: string;
  title: string;
  template: string;
  engine: string;
  status: "draft" | "in-review" | "approved";
  created_at: string;
  updated_at: string;
  sections: ReportSection[];
}

export interface Run {
  id: string;
  project_id: string;
  stage: StageId;
  engine: string;
  status: "ok" | "error";
  message: string | null;
  detail: Record<string, unknown> | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  created_at: string;
}

export type StageId =
  | "ingest"
  | "model"
  | "analyse"
  | "evidence"
  | "triangulate"
  | "generate"
  | "report"
  | "validate";

/** Per-stage counters that drive the pipeline overview and the stage badges. */
export interface ProjectStatus {
  project: Project;
  counts: {
    sources: number;
    sources_standardized: number;
    observations: number;
    findings: number;
    findings_by_perspective: Record<Perspective, number>;
    triangulations: number;
    sections: number;
    sections_approved: number;
  };
  report_id: string | null;
  runs: Run[];
  llm_available: boolean;
}

export interface QuantSummary {
  variable: string;
  dimension: Dimension | null;
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  median: number;
  scale_min: number | null;
  scale_max: number | null;
  distribution: { bucket: string; count: number }[];
  by_group?: { group: string; n: number; mean: number }[];
}
