import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskWorktreeOrphans, WorktreeRiskReport } from "../../../../shared/worktreeTypes";
import { desktopApi } from "../../../bridge";
import { confirmAction, confirmDestructive } from "../../../confirmAction";
import { useI18n } from "../../../i18n";

/** One checkout the user has asked to get rid of. */
export type WorktreeCleanupTarget = {
  repoRoot: string;
  path: string;
  /** Never empty: what the confirmation names to the user. */
  branchLabel: string;
  locked?: boolean;
  lockedReason?: string;
  baseBranch?: string | null;
};

export type WorktreeCleanup = {
  /** The checkout being removed right now, so its own row can go quiet. */
  busyPath: string | null;
  error: string | null;
  /** Checkouts of this task's repositories that no task owns any more. */
  orphans: TaskWorktreeOrphans | null;
  refreshOrphans: () => Promise<void>;
  /**
   * Inspects, asks, and only then removes. Answers whether the checkout is gone
   * from disk afterwards: removed here, or found to have gone already.
   */
  remove: (target: WorktreeCleanupTarget) => Promise<boolean>;
  /** Forgets the admin entries of checkouts whose directories are already gone. */
  prune: (repoRoots: string[]) => Promise<boolean>;
};

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Removing a checkout, and the two things that make it safe to offer.
 *
 * First: nothing is deleted before `workbenchInspectWorktree` has answered, so
 * the confirmation quotes real numbers — how many changes are uncommitted, how
 * many commits are not in the base branch — instead of a generic warning, and
 * `--force` is passed only when those numbers say the checkout is dirty. Second:
 * the branch is never touched, which the confirmation says outright, because
 * "delete a worktree" and "throw away the work" are different fears.
 *
 * Orphans are the checkouts a deleted task left behind. They are listed from the
 * repositories this task references — the panel holds no global index of
 * repositories — and only when the task whose workspace contains them is really
 * gone.
 */
export function useWorktreeCleanup(options: {
  noteId: string | null;
  repos: string[];
  /** True while the surface offering these actions is on screen. */
  active: boolean;
  /**
   * Whether a checkout git was asked about has gone. The row offering it can
   * outlive it: the agent working in it merges its branch and cleans up, and the
   * panel only finds out on its next read.
   */
  checkoutGone: (path: string) => Promise<boolean>;
  /** Something was removed: re-read what the panel shows. */
  onRemoved: (target: WorktreeCleanupTarget) => void | Promise<void>;
}): WorktreeCleanup {
  const { noteId, repos, active, checkoutGone, onRemoved } = options;
  const { t } = useI18n();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<TaskWorktreeOrphans | null>(null);

  const reposRef = useRef<string[]>(repos);
  reposRef.current = repos;
  const reposKey = useMemo(() => repos.join("\0"), [repos]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshOrphans = useCallback(async () => {
    const api = desktopApi();
    if (!noteId || typeof api.workbenchListOrphanWorktrees !== "function") {
      if (mountedRef.current) setOrphans(null);
      return;
    }
    const targets = reposRef.current.filter(Boolean);
    if (!targets.length) {
      if (mountedRef.current) setOrphans(null);
      return;
    }
    try {
      const answer = await api.workbenchListOrphanWorktrees({
        noteId,
        repos: targets.map((repoRoot) => ({ repoRoot, label: repoRoot.split("/").pop() || repoRoot }))
      });
      if (!mountedRef.current) return;
      setOrphans(answer && typeof answer === "object" && Array.isArray(answer.repos) ? answer : null);
    } catch {
      if (mountedRef.current) setOrphans(null);
    }
  }, [noteId]);

  // Orphans only change when a task is deleted, so the list is read when the
  // sheet opens rather than on a timer.
  useEffect(() => {
    if (!active) return;
    void refreshOrphans();
  }, [active, refreshOrphans, reposKey]);

  /**
   * What would be lost, in the words of the confirmation. Empty when the
   * checkout holds nothing but commits that are already in the base branch.
   */
  const riskDetail = useCallback(
    (report: WorktreeRiskReport): string => {
      const lines: string[] = [];
      const changed = (report.stagedCount || 0) + (report.unstagedCount || 0);
      if (changed) lines.push(t("desktop.workbench.worktreeStateDirty", String(changed)));
      if (report.unmergedCommits) lines.push(t("desktop.workbench.worktreeRiskUnmerged", String(report.unmergedCommits)));
      if (report.aheadOfUpstream) lines.push(t("desktop.workbench.worktreeRiskUnpushed", String(report.aheadOfUpstream)));
      if (report.liveSessionsInPath) lines.push(t("desktop.workbench.worktreeRiskSessions", String(report.liveSessionsInPath)));
      lines.push(report.branch ? t("desktop.workbench.worktreeRiskBranchKept", report.branch) : t("desktop.workbench.worktreeRiskDetached"));
      return lines.join("\n");
    },
    [t]
  );

  const remove = useCallback(
    async (target: WorktreeCleanupTarget): Promise<boolean> => {
      const api = desktopApi();
      if (target.locked) {
        setError(t("desktop.workbench.worktreeDeleteLocked", target.lockedReason || target.path));
        return false;
      }
      setBusyPath(target.path);
      setError(null);
      try {
        // The checkout can be gone before the button is pressed — an agent that
        // has just merged its branch and cleaned up, or Finder. There is then
        // nothing to weigh, nothing to confirm and nothing to say: the row goes
        // away with the re-read, and the branch is not the panel's to report on.
        if (await checkoutGone(target.path)) return true;
        const report = await api.workbenchInspectWorktree({
          repoRoot: target.repoRoot,
          path: target.path,
          baseBranch: target.baseBranch ?? undefined
        });
        const confirmed = await confirmDestructive(
          t("desktop.workbench.worktreeDeleteConfirm", target.branchLabel),
          t("desktop.common.delete"),
          riskDetail(report)
        );
        if (!confirmed) return false;
        // Only a checkout with changes needs the force flag, and it is passed
        // here — not earlier — so that a confirmation the user dismissed leaves
        // git's own protection in place.
        await api.workbenchRemoveWorktree({ repoRoot: target.repoRoot, path: target.path, force: report.dirty });
        await onRemoved(target);
        // A row can be an orphan rather than one of this task's checkouts, so the
        // list that offers it has to be re-read too.
        await refreshOrphans();
        return true;
      } catch (failure) {
        if (mountedRef.current) setError(message(failure));
        return false;
      } finally {
        if (mountedRef.current) setBusyPath(null);
      }
    },
    [checkoutGone, onRemoved, refreshOrphans, riskDetail, t]
  );

  const prune = useCallback(
    async (repoRoots: string[]): Promise<boolean> => {
      const api = desktopApi();
      const targets = [...new Set(repoRoots.filter(Boolean))];
      if (!targets.length) return false;
      const confirmed = await confirmAction(t("desktop.workbench.worktreePruneConfirm", String(targets.length)), {
        confirmLabel: t("desktop.workbench.worktreePrune"),
        destructive: true
      });
      if (!confirmed) return false;
      setError(null);
      try {
        for (const repoRoot of targets) await api.workbenchPruneWorktrees({ repoRoot });
        await refreshOrphans();
        return true;
      } catch (failure) {
        if (mountedRef.current) setError(message(failure));
        return false;
      }
    },
    [refreshOrphans, t]
  );

  return { busyPath, error, orphans, refreshOrphans, remove, prune };
}
