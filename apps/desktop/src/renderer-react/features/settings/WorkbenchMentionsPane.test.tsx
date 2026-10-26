import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@agent-resume/core";
import { WorkbenchPane } from "./AdditionalPanes";
import { workbenchDraftFromSettings, type WorkbenchDraft } from "./model";

/**
 * The `@` sections of Settings → Workbench. Both are drafts: the switches commit
 * immediately, and the scan writes nothing until "apply" runs — that is the
 * contract these tests pin down.
 */

const t = (key: string, ...args: Array<string | number>): string =>
  args.length ? `${key}(${args.join(",")})` : key;

const projects = [
  {
    projectId: "p-tj",
    alias: "tj",
    localPath: "/Users/lucas/wb/wlgk/tj",
    pathMissing: false,
    sessionCount: 40,
    lastSeenAtMs: 1_700_000_000_000,
    pinned: false
  },
  {
    projectId: "p-home",
    alias: "",
    localPath: "/Users/lucas",
    pathMissing: false,
    sessionCount: 114,
    lastSeenAtMs: 1_700_000_000_000,
    pinned: false
  },
  {
    projectId: "p-anfeng",
    alias: "anfeng",
    localPath: "/Users/lucas/wb/wlgk/anfeng",
    pathMissing: false,
    sessionCount: 30,
    lastSeenAtMs: 1_700_000_000_000,
    pinned: false
  }
];

function setup(draft?: Partial<WorkbenchDraft>) {
  const base = workbenchDraftFromSettings(DEFAULT_SETTINGS);
  const state = { draft: { ...base, ...draft } };
  const commits: WorkbenchDraft[] = [];
  const commit = (value: WorkbenchDraft) => {
    state.draft = value;
    commits.push(value);
  };
  const setDraft = (value: WorkbenchDraft) => {
    state.draft = value;
  };
  const view = render(<WorkbenchPane draft={state.draft} setDraft={setDraft} commit={commit} t={t} />);
  // `setDraft` does not re-render here, so remount on every commit.
  const remount = () =>
    view.rerender(<WorkbenchPane draft={state.draft} setDraft={setDraft} commit={commit} t={t} />);
  return { view, remount, commits, state };
}

beforeEach(() => {
  (window as any).agentResume = {
    listProjects: vi.fn().mockResolvedValue(projects),
    homePath: vi.fn().mockResolvedValue("/Users/lucas"),
    getSettings: vi.fn().mockResolvedValue({ panelHome: "/Users/lucas/.agent-resume-panel" })
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).agentResume;
});

describe("mention sources", () => {
  it("shows a switch per kind, with project directories off", () => {
    setup();
    const switchFor = (key: string): HTMLInputElement =>
      screen.getByText(`desktop.settings.${key}`).closest("label")!.querySelector("input")!;
    for (const key of [
      "mentionSourceWorkspaces",
      "mentionSourceTasks",
      "mentionSourceNotes",
      "mentionSourceSessions"
    ]) {
      expect(switchFor(key).checked).toBe(true);
    }
    // Project directories are the one kind collected from history rather than
    // chosen, so it starts off.
    expect(switchFor("mentionSourceProjectDirs").checked).toBe(false);
  });

  it("commits a switch immediately", () => {
    const { remount, commits, state } = setup();
    const workspaces = screen
      .getByText("desktop.settings.mentionSourceWorkspaces")
      .closest("label")!
      .querySelector("input")!;
    fireEvent.click(workspaces);
    expect(commits).toHaveLength(1);
    expect(commits[0].composerMentionsEnabled.workspaces).toBe(false);
    expect(state.draft.composerMentionsEnabled.workspaces).toBe(false);
    remount();
    expect(
      (screen
        .getByText("desktop.settings.mentionSourceWorkspaces")
        .closest("label")!
        .querySelector("input") as HTMLInputElement).checked
    ).toBe(false);
  });
});

describe("auto-collecting project directories", () => {
  it("cannot scan until the source is switched on", () => {
    setup();
    const scan = screen.getByText("desktop.settings.mentionScanRun").closest("button")!;
    expect(scan.disabled).toBe(true);
    expect(screen.getByText("desktop.settings.mentionScanHintDisabled")).toBeTruthy();
  });

  it("scans candidates, greys the excluded ones and writes only on apply", async () => {
    const { commits, state } = setup({
      composerMentionsEnabled: {
        workspaces: true,
        tasks: true,
        notes: true,
        sessions: true,
        projects: true
      },
      composerMentions: [{ id: "anfeng", cwd: "/Users/lucas/wb/wlgk/anfeng" }]
    });
    fireEvent.click(screen.getByText("desktop.settings.mentionScanRun").closest("button")!);

    await waitFor(() => expect(screen.getByText(/@tj/)).toBeTruthy());
    // Scanning alone writes nothing: the packs are still just the one pack.
    expect(commits).toHaveLength(0);
    expect(state.draft.composerMentions).toEqual([
      { id: "anfeng", cwd: "/Users/lucas/wb/wlgk/anfeng" }
    ]);

    // The home directory and the already-configured pack are listed but excluded.
    expect(screen.getByText("desktop.settings.mentionScanExcludedHome")).toBeTruthy();
    expect(screen.getByText("desktop.settings.mentionScanExcludedAdded")).toBeTruthy();

    const apply = screen.getByText("desktop.settings.mentionScanApply").closest("button")!;
    expect(apply.disabled).toBe(true);

    // Tick the only usable row and apply: it appends, never rewriting @anfeng.
    const row = screen.getByText(/@tj/).closest("label")!.querySelector("input")!;
    fireEvent.click(row);
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);

    expect(commits).toHaveLength(1);
    expect(commits[0].composerMentions).toEqual([
      { id: "anfeng", cwd: "/Users/lucas/wb/wlgk/anfeng" },
      { id: "tj", cwd: "/Users/lucas/wb/wlgk/tj" }
    ]);
  });

  it("selects and clears every usable row", async () => {
    setup({
      composerMentionsEnabled: {
        workspaces: true,
        tasks: true,
        notes: true,
        sessions: true,
        projects: true
      }
    });
    fireEvent.click(screen.getByText("desktop.settings.mentionScanRun").closest("button")!);
    await waitFor(() => expect(screen.getByText(/@tj/)).toBeTruthy());

    const apply = screen.getByText("desktop.settings.mentionScanApply").closest("button")!;
    fireEvent.click(screen.getByText("desktop.settings.mentionScanSelectAll").closest("button")!);
    expect(apply.disabled).toBe(false);
    expect(screen.getByText("desktop.settings.mentionScanSummary(2,1,2)")).toBeTruthy();

    fireEvent.click(screen.getByText("desktop.settings.mentionScanSelectNone").closest("button")!);
    expect(apply.disabled).toBe(true);
    expect(screen.getByText("desktop.settings.mentionScanSummary(2,1,0)")).toBeTruthy();
  });
});
