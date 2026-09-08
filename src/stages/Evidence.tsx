import { useMemo, useState } from "react";
import type { Finding, FindingStatus, Perspective } from "../../shared/types";
import { DIMENSION_LABELS } from "../../shared/types";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Bar, Empty, Notice, Spinner, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { PERSPECTIVE_LABEL, PERSPECTIVE_TONE } from "../lib/pipeline";
import { useProject } from "../lib/project";

const DIRECTION_TONE: Record<string, string> = {
  positive: "green", negative: "red", mixed: "amber", neutral: "outline",
};

export function EvidenceStage() {
  const { status, reload } = useProject();
  const projectId = status.project.id;
  const findings = useAsync(() => api.listFindings(projectId), [projectId, status.counts.findings]);
  const [perspective, setPerspective] = useState<Perspective | "">("");
  const [dimension, setDimension] = useState("");
  const [hideRejected, setHideRejected] = useState(false);

  const filtered = useMemo(() => (findings.data ?? []).filter((f) =>
    (!perspective || f.perspective === perspective) &&
    (!dimension || f.dimension === dimension) &&
    (!hideRejected || f.status !== "rejected")),
    [findings.data, perspective, dimension, hideRejected]);

  const dimensions = useMemo(
    () => [...new Set((findings.data ?? []).map((f) => f.dimension))].sort(),
    [findings.data],
  );

  const setStatus = async (finding: Finding, next: FindingStatus) => {
    await api.setFindingStatus(projectId, finding.id, next);
    findings.reload();
    reload();
  };

  return (
    <div className="page">
      <StageHead id="evidence" />

      {findings.loading ? (
        <div className="row"><Spinner /> Loading evidence…</div>
      ) : !findings.data?.length ? (
        <Empty title="The evidence store is empty">
          <p>Run the analysis lanes to populate it.</p>
        </Empty>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <Notice tone="info">
              Reject anything that does not hold up here, before it can reach the report. Rejected
              findings stay in the record — they are excluded from triangulation and generation, not deleted.
            </Notice>
          </div>

          <div className="row between" style={{ marginBottom: 12 }}>
            <div className="row tight">
              <select value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective | "")}
                style={{ width: "auto" }}>
                <option value="">All perspectives</option>
                <option value="resident">Resident voice</option>
                <option value="expert">Expert assessment</option>
                <option value="quantitative">Quantitative</option>
              </select>
              <select value={dimension} onChange={(e) => setDimension(e.target.value)} style={{ width: "auto" }}>
                <option value="">All dimensions</option>
                {dimensions.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
              </select>
              <label className="row tight tiny muted" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={hideRejected} style={{ width: "auto" }}
                  onChange={(e) => setHideRejected(e.target.checked)} />
                Hide rejected
              </label>
            </div>
            <span className="tiny muted">
              {filtered.length} of {findings.data.length} findings
            </span>
          </div>

          <div className="stack">
            {filtered.map((finding) => (
              <FindingCard key={finding.id} finding={finding} onStatus={setStatus} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FindingCard(
  { finding, onStatus }: { finding: Finding; onStatus: (f: Finding, s: FindingStatus) => Promise<void> },
) {
  return (
    <div className={`finding${finding.status === "rejected" ? " rejected" : ""}`}>
      <div className="finding-head">
        <div style={{ minWidth: 0 }}>
          <div className="row tight" style={{ marginBottom: 7 }}>
            <Badge tone={PERSPECTIVE_TONE[finding.perspective]}>
              <i className="dot" />{PERSPECTIVE_LABEL[finding.perspective]}
            </Badge>
            <Badge tone="outline">{DIMENSION_LABELS[finding.dimension]}</Badge>
            <Badge tone={DIRECTION_TONE[finding.direction]}>{finding.direction}</Badge>
            <Badge tone="outline">{finding.claim_type}</Badge>
            {finding.status === "accepted" ? <Badge tone="green">accepted</Badge> : null}
            {finding.status === "rejected" ? <Badge tone="red">rejected</Badge> : null}
          </div>
          <div className="finding-statement">{finding.statement}</div>
          {finding.detail ? <p className="tiny muted" style={{ marginTop: 6 }}>{finding.detail}</p> : null}
        </div>

        <div style={{ width: 120, flex: "none", textAlign: "right" }}>
          <div className="tiny muted">strength</div>
          <div className="nums" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{finding.strength}</div>
          <Bar value={finding.strength} />
          <div className="tiny muted" style={{ marginTop: 4 }}>n = {finding.support_n}</div>
        </div>
      </div>

      <details className="reveal">
        <summary>{finding.evidence.length} supporting observation{finding.evidence.length === 1 ? "" : "s"} · {finding.method}</summary>
        <div style={{ marginTop: 8 }}>
          {finding.evidence.map((e) => (
            <div className="evidence-quote" key={e.observation_id}>
              {e.excerpt}
              <cite>{e.source_name} · <span className="mono">{e.locator}</span></cite>
            </div>
          ))}
        </div>
      </details>

      <div className="btn-row" style={{ marginTop: 10 }}>
        <ActionButton className="btn small" busyLabel="…"
          onRun={() => onStatus(finding, finding.status === "accepted" ? "open" : "accepted")}>
          {finding.status === "accepted" ? "Un-accept" : "Accept"}
        </ActionButton>
        <ActionButton className="btn small danger" busyLabel="…"
          onRun={() => onStatus(finding, finding.status === "rejected" ? "open" : "rejected")}>
          {finding.status === "rejected" ? "Restore" : "Reject"}
        </ActionButton>
      </div>
    </div>
  );
}
