import type { DesktopApi } from "../../../preload/preload";

export type Project = Awaited<ReturnType<DesktopApi["listProjects"]>>[number];

export function basename(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

/** The value used to identify a project in note ownership. */
export function projectPathFor(project: Project): string {
  return project.localPath || project.portableKey;
}

export function projectMatchesNote(project: Project, noteProjectPath: string): boolean {
  const path = projectPathFor(project);
  return noteProjectPath === path
    || noteProjectPath === project.localPath
    || noteProjectPath === project.portableKey
    || (!!project.localPath && noteProjectPath.endsWith(project.portableKey.replace(/^~\//, "")));
}
