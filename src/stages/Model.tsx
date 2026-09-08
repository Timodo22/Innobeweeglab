import { useEffect, useState } from "react";
import type { ColumnSpec, Dimension, Observation, Source, SourceSummary } from "../../shared/types";
import { DIMENSIONS, DIMENSION_LABELS } from "../../shared/types";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Empty, Notice, Spinner, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { PERSPECTIVE_LABEL, PERSPECTIVE_TONE } from "../lib/pipeline";
import { useProject } from "../lib/project";

const ROLES: { value: ColumnSpec["role"]; label: string; hint: string }[] = [
  { value: "measure", label: "Measure", hint: "Numeric value → quantitative lane" },
  { value: "open-text", label: "Open text", hint: "Free text → qualitative lane" },
  { value: "group", label: "Group", hint: "Neighbourhood, age band — used for sub-group comparison" },
  { value: "id", label: "Respondent id", hint: "Identifies who answered" },
  { value: "ignore", label: "Ignore", hint: "Not carried into the model" },
];

export function ModelStage() {
  const { status, reload } = useProject();
  const projectId = status.project.id;
  const sources = useAsync(() => api.listSources(projectId), [projectId, status.counts.sources]);
  const observations = useAsync(
    () => api.listObservations(projectId), [projectId, status.counts.observations],
  );

  const pending = sources.data?.filter((s) => !s.standardized).length ?? 0;

  return (
    <div className="page">
      <StageHead
        id="model"
        actions={
          <ActionButton
            disabled={!sources.data?.length}
            busyLabel="Mapping…"
            onRun={async () => {
              await api.standardize(projectId);
              reload();
              observations.reload();
              sources.reload();
            }}
          >
            {status.counts.observations ? "Re-run standardization" : "Standardize all sources"}
          </ActionButton>
        }
      />

      {!sources.data?.length ? (
        <Empty title="Nothing to standardize">
          <p>Ingest at least one source first.</p>
        </Empty>
      ) : (
        <>
          {pending > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <Notice tone="warn">
                {pending} source{pending === 1 ? "" : "s"} not yet mapped into the research model.
                Confirm the column roles below, then run standardization.
              </Notice>
            </div>
          ) : null}

          <div className="section-title">Source mapping</div>
          <div className="stack">
            {sources.data.map((source) => (
              <SourceMapper key={source.id} projectId={projectId} summary={source} onSaved={reload} />
            ))}
          </div>

          <div className="section-title">Standardized observations</div>
          {observations.loading ? (
            <div className="row"><Spinner /> Loading…</div>
          ) : !observations.data?.length ? (
            <Empty title="No observations yet">
              <p>Run standardization to project every source onto the shared research model.</p>
            </Empty>
          ) : (
            <ObservationTable observations={observations.data} total={status.counts.observations} />
          )}
        </>
      )}
    </div>
  );
}

function SourceMapper(
  { projectId, summary, onSaved }: { projectId: string; summary: SourceSummary; onSaved: () => void },
) {
  const [open, setOpen] = useState(false);
  const detail = useAsync<Source | null>(
    () => (open ? api.getSource(projectId, summary.id) : Promise.resolve(null)), [open, summary.id],
  );
  const [columns, setColumns] = useState<ColumnSpec[] | null>(null);

  useEffect(() => {
    if (detail.data?.columns) setColumns(detail.data.columns);
  }, [detail.data]);

  const tabular = summary.format === "csv" || summary.format === "xlsx";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{summary.name}</h3>
          <div className="row tight tiny" style={{ marginTop: 6 }}>
            <Badge tone={PERSPECTIVE_TONE[summary.perspective]}>
              <i className="dot" />{PERSPECTIVE_LABEL[summary.perspective]}
            </Badge>
            <Badge tone="outline">{summary.kind}</Badge>
            {summary.standardized ? <Badge tone="green">standardized</Badge> : <Badge tone="amber">pending</Badge>}
          </div>
        </div>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : tabular ? "Map columns" : "Inspect"}
        </button>
      </div>

      <div className="tiny muted">
        {tabular
          ? `${summary.row_count} rows · ${summary.columns?.length ?? 0} columns → each measure and open answer becomes one observation`
          : `${summary.text_length.toLocaleString()} characters → split into speaker turns or paragraphs, each becoming one observation`}
      </div>

      {open ? (
        detail.loading ? (
          <div className="row" style={{ marginTop: 12 }}><Spinner /> Loading source…</div>
        ) : detail.error ? (
          <div style={{ marginTop: 12 }}><Notice tone="error">{detail.error}</Notice></div>
        ) : tabular && columns ? (
          <div style={{ marginTop: 14 }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Column</th><th>Role</th><th>Dimension</th><th>Sample values</th></tr>
                </thead>
                <tbody>
                  {columns.map((column, index) => (
                    <tr key={column.name}>
                      <td>
                        <div style={{ fontWeight: 550 }}>{column.name}</div>
                        <div className="tiny muted">{column.type}
                          {column.scale_min != null ? ` · scale ${column.scale_min}–${column.scale_max}` : ""}</div>
                      </td>
                      <td>
                        <select
                          value={column.role}
                          onChange={(e) => setColumns((cs) => cs!.map((c, i) =>
                            i === index ? { ...c, role: e.target.value as ColumnSpec["role"] } : c))}
                          style={{ minWidth: 130 }}
                        >
                          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select
                          value={column.dimension ?? ""}
                          disabled={column.role !== "measure" && column.role !== "open-text"}
                          onChange={(e) => setColumns((cs) => cs!.map((c, i) =>
                            i === index ? { ...c, dimension: (e.target.value || null) as Dimension | null } : c))}
                          style={{ minWidth: 170 }}
                        >
                          <option value="">{column.role === "open-text" ? "— detect per answer —" : "— unassigned —"}</option>
                          {DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
                        </select>
                      </td>
                      <td className="tiny muted">
                        {(detail.data?.rows ?? []).slice(0, 3)
                          .map((row) => row[index]).filter((v) => v !== null)
                          .map((v) => String(v).slice(0, 28)).join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <ActionButton
                className="btn"
                busyLabel="Saving…"
                onRun={async () => {
                  await api.updateColumns(projectId, summary.id, columns);
                  onSaved();
                }}
              >
                Save mapping
              </ActionButton>
              <span className="tiny muted">
                A measure without a dimension is skipped. Open text without one is tagged per answer.
              </span>
            </div>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 12, background: "var(--surface-2)", maxHeight: 260, overflow: "auto" }}>
            <div className="tiny mono" style={{ whiteSpace: "pre-wrap" }}>
              {detail.data?.raw_text?.slice(0, 2500)}
              {(detail.data?.raw_text?.length ?? 0) > 2500 ? "\n…" : ""}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function ObservationTable({ observations, total }: { observations: Observation[]; total: number }) {
  const [filter, setFilter] = useState("");
  const rows = observations.filter((o) =>
    !filter || `${o.variable ?? ""} ${o.value_text ?? ""} ${o.dimension ?? ""} ${o.respondent ?? ""}`
      .toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="tiny muted">
          Showing {rows.length.toLocaleString()} of {total.toLocaleString()} observations
          {observations.length < total ? " (first 500 loaded)" : ""}
        </span>
        <input type="text" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 240 }} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 460 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Perspective</th><th>Modality</th><th>Dimension</th>
              <th>Variable</th><th>Value</th><th>Locator</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((o) => (
              <tr key={o.id}>
                <td><Badge tone={PERSPECTIVE_TONE[o.perspective]}>{o.perspective}</Badge></td>
                <td className="tiny muted">{o.modality}</td>
                <td className="tiny">
                  {o.dimension
                    ? DIMENSION_LABELS[o.dimension]
                    : <span className="muted">untagged</span>}
                </td>
                <td className="tiny muted">{o.variable ?? o.respondent ?? "—"}</td>
                <td>
                  {o.value_num !== null
                    ? <span className="nums" style={{ fontWeight: 550 }}>{o.value_num}{o.unit ? ` ${o.unit}` : ""}</span>
                    : <span className="tiny">{(o.value_text ?? "").slice(0, 130)}{(o.value_text ?? "").length > 130 ? "…" : ""}</span>}
                </td>
                <td className="mono muted">{o.locator}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
