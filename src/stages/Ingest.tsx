import { useCallback, useRef, useState } from "react";
import type { SourceKind, Perspective } from "../../shared/types";
import { StageHead } from "../components/StageHead";
import { ActionButton, Badge, Empty, Field, Notice, Spinner, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { parseFile, type ParsedFile } from "../lib/parse";
import { PERSPECTIVE_LABEL, PERSPECTIVE_TONE } from "../lib/pipeline";
import { useProject } from "../lib/project";

const KIND_DEFAULTS: Record<SourceKind, { perspective: Perspective; label: string; hint: string }> = {
  dataset: { perspective: "quantitative", label: "Dataset / measurements", hint: "Counts, sensor data, existing databases." },
  survey: { perspective: "resident", label: "Survey export", hint: "Closed scores and open answers from residents." },
  interview: { perspective: "resident", label: "Interview / transcript", hint: "Interviews, co-creation sessions, group conversations." },
  expert: { perspective: "expert", label: "Expert assessment", hint: "Site assessments, professional observations, evaluations." },
};

export function IngestStage() {
  const { status, reload } = useProject();
  const projectId = status.project.id;
  const sources = useAsync(() => api.listSources(projectId), [projectId, status.counts.sources]);
  const [staged, setStaged] = useState<ParsedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      setStaged(await parseFile(files[0]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="page">
      <StageHead id="ingest" />

      <div className="grid two">
        <UploadCard onFiles={onFiles} />
        <PasteCard onStage={setStaged} />
      </div>

      {error ? <div style={{ marginTop: 12 }}><Notice tone="error">{error}</Notice></div> : null}

      {staged ? (
        <StageForm
          parsed={staged}
          onCancel={() => setStaged(null)}
          onCommit={async (payload) => {
            await api.addSource(projectId, payload);
            setStaged(null);
            sources.reload();
            reload();
          }}
        />
      ) : null}

      <div className="section-title">Ingested sources</div>
      {sources.loading ? (
        <div className="row"><Spinner /> Loading…</div>
      ) : !sources.data?.length ? (
        <Empty title="No sources yet">
          <p>Upload a file above, or paste a transcript. Nothing downstream can run until at least one source is in.</p>
        </Empty>
      ) : (
        <div className="stack">
          {sources.data.map((source) => (
            <div className="card" key={source.id}>
              <div className="card-head">
                <div>
                  <h3>{source.name}</h3>
                  <div className="row tight tiny" style={{ marginTop: 6 }}>
                    <Badge tone={PERSPECTIVE_TONE[source.perspective]}>
                      <i className="dot" />{PERSPECTIVE_LABEL[source.perspective]}
                    </Badge>
                    <Badge tone="outline">{source.kind}</Badge>
                    <Badge tone="outline">{source.format}</Badge>
                    {source.standardized
                      ? <Badge tone="green">standardized</Badge>
                      : <Badge tone="amber">not yet standardized</Badge>}
                  </div>
                </div>
                <ActionButton
                  className="btn small danger"
                  busyLabel="Removing…"
                  confirm={`Remove "${source.name}" and every observation derived from it?`}
                  onRun={async () => {
                    await api.deleteSource(projectId, source.id);
                    sources.reload();
                    reload();
                  }}
                >
                  Remove
                </ActionButton>
              </div>
              <div className="tiny muted">
                {source.row_count
                  ? `${source.row_count} rows · ${source.columns?.length ?? 0} columns`
                  : `${source.text_length.toLocaleString()} characters of text`}
                {source.collected_at ? ` · collected ${source.collected_at}` : ""}
              </div>
              {source.notes ? <p className="tiny muted" style={{ marginTop: 6 }}>{source.notes}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadCard({ onFiles }: { onFiles: (files: FileList | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="card">
      <div className="card-head"><h3>Upload a file</h3></div>
      <div
        className={`dropzone${over ? " over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      >
        <strong>Drop a file, or click to browse</strong>
        <span className="tiny muted">CSV · XLSX · DOCX · TXT · MD — parsed in your browser</span>
      </div>
      <input ref={input} type="file" hidden accept=".csv,.tsv,.xlsx,.xls,.docx,.txt,.md,.vtt"
        onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function PasteCard({ onStage }: { onStage: (parsed: ParsedFile) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="card">
      <div className="card-head"><h3>Or paste text</h3></div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Interviewer: Hoe gebruikt u het park?\n\nR1: Ik wandel er elke dag…"}
        style={{ minHeight: 104 }}
      />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn"
          disabled={text.trim().length < 20}
          onClick={() => {
            onStage({ name: "Pasted text", format: "text", columns: null, rows: null, raw_text: text.trim() });
            setText("");
          }}
        >
          Use this text
        </button>
        <span className="tiny muted">Speaker labels like “R1:” are detected and kept as provenance.</span>
      </div>
    </div>
  );
}

function StageForm(
  { parsed, onCommit, onCancel }: {
    parsed: ParsedFile;
    onCommit: (payload: Record<string, unknown>) => Promise<void>;
    onCancel: () => void;
  },
) {
  const guessedKind: SourceKind = parsed.rows
    ? (parsed.columns?.some((c) => c.role === "open-text") ? "survey" : "dataset")
    : "interview";
  const [kind, setKind] = useState<SourceKind>(guessedKind);
  const [perspective, setPerspective] = useState<Perspective>(KIND_DEFAULTS[guessedKind].perspective);
  const [name, setName] = useState(parsed.name.replace(/\.[^.]+$/, ""));
  const [collectedAt, setCollectedAt] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div className="card" style={{ marginTop: 14, borderColor: "var(--green-500)" }}>
      <div className="card-head">
        <h3>Confirm this source</h3>
        <button className="btn small ghost" onClick={onCancel}>Discard</button>
      </div>

      {parsed.warning ? <div style={{ marginBottom: 12 }}><Notice tone="warn">{parsed.warning}</Notice></div> : null}

      <div className="grid two">
        <Field label="Source name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Collected on"><input type="date" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} /></Field>
      </div>

      <div className="grid two">
        <Field label="Kind of material" hint={KIND_DEFAULTS[kind].hint}>
          <select value={kind} onChange={(e) => {
            const next = e.target.value as SourceKind;
            setKind(next);
            setPerspective(KIND_DEFAULTS[next].perspective);
          }}>
            {(Object.keys(KIND_DEFAULTS) as SourceKind[]).map((k) => (
              <option key={k} value={k}>{KIND_DEFAULTS[k].label}</option>
            ))}
          </select>
        </Field>
        <Field label="Perspective" hint="Determines which analysis lane picks this up.">
          <select value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective)}>
            <option value="resident">Resident and stakeholder voice</option>
            <option value="expert">Expert assessment</option>
            <option value="quantitative">Quantitative measurement</option>
          </select>
        </Field>
      </div>

      <Field label="Notes" hint="Method, sample size, anything the report should state about this source.">
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {parsed.rows && parsed.columns ? (
        <>
          <div className="tiny muted" style={{ margin: "4px 0 8px" }}>
            {parsed.rows.length} rows · {parsed.columns.length} columns. Column roles are guessed
            now and confirmed in the next stage.
          </div>
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="data">
              <thead>
                <tr>{parsed.columns.map((c) => (
                  <th key={c.name}>{c.name}<div className="tiny muted" style={{ textTransform: "none", letterSpacing: 0 }}>{c.role}</div></th>
                ))}</tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 6).map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => (
                    <td key={j} className={typeof cell === "number" ? "num" : ""}>
                      {cell === null ? <span className="muted">—</span> : String(cell).slice(0, 90)}
                    </td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="card" style={{ background: "var(--surface-2)", maxHeight: 200, overflow: "auto" }}>
          <div className="tiny mono" style={{ whiteSpace: "pre-wrap" }}>
            {parsed.raw_text?.slice(0, 900)}
            {(parsed.raw_text?.length ?? 0) > 900 ? "\n…" : ""}
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <ActionButton
          disabled={!name.trim()}
          busyLabel="Adding…"
          onRun={() => onCommit({
            name: name.trim(), kind, perspective, format: parsed.format,
            collected_at: collectedAt || null, notes: notes.trim() || null,
            raw_text: parsed.raw_text, columns: parsed.columns, rows: parsed.rows,
          })}
        >
          Add to project
        </ActionButton>
      </div>
    </div>
  );
}
