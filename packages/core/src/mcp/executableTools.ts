import { z } from "zod";
import {
  appendResultBlock,
  configureExecutableManagedSection,
  executableContentHash,
  EXECUTABLE_MAX_NEST_DEPTH,
  parseExecutableNote,
  type ExecutableManagedConfiguration,
  type ResultBlockStatus
} from "../notes/executable";
import type { NoteRecord } from "../notes/catalogNotes";
import { noteResponse, type NoteMcpResult, type NoteToolContext } from "./tools";

const noteIdSchema = z.string().min(1).max(200);
const safeProviderSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);

export const noteExecutableInspectSchema = {
  noteId: noteIdSchema.describe("Project Note to inspect.")
};

export const noteExecutableConfigureSchema = {
  noteId: noteIdSchema.describe("Project Note whose MCP-managed executable region should be configured."),
  expectedContentHash: z.string().min(1).max(32).optional().describe("Optimistic concurrency hash returned by note_executable_inspect."),
  mode: z.enum(["composite", "leaf", "none"]),
  preserveActive: z.boolean().optional().describe("Preserve an executing run verbatim. Defaults to true."),
  run: z.object({
    status: z.enum(["draft", "awaiting_approval"]),
    text: z.string().max(20_000).optional()
  }).optional(),
  children: z.array(z.object({
    noteId: noteIdSchema,
    status: z.enum(["idle", "planned"]).optional(),
    text: z.string().min(1).max(20_000)
  })).max(1_000).optional(),
  session: z.object({
    provider: safeProviderSchema,
    status: z.enum(["idle", "planned"]).optional(),
    prompt: z.string().min(1).max(100_000)
  }).optional()
};

export const noteExecutableAppendResultSchema = {
  noteId: noteIdSchema,
  status: z.enum(["completed", "failed", "partial", "blocked"]),
  text: z.string().min(1).max(100_000),
  dedupeKey: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/).optional()
};

export const noteExecutableValidateTreeSchema = {
  rootNoteId: noteIdSchema,
  maxNodes: z.number().int().min(1).max(200).optional(),
  maxDepth: z.number().int().min(1).max(EXECUTABLE_MAX_NEST_DEPTH).optional()
};

function assertProject(record: NoteRecord | undefined, label = "Note"): asserts record is NoteRecord {
  if (!record) throw new Error(`${label} not found.`);
  if (record.scope !== "project" || !record.projectPath) {
    throw new Error(`${label} must be a project note.`);
  }
}

export async function handleNoteExecutableInspect(
  args: { noteId: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const record = await ctx.notesStore.getNote(args.noteId);
  if (!record) throw new Error("Note not found.");
  const content = await ctx.notesStore.readNoteContent(args.noteId);
  const parsed = parseExecutableNote(content);
  const probe = await ctx.notesStore.probeExecutableNote(args.noteId);
  const [runs, bindings] = await Promise.all([
    ctx.notesStore.listExecutableRuns(args.noteId),
    ctx.notesStore.listExecutableBindings(args.noteId)
  ]);
  return noteResponse("Executable note inspected.", {
    noteId: args.noteId,
    scope: record.scope,
    projectPath: record.projectPath,
    updatedAtMs: record.updatedAtMs,
    contentHash: executableContentHash(content),
    active: parsed.runs.some((run) => run.status === "executing"),
    role: parsed.runs.length && parsed.noteChildren.length
      ? "composite"
      : parsed.sessions.length
        ? "leaf"
        : "passive",
    parsed,
    probe,
    runs,
    bindings
  });
}

export async function handleNoteExecutableConfigure(
  args: {
    noteId: string;
    expectedContentHash?: string;
    mode: "composite" | "leaf" | "none";
    preserveActive?: boolean;
    run?: { status: "draft" | "awaiting_approval"; text?: string };
    children?: Array<{ noteId: string; status?: "idle" | "planned"; text: string }>;
    session?: { provider: string; status?: "idle" | "planned"; prompt: string };
  },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const record = await ctx.notesStore.getNote(args.noteId);
  assertProject(record);
  const content = await ctx.notesStore.readNoteContent(args.noteId);
  const beforeHash = executableContentHash(content);
  if (args.expectedContentHash && args.expectedContentHash !== beforeHash) {
    throw new Error(`Executable note content conflict: expected ${args.expectedContentHash}, found ${beforeHash}.`);
  }

  const children = args.children || [];
  if (args.mode === "composite") {
    const seen = new Set<string>();
    for (const child of children) {
      if (child.noteId === args.noteId) throw new Error("Executable child cannot reference its own note.");
      if (seen.has(child.noteId)) throw new Error(`Duplicate executable child: ${child.noteId}.`);
      seen.add(child.noteId);
      const childRecord = await ctx.notesStore.getNote(child.noteId);
      assertProject(childRecord, `Child note ${child.noteId}`);
      if (childRecord.projectPath !== record.projectPath) {
        throw new Error(`Child note ${child.noteId} belongs to a different project.`);
      }
      const parent = await ctx.notesStore.getNoteParent(child.noteId);
      if (parent?.parentNoteId !== args.noteId) {
        throw new Error(`Child note ${child.noteId} is not linked to parent ${args.noteId}.`);
      }
    }
  }

  const configuration: ExecutableManagedConfiguration = {
    mode: args.mode,
    run: args.run,
    children,
    session: args.session
  };
  const update = configureExecutableManagedSection(
    content,
    configuration,
    args.preserveActive !== false
  );
  if (update.changed) await ctx.notesStore.writeValidatedNoteContent(args.noteId, update.content);
  return noteResponse("Executable note configured.", {
    noteId: args.noteId,
    mode: args.mode,
    changed: update.changed,
    preservedActive: update.preservedActive,
    previousContentHash: beforeHash,
    contentHash: executableContentHash(update.content),
    parsed: parseExecutableNote(update.content)
  });
}

export async function handleNoteExecutableAppendResult(
  args: { noteId: string; status: ResultBlockStatus; text: string; dedupeKey?: string },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const record = await ctx.notesStore.getNote(args.noteId);
  assertProject(record);
  const content = await ctx.notesStore.readNoteContent(args.noteId);
  const marker = args.dedupeKey ? `<!-- agent-resume-result:${args.dedupeKey} -->` : "";
  if (marker && content.includes(marker)) {
    return noteResponse("Executable result already exists.", {
      noteId: args.noteId,
      changed: false,
      deduplicated: true,
      contentHash: executableContentHash(content)
    });
  }
  let next = appendResultBlock(content, { status: args.status, text: args.text });
  if (marker) {
    const blockStart = next.lastIndexOf(`:::result ${args.status}`);
    next = `${next.slice(0, blockStart)}${marker}\n${next.slice(blockStart)}`;
  }
  await ctx.notesStore.writeValidatedNoteContent(args.noteId, next);
  return noteResponse("Executable result appended.", {
    noteId: args.noteId,
    changed: true,
    deduplicated: false,
    contentHash: executableContentHash(next)
  });
}

interface ValidationNode {
  noteId: string;
  parentNoteId?: string;
  depth: number;
  role: "composite" | "leaf" | "passive";
  runStatus?: string;
  childStatuses: Array<{ noteId?: string; status: string }>;
  sessionStatus?: string;
  sessionProvider?: string;
}

export async function handleNoteExecutableValidateTree(
  args: { rootNoteId: string; maxNodes?: number; maxDepth?: number },
  ctx: NoteToolContext
): Promise<NoteMcpResult> {
  const rootRecord = await ctx.notesStore.getNote(args.rootNoteId);
  assertProject(rootRecord, "Root note");
  const maxNodes = args.maxNodes || 200;
  const maxDepth = args.maxDepth || EXECUTABLE_MAX_NEST_DEPTH;
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes: ValidationNode[] = [];
  const seen = new Set<string>();
  const queue: Array<{ noteId: string; parentNoteId?: string; depth: number; required: boolean }> = [
    { noteId: args.rootNoteId, depth: 0, required: true }
  ];
  let truncated = false;

  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.noteId)) {
      errors.push(`Executable tree cycle or duplicate reference at ${current.noteId}.`);
      continue;
    }
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    seen.add(current.noteId);
    const record = await ctx.notesStore.getNote(current.noteId);
    if (!record) {
      errors.push(`Referenced note not found: ${current.noteId}.`);
      continue;
    }
    if (record.scope !== "project" || record.projectPath !== rootRecord.projectPath) {
      errors.push(`Note ${current.noteId} is outside project ${rootRecord.projectPath}.`);
    }
    if (current.parentNoteId) {
      const parent = await ctx.notesStore.getNoteParent(current.noteId);
      if (parent?.parentNoteId !== current.parentNoteId) {
        errors.push(`Note ${current.noteId} is not linked to executable parent ${current.parentNoteId}.`);
      }
    }
    const parsed = parseExecutableNote(await ctx.notesStore.readNoteContent(current.noteId));
    const composite = parsed.runs.length > 0 || parsed.noteChildren.length > 0;
    const leaf = parsed.sessions.length > 0;
    const role: ValidationNode["role"] = composite ? "composite" : leaf ? "leaf" : "passive";
    if (composite) {
      if (parsed.runs.length !== 1) errors.push(`Composite note ${current.noteId} must contain exactly one run block.`);
      if (!parsed.noteChildren.length) errors.push(`Composite note ${current.noteId} has no note-child blocks.`);
      if (parsed.sessions.length) errors.push(`Composite note ${current.noteId} must not contain a session block.`);
      if (current.depth >= maxDepth) {
        errors.push(`Composite note ${current.noteId} reaches executable depth limit ${maxDepth}.`);
      }
    } else if (leaf) {
      if (parsed.sessions.length !== 1) errors.push(`Leaf note ${current.noteId} must contain exactly one session block.`);
      if (parsed.runs.length || parsed.noteChildren.length) errors.push(`Leaf note ${current.noteId} mixes composite directives.`);
    } else if (current.required) {
      errors.push(`Executable note ${current.noteId} has neither a composite run nor a leaf session.`);
    }
    nodes.push({
      noteId: current.noteId,
      parentNoteId: current.parentNoteId,
      depth: current.depth,
      role,
      runStatus: parsed.runs[0]?.status,
      childStatuses: parsed.noteChildren.map((child) => ({ noteId: child.noteId, status: child.status })),
      sessionStatus: parsed.sessions[0]?.status,
      sessionProvider: parsed.sessions[0]?.provider
    });
    const childIds = new Set<string>();
    for (const child of parsed.noteChildren) {
      if (!child.noteId) {
        errors.push(`Note ${current.noteId} contains an unbound note-child at index ${child.index}.`);
        continue;
      }
      if (childIds.has(child.noteId)) errors.push(`Note ${current.noteId} references child ${child.noteId} more than once.`);
      childIds.add(child.noteId);
      queue.push({
        noteId: child.noteId,
        parentNoteId: current.noteId,
        depth: current.depth + 1,
        required: child.status !== "done"
      });
    }
  }

  if (truncated) warnings.push(`Validation stopped at maxNodes=${maxNodes}.`);
  const counts = {
    nodes: nodes.length,
    composite: nodes.filter((node) => node.role === "composite").length,
    leaf: nodes.filter((node) => node.role === "leaf").length,
    passive: nodes.filter((node) => node.role === "passive").length,
    completed: nodes.filter((node) => node.runStatus === "completed" || node.sessionStatus === "settled").length
  };
  return noteResponse("Executable note tree validated.", {
    rootNoteId: args.rootNoteId,
    projectPath: rootRecord.projectPath,
    valid: errors.length === 0 && !truncated,
    maxDepth,
    maxNodes,
    truncated,
    counts,
    nodes,
    errors,
    warnings
  });
}
