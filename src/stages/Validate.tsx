import { useEffect, useState } from "react";
import type { ReportSection, SectionStatus } from "../../shared/types";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Empty, Field, Notice, Spinner, relativeTime, useAsync } from "../components/ui";
import { api, downloadExport } from "../lib/api";
import { CitationChips, Markdown } from "../lib/markdown";
import { useProject } from "../lib/project";

const STATUS_TONE: Record<SectionStatus, string> = {
  draft: "outline", approved: "green", revised: "blue", rejected: "red",
};

const REVIEWER_KEY = "ibl.reviewer";

export function ValidateStage() {
  const { status, reload } = useProject();
  const projectId = status.project.id;
  const report = useAsync(() => api.getReport(projectId), [projectId, status.counts.sections]);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? "");

  useEffect(() => { localStorage.setItem(REVIEWER_KEY, reviewer); }, [reviewer]);

  const sections = report.data?.sections ?? [];
  const approved = sections.filter((s) => s.status === "approved").length;
  const allDone = sections.length > 0 && approved === sections.length;
  const slug = status.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  const patch = async (section: ReportSection, body: Parameters<typeof api.updateSection>[2]) => {
    await api.updateSection(projectId, section.id, { ...body, edited_by: reviewer || null });
    report.reload();
    reload();
  };

  return (
    <div className="page">
      <StageHead
        id="validate"
        actions={
          sections.length ? (
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
      ) : !sections.length ? (
        <Empty title="Nothing to validate">
          <p>Generate a draft report first.</p>
        </Empty>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row between">
              <div style={{ minWidth: 240, flex: 1 }}>
                <div className="row between tiny" style={{ marginBottom: 6 }}>
                  <span>Validation progress</span>
                  <span className="nums muted">{approved} of {sections.length} sections approved</span>
                </div>
                <div className="bar"><i style={{ width: `${(approved / sections.length) * 100}%` }} /></div>
              </div>
              <div style={{ width: 210 }}>
                <Field label="Reviewer">
                  <input type="text" value={reviewer} onChange={(e) => setReviewer(e.target.value)}
                    placeholder="Your name" />
                </Field>
              </div>
            </div>

            {allDone ? (
              <div style={{ marginTop: 12 }}>
                <Notice tone="ok">
                  <span>
                    Every section is approved.{" "}
                    <ActionButton className="btn small" busyLabel="Marking…"
                      onRun={async () => { await api.setReportStatus(projectId, "approved"); report.reload(); }}>
                      Mark report approved
                    </ActionButton>
                  </span>
                </Notice>
              </div>
            ) : null}
          </div>

          <div className="stack">
            {sections.map((section) => (
              <SectionReview key={section.id} section={section} onPatch={patch} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectionReview(
  { section, onPatch }: {
    section: ReportSection;
    onPatch: (s: ReportSection, body: { body_md?: string; status?: SectionStatus; reviewer_note?: string | null }) => Promise<void>;
  },
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body_md);
  const [note, setNote] = useState(section.reviewer_note ?? "");

  useEffect(() => { setDraft(section.body_md); }, [section.body_md]);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>{section.title}</h3>
          <div className="row tight tiny" style={{ marginTop: 6 }}>
            <Badge tone={STATUS_TONE[section.status]}>{section.status}</Badge>
            {section.citations.length
              ? <Badge tone="outline">{section.citations.length} references</Badge>
              : <Badge tone="amber">no source reference</Badge>}
            {section.edited_by ? <span className="muted">last touched by {section.edited_by} · {relativeTime(section.updated_at)}</span> : null}
          </div>
        </div>
        <button className="btn small" onClick={() => setEditing((v) => !v)}>
          {editing ? "Preview" : "Edit"}
        </button>
      </div>

      {editing ? (
        <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 220 }} />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <ActionButton
              className="btn" busyLabel="Saving…"
              disabled={draft === section.body_md}
              onRun={async () => { await onPatch(section, { body_md: draft, status: "revised" }); setEditing(false); }}
            >
              Save edit
            </ActionButton>
            <button className="btn ghost small" onClick={() => { setDraft(section.body_md); setEditing(false); }}>
              Discard changes
            </button>
          </div>
        </>
      ) : (
        <div className="doc" style={{ border: "none", padding: 0, background: "transparent", maxWidth: "none" }}>
          {section.body_md
            ? <Markdown source={section.body_md} />
            : <p className="muted"><em>This section came back empty. Write it yourself or regenerate.</em></p>}
        </div>
      )}

      <details className="reveal" style={{ marginTop: 12 }}>
        <summary>Source references and reviewer note</summary>
        <div style={{ marginTop: 8 }}>
          <CitationChips citations={section.citations} />
          {section.citations.length ? (
            <div className="stack" style={{ marginTop: 10, gap: 6 }}>
              {section.citations.map((c, i) => (
                <div className="evidence-quote" key={`${c.evidence_id}-${i}`}>
                  {c.cited_text}
                  <cite>{c.kind} · {c.label} · <span className="mono">{c.evidence_id}</span></cite>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Field label="Reviewer note" hint="Kept with the section; not shown in the exported report body.">
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. checked against the raw transcript" />
            </Field>
            <ActionButton className="btn small" busyLabel="Saving…" disabled={note === (section.reviewer_note ?? "")}
              onRun={() => onPatch(section, { reviewer_note: note || null })}>
              Save note
            </ActionButton>
          </div>
        </div>
      </details>

      <div className="btn-row" style={{ marginTop: 12, borderTop: "1px solid var(--ink-100)", paddingTop: 12 }}>
        <ActionButton className="btn primary small" busyLabel="…"
          disabled={section.status === "approved"}
          onRun={() => onPatch(section, { status: "approved" })}>
          Approve
        </ActionButton>
        <ActionButton className="btn small danger" busyLabel="…"
          disabled={section.status === "rejected"}
          onRun={() => onPatch(section, { status: "rejected" })}>
          Reject
        </ActionButton>
        {section.status !== "draft" ? (
          <ActionButton className="btn small ghost" busyLabel="…"
            onRun={() => onPatch(section, { status: "draft" })}>
            Reset to draft
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}
