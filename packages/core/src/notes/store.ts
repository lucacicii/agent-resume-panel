import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureExtensionCatalogSchema } from "../catalog/db";
import type { AgentProvider, AgentSession } from "../catalog/types";
import { sessionGtdKey } from "../gtd/store";
import { resolvePanelHome } from "../panelHome";
import { normalizeProjectPath } from "../pathUtils";
import {
  deleteNoteRecord,
  getNoteById,
  listAllNotes,
  listLibraryNotes,
  listProjectNotes,
  listSessionNotes,
  loadProjectNoteFlags,
  loadSessionNoteFlags,
  upsertNoteRecord,
  type NoteRecord
} from "./catalogNotes";
import {
  buildNoteDocument,
  contentPreview,
  extractTitle,
  parseNoteDocument,
  type NoteFrontmatter
} from "./frontmatter";
import {
  nextNoteFilename,
  normalizeNoteFilename,
  noteAssetsDirName,
  noteStem,
  rewriteAssetReferences,
  uniqueNoteFilename
} from "./naming";
import {
  absFromRelMdPath,
  type NoteOwner,
  notesRoot,
  ownerRelDir
} from "./paths";
import {
  deleteNoteFiles,
  ensureAssetsDir,
  ensureOwnerDir,
  fileMtimeMs,
  listMarkdownFilenames,
  newNoteId,
  pathExists,
  readNoteFile,
  renameNoteFiles,
  writeNewNoteFile
} from "./fs";
import { reconcileNotesIndex } from "./reconcile";
import {
  clearParentLink,
  collectDescendantIds,
  deleteLinksForNote,
  getNoteSubtree,
  getParentLink,
  listAllNoteLinks,
  listChildCounts,
  listChildLinks,
  listLinkedChildNoteIds,
  resolveLinkRoot,
  setParentLink,
  type NoteLink,
  type NoteSubtree,
  type NoteTreeNode
} from "./links";
import {
  appendResultBlock,
  applyMaterializedNoteIds,
  currentExecutableChild,
  defaultChildNoteBody,
  EXECUTABLE_MAX_NEST_DEPTH,
  formatNativeSessionRef,
  formatNoteChildBlock,
  isCompositeExecutableParsed,
  listUnmaterializedNoteChildren,
  noteChildTitle,
  parseExecutableNote,
  parseNativeSessionRef,
  updateNoteChildBlocks,
  updateRunBlocks,
  updateSessionBlocks,
  type NoteChildStatus,
  type RunBlockStatus,
  type SessionBlockStatus
} from "./executable";
import {
  listNoteRunsForSource,
  listNoteSessionBindings,
  upsertNoteRun,
  upsertNoteSessionBinding,
  type NoteRunRow,
  type NoteSessionBinding
} from "./executableBindings";

export interface ImportNotesResult {
  imported: number;
  skipped: number;
  errors: string[];
  records: NoteRecord[];
}

export interface ExecutableNoteProbe {
  runCount: number;
  runStatus?: RunBlockStatus;
  hasRun: boolean;
  hasSession: boolean;
  sessionStatus?: SessionBlockStatus;
  sessionProvider?: string;
  sessionNativeRef?: { provider: string; sessionId: string } | undefined;
  asStep?: {
    parentNoteId: string;
    childStatus: NoteChildStatus;
    parentRunStatus?: RunBlockStatus;
  };
}

export type { NoteLink, NoteSubtree, NoteTreeNode };

export class NotesStore {
  private sessionFlags = new Set<string>();
  private projectFlags = new Set<string>();
  private cachedNotes: NoteRecord[] = [];
  private panelHome: string;

  constructor(
    private readonly dbPath: string,
    panelHome?: string,
    private readonly ensureSchema: (dbPath: string) => Promise<void> = ensureExtensionCatalogSchema
  ) {
    this.panelHome = resolvePanelHome(panelHome);
  }

  getPanelHome(): string {
    return this.panelHome;
  }

  setPanelHome(panelHome: string): void {
    this.panelHome = resolvePanelHome(panelHome);
  }

  async initialize(): Promise<void> {
    await this.ensureSchema(this.dbPath);
    await fs.mkdir(notesRoot(this.panelHome), { recursive: true });
    await this.reload();
  }

  async reload(): Promise<void> {
    await reconcileNotesIndex(this.dbPath, this.panelHome);
    this.cachedNotes = await listAllNotes(this.dbPath);
    this.sessionFlags = await loadSessionNoteFlags(this.dbPath);
    this.projectFlags = await loadProjectNoteFlags(this.dbPath);
  }

  getAllNotes(): NoteRecord[] {
    return this.cachedNotes;
  }

  hasSessionNote(session: Pick<AgentSession, "provider" | "id">): boolean {
    return this.sessionFlags.has(sessionGtdKey(session.provider, session.id));
  }

  hasProjectNote(projectPath: string): boolean {
    return this.projectFlags.has(normalizeProjectPath(projectPath));
  }

  async listSessionNotes(session: Pick<AgentSession, "provider" | "id">): Promise<NoteRecord[]> {
    return listSessionNotes(this.dbPath, session.provider, session.id);
  }

  async listProjectNotes(projectPath: string): Promise<NoteRecord[]> {
    return listProjectNotes(this.dbPath, projectPath);
  }

  async listLibraryNotes(): Promise<NoteRecord[]> {
    return listLibraryNotes(this.dbPath);
  }

  async getNote(noteId: string): Promise<NoteRecord | undefined> {
    return getNoteById(this.dbPath, noteId);
  }

  absolutePath(record: NoteRecord): string {
    return absFromRelMdPath(this.panelHome, record.relMdPath);
  }

  async readNoteContent(noteId: string): Promise<string> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    return readNoteFile(this.absolutePath(record));
  }

  async writeNoteContent(
    noteId: string,
    content: string
  ): Promise<NoteRecord & { content?: string; materialized?: boolean }> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    let nextContent = content;
    let materialized = false;
    if (record.scope === "project") {
      const before = content;
      nextContent = await this.materializeExecutableChildrenInContent(noteId, content, {
        defaultProvider: "codex"
      });
      materialized = nextContent !== before;
    }
    await fs.writeFile(this.absolutePath(record), nextContent, "utf8");
    await this.refreshNoteFromDisk(record);
    const updated = await getNoteById(this.dbPath, noteId);
    if (!updated) {
      throw new Error("Note not found after write.");
    }
    return { ...updated, content: nextContent, materialized };
  }

  /**
   * Materialize `:::note-child` blocks without `note=` into linked project notes.
   * Each child gets a title heading + empty `:::session` block.
   * Returns updated parent markdown (may be unchanged).
   */
  async materializeExecutableChildrenInContent(
    parentNoteId: string,
    content: string,
    options?: { defaultProvider?: string }
  ): Promise<string> {
    const pending = listUnmaterializedNoteChildren(content);
    if (pending.length === 0) {
      return content;
    }
    const parent = await getNoteById(this.dbPath, parentNoteId);
    if (!parent || parent.scope !== "project" || !parent.projectPath) {
      return content;
    }
    const provider = options?.defaultProvider?.trim() || "codex";
    const materializations: Array<{ index: number; noteId: string }> = [];
    for (const block of pending) {
      const title = noteChildTitle(block);
      const body = defaultChildNoteBody(title, provider);
      const child = await this.createLinkedChildNote(parentNoteId, body);
      materializations.push({ index: block.index, noteId: child.noteId });
    }
    return applyMaterializedNoteIds(content, materializations);
  }

  async parseExecutable(noteId: string) {
    const content = await this.readNoteContent(noteId);
    return { content, ...parseExecutableNote(content) };
  }

  async isCompositeExecutableNote(noteId: string): Promise<boolean> {
    const content = await this.readNoteContent(noteId);
    return isCompositeExecutableParsed(parseExecutableNote(content));
  }

  /**
   * Find an outer run note that lists `noteId` as a :::note-child step.
   * Prefer note_links parent; fall back to scanning project notes.
   */
  async findExecutableOuterParentNoteId(noteId: string): Promise<string | undefined> {
    const link = await getParentLink(this.dbPath, noteId);
    if (link?.parentNoteId) {
      try {
        const content = await this.readNoteContent(link.parentNoteId);
        const parsed = parseExecutableNote(content);
        if (parsed.noteChildren.some((c) => c.noteId === noteId) && parsed.runs.length > 0) {
          return link.parentNoteId;
        }
      } catch {
        // continue scan
      }
    }
    const record = await getNoteById(this.dbPath, noteId);
    if (!record?.projectPath) return undefined;
    const projectNotes = await this.listProjectNotes(record.projectPath).catch(() => []);
    for (const candidate of projectNotes) {
      if (candidate.noteId === noteId) continue;
      try {
        const content = await this.readNoteContent(candidate.noteId);
        const parsed = parseExecutableNote(content);
        if (
          parsed.runs.length > 0 &&
          parsed.noteChildren.some((c) => c.noteId === noteId)
        ) {
          return candidate.noteId;
        }
      } catch {
        // skip unreadable
      }
    }
    return undefined;
  }

  /**
   * From a run-holder note (already executing or approvable), dive through composite
   * children until a leaf step is reached. Approves nested runs as needed.
   */
  async resolveExecutableLeaf(
    startNoteId: string,
    options?: { defaultProvider?: string; maxDepth?: number }
  ): Promise<{
    leafNoteId: string;
    leafParentNoteId: string;
    path: Array<{ noteId: string; title: string; composite: boolean }>;
    runIdsByNoteId: Record<string, string>;
  }> {
    const maxDepth = options?.maxDepth ?? EXECUTABLE_MAX_NEST_DEPTH;
    const path: Array<{ noteId: string; title: string; composite: boolean }> = [];
    const runIdsByNoteId: Record<string, string> = {};
    const ancestors = new Set<string>();
    let noteId = startNoteId;
    let depth = 0;

    while (depth <= maxDepth) {
      if (ancestors.has(noteId)) {
        throw new Error(`Executable nest cycle detected at note ${noteId}.`);
      }
      ancestors.add(noteId);

      const record = await getNoteById(this.dbPath, noteId);
      if (!record) {
        throw new Error(`Note not found: ${noteId}`);
      }

      const before = await this.readNoteContent(noteId);
      let content = before;
      if (record.scope === "project") {
        content = await this.materializeExecutableChildrenInContent(noteId, content, {
          defaultProvider: options?.defaultProvider
        });
        if (content !== before) {
          await fs.writeFile(this.absolutePath(record), content, "utf8");
          await this.refreshNoteFromDisk(record);
        }
      }

      let parsed = parseExecutableNote(content);
      const title = record.title || record.filename.replace(/\.md$/i, "") || noteId;
      const composite = isCompositeExecutableParsed(parsed);

      if (!composite) {
        // Leaf: either start note itself is leaf (no children run), or we should not be here
        // without a parent frame — treat as leaf for CLI.
        path.push({ noteId, title, composite: false });
        const parentLink = await getParentLink(this.dbPath, noteId);
        return {
          leafNoteId: noteId,
          leafParentNoteId: parentLink?.parentNoteId || noteId,
          path,
          runIdsByNoteId
        };
      }

      path.push({ noteId, title, composite: true });

      // Ensure this note's run is executing.
      const run = parsed.runs[0];
      if (!run) {
        throw new Error(`Composite note ${noteId} has no :::run block.`);
      }
      if (run.status === "awaiting_approval" || run.status === "draft") {
        const approved = await this.approveExecutableRun(noteId, {
          defaultProvider: options?.defaultProvider
        });
        runIdsByNoteId[noteId] = approved.runId;
        content = approved.content;
        parsed = parseExecutableNote(content);
      } else if (run.status === "executing") {
        const runs = await listNoteRunsForSource(this.dbPath, noteId);
        const active = runs.find((r) => r.status === "executing") || runs[0];
        if (active?.runId) runIdsByNoteId[noteId] = active.runId;
      } else if (run.status === "completed" || run.status === "failed") {
        throw new Error(`Composite note ${noteId} run is already ${run.status}.`);
      }

      const current = currentExecutableChild(parsed);
      if (!current?.noteId) {
        throw new Error(`Composite note ${noteId} has no current note-child step.`);
      }

      // Keep note_links aligned with note-child chain so nested settle can bubble.
      try {
        await this.setNoteParent(current.noteId, noteId);
      } catch {
        // Cross-scope or cycle — bubble may fall back to non-linked parents.
      }

      // Ensure current child is marked running on this parent.
      if (current.status !== "running") {
        const updates = new Map<number, { status: "running" | "planned" }>();
        for (const child of parsed.noteChildren) {
          if (child.index === current.index) updates.set(child.index, { status: "running" });
          else if (child.status === "idle" || child.status === "planned") {
            updates.set(child.index, { status: "planned" });
          }
        }
        content = updateNoteChildBlocks(content, updates);
        await fs.writeFile(this.absolutePath(record), content, "utf8");
        await this.refreshNoteFromDisk(record);
      }

      const childIsComposite = await this.isCompositeExecutableNote(current.noteId);
      if (childIsComposite) {
        noteId = current.noteId;
        depth += 1;
        continue;
      }

      // Leaf under this composite (or root flat chain).
      const leafRecord = await getNoteById(this.dbPath, current.noteId);
      const leafTitle =
        leafRecord?.title || leafRecord?.filename.replace(/\.md$/i, "") || current.noteId;
      path.push({ noteId: current.noteId, title: leafTitle, composite: false });
      return {
        leafNoteId: current.noteId,
        leafParentNoteId: noteId,
        path,
        runIdsByNoteId
      };
    }

    throw new Error(`Executable nest exceeds max depth ${maxDepth}.`);
  }

  async approveExecutableRun(
    noteId: string,
    options?: { runIndex?: number; defaultProvider?: string }
  ): Promise<{ content: string; runId: string; childNoteIds: string[] }> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    let content = await this.readNoteContent(noteId);
    if (record.scope === "project") {
      content = await this.materializeExecutableChildrenInContent(noteId, content, {
        defaultProvider: options?.defaultProvider
      });
    }
    const parsed = parseExecutableNote(content);
    const runIndex = options?.runIndex ?? 0;
    const run = parsed.runs[runIndex];
    if (!run) {
      throw new Error("No :::run block found on this note.");
    }
    if (run.status !== "awaiting_approval" && run.status !== "draft") {
      throw new Error(`Run is not approvable (status=${run.status}).`);
    }
    if (parsed.noteChildren.length === 0) {
      throw new Error("No :::note-child blocks to execute.");
    }
    const stillPending = parsed.noteChildren.filter((c) => !c.noteId);
    if (stillPending.length > 0) {
      throw new Error("Some note-child blocks could not be materialized (project notes only).");
    }

    const runId = newNoteId();
    content = updateRunBlocks(
      content,
      new Map([[runIndex, { status: "executing" as RunBlockStatus }]])
    );

    // Mark first child running; remaining planned (serial).
    const childUpdates = new Map<
      number,
      { status: "running" | "planned"; noteId?: string }
    >();
    for (const child of parseExecutableNote(content).noteChildren) {
      childUpdates.set(child.index, {
        status: child.index === 0 ? "running" : "planned",
        noteId: child.noteId
      });
    }
    content = updateNoteChildBlocks(content, childUpdates);

    // Mark first child's session planned (spawn is Desktop's job; native id may arrive later).
    const firstChildId = parseExecutableNote(content).noteChildren[0]?.noteId;
    if (firstChildId) {
      const childContent = await this.readNoteContent(firstChildId);
      const childParsed = parseExecutableNote(childContent);
      if (childParsed.sessions[0]) {
        const nextChild = updateSessionBlocks(
          childContent,
          new Map([[0, { status: "planned" as SessionBlockStatus }]])
        );
        await fs.writeFile(
          this.absolutePath((await getNoteById(this.dbPath, firstChildId))!),
          nextChild,
          "utf8"
        );
        await this.refreshNoteFromDisk((await getNoteById(this.dbPath, firstChildId))!);
      }
    }

    await upsertNoteRun(this.dbPath, {
      runId,
      sourceNoteId: noteId,
      status: "executing",
      currentChildIndex: 0
    });

    await fs.writeFile(this.absolutePath(record), content, "utf8");
    await this.refreshNoteFromDisk(record);

    const childNoteIds = parseExecutableNote(content)
      .noteChildren.map((c) => c.noteId)
      .filter((id): id is string => Boolean(id));

    return { content, runId, childNoteIds };
  }

  async bindExecutableSession(args: {
    noteId: string;
    provider: string;
    agentSessionId: string;
    runId?: string;
    role?: string;
    status?: string;
  }): Promise<{ content: string }> {
    const record = await getNoteById(this.dbPath, args.noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    let content = await this.readNoteContent(args.noteId);
    const parsed = parseExecutableNote(content);
    if (parsed.sessions[0]) {
      content = updateSessionBlocks(
        content,
        new Map([
          [
            0,
            {
              provider: args.provider,
              status: "running" as SessionBlockStatus,
              native: formatNativeSessionRef(args.provider, args.agentSessionId)
            }
          ]
        ])
      );
      await fs.writeFile(this.absolutePath(record), content, "utf8");
      await this.refreshNoteFromDisk(record);
    }
    await upsertNoteSessionBinding(this.dbPath, {
      noteId: args.noteId,
      provider: args.provider,
      agentSessionId: args.agentSessionId,
      runId: args.runId,
      role: args.role,
      status: args.status || "running"
    });
    return { content };
  }

  /**
   * Settle one child, then bubble to outer parent runs when a nested run finishes.
   * Returns the innermost settle result plus optional next leaf after advance/bubble.
   */
  async settleExecutableChildWithBubble(args: {
    parentNoteId: string;
    childNoteId: string;
    outcome: "completed" | "failed";
    summary: string;
    runId?: string;
    defaultProvider?: string;
  }): Promise<{
    content: string;
    advanced: boolean;
    done: boolean;
    bubbled: boolean;
    /** When chain still running, dive to the next CLI leaf. */
    nextLeaf?: {
      leafNoteId: string;
      leafParentNoteId: string;
      path: Array<{ noteId: string; title: string; composite: boolean }>;
      runIdsByNoteId: Record<string, string>;
    };
    /** Root-most note whose run ended (completed/failed) after bubbling. */
    terminalNoteId?: string;
  }> {
    let parentNoteId = args.parentNoteId;
    let childNoteId = args.childNoteId;
    let outcome = args.outcome;
    let summary = args.summary;
    let runId = args.runId;
    let bubbled = false;
    let last = await this.settleExecutableChild({
      parentNoteId,
      childNoteId,
      outcome,
      summary,
      runId
    });

    while (last.done) {
      const outerParentId = await this.findExecutableOuterParentNoteId(parentNoteId);
      if (!outerParentId) {
        return {
          ...last,
          bubbled,
          terminalNoteId: parentNoteId
        };
      }
      const outerContent = await this.readNoteContent(outerParentId);
      const outerParsed = parseExecutableNote(outerContent);
      const asStep = outerParsed.noteChildren.find((c) => c.noteId === parentNoteId);
      if (!asStep) {
        return { ...last, bubbled, terminalNoteId: parentNoteId };
      }
      // Nested frame finished — settle this composite step on the outer chain.
      const outerRuns = await listNoteRunsForSource(this.dbPath, outerParentId);
      const outerRun =
        outerRuns.find((r) => r.status === "executing") ||
        outerRuns.find((r) => r.status === "awaiting_approval");
      bubbled = true;
      last = await this.settleExecutableChild({
        parentNoteId: outerParentId,
        childNoteId: parentNoteId,
        outcome,
        summary:
          outcome === "completed"
            ? `Nested run completed on ${parentNoteId}.`
            : `Nested run failed on ${parentNoteId}: ${summary}`,
        runId: outerRun?.runId
      });
      childNoteId = parentNoteId;
      parentNoteId = outerParentId;
      runId = outerRun?.runId;
    }

    if (last.advanced || (!last.done && outcome === "completed")) {
      // After advance, resolve next leaf from the parent that still has executing run.
      try {
        const nextLeaf = await this.resolveExecutableLeaf(parentNoteId, {
          defaultProvider: args.defaultProvider
        });
        return { ...last, bubbled, nextLeaf };
      } catch {
        return { ...last, bubbled };
      }
    }

    return { ...last, bubbled, terminalNoteId: last.done ? parentNoteId : undefined };
  }

  async settleExecutableChild(args: {
    parentNoteId: string;
    childNoteId: string;
    outcome: "completed" | "failed";
    summary: string;
    runId?: string;
  }): Promise<{ content: string; advanced: boolean; done: boolean }> {
    const parent = await getNoteById(this.dbPath, args.parentNoteId);
    if (!parent) {
      throw new Error("Parent note not found.");
    }
    let parentContent = await this.readNoteContent(args.parentNoteId);
    const children = parseExecutableNote(parentContent).noteChildren;
    const childIndex = children.findIndex((c) => c.noteId === args.childNoteId);
    if (childIndex < 0) {
      throw new Error("Child note is not part of this parent note-child chain.");
    }

    const childRecord = await getNoteById(this.dbPath, args.childNoteId);
    if (childRecord) {
      let childContent = await this.readNoteContent(args.childNoteId);
      const childSessions = parseExecutableNote(childContent).sessions;
      if (childSessions[0]) {
        childContent = updateSessionBlocks(
          childContent,
          new Map([
            [
              0,
              {
                status: (args.outcome === "completed" ? "settled" : "failed") as SessionBlockStatus
              }
            ]
          ])
        );
      }
      childContent = appendResultBlock(childContent, {
        status: args.outcome === "completed" ? "completed" : "failed",
        text: args.summary
      });
      await fs.writeFile(this.absolutePath(childRecord), childContent, "utf8");
      await this.refreshNoteFromDisk(childRecord);
    }

    parentContent = updateNoteChildBlocks(
      parentContent,
      new Map([
        [
          childIndex,
          { status: args.outcome === "completed" ? "done" : "failed" }
        ]
      ])
    );

    const nextIndex = childIndex + 1;
    const refreshedChildren = parseExecutableNote(parentContent).noteChildren;
    let advanced = false;
    let done = false;

    if (args.outcome === "failed") {
      parentContent = updateRunBlocks(
        parentContent,
        new Map([[0, { status: "failed" as RunBlockStatus }]])
      );
      parentContent = appendResultBlock(parentContent, {
        status: "failed",
        text: `Step ${childIndex + 1} failed: ${args.summary}`
      });
      done = true;
      if (args.runId) {
        await upsertNoteRun(this.dbPath, {
          runId: args.runId,
          sourceNoteId: args.parentNoteId,
          status: "failed",
          currentChildIndex: childIndex
        });
      }
    } else if (nextIndex >= refreshedChildren.length) {
      parentContent = updateRunBlocks(
        parentContent,
        new Map([[0, { status: "completed" as RunBlockStatus }]])
      );
      parentContent = appendResultBlock(parentContent, {
        status: "completed",
        text: `All ${refreshedChildren.length} child steps completed.`
      });
      done = true;
      if (args.runId) {
        await upsertNoteRun(this.dbPath, {
          runId: args.runId,
          sourceNoteId: args.parentNoteId,
          status: "completed",
          currentChildIndex: childIndex
        });
      }
    } else {
      parentContent = updateNoteChildBlocks(
        parentContent,
        new Map([[nextIndex, { status: "running" }]])
      );
      advanced = true;
      const nextChildId = refreshedChildren[nextIndex]?.noteId;
      if (nextChildId) {
        const nextRecord = await getNoteById(this.dbPath, nextChildId);
        if (nextRecord) {
          let nextContent = await this.readNoteContent(nextChildId);
          if (parseExecutableNote(nextContent).sessions[0]) {
            nextContent = updateSessionBlocks(
              nextContent,
              new Map([[0, { status: "planned" as SessionBlockStatus }]])
            );
            await fs.writeFile(this.absolutePath(nextRecord), nextContent, "utf8");
            await this.refreshNoteFromDisk(nextRecord);
          }
        }
      }
      if (args.runId) {
        await upsertNoteRun(this.dbPath, {
          runId: args.runId,
          sourceNoteId: args.parentNoteId,
          status: "executing",
          currentChildIndex: nextIndex
        });
      }
    }

    await fs.writeFile(this.absolutePath(parent), parentContent, "utf8");
    await this.refreshNoteFromDisk(parent);
    return { content: parentContent, advanced, done };
  }

  /**
   * Lightweight role probe for a note, used to render executable-state
   * context-menu actions without mutating anything.
   */
  async probeExecutableNote(noteId: string): Promise<ExecutableNoteProbe> {
    const content = await this.readNoteContent(noteId);
    const parsed = parseExecutableNote(content);
    const run = parsed.runs[0];
    const session = parsed.sessions[0];
    let asStep: {
      parentNoteId: string;
      childStatus: NoteChildStatus;
      parentRunStatus?: RunBlockStatus;
    } | undefined;

    const parentNoteId = await this.findExecutableOuterParentNoteId(noteId);
    if (parentNoteId) {
      try {
        const parentParsed = parseExecutableNote(await this.readNoteContent(parentNoteId));
        const step = parentParsed.noteChildren.find((c) => c.noteId === noteId);
        if (step) {
          asStep = {
            parentNoteId,
            childStatus: step.status,
            parentRunStatus: parentParsed.runs[0]?.status
          };
        }
      } catch {
        asStep = undefined;
      }
    }

    return {
      runCount: parsed.runs.length,
      runStatus: run?.status,
      hasRun: parsed.runs.length > 0,
      hasSession: parsed.sessions.length > 0,
      sessionStatus: session?.status,
      sessionProvider: session?.provider,
      sessionNativeRef: session?.native ? parseNativeSessionRef(session.native) ?? undefined : undefined,
      asStep
    };
  }

  /**
   * Manually rewrite a run block status (error correction) and keep the
   * note_runs index roughly aligned so the renderer can restore runId.
   */
  async setExecutableRunStatus(
    noteId: string,
    status: RunBlockStatus
  ): Promise<{ content: string }> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    let content = await this.readNoteContent(noteId);
    const parsed = parseExecutableNote(content);
    if (parsed.runs.length === 0) {
      throw new Error("No :::run block found on this note.");
    }
    content = updateRunBlocks(content, new Map([[0, { status }]]));
    await fs.writeFile(this.absolutePath(record), content, "utf8");
    await this.refreshNoteFromDisk(record);

    const runs = await listNoteRunsForSource(this.dbPath, noteId);
    const active = runs.find((r) => r.status === "executing" || r.status === "awaiting_approval");
    if (active) {
      await upsertNoteRun(this.dbPath, {
        runId: active.runId,
        sourceNoteId: noteId,
        status,
        currentChildIndex: active.currentChildIndex
      });
    }
    return { content };
  }

  /**
   * Manually rewrite the note-child step status on the outer run-holder and
   * cascade to the child's session block. Does NOT touch the parent run status
   * — caller keeps control of run progression when correcting by hand.
   */
  async setExecutableChildStatus(
    childNoteId: string,
    status: NoteChildStatus
  ): Promise<{ content: string; parentNoteId: string }> {
    const parentNoteId = await this.findExecutableOuterParentNoteId(childNoteId);
    if (!parentNoteId) {
      throw new Error("Note is not a step of any executable run.");
    }
    const parent = await getNoteById(this.dbPath, parentNoteId);
    if (!parent) {
      throw new Error("Parent note not found.");
    }
    let parentContent = await this.readNoteContent(parentNoteId);
    const children = parseExecutableNote(parentContent).noteChildren;
    const childIndex = children.findIndex((c) => c.noteId === childNoteId);
    if (childIndex < 0) {
      throw new Error("Child note is not part of this parent note-child chain.");
    }

    const childRecord = await getNoteById(this.dbPath, childNoteId);
    if (childRecord) {
      let childContent = await this.readNoteContent(childNoteId);
      if (parseExecutableNote(childContent).sessions[0]) {
        const sessionStatus: SessionBlockStatus =
          status === "done" ? "settled" : status === "failed" ? "failed" : "planned";
        childContent = updateSessionBlocks(
          childContent,
          new Map([[0, { status: sessionStatus }]])
        );
      }
      if (status === "done" || status === "failed") {
        childContent = appendResultBlock(childContent, {
          status: status === "done" ? "completed" : "failed",
          text: status === "done" ? "Step marked done manually." : "Step marked failed manually."
        });
      }
      await fs.writeFile(this.absolutePath(childRecord), childContent, "utf8");
      await this.refreshNoteFromDisk(childRecord);
    }

    parentContent = updateNoteChildBlocks(
      parentContent,
      new Map([[childIndex, { status }]])
    );
    await fs.writeFile(this.absolutePath(parent), parentContent, "utf8");
    await this.refreshNoteFromDisk(parent);

    const runs = await listNoteRunsForSource(this.dbPath, parentNoteId);
    const active = runs.find((r) => r.status === "executing" || r.status === "awaiting_approval");
    if (active) {
      await upsertNoteRun(this.dbPath, {
        runId: active.runId,
        sourceNoteId: parentNoteId,
        status: active.status,
        currentChildIndex: childIndex
      });
    }
    return { content: parentContent, parentNoteId };
  }

  /** Manually rewrite the session block status on a leaf (error correction). */
  async setExecutableSessionStatus(
    noteId: string,
    status: SessionBlockStatus
  ): Promise<{ content: string }> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    let content = await this.readNoteContent(noteId);
    const parsed = parseExecutableNote(content);
    if (parsed.sessions.length === 0) {
      throw new Error("No :::session block found on this note.");
    }
    content = updateSessionBlocks(content, new Map([[0, { status }]]));
    await fs.writeFile(this.absolutePath(record), content, "utf8");
    await this.refreshNoteFromDisk(record);
    return { content };
  }

  /**
   * Append a new note-child step to a run-holder note and materialize its
   * linked child note so the new step can be executed without hand-editing md.
   */
  async appendExecutableStep(
    parentNoteId: string,
    text?: string
  ): Promise<{ content: string; childNoteId: string }> {
    const parent = await getNoteById(this.dbPath, parentNoteId);
    if (!parent) {
      throw new Error("Parent note not found.");
    }
    if (parent.scope !== "project" || !parent.projectPath) {
      throw new Error("Executable steps can only be added to project notes.");
    }
    const title = (text || "").trim() || "New step";
    const child = await this.createLinkedChildNote(
      parentNoteId,
      defaultChildNoteBody(title, "codex")
    );
    const block = formatNoteChildBlock({
      status: "planned",
      text: title,
      noteId: child.noteId
    });
    const content = (await this.readNoteContent(parentNoteId)).trimEnd();
    const next = content ? `${content}\n\n${block}\n` : `${block}\n`;
    await fs.writeFile(this.absolutePath(parent), next, "utf8");
    await this.refreshNoteFromDisk(parent);
    return { content: next, childNoteId: child.noteId };
  }

  async listExecutableBindings(noteId: string): Promise<NoteSessionBinding[]> {
    return listNoteSessionBindings(this.dbPath, noteId);
  }

  async listExecutableRuns(noteId: string): Promise<NoteRunRow[]> {
    return listNoteRunsForSource(this.dbPath, noteId);
  }

  async createSessionNote(
    session: Pick<AgentSession, "provider" | "id" | "projectPath">,
    body = ""
  ): Promise<NoteRecord> {
    const owner: NoteOwner = {
      scope: "session",
      provider: session.provider,
      sessionId: session.id,
      projectPath: session.projectPath
    };
    return this.createNote(owner, body);
  }

  async createProjectNote(projectPath: string, body = ""): Promise<NoteRecord> {
    const owner: NoteOwner = {
      scope: "project",
      projectPath: normalizeProjectPath(projectPath)
    };
    return this.createNote(owner, body);
  }

  async createLibraryNote(body = ""): Promise<NoteRecord> {
    return this.createNote({ scope: "library" }, body);
  }

  async createNote(owner: NoteOwner, body = ""): Promise<NoteRecord> {
    const ownerDir = await ensureOwnerDir(this.panelHome, owner);
    const existing = await listMarkdownFilenames(ownerDir);
    const filename = nextNoteFilename(existing);
    const noteId = newNoteId();
    const createdAtMs = Date.now();
    const { absPath } = await writeNewNoteFile({
      panelHome: this.panelHome,
      owner,
      filename,
      noteId,
      body,
      createdAtMs
    });
    const mtime = await fileMtimeMs(absPath);
    const record: NoteRecord = {
      noteId,
      scope: owner.scope,
      provider: owner.scope === "session" ? owner.provider : undefined,
      agentSessionId: owner.scope === "session" ? owner.sessionId : undefined,
      projectPath:
        owner.scope === "project"
          ? owner.projectPath
          : owner.scope === "session"
            ? owner.projectPath
            : undefined,
      filename,
      relDir: ownerRelDir(owner),
      relMdPath: path.join("notes", ownerRelDir(owner), filename),
      title: extractTitle(body),
      contentPreview: contentPreview(body),
      createdAtMs,
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, record);
    await this.refreshFlagsFromCacheInsert(record);
    return record;
  }

  async importMarkdownFiles(owner: NoteOwner, sourcePaths: string[]): Promise<ImportNotesResult> {
    const ownerDir = await ensureOwnerDir(this.panelHome, owner);
    const existing = await listMarkdownFilenames(ownerDir);
    const result: ImportNotesResult = { imported: 0, skipped: 0, errors: [], records: [] };

    for (const sourcePath of sourcePaths) {
      try {
        if (!sourcePath.toLowerCase().endsWith(".md")) {
          result.skipped += 1;
          continue;
        }
        const sourceBase = path.basename(sourcePath);
        const filename = uniqueNoteFilename(sourceBase, existing);
        const raw = await fs.readFile(sourcePath, "utf8");
        const doc = parseNoteDocument(raw);
        const noteId = newNoteId();
        const createdAtMs = Date.now();
        const fm: NoteFrontmatter = {
          id: noteId,
          scope: owner.scope,
          createdAt: new Date(createdAtMs).toISOString()
        };
        if (owner.scope === "project") {
          fm.projectPath = owner.projectPath;
        } else if (owner.scope === "session") {
          fm.provider = owner.provider;
          fm.sessionId = owner.sessionId;
          if (owner.projectPath) {
            fm.projectPath = owner.projectPath;
          }
        }
        let body = doc.body;
        body = rewriteAssetReferences(body, sourceBase.endsWith(".md") ? sourceBase : `${sourceBase}.md`, filename);
        const sourceStemAssets = `${noteStem(sourceBase)}.assets`;
        const destAssetsName = noteAssetsDirName(filename);
        if (sourceStemAssets !== destAssetsName) {
          body = body.split(sourceStemAssets).join(destAssetsName);
        }

        const content = buildNoteDocument(fm, body);
        const absPath = path.join(ownerDir, filename);
        await fs.writeFile(absPath, content, "utf8");

        const sourceAssets = path.join(path.dirname(sourcePath), noteAssetsDirName(sourceBase));
        const destAssets = path.join(ownerDir, destAssetsName);
        if (await pathExists(sourceAssets)) {
          await copyDirectoryRecursive(sourceAssets, destAssets);
        }

        const mtime = await fileMtimeMs(absPath);
        const record: NoteRecord = {
          noteId,
          scope: owner.scope,
          provider: owner.scope === "session" ? owner.provider : undefined,
          agentSessionId: owner.scope === "session" ? owner.sessionId : undefined,
          projectPath:
            owner.scope === "project"
              ? owner.projectPath
              : owner.scope === "session"
                ? owner.projectPath
                : undefined,
          filename,
          relDir: ownerRelDir(owner),
          relMdPath: path.join("notes", ownerRelDir(owner), filename),
          title: extractTitle(body),
          contentPreview: contentPreview(body),
          createdAtMs,
          updatedAtMs: mtime,
          fsMtimeMs: mtime
        };
        await upsertNoteRecord(this.dbPath, record);
        await this.refreshFlagsFromCacheInsert(record);
        existing.push(filename);
        result.records.push(record);
        result.imported += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${path.basename(sourcePath)}: ${message}`);
        result.skipped += 1;
      }
    }

    return result;
  }

  async deleteNote(noteId: string): Promise<void> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      return;
    }
    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    await deleteNoteFiles(ownerDir, record.filename);
    await deleteLinksForNote(this.dbPath, noteId);
    await deleteNoteRecord(this.dbPath, noteId);
    this.cachedNotes = this.cachedNotes.filter((n) => n.noteId !== noteId);
    await this.rebuildFlagsFromCache();
  }

  // --- Note links (tree associations among project notes) ---

  async listNoteLinks(): Promise<NoteLink[]> {
    return listAllNoteLinks(this.dbPath);
  }

  async getNoteParent(noteId: string): Promise<NoteLink | undefined> {
    return getParentLink(this.dbPath, noteId);
  }

  async listNoteChildren(parentNoteId: string): Promise<NoteLink[]> {
    return listChildLinks(this.dbPath, parentNoteId);
  }

  async listLinkedChildIds(): Promise<Set<string>> {
    return listLinkedChildNoteIds(this.dbPath);
  }

  async listNoteChildCounts(): Promise<Map<string, number>> {
    return listChildCounts(this.dbPath);
  }

  /**
   * Root notes for list UI: library/session always roots; project notes without a parent.
   */
  async listRootNotes(): Promise<NoteRecord[]> {
    const childIds = await listLinkedChildNoteIds(this.dbPath);
    return this.cachedNotes.filter((note) => {
      if (note.scope !== "project") {
        return true;
      }
      return !childIds.has(note.noteId);
    });
  }

  async setNoteParent(childNoteId: string, parentNoteId: string | null): Promise<void> {
    await setParentLink(this.dbPath, childNoteId, parentNoteId);
  }

  async clearNoteParent(childNoteId: string): Promise<void> {
    await clearParentLink(this.dbPath, childNoteId);
  }

  async createLinkedChildNote(parentNoteId: string, body = ""): Promise<NoteRecord> {
    const parent = await getNoteById(this.dbPath, parentNoteId);
    if (!parent) {
      throw new Error("Parent note not found.");
    }
    if (parent.scope !== "project" || !parent.projectPath) {
      throw new Error("Linked children can only be created under a project note.");
    }
    const child = await this.createProjectNote(parent.projectPath, body);
    try {
      await setParentLink(this.dbPath, child.noteId, parentNoteId);
    } catch (error) {
      await this.deleteNote(child.noteId);
      throw error;
    }
    return child;
  }

  async getNoteSubtree(rootNoteId: string): Promise<NoteSubtree> {
    return getNoteSubtree(this.dbPath, rootNoteId);
  }

  async resolveNoteLinkRoot(noteId: string): Promise<string> {
    return resolveLinkRoot(this.dbPath, noteId);
  }

  async collectNoteDescendantIds(rootNoteId: string): Promise<Set<string>> {
    return collectDescendantIds(this.dbPath, rootNoteId);
  }

  async moveNote(noteId: string, newOwner: NoteOwner): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    if (record.filename === "todolist.md") {
      throw new Error("Cannot move session to-do list.");
    }

    const currentOwner = recordToOwner(record);
    if (ownersEqual(currentOwner, newOwner)) {
      return record;
    }

    const oldOwnerDir = path.join(this.panelHome, "notes", record.relDir);
    const newOwnerDir = await ensureOwnerDir(this.panelHome, newOwner);
    const existing = await listMarkdownFilenames(newOwnerDir);
    let newFilename = record.filename;
    if (existing.includes(newFilename)) {
      newFilename = uniqueNoteFilename(newFilename, existing);
    }

    const oldMd = path.join(oldOwnerDir, record.filename);
    const newMd = path.join(newOwnerDir, newFilename);
    const raw = await fs.readFile(oldMd, "utf8");
    const doc = parseNoteDocument(raw);
    let body = doc.body;
    if (newFilename !== record.filename) {
      body = parseNoteDocument(rewriteAssetReferences(raw, record.filename, newFilename)).body;
    }

    const fm = frontmatterForOwner(doc.frontmatter.id || record.noteId, newOwner, doc.frontmatter.createdAt);
    await fs.writeFile(newMd, buildNoteDocument(fm, body), "utf8");

    const oldAssets = path.join(oldOwnerDir, noteAssetsDirName(record.filename));
    const newAssets = path.join(newOwnerDir, noteAssetsDirName(newFilename));
    if (await pathExists(oldAssets)) {
      if (await pathExists(newAssets)) {
        throw new Error(`Assets folder already exists: ${noteAssetsDirName(newFilename)}`);
      }
      try {
        await fs.rename(oldAssets, newAssets);
      } catch {
        await copyDirectoryRecursive(oldAssets, newAssets);
        await fs.rm(oldAssets, { recursive: true, force: true });
      }
    }

    await fs.rm(oldMd, { force: true });

    const mtime = await fileMtimeMs(newMd);
    const updated: NoteRecord = {
      noteId: record.noteId,
      scope: newOwner.scope,
      provider: newOwner.scope === "session" ? newOwner.provider : undefined,
      agentSessionId: newOwner.scope === "session" ? newOwner.sessionId : undefined,
      projectPath:
        newOwner.scope === "project"
          ? newOwner.projectPath
          : newOwner.scope === "session"
            ? newOwner.projectPath
            : undefined,
      filename: newFilename,
      relDir: ownerRelDir(newOwner),
      relMdPath: path.join("notes", ownerRelDir(newOwner), newFilename),
      title: extractTitle(body),
      contentPreview: contentPreview(body),
      createdAtMs: record.createdAtMs,
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));
    await this.rebuildFlagsFromCache();
    return updated;
  }

  async renameNote(noteId: string, desiredName: string): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    const newFilename = normalizeNoteFilename(desiredName);
    if (!newFilename) {
      throw new Error("Invalid note name.");
    }
    if (newFilename === record.filename) {
      return record;
    }

    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    const existing = await listMarkdownFilenames(ownerDir);
    if (existing.includes(newFilename)) {
      throw new Error(`A note named "${newFilename}" already exists.`);
    }

    const { absPath } = await renameNoteFiles(ownerDir, record.filename, newFilename, (raw) =>
      rewriteAssetReferences(raw, record.filename, newFilename)
    );

    const raw = await fs.readFile(absPath, "utf8");
    const doc = parseNoteDocument(raw);
    const mtime = await fileMtimeMs(absPath);
    const updated: NoteRecord = {
      ...record,
      filename: newFilename,
      relMdPath: path.join("notes", record.relDir, newFilename),
      title: extractTitle(doc.body),
      contentPreview: contentPreview(doc.body),
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));
    return updated;
  }

  async deleteSessionNotes(session: Pick<AgentSession, "provider" | "id">): Promise<number> {
    const notes = await listSessionNotes(this.dbPath, session.provider, session.id);
    for (const note of notes) {
      await this.deleteNote(note.noteId);
    }
    return notes.length;
  }

  async deleteProjectNotes(projectPath: string): Promise<number> {
    const notes = await listProjectNotes(this.dbPath, projectPath);
    for (const note of notes) {
      await this.deleteNote(note.noteId);
    }
    return notes.length;
  }

  async touchFromDisk(absPath: string): Promise<void> {
    await this.reload();
    void absPath;
  }

  async refreshNoteFromDisk(record: NoteRecord): Promise<void> {
    const abs = this.absolutePath(record);
    if (!(await pathExists(abs))) {
      await deleteNoteRecord(this.dbPath, record.noteId);
      this.cachedNotes = this.cachedNotes.filter((n) => n.noteId !== record.noteId);
      await this.rebuildFlagsFromCache();
      return;
    }
    const text = await fs.readFile(abs, "utf8");
    const doc = parseNoteDocument(text);
    const mtime = await fileMtimeMs(abs);
    const updated: NoteRecord = {
      ...record,
      title: extractTitle(doc.body),
      contentPreview: contentPreview(doc.body),
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));
  }

  async ensureAssetsForNote(record: NoteRecord): Promise<string> {
    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    return ensureAssetsDir(ownerDir, record.filename);
  }

  private async refreshFlagsFromCacheInsert(record: NoteRecord): Promise<void> {
    this.cachedNotes = [record, ...this.cachedNotes.filter((n) => n.noteId !== record.noteId)];
    if (record.scope === "session" && record.provider && record.agentSessionId) {
      this.sessionFlags.add(sessionGtdKey(record.provider, record.agentSessionId));
    }
    if (record.scope === "project" && record.projectPath) {
      this.projectFlags.add(normalizeProjectPath(record.projectPath));
    }
  }

  private async rebuildFlagsFromCache(): Promise<void> {
    this.sessionFlags = new Set();
    this.projectFlags = new Set();
    for (const note of this.cachedNotes) {
      if (note.scope === "session" && note.provider && note.agentSessionId) {
        this.sessionFlags.add(sessionGtdKey(note.provider, note.agentSessionId));
      }
      if (note.scope === "project" && note.projectPath) {
        this.projectFlags.add(normalizeProjectPath(note.projectPath));
      }
    }
  }
}

function recordToOwner(record: NoteRecord): NoteOwner {
  if (record.scope === "library") {
    return { scope: "library" };
  }
  if (record.scope === "project" && record.projectPath) {
    return { scope: "project", projectPath: record.projectPath };
  }
  if (record.scope === "session" && record.provider && record.agentSessionId) {
    return {
      scope: "session",
      provider: record.provider as AgentProvider,
      sessionId: record.agentSessionId,
      projectPath: record.projectPath
    };
  }
  throw new Error("Invalid note record owner.");
}

function ownersEqual(a: NoteOwner, b: NoteOwner): boolean {
  if (a.scope !== b.scope) {
    return false;
  }
  if (a.scope === "library") {
    return true;
  }
  if (a.scope === "project" && b.scope === "project") {
    return normalizeProjectPath(a.projectPath) === normalizeProjectPath(b.projectPath);
  }
  if (a.scope === "session" && b.scope === "session") {
    return a.provider === b.provider && a.sessionId === b.sessionId;
  }
  return false;
}

function frontmatterForOwner(
  noteId: string,
  owner: NoteOwner,
  createdAt?: string
): NoteFrontmatter {
  const fm: NoteFrontmatter = {
    id: noteId,
    scope: owner.scope,
    createdAt
  };
  if (owner.scope === "project") {
    fm.projectPath = owner.projectPath;
  } else if (owner.scope === "session") {
    fm.provider = owner.provider;
    fm.sessionId = owner.sessionId;
    if (owner.projectPath) {
      fm.projectPath = owner.projectPath;
    }
  }
  return fm;
}

async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}