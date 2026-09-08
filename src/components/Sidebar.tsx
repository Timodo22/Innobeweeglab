import { Link, NavLink, useNavigate } from "react-router-dom";
import type { Project, ProjectStatus } from "../../shared/types";
import { STAGES } from "../lib/pipeline";

export function Sidebar(
  { status, projects, health }: {
    status: ProjectStatus;
    projects: Project[];
    health: { llm_available: boolean; model: string | null } | null;
  },
) {
  const navigate = useNavigate();
  const projectId = status.project.id;

  return (
    <aside className="sidebar">
      <Link className="brand" to="/">
        <span className="brand-mark">
          <svg viewBox="0 0 32 32" aria-hidden>
            <path d="M6 22l6-11 5 6 3.5-5L27 21" stroke="#fff" strokeWidth="3"
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>
          <div className="brand-name">Evidence Engine</div>
          <div className="brand-sub">InnoBeweegLab</div>
        </span>
      </Link>

      <div className="project-switch">
        <label htmlFor="project-select">Project</label>
        <select
          id="project-select"
          value={projectId}
          onChange={(e) => navigate(`/p/${e.target.value}`)}
        >
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <nav className="rail">
        <div className="rail-title">Pipeline</div>
        <NavLink to={`/p/${projectId}`} end
          className={({ isActive }) => `rail-item${isActive ? " active" : ""}`}>
          <span className="rail-index">◎</span>
          <span className="rail-label">Overview</span>
          <span className="rail-note" />
        </NavLink>

        {STAGES.map((stage) => {
          const done = stage.done(status);
          const ready = stage.ready(status);
          return (
            <NavLink
              key={stage.id}
              to={`/p/${projectId}/${stage.path}`}
              className={({ isActive }) =>
                `rail-item${isActive ? " active" : ""}${!ready ? " disabled" : ""}`}
              title={ready ? stage.blurb : "Complete the previous stage first"}
            >
              <span className={`rail-index${done ? " done" : ""}`}>
                {done ? "✓" : stage.index}
              </span>
              <span className="rail-label">{stage.label}</span>
              <span className="rail-note">{stage.note(status)}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="row tight">
          <span className={`badge ${health?.llm_available ? "green" : "amber"}`}>
            <i className="dot" />
            {health?.llm_available ? "Claude connected" : "Heuristic mode"}
          </span>
        </div>
        {health?.model ? <div className="mono">{health.model}</div> : null}
        {!health?.llm_available ? (
          <div className="tiny">Set ANTHROPIC_API_KEY to enable thematic coding and grounded generation.</div>
        ) : null}
      </div>
    </aside>
  );
}
