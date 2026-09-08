import type { Convergence, Triangulation } from "../../shared/types";
import { DIMENSION_LABELS } from "../../shared/types";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Bar, Empty, Notice, Spinner, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { PERSPECTIVE_LABEL, PERSPECTIVE_TONE } from "../lib/pipeline";
import { useProject } from "../lib/project";

const CONVERGENCE: Record<Convergence, { tone: string; label: string; note: string }> = {
  converging: { tone: "green", label: "Converging", note: "Independent perspectives point the same way." },
  diverging: { tone: "red", label: "Diverging", note: "Perspectives contradict each other — a result, not a defect." },
  "single-source": { tone: "amber", label: "Single source", note: "Only one perspective covers this; not corroborated." },
  gap: { tone: "outline", label: "Evidence gap", note: "The material touches this, but nothing was concluded." },
};

export function TriangulateStage() {
  const { status, reload } = useProject();
  const projectId = status.project.id;
  const triangulations = useAsync(
    () => api.listTriangulations(projectId), [projectId, status.counts.triangulations],
  );
  const findings = useAsync(() => api.listFindings(projectId), [projectId, status.counts.findings]);

  const byId = new Map((findings.data ?? []).map((f) => [f.id, f]));
  const groups = triangulations.data ?? [];
  const order: Convergence[] = ["diverging", "converging", "single-source", "gap"];

  return (
    <div className="page">
      <StageHead
        id="triangulate"
        actions={
          <ActionButton
            disabled={!status.counts.findings}
            busyLabel="Triangulating…"
            onRun={async () => { await api.triangulate(projectId); triangulations.reload(); reload(); }}
          >
            {groups.length ? "Re-run triangulation" : "Run triangulation"}
          </ActionButton>
        }
      />

      {triangulations.loading ? (
        <div className="row"><Spinner /> Loading…</div>
      ) : !groups.length ? (
        <Empty title="Not triangulated yet">
          <p>Group the findings across perspectives to see where the sources agree and where they do not.</p>
        </Empty>
      ) : (
        <>
          <div className="grid four" style={{ marginBottom: 18 }}>
            {order.map((key) => (
              <div className="stat" key={key}>
                <div className="stat-value">{groups.filter((g) => g.convergence === key).length}</div>
                <div className="stat-label">{CONVERGENCE[key].label}</div>
              </div>
            ))}
          </div>

          {groups.some((g) => g.convergence === "diverging") ? (
            <div style={{ marginBottom: 16 }}>
              <Notice tone="warn">
                Some dimensions have contradicting evidence. These are deliberately left unresolved —
                reconciling them is the researcher's judgement, not the system's.
              </Notice>
            </div>
          ) : null}

          <div className="stack">
            {order.flatMap((key) => groups.filter((g) => g.convergence === key))
              .map((group) => (
                <TriangulationCard key={group.id} group={group} byId={byId} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function TriangulationCard(
  { group, byId }: {
    group: Triangulation;
    byId: Map<string, { perspective: string; statement: string; direction: string; strength: number }>;
  },
) {
  const meta = CONVERGENCE[group.convergence];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="row tight" style={{ marginBottom: 7 }}>
            <Badge tone={meta.tone}><i className="dot" />{meta.label}</Badge>
            <Badge tone="outline">{DIMENSION_LABELS[group.dimension]}</Badge>
            {group.perspectives.map((p) => (
              <Badge key={p} tone={PERSPECTIVE_TONE[p]}>{PERSPECTIVE_LABEL[p]}</Badge>
            ))}
          </div>
          <h3>{group.title}</h3>
        </div>
        <div style={{ width: 110, flex: "none", textAlign: "right" }}>
          <div className="tiny muted">confidence</div>
          <div className="nums" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{group.confidence}</div>
          <Bar value={group.confidence} />
        </div>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>{group.summary}</p>

      {group.finding_ids.length ? (
        <details className="reveal">
          <summary>{group.finding_ids.length} underlying finding{group.finding_ids.length === 1 ? "" : "s"}</summary>
          <div className="stack" style={{ marginTop: 8, gap: 6 }}>
            {group.finding_ids.map((id) => {
              const finding = byId.get(id);
              if (!finding) return null;
              return (
                <div className="row tight tiny" key={id} style={{ alignItems: "flex-start" }}>
                  <Badge tone={PERSPECTIVE_TONE[finding.perspective]}>{finding.perspective}</Badge>
                  <span style={{ flex: 1, minWidth: 0 }}>{finding.statement}</span>
                  <span className="muted nums">{finding.strength}</span>
                </div>
              );
            })}
          </div>
        </details>
      ) : (
        <div className="tiny muted" style={{ marginTop: 6 }}>{meta.note}</div>
      )}
    </div>
  );
}
