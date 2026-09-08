import { useCallback } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Notice, Spinner, useAsync } from "./components/ui";
import { api } from "./lib/api";
import { ProjectProvider } from "./lib/project";
import { ProjectsPage } from "./stages/Projects";
import { OverviewStage } from "./stages/Overview";
import { IngestStage } from "./stages/Ingest";
import { ModelStage } from "./stages/Model";
import { AnalyseStage } from "./stages/Analyse";
import { EvidenceStage } from "./stages/Evidence";
import { TriangulateStage } from "./stages/Triangulate";
import { GenerateStage } from "./stages/Generate";
import { ReportStage } from "./stages/Report";
import { ValidateStage } from "./stages/Validate";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/p/:projectId/*" element={<ProjectShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ProjectShell() {
  const { projectId = "" } = useParams();
  const status = useAsync(() => api.status(projectId), [projectId]);
  const projects = useAsync(() => api.listProjects(), []);
  const health = useAsync(() => api.health(), []);

  const reload = useCallback(() => {
    status.reload();
  }, [status]);

  if (status.loading && !status.data) {
    return (
      <div className="page" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Spinner /> Loading project…
      </div>
    );
  }

  if (status.error || !status.data) {
    return (
      <div className="page">
        <Notice tone="error">
          {status.error ?? "Project not found."} — <a href="/">back to projects</a>
        </Notice>
      </div>
    );
  }

  const project = status.data.project;

  return (
    <ProjectProvider value={{ status: status.data, reload }}>
      <div className="shell">
        <Sidebar status={status.data} projects={projects.data ?? [project]} health={health.data} />
        <div className="main">
          <header className="topbar">
            <div>
              <h1>{project.name}</h1>
              <div className="topbar-meta">
                {[project.municipality, project.neighbourhood, project.period]
                  .filter(Boolean).join(" · ") || "No context set"}
              </div>
            </div>
            <div className="row tight">
              {status.loading ? <Spinner /> : null}
              <button className="btn small ghost" onClick={reload} title="Reload project state">Refresh</button>
            </div>
          </header>
          <Routes>
            <Route index element={<OverviewStage />} />
            <Route path="ingest" element={<IngestStage />} />
            <Route path="model" element={<ModelStage />} />
            <Route path="analyse" element={<AnalyseStage />} />
            <Route path="evidence" element={<EvidenceStage />} />
            <Route path="triangulate" element={<TriangulateStage />} />
            <Route path="generate" element={<GenerateStage />} />
            <Route path="report" element={<ReportStage />} />
            <Route path="validate" element={<ValidateStage />} />
            <Route path="*" element={<Navigate to="." replace />} />
          </Routes>
        </div>
      </div>
    </ProjectProvider>
  );
}
