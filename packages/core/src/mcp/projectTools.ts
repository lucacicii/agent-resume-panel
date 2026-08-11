import { z } from "zod";
import {
  listProjects,
  mergeProjectsInCatalog,
  moveSessionToProjectInCatalog,
  reconcileProjectsFromSessions,
  tidyProjectsInCatalog
} from "../catalog/projects";
import type { ProjectRow } from "../catalog/projects";
import { mergeWorkbenchSessionFolders, removeWorkbenchSessionFromFolder } from "../catalog/workbenchFolders";
import type { AgentProvider } from "../catalog/types";

export interface ProjectToolContext {
  catalogDb: string;
  desktopDb: string;
}

export const PROJECT_LIST_DEFAULT_LIMIT = 100;
export const PROJECT_LIST_MAX_LIMIT = 200;

const providerEnum = z.enum(["codex", "claude", "agy", "grok", "opencode", "pi", "chat"]);

export const projectListSchema = {
  includeHidden: z
    .boolean()
    .optional()
    .describe("Include hidden (stale) projects. Defaults to false."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum projects to return. Defaults to ${PROJECT_LIST_DEFAULT_LIMIT}, capped at ${PROJECT_LIST_MAX_LIMIT}.`)
};

export const projectMergeSchema = {
  sourceProjectId: z
    .string()
    .min(1)
    .describe("Project id to merge away; its sessions and workbench folders move to the target."),
  targetProjectId: z
    .string()
    .min(1)
    .describe("Project id that absorbs the source."),
  mergeWorkbenchFolders: z
    .boolean()
    .optional()
    .describe("Also migrate the desktop workbench folder tree. Defaults to true.")
};

export const projectTidySchema = {
  apply: z
    .boolean()
    .optional()
    .describe(
      "When true, hide stale/empty projects (not pinned, no visible sessions, local path missing). Defaults to false — dry run that only reports candidates."
    )
};

export const projectReconcileSchema = {};

export const sessionMoveSchema = {
  provider: providerEnum.describe("Agent provider of the session."),
  sessionId: z.string().min(1).describe("Native agent session id (catalog agent_session_id)."),
  targetProjectPath: z
    .string()
    .min(1)
    .describe("Absolute directory the session should belong to. Reuses an existing project for this path or creates one.")
};

function projectToJson(p: ProjectRow): Record<string, unknown> {
  return {
    projectId: p.projectId,
    portableKey: p.portableKey,
    alias: p.alias,
    hidden: p.hidden,
    pinned: p.pinned,
    pathMissing: p.pathMissing,
    localPath: p.localPath,
    sessionCount: p.sessionCount,
    lastSeenAtMs: p.lastSeenAtMs,
    updatedAtMs: p.updatedAtMs
  };
}

function clampProjectListLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return PROJECT_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), PROJECT_LIST_MAX_LIMIT);
}

export async function handleProjectList(
  args: { includeHidden?: boolean; limit?: number },
  ctx: ProjectToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const limit = clampProjectListLimit(args.limit);
  const projects = await listProjects(ctx.catalogDb, { includeHidden: args.includeHidden === true });
  const slice = projects.slice(0, limit);
  if (!slice.length) {
    return {
      content: [{ type: "text", text: "No projects found." }]
    };
  }
  const payload = slice.map(projectToJson);
  return {
    content: [
      {
        type: "text",
        text: `Listed ${payload.length} project(s):\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleProjectMerge(
  args: { sourceProjectId: string; targetProjectId: string; mergeWorkbenchFolders?: boolean },
  ctx: ProjectToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const sourceProjectId = args.sourceProjectId?.trim();
  const targetProjectId = args.targetProjectId?.trim();
  if (!sourceProjectId || !targetProjectId) {
    throw new Error("sourceProjectId and targetProjectId are required.");
  }

  const result = await mergeProjectsInCatalog(ctx.catalogDb, sourceProjectId, targetProjectId);

  let movedFolders = 0;
  let movedAssignments = 0;
  if (args.mergeWorkbenchFolders !== false && ctx.desktopDb?.trim()) {
    try {
      const wb = await mergeWorkbenchSessionFolders(ctx.desktopDb, sourceProjectId, targetProjectId);
      movedFolders = wb.movedFolders;
      movedAssignments = wb.movedAssignments;
    } catch {
      // Desktop workbench tables may be absent — catalog merge is already done.
    }
  }

  const payload = {
    ok: true,
    targetProjectId: result.targetProjectId,
    mergedSessions: result.mergedSessions,
    movedFolders,
    movedAssignments
  };
  return {
    content: [
      {
        type: "text",
        text: `Merged projects:\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleProjectTidy(
  args: { apply?: boolean },
  ctx: ProjectToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = await tidyProjectsInCatalog(ctx.catalogDb, { dryRun: args.apply !== true });
  const payload = {
    ok: true,
    dryRun: result.dryRun,
    hiddenProjects: result.hiddenProjects,
    candidates: result.candidates
  };
  if (!result.candidates.length) {
    return {
      content: [
        {
          type: "text",
          text: `Tidy found no stale/empty projects to ${result.dryRun ? "hide" : "clean up"}.`
        }
      ]
    };
  }
  const action = result.dryRun ? "would hide" : "hidden";
  return {
    content: [
      {
        type: "text",
        text: `Tidy ${action} ${result.candidates.length} stale/empty project(s):\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleProjectReconcile(
  _args: Record<string, never>,
  ctx: ProjectToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = await reconcileProjectsFromSessions(ctx.catalogDb);
  const payload = {
    ok: true,
    projectCount: result.projectCount,
    linkedSessions: result.linkedSessions
  };
  return {
    content: [
      {
        type: "text",
        text: `Reconciled projects from sessions:\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleSessionMove(
  args: { provider: string; sessionId: string; targetProjectPath: string },
  ctx: ProjectToolContext
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const provider = args.provider?.trim() as AgentProvider;
  const sessionId = args.sessionId?.trim();
  const targetProjectPath = args.targetProjectPath?.trim();
  if (!provider || !sessionId || !targetProjectPath) {
    throw new Error("provider, sessionId, and targetProjectPath are required.");
  }

  let result;
  try {
    result = await moveSessionToProjectInCatalog(ctx.catalogDb, provider, sessionId, targetProjectPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Session move failed: ${message}` }]
    };
  }

  // A workbench folder assignment only leaves when the session crosses projects.
  if (
    result.moved &&
    result.fromProjectId &&
    result.fromProjectId !== result.toProjectId &&
    ctx.desktopDb?.trim()
  ) {
    try {
      await removeWorkbenchSessionFromFolder(ctx.desktopDb, provider, sessionId);
    } catch {
      // Desktop workbench tables may be absent — catalog move is already done.
    }
  }

  const payload = { ok: true, ...result };
  const headline = result.moved
    ? `Moved session ${provider}:${sessionId} to ${result.newPath}`
    : `Session ${provider}:${sessionId} already belongs to ${result.newPath}`;
  return {
    content: [
      {
        type: "text",
        text: `${headline}:\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}
