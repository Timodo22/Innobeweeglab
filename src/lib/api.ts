import type {
  ColumnSpec, Finding, FindingStatus, Observation, Perspective, Project, ProjectStatus,
  QuantSummary, Report, ReportSection, SectionStatus, Source, SourceSummary, Triangulation,
} from "../../shared/types";

const PASSWORD_KEY = "ibl.password";

export const auth = {
  get: () => localStorage.getItem(PASSWORD_KEY) ?? "",
  set: (value: string) => localStorage.setItem(PASSWORD_KEY, value),
  clear: () => localStorage.removeItem(PASSWORD_KEY),
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const password = auth.get();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(password ? { "x-app-password": password } : {}),
      ...init.headers,
    },
  });
  const raw = await response.text();
  const data = raw ? safeParse(raw) : {};
  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data
      ? String((data as { error: unknown }).error)
      : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return { error: raw.slice(0, 300) }; }
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const api = {
  health: () => call<{ ok: boolean; llm_available: boolean; model: string | null; auth_required: boolean }>("/health"),

  listProjects: () => call<{ projects: Project[] }>("/projects").then((r) => r.projects),
  createProject: (input: Partial<Project> & { name: string }) =>
    post<{ project: Project }>("/projects", input).then((r) => r.project),
  createDemo: () => post<{ project: Project }>("/projects", { demo: true }).then((r) => r.project),
  status: (projectId: string) => call<ProjectStatus>(`/projects/${projectId}`),
  updateProject: (projectId: string, input: Partial<Project>) =>
    patch<{ project: Project }>(`/projects/${projectId}`, input).then((r) => r.project),
  deleteProject: (projectId: string) => call<{ ok: true }>(`/projects/${projectId}`, { method: "DELETE" }),

  listSources: (projectId: string) =>
    call<{ sources: SourceSummary[] }>(`/projects/${projectId}/sources`).then((r) => r.sources),
  getSource: (projectId: string, sourceId: string) =>
    call<{ source: Source }>(`/projects/${projectId}/sources/${sourceId}`).then((r) => r.source),
  addSource: (projectId: string, source: Partial<Source>) =>
    post<{ source: SourceSummary }>(`/projects/${projectId}/sources`, source).then((r) => r.source),
  updateColumns: (projectId: string, sourceId: string, columns: ColumnSpec[]) =>
    patch<{ ok: true }>(`/projects/${projectId}/sources/${sourceId}`, { columns }),
  deleteSource: (projectId: string, sourceId: string) =>
    call<{ ok: true }>(`/projects/${projectId}/sources/${sourceId}`, { method: "DELETE" }),

  standardize: (projectId: string, sourceIds?: string[]) =>
    post<{ observations: number; sources: number }>(`/projects/${projectId}/standardize`, { source_ids: sourceIds }),
  listObservations: (projectId: string, perspective?: Perspective) =>
    call<{ observations: Observation[] }>(
      `/projects/${projectId}/observations${perspective ? `?perspective=${perspective}` : ""}`,
    ).then((r) => r.observations),

  analyse: (projectId: string, lane: "quantitative" | "resident" | "expert" | "all") =>
    post<{ lanes: Record<string, { findings: number; engine: string; note?: string }>; quant_summaries: QuantSummary[] }>(
      `/projects/${projectId}/analyse`, { lane },
    ),
  listFindings: (projectId: string) =>
    call<{ findings: Finding[] }>(`/projects/${projectId}/findings`).then((r) => r.findings),
  setFindingStatus: (projectId: string, findingId: string, status: FindingStatus) =>
    patch<{ ok: true }>(`/projects/${projectId}/findings/${findingId}`, { status }),

  triangulate: (projectId: string) =>
    post<{ triangulations: Triangulation[]; engine: string }>(`/projects/${projectId}/triangulate`),
  listTriangulations: (projectId: string) =>
    call<{ triangulations: Triangulation[] }>(`/projects/${projectId}/triangulations`).then((r) => r.triangulations),

  generateReport: (projectId: string) =>
    post<{ report: Report }>(`/projects/${projectId}/report`).then((r) => r.report),
  getReport: (projectId: string) =>
    call<{ report: Report | null }>(`/projects/${projectId}/report`).then((r) => r.report),
  updateSection: (
    projectId: string, sectionId: string,
    body: { body_md?: string; status?: SectionStatus; reviewer_note?: string | null; edited_by?: string | null },
  ) => patch<{ section: ReportSection }>(`/projects/${projectId}/report/sections/${sectionId}`, body)
    .then((r) => r.section),
  setReportStatus: (projectId: string, status: Report["status"]) =>
    patch<{ report: Report }>(`/projects/${projectId}/report`, { status }).then((r) => r.report),

  exportUrl: (projectId: string, format: "md" | "html") =>
    `/api/projects/${projectId}/export?format=${format}`,
};

/**
 * Exports are plain GETs, but the API may sit behind a shared password that a
 * browser navigation cannot carry — so fetch with the header and save the blob.
 */
export async function downloadExport(projectId: string, format: "md" | "html", filename: string): Promise<void> {
  const password = auth.get();
  const response = await fetch(api.exportUrl(projectId, format), {
    headers: password ? { "x-app-password": password } : {},
  });
  if (!response.ok) throw new ApiError(response.status, `Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
