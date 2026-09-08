import type { ReactNode } from "react";
import type { StageId } from "../../shared/types";
import { stageById } from "../lib/pipeline";

export function StageHead({ id, actions }: { id: StageId; actions?: ReactNode }) {
  const stage = stageById(id);
  return (
    <div className="stage-head">
      <div className="row between">
        <div>
          <div className="stage-eyebrow">Stage {stage.index} of 8 · {stage.diagramLabel}</div>
          <h2>{stage.label}</h2>
        </div>
        {actions ? <div className="btn-row">{actions}</div> : null}
      </div>
      <p>{stage.blurb}</p>
    </div>
  );
}
