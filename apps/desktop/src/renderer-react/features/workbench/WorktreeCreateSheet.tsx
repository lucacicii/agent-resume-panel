import { useEffect, useMemo, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { Sheet } from "../../components/Sheet";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { SegmentedControl } from "../../components/SegmentedControl";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { worktreeDirName } from "../../../shared/worktreeTypes";
import { basename } from "./git/workbenchGitModel";

type BranchMode = "new" | "existing";

export type WorktreeRepoOption = { repoRoot: string; label: string; baseBranch: string | null };

/**
 * Creating a checkout, from the panel rather than from a terminal.
 *
 * The directory it will land in is previewed with the same rule the main process
 * uses, so what the sheet promises and what appears on disk cannot drift apart.
 * Nothing here is committed to until Create: the sheet is a form, and the only
 * side effect is the one the caller performs.
 */
export function WorktreeCreateSheet({
  open,
  onClose,
  repos,
  root,
  preferredRepo,
  savedBaseBranch,
  onCreate,
  onOpenTerminal
}: {
  open: boolean;
  onClose: () => void;
  /** The task's repositories that are really there and really are git repositories. */
  repos: WorktreeRepoOption[];
  /** Where checkouts of this task live. */
  root: string;
  /** The repository the selector was showing when the sheet was opened. */
  preferredRepo: string | null;
  /** Base branches chosen before, per repository root. */
  savedBaseBranch: Record<string, string>;
  /** Perform the creation; throw to show the reason in the sheet. */
  onCreate: (input: { repoRoot: string; branch: string; baseBranch?: string }) => Promise<{ path: string; branch: string }>;
  /** Open a terminal in the new checkout — it has no dependencies installed. */
  onOpenTerminal: (cwd: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [repoRoot, setRepoRoot] = useState("");
  const [mode, setMode] = useState<BranchMode>("new");
  const [branch, setBranch] = useState("");
  const [existing, setExisting] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The checkout that was made, held until the sheet is dismissed. */
  const [created, setCreated] = useState<{ path: string; branch: string } | null>(null);
  const branchInputRef = useRef<HTMLInputElement | null>(null);

  // Opening the sheet starts a fresh form: whatever was typed for the previous
  // checkout is not an answer about this one.
  useEffect(() => {
    if (!open) return;
    setMode("new");
    setBranch("");
    setExisting("");
    setError(null);
    setCreated(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // The selected repository can disappear while the sheet is open — the panel
    // is live behind it — so the choice is re-resolved against the current list.
    setRepoRoot((currentValue) => {
      if (repos.some((repo) => repo.repoRoot === currentValue)) return currentValue;
      if (preferredRepo && repos.some((repo) => repo.repoRoot === preferredRepo)) return preferredRepo;
      return repos[0]?.repoRoot ?? "";
    });
  }, [open, preferredRepo, repos]);

  useEffect(() => {
    if (!open || !repoRoot) {
      setBranches([]);
      setCurrent(null);
      return;
    }
    let active = true;
    const api = desktopApi();
    if (typeof api.terminalGitBranches !== "function") return;
    void api
      .terminalGitBranches({ cwd: repoRoot })
      .then((result) => {
        if (!active) return;
        const direct = result.mode === "direct" ? result : null;
        setBranches(direct?.localBranches?.length ? direct.localBranches : direct?.branches ?? []);
        setCurrent(direct?.current ?? null);
      })
      .catch(() => {
        if (active) setBranches([]);
      });
    return () => {
      active = false;
    };
  }, [open, repoRoot]);

  // A new checkout starts from the branch this repository is on, or from the one
  // chosen for it last time — the basis is a property of the repository, not of
  // this particular checkout.
  useEffect(() => {
    if (!repoRoot) return;
    const preferred = savedBaseBranch[repoRoot];
    if (preferred && (preferred === current || branches.includes(preferred))) {
      setBaseBranch(preferred);
      return;
    }
    setBaseBranch(current || branches[0] || "");
  }, [repoRoot, current, branches, savedBaseBranch]);

  const selectedBranch = mode === "new" ? branch.trim() : existing;
  const target = useMemo(
    () => (repoRoot && selectedBranch ? `${root}/${worktreeDirName(basename(repoRoot), selectedBranch)}` : ""),
    [repoRoot, selectedBranch, root]
  );
  const repo = repos.find((item) => item.repoRoot === repoRoot);

  const create = async () => {
    if (!repoRoot || !selectedBranch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onCreate({
        repoRoot,
        branch: selectedBranch,
        baseBranch: mode === "new" ? baseBranch || undefined : undefined
      });
      setCreated(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const footer = created ? (
    <>
      <button type="button" className="wb-note-created-btn" onClick={onClose}>{t("desktop.common.close")}</button>
      <button type="button" className="wb-note-created-btn primary" onClick={() => { onOpenTerminal(created.path); onClose(); }}>
        {t("desktop.workbench.worktreeInstall")}
      </button>
    </>
  ) : (
    <>
      <button type="button" className="wb-note-created-btn" disabled={busy} onClick={onClose}>{t("desktop.common.cancel")}</button>
      <button type="button" className="wb-note-created-btn primary" disabled={busy || !repoRoot || !selectedBranch} onClick={() => void create()}>
        {busy ? t("desktop.common.loading") : t("desktop.workbench.worktreeCreateTitle")}
      </button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("desktop.workbench.worktreeCreateTitle")}
      modal
      // Closing mid-create would leave a half-finished checkout behind, which git
      // then reports as prunable — a mess the user did not ask for.
      dismissible={!busy}
    >
      {created ? (
        <div className="wb-worktree-created" role="status">
          <p className="wb-worktree-created-title">
            <ThemeIcon name="git-branch" size={ICON_SIZE.dense} aria-hidden="true" />
            {created.branch}
          </p>
          <p className="wb-task-settings-path" title={created.path}>{created.path}</p>
          <p className="settings-callout">{t("desktop.workbench.worktreeNoDeps")}</p>
        </div>
      ) : !repos.length ? (
        <p className="muted wb-task-settings-empty">{t("desktop.workbench.worktreeNotGitRepo")}</p>
      ) : (
        <>
          <label className="settings-row">
            <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeRepo")}</span></span>
            {repos.length > 1 ? (
              <NativeMenuSelect
                className="settings-row-control"
                ariaLabel={t("desktop.workbench.worktreeRepo")}
                value={repoRoot}
                options={repos.map((item) => ({ value: item.repoRoot, label: item.label }))}
                onChange={setRepoRoot}
              />
            ) : (
              <span className="wb-task-settings-path" title={repoRoot}>{repo?.label ?? repoRoot}</span>
            )}
          </label>
          <label className="settings-row">
            <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeBranch")}</span></span>
            <SegmentedControl
              value={mode}
              options={["new", "existing"]}
              aria-label={t("desktop.workbench.worktreeBranch")}
              getLabel={(value) => t(value === "new" ? "desktop.workbench.worktreeBranchNew" : "desktop.workbench.worktreeBranchExisting")}
              onChange={(value) => { setMode(value); setError(null); if (value === "new") branchInputRef.current?.focus(); }}
            />
          </label>
          {mode === "new" ? (
            <>
              <label className="settings-row">
                <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeBranchName")}</span></span>
                <input
                  ref={branchInputRef}
                  className="wb-worktree-branch-input"
                  value={branch}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                  placeholder="feat/my-change"
                  onChange={(event) => { setBranch(event.target.value); setError(null); }}
                  onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
                />
              </label>
              <label className="settings-row">
                <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeBase")}</span></span>
                <NativeMenuSelect
                  className="settings-row-control"
                  ariaLabel={t("desktop.workbench.worktreeBase")}
                  value={baseBranch}
                  emptyLabel={current ?? undefined}
                  options={(branches.length ? branches : baseBranch ? [baseBranch] : []).map((item) => ({ value: item, label: item }))}
                  onChange={setBaseBranch}
                />
              </label>
            </>
          ) : (
            <label className="settings-row">
              <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeBranch")}</span></span>
              <NativeMenuSelect
                className="settings-row-control"
                ariaLabel={t("desktop.workbench.worktreeBranch")}
                value={existing}
                emptyLabel={t("desktop.workbench.worktreeBranchExisting")}
                options={branches.map((item) => ({ value: item, label: item }))}
                onChange={setExisting}
              />
            </label>
          )}
          <div className="settings-row">
            <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeWillCreate")}</span></span>
            <span className="wb-task-settings-path is-root" title={target}>{target ? target.slice(root.length + 1) || basename(target) : "-"}</span>
          </div>
          {error ? <p className="settings-callout is-error" role="alert">{error}</p> : null}
          <p className="settings-callout">{t("desktop.workbench.worktreeNoDeps")}</p>
        </>
      )}
      <div className="wb-note-created-actions">{footer}</div>
    </Sheet>
  );
}
