export type ProjectRoleAgent = "pi" | "claude" | "codex";
export type ProjectRolePermission = "read" | "write";

export interface ProjectRoleTools {
  fsRead: boolean;
  fsWrite: boolean;
  execute: boolean;
}

export interface ProjectRoleDescriptor {
  id: string;
  slug: string;
  name: string;
  persona: string;
  agent: ProjectRoleAgent;
  model?: string;
  thoughtLevel?: string;
  permissions: ProjectRolePermission;
  tools: ProjectRoleTools;
  callable: string[];
  autoDispatch: boolean;
  enabled: boolean;
  filePath: string;
  fileName: string;
  updatedAtMs?: number;
}

export interface DiscoverProjectRolesOptions {
  projectPath?: string | null;
  panelHome?: string;
}
