import { Link } from "react-router-dom";
import { PipelineDiagram } from "../components/Diagram";
import { Badge, Empty, Stat, relativeTime } from "../components/ui";
import { STAGES } from "../lib/pipeline";
import { useProject } from "../lib/project";

export function OverviewStage() {
  const { status } = useProject();
  const { counts, project } = status;
  const next = STAGES.find((s) => !s.done(status) && s.ready(status)) ?? null;

  return (
    <div className="page wide">
      <div className="stage-head">
        <div className="stage-eyebrow">Pipeline overview</div>
        <h2>From data to evidence-based recommendations</h2>
        <p>
          Four kinds of research material enter on the left. Everything is normalised into one
          research model, analysed along three independent lanes, collected in an evidence store,
          triangulated across sources, and only then written up — with every claim traceable back
          to the observation it came from. The researcher validates the result.
        </p>
      </div>

      {next ? (
        <div className="notice info" style={{ marginBottom: 18 }}>
          <span>
            Next step: <strong>{next.label}</strong> — {next.blurb}{" "}
            <Link to={`/p/${project.id}/${next.path}`}>Open stage →</Link>
          </span>
        </div>
      ) : counts.sections_approved === counts.sections && counts.sections > 0 ? (
        <div className="notice ok" style={{ marginBottom: 18 }}>
          <span>
            Every section has been validated.{" "}
            <Link to={`/p/${project.id}/validate`}>Export the report →</Link>
          </span>
        </div>
      ) : null}

      <div className="grid four" style={{ marginBottom: 20 }}>
        <Stat value={counts.sources} label="Sources ingested" />
        <Stat value={counts.observations} label="Standardized observations" />
        <Stat value={counts.findings} label="Findings in the evidence store" />
        <Stat value={counts.triangulations} label="Triangulated dimensions" />
      </div>

      <div className="card" style={{ padding: "18px 16px" }}>
        <PipelineDiagram status={status} projectId={project.id} />
      </div>

      <div className="grid two" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="card-head">
            <h3>Findings by perspective</h3>
            <span className="tiny muted">The three perspectives InnoBeweegLab works with</span>
          </div>
          <div className="stack">
            <PerspectiveRow label="Resident and stakeholder voice" tone="green"
              count={counts.findings_by_perspective.resident} total={counts.findings} />
            <PerspectiveRow label="Expert assessment" tone="violet"
              count={counts.findings_by_perspective.expert} total={counts.findings} />
            <PerspectiveRow label="Quantitative measurement" tone="blue"
              count={counts.findings_by_perspective.quantitative} total={counts.findings} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Run log</h3>
            <span className="tiny muted">What ran, with which engine</span>
          </div>
          {!status.runs.length ? (
            <Empty title="Nothing has run yet">
              <p className="tiny">Stage executions are recorded here so the workflow stays auditable.</p>
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 7 }}>
              {status.runs.slice(0, 9).map((run) => (
                <div className="row between tiny" key={run.id} style={{ gap: 8 }}>
                  <span className="row tight" style={{ minWidth: 0 }}>
                    <Badge tone={run.status === "ok" ? "green" : "red"}>{run.stage}</Badge>
                    <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {run.message}
                    </span>
                  </span>
                  <span className="muted nums" style={{ whiteSpace: "nowrap" }}>
                    {run.output_tokens ? `${(run.input_tokens + run.output_tokens).toLocaleString()} tok · ` : ""}
                    {relativeTime(run.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {project.research_question ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head"><h3>Research question</h3></div>
          <p className="muted">{project.research_question}</p>
        </div>
      ) : null}
    </div>
  );
}

function PerspectiveRow(
  { label, count, total, tone }: { label: string; count: number; total: number; tone: string },
) {
  return (
    <div>
      <div className="row between tiny" style={{ marginBottom: 4 }}>
        <span className="row tight"><Badge tone={tone}><i className="dot" />{label}</Badge></span>
        <span className="muted nums">{count}</span>
      </div>
      <div className="bar"><i style={{ width: `${total ? (count / total) * 100 : 0}%` }} /></div>
    </div>
  );
}
