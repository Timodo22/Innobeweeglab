import type { ProjectStatus, StageId } from "../../shared/types";

export interface Stage {
  id: StageId;
  path: string;
  index: number;
  label: string;
  diagramLabel: string;
  blurb: string;
  /** Short counter shown in the sidebar and on the diagram node. */
  note: (s: ProjectStatus) => string;
  done: (s: ProjectStatus) => boolean;
  ready: (s: ProjectStatus) => boolean;
}

export const STAGES: Stage[] = [
  {
    id: "ingest", path: "ingest", index: 1,
    label: "Data ingestion", diagramLabel: "Data ingestion",
    blurb: "Excel and CSV files, survey exports, interview transcripts and expert assessments enter the pipeline here.",
    note: (s) => `${s.counts.sources}`,
    done: (s) => s.counts.sources > 0,
    ready: () => true,
  },
  {
    id: "model", path: "model", index: 2,
    label: "Research model", diagramLabel: "Standardized research model",
    blurb: "Every source is mapped onto one shared shape: observations tagged with a perspective, a design dimension, and a locator pointing back into the original file.",
    note: (s) => `${s.counts.observations}`,
    done: (s) => s.counts.observations > 0 && s.counts.sources_standardized === s.counts.sources,
    ready: (s) => s.counts.sources > 0,
  },
  {
    id: "analyse", path: "analyse", index: 3,
    label: "Analysis lanes", diagramLabel: "Qualitative · Expert · Quantitative",
    blurb: "Three lanes run over the standardized model: thematic coding of resident voice, structuring of expert assessment, and descriptive statistics over the datasets.",
    note: (s) => `${s.counts.findings}`,
    done: (s) => s.counts.findings > 0,
    ready: (s) => s.counts.observations > 0,
  },
  {
    id: "evidence", path: "evidence", index: 4,
    label: "Evidence store", diagramLabel: "Evidence / finding store",
    blurb: "One reviewable register of every finding, what supports it, and how strong that support is. Reject anything that does not hold up before it reaches the report.",
    note: (s) => `${s.counts.findings}`,
    done: (s) => s.counts.findings > 0,
    ready: (s) => s.counts.findings > 0,
  },
  {
    id: "triangulate", path: "triangulate", index: 5,
    label: "Triangulation", diagramLabel: "Cross-source triangulation",
    blurb: "Findings are grouped per design dimension across the three perspectives to expose where they agree, where they contradict each other, and where evidence is missing.",
    note: (s) => `${s.counts.triangulations}`,
    done: (s) => s.counts.triangulations > 0,
    ready: (s) => s.counts.findings > 0,
  },
  {
    id: "generate", path: "generate", index: 6,
    label: "Grounded generation", diagramLabel: "Grounded LLM generation",
    blurb: "Claude drafts the report over the evidence pack with citations enabled, so every claim carries a character-exact reference back to the finding it came from.",
    note: (s) => (s.counts.sections ? `${s.counts.sections}` : "—"),
    done: (s) => s.counts.sections > 0,
    ready: (s) => s.counts.findings > 0,
  },
  {
    id: "report", path: "report", index: 7,
    label: "Draft report", diagramLabel: "Draft report + source references",
    blurb: "The draft, section by section, with the source references the model actually used while writing each part.",
    note: (s) => (s.counts.sections ? `${s.counts.sections}` : "—"),
    done: (s) => s.counts.sections > 0,
    ready: (s) => s.counts.sections > 0,
  },
  {
    id: "validate", path: "validate", index: 8,
    label: "Validation", diagramLabel: "Researcher validation",
    blurb: "The researcher stays in control: edit, approve or reject each section, then export the validated draft.",
    note: (s) => (s.counts.sections ? `${s.counts.sections_approved}/${s.counts.sections}` : "—"),
    done: (s) => s.counts.sections > 0 && s.counts.sections_approved === s.counts.sections,
    ready: (s) => s.counts.sections > 0,
  },
];

export const stageById = (id: StageId): Stage =>
  STAGES.find((s) => s.id === id) ?? STAGES[0];

export const PERSPECTIVE_LABEL: Record<string, string> = {
  quantitative: "Quantitative",
  resident: "Resident voice",
  expert: "Expert assessment",
};

export const PERSPECTIVE_TONE: Record<string, string> = {
  quantitative: "blue",
  resident: "green",
  expert: "violet",
};
