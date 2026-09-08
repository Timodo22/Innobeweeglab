import { useNavigate } from "react-router-dom";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Empty, Notice, relativeTime } from "../components/ui";
import { api } from "../lib/api";
import { useProject } from "../lib/project";

interface SectionDetail { key: string; words: number; citations: number }

export function GenerateStage() {
  const { status, reload } = useProject();
  const navigate = useNavigate();
  const projectId = status.project.id;
  const lastRun = status.runs.find((r) => r.stage === "generate");
  const sections = (lastRun?.detail as { sections?: SectionDetail[] } | null)?.sections ?? [];
  const uncited = sections.filter((s) => s.citations === 0);

  return (
    <div className="page">
      <StageHead
        id="generate"
        actions={
          <ActionButton
            disabled={!status.counts.findings}
            busyLabel="Drafting… this takes a minute"
            confirm={status.counts.sections
              ? "Regenerating replaces the current draft and discards any edits and approvals. Continue?"
              : undefined}
            onRun={async () => {
              await api.generateReport(projectId);
              reload();
              navigate(`/p/${projectId}/report`);
            }}
          >
            {status.counts.sections ? "Regenerate draft" : "Generate draft report"}
          </ActionButton>
        }
      />

      <div className="grid two">
        <div className="card">
          <div className="card-head"><h3>What goes into the model</h3></div>
          <p className="tiny muted">
            The evidence store and the triangulation results are handed to Claude as documents with
            citations enabled — not as a summary. The project brief and source inventory go with them,
            so the draft can describe its own method.
          </p>
          <div className="stack" style={{ marginTop: 12, gap: 7 }}>
            <PackRow label="Project brief and source inventory" value={`${status.counts.sources} sources`} />
            <PackRow label="Evidence store" value={`${status.counts.findings} findings`} />
            <PackRow label="Cross-source triangulation" value={`${status.counts.triangulations} dimensions`} />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>How grounding is enforced</h3></div>
          <ul className="tiny muted" style={{ paddingLeft: "1.1em", margin: 0 }}>
            <li style={{ marginBottom: 6 }}>
              Citations are enabled on every evidence document, so each cited claim carries an exact
              character range back into the pack. That range is resolved to the finding it landed in.
            </li>
            <li style={{ marginBottom: 6 }}>
              Numbers are never generated. Every statistic was computed in the quantitative lane; the
              model can only restate figures that are already in the evidence.
            </li>
            <li style={{ marginBottom: 6 }}>
              Quotes were verified word-for-word during coding. Anything that failed that check never
              entered the store and cannot appear here.
            </li>
            <li>
              Sections that come back with no citation are flagged in the draft rather than silently accepted.
            </li>
          </ul>
        </div>
      </div>

      {!status.llm_available ? (
        <div style={{ marginTop: 16 }}>
          <Notice tone="warn">
            No API key is configured. The draft will be assembled from templates instead of written:
            structure, figures and references will be real, but there will be no interpretive synthesis,
            and the recommendations section will be left deliberately unfinished rather than filled with
            generic advice.
          </Notice>
        </div>
      ) : null}

      {lastRun ? (
        <>
          <div className="section-title">Last generation</div>
          <div className="card">
            <div className="card-head">
              <div className="row tight">
                <Badge tone={lastRun.status === "ok" ? "green" : "red"}>{lastRun.status}</Badge>
                <span className="tiny muted">{lastRun.engine} · {relativeTime(lastRun.created_at)}</span>
              </div>
              <span className="tiny muted nums">
                {lastRun.input_tokens
                  ? `${lastRun.input_tokens.toLocaleString()} in / ${lastRun.output_tokens.toLocaleString()} out · `
                  : ""}
                {(lastRun.duration_ms / 1000).toFixed(1)}s
              </span>
            </div>
            <p className="tiny muted">{lastRun.message}</p>

            {sections.length ? (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data">
                  <thead><tr><th>Section</th><th className="num">Words</th><th className="num">Source references</th></tr></thead>
                  <tbody>
                    {sections.map((s) => (
                      <tr key={s.key}>
                        <td>{s.key}</td>
                        <td className="num nums">{s.words}</td>
                        <td className="num">
                          {s.citations
                            ? <span className="nums">{s.citations}</span>
                            : <Badge tone="amber">none</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {uncited.length ? (
              <div style={{ marginTop: 12 }}>
                <Notice tone="warn">
                  {uncited.length} section{uncited.length === 1 ? "" : "s"} came back without a source
                  reference ({uncited.map((s) => s.key).join(", ")}). Check those first during validation.
                </Notice>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div style={{ marginTop: 18 }}>
          <Empty title="Nothing generated yet">
            <p>Generate a draft once the evidence store and triangulation look right.</p>
          </Empty>
        </div>
      )}
    </div>
  );
}

function PackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row between tiny">
      <span>{label}</span>
      <span className="muted nums">{value}</span>
    </div>
  );
}
