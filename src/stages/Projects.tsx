import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionButton, Empty, Field, Notice, Spinner, relativeTime, useAsync } from "../components/ui";
import { api, auth } from "../lib/api";

export function ProjectsPage() {
  const navigate = useNavigate();
  const health = useAsync(() => api.health(), []);
  const projects = useAsync(() => api.listProjects(), [health.data?.auth_required]);
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState(auth.get());

  const locked = projects.error?.includes("Authentication") ?? false;

  return (
    <div className="main">
      <header className="topbar">
        <div className="row tight">
          <span className="brand-mark" style={{ width: 26, height: 26 }}>
            <svg viewBox="0 0 32 32" aria-hidden style={{ width: 15, height: 15 }}>
              <path d="M6 22l6-11 5 6 3.5-5L27 21" stroke="#fff" strokeWidth="3"
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1>InnoBeweegLab · Evidence Engine</h1>
            <div className="topbar-meta">From research data to evidence-based recommendations</div>
          </div>
        </div>
        <span className={`badge ${health.data?.llm_available ? "green" : "amber"}`}>
          <i className="dot" />
          {health.data?.llm_available ? `Claude · ${health.data.model}` : "Heuristic mode"}
        </span>
      </header>

      <div className="page">
        {locked ? (
          <div className="card" style={{ maxWidth: 420 }}>
            <div className="card-head"><h3>This instance is password protected</h3></div>
            <Field label="Shared password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <button className="btn primary" onClick={() => { auth.set(password); projects.reload(); }}>
              Unlock
            </button>
          </div>
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 20 }}>Research projects</h2>
                <p className="muted" style={{ maxWidth: "62ch", marginTop: 6 }}>
                  Each project runs the full pipeline: ingestion, a standardized research model,
                  three analysis lanes, an evidence store, cross-source triangulation, grounded
                  generation and researcher validation.
                </p>
              </div>
              <div className="btn-row">
                <ActionButton
                  className="btn"
                  busyLabel="Seeding…"
                  onRun={async () => {
                    const project = await api.createDemo();
                    navigate(`/p/${project.id}`);
                  }}
                >
                  Load worked example
                </ActionButton>
                <button className="btn primary" onClick={() => setShowForm((v) => !v)}>
                  {showForm ? "Cancel" : "New project"}
                </button>
              </div>
            </div>

            {showForm ? <NewProjectForm onCreated={(id) => navigate(`/p/${id}`)} /> : null}

            {projects.loading ? (
              <div className="row"><Spinner /> Loading…</div>
            ) : projects.error ? (
              <Notice tone="error">{projects.error}</Notice>
            ) : !projects.data?.length ? (
              <Empty title="No projects yet">
                <p>Create one, or load the worked example to see the whole pipeline with realistic material.</p>
              </Empty>
            ) : (
              <div className="grid two">
                {projects.data.map((p) => (
                  <Link key={p.id} to={`/p/${p.id}`} className="card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                    <div className="card-head">
                      <h3>{p.name}</h3>
                      <span className="tiny muted">{relativeTime(p.updated_at)}</span>
                    </div>
                    <div className="tiny muted">
                      {[p.municipality, p.neighbourhood, p.period].filter(Boolean).join(" · ") || "No context set"}
                    </div>
                    {p.research_question ? (
                      <p className="tiny muted" style={{ marginTop: 8 }}>{p.research_question}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}

            {health.data && !health.data.llm_available ? (
              <div style={{ marginTop: 22 }}>
                <Notice tone="warn">
                  <span>
                    No <code>ANTHROPIC_API_KEY</code> is configured, so the pipeline runs in
                    heuristic mode: statistics, triangulation and the report skeleton are still
                    real, but thematic coding falls back to a keyword lexicon and the draft is
                    assembled from templates instead of written.
                  </span>
                </Notice>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: "", municipality: "", neighbourhood: "", period: "", research_question: "",
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="card" style={{ marginBottom: 18, maxWidth: 640 }}>
      <div className="card-head"><h3>New project</h3></div>
      <Field label="Project name">
        <input type="text" value={form.name} onChange={set("name")}
          placeholder="Beweegvriendelijke inrichting …" />
      </Field>
      <div className="grid two">
        <Field label="Municipality"><input type="text" value={form.municipality} onChange={set("municipality")} /></Field>
        <Field label="Area / neighbourhood"><input type="text" value={form.neighbourhood} onChange={set("neighbourhood")} /></Field>
      </div>
      <Field label="Fieldwork period" hint="Free text, e.g. “maart – juni 2026”">
        <input type="text" value={form.period} onChange={set("period")} />
      </Field>
      <Field label="Research question" hint="Carried into the evidence pack and steers the generated report.">
        <textarea value={form.research_question} onChange={set("research_question")} />
      </Field>
      <div className="btn-row">
        <ActionButton
          disabled={!form.name.trim()}
          busyLabel="Creating…"
          onRun={async () => {
            const project = await api.createProject({
              name: form.name.trim(),
              municipality: form.municipality.trim() || null,
              neighbourhood: form.neighbourhood.trim() || null,
              period: form.period.trim() || null,
              research_question: form.research_question.trim() || null,
            });
            onCreated(project.id);
          }}
        >
          Create project
        </ActionButton>
      </div>
    </div>
  );
}
