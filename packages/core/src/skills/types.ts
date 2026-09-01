export type SkillScope = "project" | "user" | "pi" | "package";

export interface SkillDescriptor {
  name: string;
  description: string;
  location: string;
  directory: string;
  scope: SkillScope;
  triggers?: string[];
  content?: string;
}

export interface DiscoverSkillsOptions {
  projectPath?: string | null;
  panelHome?: string;
  userHome?: string;
  extraSkillPaths?: string[];
  loadContent?: boolean;
}
