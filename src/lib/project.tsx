import { createContext, useContext, type ReactNode } from "react";
import type { ProjectStatus } from "../../shared/types";

interface ProjectContextValue {
  status: ProjectStatus;
  reload: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider(
  { value, children }: { value: ProjectContextValue; children: ReactNode },
) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject must be used inside a ProjectProvider");
  return value;
}
