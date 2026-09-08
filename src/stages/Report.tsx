import { StageHead } from "../components/StageHead";
import { Badge, Empty, Notice, Spinner, useAsync } from "../components/ui";
import { api, downloadExport } from "../lib/api";
import { CitationChips, Markdown } from "../lib/markdown";
import { useProject } from "../lib/project";

export function ReportStage() {
  const { status } = useProject();
  const projectId = status.project.id;
  const report = useAsync(() => api.getReport(projectId), [projectId, status.counts.sections]);

  const slug = status.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  return (
    <div className="page wide">
      <StageHead
        id="report"
        actions={
          report.data ? (
            <>
              <button className="btn small" onClick={() => downloadExport(projectId, "md", `${slug}.md`)}>
                Export Markdown
              </button>
              <button className="btn small" onClick={() => downloadExport(projectId, "html", `${slug}.html`)}>
                Export HTML
              </button>
            </>
          ) : null
        }
      />

      {report.loading ? (
        <div className="row"><Spinner /> Loading draft…</div>
      ) : !report.data ? (
        <Empty title="No draft yet">
          <p>Run grounded generation to produce one.</p>
        </Empty>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 16 }}>
            <div className="row tight">
              <Badge tone={report.data.status === "approved" ? "green" : "amber"}>{report.data.status}</Badge>
              <span className="tiny muted mono">{report.data.engine}</span>
            </div>
            <span className="tiny muted">
              {report.data.sections.reduce((a, s) => a + s.citations.length, 0)} source references across{" "}
              {report.data.sections.length} sections
            </span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Notice tone="info">
              This is a draft for a researcher, not a finished report. Interpretation, final conclusions
              and policy recommendations stay with you — the next stage is where you edit and sign off.
            </Notice>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 46rem) 1fr", gap: 20, alignItems: "start" }}>
            <div className="doc">
              {report.data.sections.map((section) => (
                <section key={section.id} id={section.section_key}>
                  <h2>{section.title}</h2>
                  {section.body_md
                    ? <Markdown source={section.body_md} />
                    : <p className="muted"><em>This section came back empty.</em></p>}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--ink-200)" }}>
                    <div className="tiny muted" style={{ marginBottom: 6 }}>Source references</div>
                    <CitationChips citations={section.citations} />
                  </div>
                </section>
              ))}
            </div>

            <aside className="card" style={{ position: "sticky", top: 78 }}>
              <div className="card-head"><h3>Sections</h3></div>
              <div className="stack" style={{ gap: 5 }}>
                {report.data.sections.map((section) => (
                  <a key={section.id} href={`#${section.section_key}`}
                    className="row between tiny" style={{ textDecoration: "none", color: "inherit", gap: 8 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {section.title}
                    </span>
                    <Badge tone={section.citations.length ? "green" : "amber"}>
                      {section.citations.length || "0"}
                    </Badge>
                  </a>
                ))}
              </div>
              <div className="tiny muted" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--ink-100)" }}>
                The number is how many evidence references the model cited while writing that section.
                A zero is a prompt to check the claim yourself.
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
