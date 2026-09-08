import { useState } from "react";
import type { QuantSummary } from "../../shared/types";
import { DIMENSION_LABELS } from "../../shared/types";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Distribution, Empty, Notice, relativeTime } from "../components/ui";
import { api } from "../lib/api";
import { useProject } from "../lib/project";

type Lane = "quantitative" | "resident" | "expert";

const LANES: { id: Lane; title: string; diagram: string; tone: string; method: string; body: string }[] = [
  {
    id: "resident", title: "Qualitative analysis", diagram: "Resident and stakeholder voice",
    tone: "green", method: "Thematic coding",
    body: "Interview turns and open survey answers are coded into themes against the shared dimension vocabulary. Every quote the model attaches is checked word-for-word against the source; quotes that do not match exactly are discarded before anything is stored.",
  },
  {
    id: "expert", title: "Expert analysis", diagram: "Professional assessment",
    tone: "violet", method: "Assessment structuring",
    body: "Site assessments and professional observations are structured into judgements per dimension, with the grounds the expert gave. Same verbatim check as the resident lane.",
  },
  {
    id: "quantitative", title: "Quantitative analysis", diagram: "Datasets and measurements",
    tone: "blue", method: "Descriptive statistics",
    body: "Descriptive statistics per variable, plus sub-group comparison where a grouping column exists. Computed in code, never by a language model — so no figure in the final report can be invented.",
  },
];

export function AnalyseStage() {
  const { status, reload } = useProject();
  const projectId = status.project.id;
  const [summaries, setSummaries] = useState<QuantSummary[] | null>(null);

  const lastRuns = status.runs.filter((r) => r.stage === "analyse");
  const runFor = (lane: Lane) =>
    lastRuns.find((r) => (r.detail as { lane?: string } | null)?.lane === lane);

  const storedSummaries = (runFor("quantitative")?.detail as { summaries?: QuantSummary[] } | null)?.summaries;
  const shown = summaries ?? storedSummaries ?? [];

  const run = async (lane: Lane | "all") => {
    const result = await api.analyse(projectId, lane);
    if (result.quant_summaries?.length) setSummaries(result.quant_summaries);
    reload();
  };

  return (
    <div className="page">
      <StageHead
        id="analyse"
        actions={
          <ActionButton
            disabled={!status.counts.observations}
            busyLabel="Analysing…"
            onRun={() => run("all")}
          >
            Run all three lanes
          </ActionButton>
        }
      />

      {!status.counts.observations ? (
        <Empty title="No standardized observations">
          <p>Run the research model stage before analysing.</p>
        </Empty>
      ) : (
        <>
          {!status.llm_available ? (
            <div style={{ marginBottom: 16 }}>
              <Notice tone="warn">
                Running in heuristic mode. The quantitative lane is unaffected — it is deterministic
                either way — but qualitative and expert coding fall back to a keyword lexicon, which
                produces blunter themes than the model would.
              </Notice>
            </div>
          ) : null}

          <div className="grid three">
            {LANES.map((lane) => {
              const count = status.counts.findings_by_perspective[lane.id];
              const lastRun = runFor(lane.id);
              const dropped = (lastRun?.detail as { dropped_quotes?: number } | null)?.dropped_quotes ?? 0;
              return (
                <div className="card" key={lane.id}>
                  <div className="card-head">
                    <div>
                      <h3>{lane.title}</h3>
                      <div className="tiny muted">{lane.diagram}</div>
                    </div>
                    <Badge tone={lane.tone}><i className="dot" />{lane.method}</Badge>
                  </div>
                  <p className="tiny muted">{lane.body}</p>
                  <div className="row between" style={{ marginTop: 12 }}>
                    <div>
                      <div className="stat-value" style={{ fontSize: 20 }}>{count}</div>
                      <div className="stat-label">findings</div>
                    </div>
                    <ActionButton className="btn small" busyLabel="Running…" onRun={() => run(lane.id)}>
                      {count ? "Re-run" : "Run lane"}
                    </ActionButton>
                  </div>
                  {lastRun ? (
                    <div className="tiny muted" style={{ marginTop: 10, borderTop: "1px solid var(--ink-100)", paddingTop: 8 }}>
                      {lastRun.engine} · {relativeTime(lastRun.created_at)}
                      {lastRun.output_tokens
                        ? ` · ${(lastRun.input_tokens + lastRun.output_tokens).toLocaleString()} tokens` : ""}
                      {dropped ? (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="amber">{dropped} unverifiable quotes discarded</Badge>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {shown.length ? (
            <>
              <div className="section-title">Descriptive statistics</div>
              <div className="grid two">
                {shown.map((s) => (
                  <div className="card" key={`${s.variable}-${s.dimension}`}>
                    <div className="card-head">
                      <div>
                        <h3 style={{ fontSize: 13.5 }}>{s.variable}</h3>
                        <div className="tiny muted">
                          {s.dimension ? DIMENSION_LABELS[s.dimension] : "unassigned dimension"}
                        </div>
                      </div>
                      <Badge tone="outline">n = {s.n}</Badge>
                    </div>
                    <div className="row" style={{ gap: 16, marginBottom: 10 }}>
                      <Metric label="mean" value={s.mean} />
                      <Metric label="median" value={s.median} />
                      <Metric label="sd" value={s.sd} />
                      <Metric label="range" value={`${s.min}–${s.max}`} />
                    </div>
                    <Distribution buckets={s.distribution} />
                    {s.by_group?.length ? (
                      <div style={{ marginTop: 12 }}>
                        <div className="tiny muted" style={{ marginBottom: 5 }}>By group</div>
                        {s.by_group.map((g) => (
                          <div className="row between tiny" key={g.group} style={{ marginBottom: 3 }}>
                            <span>{g.group} <span className="muted">(n = {g.n})</span></span>
                            <span className="nums" style={{ fontWeight: 550 }}>{g.mean}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="nums" style={{ fontSize: 17, fontWeight: 600 }}>{value}</div>
      <div className="tiny muted">{label}</div>
    </div>
  );
}
