import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../../bridge";
import { notifyDesktop } from "../../../components/Notifications";
import { useI18n } from "../../../i18n";
import {
  type CommitSuggestion,
  type GitStageTarget,
  type GitStatusResult,
  GIT_AUTO_FETCH_MS,
  GIT_AUTO_FETCH_MAX_ROOTS,
  GIT_STATUS_POLL_MS,
  basename,
  defaultGitRoot,
  gitDirectoryKeys,
  gitOperationError,
  normalizeGitStageTargets,
  reconcileExpandedGitDirectories,
  stageGitChangesOptimistically,
  trackingForRoot
} from "./workbenchGitModel";

export function useWorkbenchGit(options: {
  active: boolean;
  selectedProject: string | null;
  selectedProjectRef: { current: string | null };
  side: string | null;
  nestedScanMaxDepth?: number;
  nestedScanIgnoreDirs?: string[];
  onGitMutated: () => void;
  notifyStatus: (status: { text: string; kind?: "error" | "ok" | "warning" }) => void;
}): {
  git: GitStatusResult | null;
  gitRef: { current: GitStatusResult | null };
  gitRoot: string;
  gitExpandedDirs: Set<string>;
  gitRefreshing: boolean;
  gitSyncing: boolean;
  commitMessage: string;
  commitBusy: boolean;
  commitSuggestion: CommitSuggestion | null;
  gitRepositories: Array<{ root: string; label: string }>;
  stagedCommitPaths: string[];
  canCommit: boolean;
  projectTracking: ReturnType<typeof trackingForRoot>;
  refreshGit: (withNotification?: boolean) => Promise<void>;
  toggleGitDirectory: (path: string) => void;
  toggleGitStage: (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => Promise<void>;
  selectGitRoot: (root: string) => void;
  setCommitMessage: (value: string) => void;
  suggestCommit: () => Promise<void>;
  commit: (pushAfter?: boolean) => Promise<void>;
  syncGitBranch: () => Promise<void>;
  checkoutGitPanelBranch: (selection: { branch: string; remote?: string }) => Promise<void>;
  notifyGitSuccess: (key: string, ...args: Array<string | number>) => void;
  notifyGitFailure: (key: string, error: unknown) => void;
} {
  const {
    active,
    selectedProject,
    selectedProjectRef,
    side,
    nestedScanMaxDepth,
    nestedScanIgnoreDirs,
    onGitMutated,
    notifyStatus
  } = options;
  const { t } = useI18n();
  const [git, setGit] = useState<GitStatusResult | null>(null);
  const [gitRoot, setGitRoot] = useState("");
  const gitRootManuallySelectedRef = useRef(false);
  const [gitExpandedDirs, setGitExpandedDirs] = useState<Set<string>>(new Set());
  const gitExpandInitializedRef = useRef(false);
  const gitSeenDirectoryKeysRef = useRef<Set<string>>(new Set());
  const [gitRefreshing, setGitRefreshing] = useState(false);
  const [gitSyncing, setGitSyncing] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitSuggestion, setCommitSuggestion] = useState<CommitSuggestion | null>(null);
  const gitStageQueuesRef = useRef(new Map<string, Promise<void>>());
  const gitStatusInFlightRef = useRef(false);
  const gitRefreshPendingRef = useRef(false);
  const refreshGitRef = useRef<(withNotification?: boolean) => Promise<void>>(async () => {});
  const gitFetchInFlightRef = useRef(false);
  const gitLastFetchAtRef = useRef(0);
  const gitRootsRef = useRef<string[]>([]);
  const gitRef = useRef<GitStatusResult | null>(null);
  const onGitMutatedRef = useRef(onGitMutated);
  onGitMutatedRef.current = onGitMutated;

  useEffect(() => { gitRef.current = git; }, [git]);

  const notifyGitSuccess = useCallback((key: string, ...args: Array<string | number>) => {
    notifyDesktop({ text: t(key, ...args), kind: "ok" });
  }, [t]);

  const notifyGitFailure = useCallback((key: string, error: unknown) => {
    notifyDesktop({ text: t(key, gitOperationError(error)), kind: "error" });
  }, [t]);

  const collectGitRoots = useCallback((result: GitStatusResult, preferredRoot = ""): string[] => {
    const roots = new Set<string>();
    if (preferredRoot) roots.add(preferredRoot);
    if (result.root) roots.add(result.root);
    (result.nestedRepos || []).forEach((repo) => roots.add(repo.root));
    [...result.staged, ...result.unstaged].forEach((change) => {
      if (change.repoRoot) roots.add(change.repoRoot);
    });
    (result.tracking || []).forEach((item) => {
      if (item.repoRoot) roots.add(item.repoRoot);
    });
    return [...roots].filter(Boolean);
  }, []);

  const refreshGit = useCallback(async (withNotification = false) => {
    if (!selectedProject) return;
    const project = selectedProject;
    if (gitStatusInFlightRef.current) {
      if (withNotification) {
        while (gitStatusInFlightRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
      } else {
        gitRefreshPendingRef.current = true;
        return;
      }
    }
    gitStatusInFlightRef.current = true;
    if (withNotification) setGitRefreshing(true);
    try {
      const result = await desktopApi().terminalGitStatus({
        cwd: project,
        nestedScan: {
          maxDepth: nestedScanMaxDepth,
          ignoreDirs: nestedScanIgnoreDirs
        }
      });
      if (selectedProjectRef.current !== project) return;
      setGit(result);
      const roots = collectGitRoots(result);
      gitRootsRef.current = roots;
      const preferredRoot = defaultGitRoot(result, roots);
      setGitRoot((current) => {
        if (gitRootManuallySelectedRef.current && current && roots.includes(current)) return current;
        return preferredRoot;
      });
      const nextChanges = [...result.staged, ...result.unstaged];
      const available = gitDirectoryKeys(nextChanges);
      setGitExpandedDirs((current) => {
        if (!gitExpandInitializedRef.current) {
          gitExpandInitializedRef.current = true;
          gitSeenDirectoryKeysRef.current = new Set(available);
          return new Set(available);
        }
        const next = reconcileExpandedGitDirectories(current, nextChanges);
        for (const key of available) {
          if (!gitSeenDirectoryKeysRef.current.has(key)) next.add(key);
        }
        gitSeenDirectoryKeysRef.current = new Set(available);
        return next;
      });
    } catch (error) {
      if (withNotification) notifyGitFailure("desktop.workbench.gitStatusRefreshFailed", error);
      else if (side === "git") notifyStatus({ text: gitOperationError(error), kind: "error" });
    } finally {
      gitStatusInFlightRef.current = false;
      if (withNotification) setGitRefreshing(false);
      if (gitRefreshPendingRef.current) {
        gitRefreshPendingRef.current = false;
        void refreshGitRef.current(false);
      }
    }
  }, [
    collectGitRoots,
    nestedScanIgnoreDirs,
    nestedScanMaxDepth,
    notifyGitFailure,
    notifyStatus,
    selectedProject,
    selectedProjectRef,
    side
  ]);

  useEffect(() => { refreshGitRef.current = refreshGit; }, [refreshGit]);

  const autoFetchGit = useCallback(async (force = false) => {
    if (!selectedProject || gitFetchInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - gitLastFetchAtRef.current < GIT_AUTO_FETCH_MS) return;
    gitFetchInFlightRef.current = true;
    try {
      if (force || !gitRootsRef.current.length) {
        await refreshGit(false);
      }
      const roots = gitRootsRef.current.slice(0, GIT_AUTO_FETCH_MAX_ROOTS);
      for (const root of roots) {
        try {
          await desktopApi().terminalGitFetch({ repoRoot: root });
        } catch {
          // Soft-fail per root (offline remotes, auth prompts, etc.).
        }
      }
      gitLastFetchAtRef.current = Date.now();
      await refreshGit(false);
    } finally {
      gitFetchInFlightRef.current = false;
    }
  }, [refreshGit, selectedProject]);

  useEffect(() => {
    gitRootsRef.current = [];
    gitLastFetchAtRef.current = 0;
    gitExpandInitializedRef.current = false;
    gitSeenDirectoryKeysRef.current = new Set();
    setGit(null);
    setGitRoot("");
    gitRootManuallySelectedRef.current = false;
    setGitExpandedDirs(new Set());
  }, [selectedProject]);

  useEffect(() => {
    if (!active || !selectedProject) return;
    void refreshGit(false);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshGit(false);
    }, GIT_STATUS_POLL_MS);
    return () => window.clearInterval(poll);
  }, [active, refreshGit, selectedProject]);

  useEffect(() => {
    if (!active || !selectedProject) return;
    void autoFetchGit(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void autoFetchGit(false);
    }, GIT_AUTO_FETCH_MS);
    return () => window.clearInterval(timer);
  }, [active, autoFetchGit, selectedProject]);

  useEffect(() => {
    if (!active || !selectedProject) return;
    const onFocus = () => {
      void refreshGit(false);
      void autoFetchGit(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, autoFetchGit, refreshGit, selectedProject]);

  const toggleGitDirectory = useCallback((path: string) => {
    setGitExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const gitRepositories = useMemo(() => {
    const roots = new Set<string>();
    if (git?.root) roots.add(git.root);
    git?.nestedRepos?.forEach((repository) => roots.add(repository.root));
    [...(git?.staged || []), ...(git?.unstaged || [])].forEach((change) => roots.add(change.repoRoot));
    return [...roots].filter(Boolean).sort((left, right) => left.localeCompare(right)).map((root) => ({
      root,
      label: git?.nestedRepos?.find((repository) => repository.root === root)?.displayPath || basename(root)
    }));
  }, [git]);

  const enqueueGitStage = useCallback((repoRoot: string, operation: () => Promise<unknown>): Promise<void> => {
    const queues = gitStageQueuesRef.current;
    const previous = queues.get(repoRoot) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation).then(() => undefined);
    queues.set(repoRoot, next.catch(() => undefined));
    return next;
  }, []);

  const toggleGitStage = useCallback(async (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => {
    const groups = normalizeGitStageTargets(targets);
    if (!groups.length) return;
    const results = await Promise.all(groups.map(async (group) => {
      try {
        await enqueueGitStage(group.repoRoot, () => targetStaged
          ? desktopApi().terminalGitStage({ repoRoot: group.repoRoot, paths: group.paths })
          : desktopApi().terminalGitUnstage({ repoRoot: group.repoRoot, paths: group.paths }));
        setGit((current) => current ? stageGitChangesOptimistically(current, [group], targetStaged) : current);
        return null;
      } catch (error) {
        return error;
      }
    }));
    const failures = results.filter((error): error is Error => Boolean(error));
    if (failures.length) {
      notifyGitFailure(targetStaged ? "desktop.workbench.gitStageFailed" : "desktop.workbench.gitUnstageFailed", failures[0]);
    }
    onGitMutatedRef.current();
    void refreshGit(false);
  }, [enqueueGitStage, notifyGitFailure, refreshGit]);

  const stagedCommitPaths = useMemo(() => {
    if (!gitRoot || !git) return [] as string[];
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const change of git.staged) {
      if (change.repoRoot !== gitRoot || seen.has(change.repoPath)) continue;
      seen.add(change.repoPath);
      paths.push(change.repoPath);
    }
    return paths;
  }, [git, gitRoot]);

  const canCommit = Boolean(gitRoot && commitMessage.trim() && stagedCommitPaths.length && !commitBusy);

  const suggestCommit = useCallback(async () => {
    if (!gitRoot || !stagedCommitPaths.length) return;
    try {
      setCommitBusy(true);
      setCommitSuggestion(null);
      const result = await desktopApi().terminalGitSuggestCommit({ repoRoot: gitRoot, paths: stagedCommitPaths });
      setCommitMessage(result.message);
      setCommitSuggestion(result);
    } catch (error) { notifyGitFailure("desktop.workbench.gitCommitGenerateFailed", error); }
    finally { setCommitBusy(false); }
  }, [gitRoot, notifyGitFailure, stagedCommitPaths]);

  const commit = useCallback(async (pushAfter = false) => {
    if (!gitRoot || !commitMessage.trim() || !stagedCommitPaths.length) return;
    let result: { ok: boolean; skipped?: string[] } | undefined;
    try {
      setCommitBusy(true);
      result = await desktopApi().terminalGitCommit({
        repoRoot: gitRoot,
        message: commitMessage.trim(),
        paths: stagedCommitPaths
      });
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitCommitFailed", error);
      setCommitBusy(false);
      return;
    }
    setCommitSuggestion(null);
    const notifySkippedSubmodules = (value: { ok: boolean; skipped?: string[] } | undefined) => {
      if (!value?.skipped?.length) return;
      const text = t("desktop.workbench.gitCommitSkippedSubmodules", value.skipped.join(", "));
      notifyStatus({ text, kind: "warning" });
      notifyDesktop({ text, kind: "info" });
    };
    if (pushAfter) {
      try {
        await desktopApi().terminalGitPush({ repoRoot: gitRoot });
        notifySkippedSubmodules(result);
        notifyGitSuccess("desktop.workbench.gitCommitAndPushSucceeded");
        setCommitMessage("");
      } catch (error) { notifyGitFailure("desktop.workbench.gitCommitSucceededPushFailed", error); }
    } else {
      notifySkippedSubmodules(result);
      notifyGitSuccess("desktop.workbench.gitCommitSucceeded");
      setCommitMessage("");
    }
    await refreshGit();
    onGitMutatedRef.current();
    setCommitBusy(false);
  }, [commitMessage, gitRoot, notifyGitFailure, notifyGitSuccess, notifyStatus, refreshGit, stagedCommitPaths, t]);

  const syncGitBranch = useCallback(async () => {
    const root = trackingForRoot(git, gitRoot);
    const repoRoot = gitRoot || root?.repoRoot;
    if (!repoRoot) return;
    setGitSyncing(true);
    try {
      if (root && root.behind > 0) await desktopApi().terminalGitPull({ repoRoot });
      if (root && root.ahead > 0) await desktopApi().terminalGitPush({ repoRoot });
      if (!root || (root.ahead <= 0 && root.behind <= 0)) await desktopApi().terminalGitFetch({ repoRoot });
      notifyGitSuccess("desktop.workbench.gitSyncSucceeded");
      await refreshGit();
      onGitMutatedRef.current();
    } catch (error) { notifyGitFailure("desktop.workbench.gitSyncFailed", error); }
    finally { setGitSyncing(false); }
  }, [git, gitRoot, notifyGitFailure, notifyGitSuccess, refreshGit]);

  const checkoutGitPanelBranch = useCallback(async (selection: { branch: string; remote?: string }) => {
    if (!gitRoot || !selection.branch) return;
    try {
      await desktopApi().terminalGitCheckout({ cwd: gitRoot, ...selection, repoRoot: gitRoot });
      await refreshGit();
      onGitMutatedRef.current();
      const displayBranch = selection.remote ? `${selection.remote}/${selection.branch}` : selection.branch;
      notifyGitSuccess("desktop.workbench.checkoutBranchSucceeded", displayBranch);
    } catch (error) { notifyGitFailure("desktop.workbench.checkoutBranchFailed", error); }
  }, [gitRoot, notifyGitFailure, notifyGitSuccess, refreshGit]);

  const selectGitRoot = useCallback((root: string) => {
    gitRootManuallySelectedRef.current = true;
    setGitRoot(root);
  }, []);

  const projectTracking = trackingForRoot(git, gitRoot);

  return {
    git,
    gitRef,
    gitRoot,
    gitExpandedDirs,
    gitRefreshing,
    gitSyncing,
    commitMessage,
    commitBusy,
    commitSuggestion,
    gitRepositories,
    stagedCommitPaths,
    canCommit,
    projectTracking,
    refreshGit,
    toggleGitDirectory,
    toggleGitStage,
    selectGitRoot,
    setCommitMessage,
    suggestCommit,
    commit,
    syncGitBranch,
    checkoutGitPanelBranch,
    notifyGitSuccess,
    notifyGitFailure
  };
}
