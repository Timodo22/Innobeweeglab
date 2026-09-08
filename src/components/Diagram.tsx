import { Link } from "react-router-dom";
import type { ProjectStatus, StageId } from "../../shared/types";
import { STAGES } from "../lib/pipeline";

/**
 * The pipeline, drawn. Sources fan into ingestion on the left, the three analysis
 * lanes fan out and back in the middle, and generation runs down to validation.
 * Nodes reflect live project state and link to their stage.
 */

const W = 980;
const H = 700;
const CX = 600;
const MAIN_W = 268;
const LANE_W = 196;
const NODE_H = 46;

interface Node { id: StageId; x: number; y: number; w: number; lines: string[] }

const rowY = { ingest: 62, model: 146, lanes: 236, evidence: 326, triangulate: 410, generate: 494, report: 578, validate: 654 };

const NODES: Node[] = [
  { id: "ingest", x: CX - MAIN_W / 2, y: rowY.ingest, w: MAIN_W, lines: ["Data ingestion"] },
  { id: "model", x: CX - MAIN_W / 2, y: rowY.model, w: MAIN_W, lines: ["Standardized research model"] },
  { id: "evidence", x: CX - MAIN_W / 2, y: rowY.evidence, w: MAIN_W, lines: ["Evidence / finding store"] },
  { id: "triangulate", x: CX - MAIN_W / 2, y: rowY.triangulate, w: MAIN_W, lines: ["Cross-source triangulation"] },
  { id: "generate", x: CX - MAIN_W / 2, y: rowY.generate, w: MAIN_W, lines: ["Grounded LLM generation"] },
  { id: "report", x: CX - MAIN_W / 2, y: rowY.report, w: MAIN_W, lines: ["Draft report", "+ source references"] },
  { id: "validate", x: CX - MAIN_W / 2, y: rowY.validate, w: MAIN_W, lines: ["Researcher validation"] },
];

const LANES: { cx: number; title: string; perspective: "resident" | "expert" | "quantitative" }[] = [
  { cx: CX - 230, title: "Qualitative analysis", perspective: "resident" },
  { cx: CX, title: "Expert analysis", perspective: "expert" },
  { cx: CX + 230, title: "Quantitative analysis", perspective: "quantitative" },
];

const SOURCES = ["Excel / CSV", "Surveys", "Interviews / transcripts", "Expert assessments"];

export function PipelineDiagram({ status, projectId }: { status: ProjectStatus; projectId: string }) {
  const stage = (id: StageId) => STAGES.find((s) => s.id === id)!;
  const state = (id: StageId) => {
    const s = stage(id);
    if (s.done(status)) return "done";
    return s.ready(status) ? "active" : "";
  };
  const lit = (id: StageId) => (stage(id).done(status) ? "flow lit" : "flow");

  const busX = 208;
  const busTop = 34;
  const busBottom = 148;
  const ingestCy = rowY.ingest + NODE_H / 2;

  return (
    <svg className="diagram" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Pipeline from data ingestion to researcher validation">
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--ink-400)" />
        </marker>
        <marker id="arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--green-500)" />
        </marker>
      </defs>

      {/* Sources fanning into ingestion */}
      {SOURCES.map((label, i) => {
        const y = 22 + i * 38;
        return (
          <g key={label}>
            <rect className="source-box" x={12} y={y} width={168} height={26} rx={6} />
            <text className="node-meta" x={26} y={y + 17} style={{ fontSize: 10.5 }}>{label}</text>
            <path className={status.counts.sources ? "flow lit" : "flow"}
              d={`M180 ${y + 13} H ${busX}`} />
          </g>
        );
      })}
      <path className={status.counts.sources ? "flow lit" : "flow"} d={`M${busX} ${busTop} V ${busBottom}`} />
      <path className={status.counts.sources ? "flow lit" : "flow"}
        d={`M${busX} ${ingestCy} H ${CX - MAIN_W / 2 - 8}`}
        markerEnd={status.counts.sources ? "url(#arrow-lit)" : "url(#arrow)"} />

      {/* Ingestion -> model */}
      <Edge from={rowY.ingest + NODE_H} to={rowY.model} x={CX} cls={lit("ingest")} />

      {/* Model -> three lanes */}
      <path className={lit("model")}
        d={`M${CX} ${rowY.model + NODE_H} V ${rowY.lanes - 22} M${LANES[0].cx} ${rowY.lanes - 22} H ${LANES[2].cx}`} />
      {LANES.map((lane) => (
        <path key={lane.title} className={lit("model")}
          d={`M${lane.cx} ${rowY.lanes - 22} V ${rowY.lanes - 8}`}
          markerEnd={stage("model").done(status) ? "url(#arrow-lit)" : "url(#arrow)"} />
      ))}

      {/* The three analysis lanes */}
      {LANES.map((lane) => {
        const count = status.counts.findings_by_perspective[lane.perspective] ?? 0;
        return (
          <Link key={lane.title} to={`/p/${projectId}/analyse`}>
            <g>
              <rect className={`node-box ${count > 0 ? "done" : status.counts.observations ? "active" : ""}`}
                x={lane.cx - LANE_W / 2} y={rowY.lanes} width={LANE_W} height={NODE_H} rx={9} />
              <text className="node-label" x={lane.cx} y={rowY.lanes + 21} textAnchor="middle">{lane.title}</text>
              <text className="node-meta" x={lane.cx} y={rowY.lanes + 35} textAnchor="middle">
                {count > 0 ? `${count} findings` : "not run"}
              </text>
            </g>
          </Link>
        );
      })}

      {/* Lanes -> evidence store */}
      {LANES.map((lane) => (
        <path key={`${lane.title}-out`} className={lit("analyse")}
          d={`M${lane.cx} ${rowY.lanes + NODE_H} V ${rowY.evidence - 22}`} />
      ))}
      <path className={lit("analyse")}
        d={`M${LANES[0].cx} ${rowY.evidence - 22} H ${LANES[2].cx} M${CX} ${rowY.evidence - 22} V ${rowY.evidence - 8}`}
        markerEnd={stage("analyse").done(status) ? "url(#arrow-lit)" : "url(#arrow)"} />

      <Edge from={rowY.evidence + NODE_H} to={rowY.triangulate} x={CX} cls={lit("evidence")} />
      <Edge from={rowY.triangulate + NODE_H} to={rowY.generate} x={CX} cls={lit("triangulate")} />
      <Edge from={rowY.generate + NODE_H} to={rowY.report} x={CX} cls={lit("generate")} />
      <Edge from={rowY.report + NODE_H} to={rowY.validate} x={CX} cls={lit("report")} />

      {NODES.map((node) => {
        const s = stage(node.id);
        return (
          <Link key={node.id} to={`/p/${projectId}/${s.path}`}>
            <g>
              <rect className={`node-box ${state(node.id)}`} x={node.x} y={node.y}
                width={node.w} height={NODE_H} rx={9} />
              {node.lines.length === 1 ? (
                <>
                  <text className="node-label" x={CX} y={node.y + 21} textAnchor="middle">{node.lines[0]}</text>
                  <text className="node-meta" x={CX} y={node.y + 35} textAnchor="middle">{s.note(status)} · {s.label.toLowerCase()}</text>
                </>
              ) : (
                <>
                  <text className="node-label" x={CX} y={node.y + 19} textAnchor="middle">{node.lines[0]}</text>
                  <text className="node-label" x={CX} y={node.y + 33} textAnchor="middle">{node.lines[1]}</text>
                </>
              )}
            </g>
          </Link>
        );
      })}
    </svg>
  );
}

function Edge({ from, to, x, cls }: { from: number; to: number; x: number; cls: string }) {
  return (
    <path className={cls} d={`M${x} ${from} V ${to - 8}`}
      markerEnd={cls.includes("lit") ? "url(#arrow-lit)" : "url(#arrow)"} />
  );
}
