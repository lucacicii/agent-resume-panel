import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../../bridge";
import { notifyDesktop } from "../../../components/Notifications";
import { useMountedRef } from "../../../components/useOverlayMotion";
import { useI18n } from "../../../i18n";
import {
  type CommitSuggestion,
  type GitStageTarget,
  type GitStatusResult,
  GIT_AUTO_FETCH_MS,
  GIT_AUTO_FETCH_MAX_ROOTS,
  GIT_STATUS_POLL_MS,
  basename,
  collectGitRoots,
  defaultGitRoot,
  gitDirectoryKeys,
  gitOperationError,
  mergeGitStatuses,
  normalizeGitStageTargets,
  reconcileExpandedGitDirectories,
  stageGitChangesOptimistically,
  trackingForRoot
} from "./workbenchGitModel";

/** Identity of a set of project roots; a change resets the git view. */
function projectRootsKey(projects: string[]): string {
  return projects.map((project) => project.replaceAll("\\", "/").replace(/\/+$/, "")).join("\0");
}

export function useWorkbenchGit(options: {
  active: boolean;
  selectedProjects: string[];
  selectedProjectsRef: { current: string[] };
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
  commit: (pushAfter?: boolean, messageOverride?: string, pathsOverride?: string[]) => Promise<void>;
  syncGitBranch: () => Promise<void>;
  checkoutGitPanelBranch: (selection: { branch: string; remote?: string }) => Promise<void>;
  notifyGitSuccess: (key: string, ...args: Array<string | number>) => void;
  notifyGitFailure: (key: string, error: unknown) => void;
} {
  const {
    active,
    selectedProjects,
    selectedProjectsRef,
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
  /**
   * The status lock is cleared by the in-flight call's `finally`, which can
   * land after this hook unmounts. Waiters must stop when that happens,
   * otherwise they keep scheduling timers against a torn-down `window`.
   */
  const mountedRef = useMountedRef();
  const gitRefreshPendingRef = useRef(false);
  const refreshGitRef = useRef<(withNotification?: boolean) => Promise<void>>(async () => {});
  const gitFetchInFlightRef = useRef(false);
  const gitLastFetchAtRef = useRef(0);
  const gitRootsRef = useRef<string[]>([]);
  const gitRef = useRef<GitStatusResult | null>(null);
  const onGitMutatedRef = useRef(onGitMutated);
  onGitMutatedRef.current = onGitMutated;
  /** Stable identity of the project root set, used to reset/poll per workspace. */
  const projectsKey = projectRootsKey(selectedProjects);

  useEffect(() => { gitRef.current = git; }, [git]);

  const notifyGitSuccess = useCallback((key: string, ...args: Array<string | number>) => {
    notifyDesktop({ text: t(key, ...args), kind: "ok" });
  }, [t]);

  const notifyGitFailure = useCallback((key: string, error: unknown) => {
    notifyDesktop({ text: t(key, gitOperationError(error)), kind: "error" });
  }, [t]);

  const refreshGit = useCallback(async (withNotification = false) => {
    if (!mountedRef.current) return;
    const projects = selectedProjects;
    if (!projects.length) return;
    const projectsIdentity = projectRootsKey(projects);
    if (gitStatusInFlightRef.current) {
      if (withNotification) {
        while (gitStatusInFlightRef.current && mountedRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        // Unmounted while waiting out the in-flight status call: do not start
        // another one against a dead component.
        if (!mountedRef.current) return;
      } else {
        gitRefreshPendingRef.current = true;
        return;
      }
    }
    gitStatusInFlightRef.current = true;
    if (withNotification) setGitRefreshing(true);
    try {
      const results = await Promise.all(projects.map((project) => desktopApi().terminalGitStatus({
        cwd: project,
        nestedScan: {
          maxDepth: nestedScanMaxDepth,
          ignoreDirs: nestedScanIgnoreDirs
        }
      })));
      if (projectRootsKey(selectedProjectsRef.current) !== projectsIdentity) return;
      const result = mergeGitStatuses(projects, results);
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
    mountedRef,
    nestedScanIgnoreDirs,
    nestedScanMaxDepth,
    notifyGitFailure,
    notifyStatus,
    selectedProjects,
    selectedProjectsRef,
    side
  ]);

  useEffect(() => { refreshGitRef.current = refreshGit; }, [refreshGit]);

  const autoFetchGit = useCallback(async (force = false) => {
    if (!mountedRef.current) return;
    if (!selectedProjects.length || gitFetchInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - gitLastFetchAtRef.current < GIT_AUTO_FETCH_MS) return;
    gitFetchInFlightRef.current = true;
    try {
      if (force || !gitRootsRef.current.length) {
        await refreshGit(false);
        // A concurrent poll may hold the status lock; wait it out so the repo
        // roots are known before fetching instead of skipping the sweep.
        while (gitStatusInFlightRef.current && mountedRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 20));
        }
        if (!mountedRef.current) return;
        if (!gitRootsRef.current.length) await refreshGit(false);
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
  }, [mountedRef, refreshGit, selectedProjects]);

  useEffect(() => {
    gitRootsRef.current = [];
    gitLastFetchAtRef.current = 0;
    gitExpandInitializedRef.current = false;
    gitSeenDirectoryKeysRef.current = new Set();
    setGit(null);
    setGitRoot("");
    gitRootManuallySelectedRef.current = false;
    setGitExpandedDirs(new Set());
  }, [projectsKey]);

  useEffect(() => {
    if (!active || !projectsKey) return;
    void refreshGit(false);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshGit(false);
    }, GIT_STATUS_POLL_MS);
    return () => window.clearInterval(poll);
  }, [active, projectsKey, refreshGit]);

  useEffect(() => {
    if (!active || !projectsKey) return;
    void autoFetchGit(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void autoFetchGit(false);
    }, GIT_AUTO_FETCH_MS);
    return () => window.clearInterval(timer);
  }, [active, autoFetchGit, projectsKey]);

  useEffect(() => {
    if (!active || !projectsKey) return;
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
  }, [active, autoFetchGit, projectsKey, refreshGit]);

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

  const commit = useCallback(async (pushAfter = false, messageOverride?: string, pathsOverride?: string[]) => {
    const finalMessage = (messageOverride ?? commitMessage).trim();
    // `pathsOverride` lets a caller stage-and-commit a set it just computed. Relying
    // on `stagedCommitPaths` there races the state update, which made the review
    // banner's "stage everything then commit" path commit nothing at all.
    const commitPaths = pathsOverride?.length ? pathsOverride : stagedCommitPaths;
    if (!gitRoot || !finalMessage || !commitPaths.length) return;
    let result: { ok: boolean; skipped?: string[] } | undefined;
    try {
      setCommitBusy(true);
      result = await desktopApi().terminalGitCommit({
        repoRoot: gitRoot,
        message: finalMessage,
        paths: commitPaths
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
