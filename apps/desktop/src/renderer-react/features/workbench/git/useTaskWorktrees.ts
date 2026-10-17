import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../../bridge";
import { normalizeTaskWorktreeState, type TaskWorktreeListing, type TaskWorktreeState } from "../../../../shared/worktreeTypes";

/**
 * Which surface is asking for a root. Every scope follows the shared default
 * until its pane is pinned, because "Git shows one checkout while the explorer
 * shows another" is nearly always an accident; pinning is the escape hatch for
 * the case where it is not.
 */
export type CheckoutScope = "default" | "git" | "files" | "search" | "terminal";

/** A checkout as a menu row: the main working tree, or one worktree of it. */
export type CheckoutOption = {
  path: string;
  repoRoot: string;
  repoLabel: string;
  /** Never empty: a detached checkout falls back to its short commit. */
  branchLabel: string;
  isMain: boolean;
  /** HEAD is contained in the repository's base branch. */
  merged: boolean;
};

export type TaskWorktrees = {
  /** Where this task's worktrees live; the create sheet previews against it. */
  root: string;
  listing: TaskWorktreeListing | null;
  /** Every selectable checkout, grouped by repository with the main one first. */
  checkouts: CheckoutOption[];
  loading: boolean;
  error: string | null;
  state: TaskWorktreeState;
  saveState: (patch: Partial<TaskWorktreeState>) => Promise<void>;
  refresh: () => Promise<void>;
  /** The path a pane with this scope shows for a repository root. */
  rootFor: (scope: CheckoutScope, repoRoot: string) => string;
  /** The checkout a repository is diverted to for this scope, or null at its main one. */
  checkoutFor: (scope: CheckoutScope, repoRoot: string) => string | null;
  /** The pane was pinned away from the shared default. */
  isPinned: (scope: CheckoutScope) => boolean;
  /**
   * Point one repository at one checkout; an unpinned scope moves the shared
   * default. Choosing a repository's main checkout returns it to the fold.
   */
  select: (scope: CheckoutScope, repoRoot: string, path: string) => void;
  pin: (scope: CheckoutScope) => void;
  unpin: (scope: CheckoutScope) => void;
};

const EMPTY_CHECKOUTS: CheckoutOption[] = [];
/** Repository root → the checkout it is diverted to, absent while it is at its main one. */
type CheckoutSelection = Record<string, string>;

/**
 * An agent creating a worktree from a terminal writes into the panel home, which
 * no file watcher covers — the watched roots are the repositories themselves. So
 * the list is polled for as long as the window is visible: `git worktree list`
 * costs milliseconds, and this is what makes a new checkout appear without a
 * restart. Focus, and any filesystem change inside a repository, refresh sooner.
 */
const POLL_MS = 20_000;

function pathKey(value = ""): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function basename(value: string): string {
  const parts = pathKey(value).split("/");
  return parts[parts.length - 1] || value;
}

export function useTaskWorktrees(options: { noteId: string | null; repos: string[] }): TaskWorktrees {
  const { noteId, repos } = options;
  const reposKey = useMemo(() => repos.map(pathKey).filter(Boolean).join("\0"), [repos]);
  const reposRef = useRef<string[]>(repos);
  reposRef.current = repos;

  const [listing, setListing] = useState<TaskWorktreeListing | null>(null);
  const [state, setState] = useState<TaskWorktreeState>({ enabled: false, baseBranch: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What every unpinned pane shows, then the panes that pinned themselves off it. */
  const [shared, setShared] = useState<CheckoutSelection>({});
  const [pins, setPins] = useState<Partial<Record<CheckoutScope, CheckoutSelection>>>({});

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * `git worktree list` answers the same records every poll, so a result is only
   * committed when it actually differs — otherwise the whole workbench would
   * re-render every twenty seconds for nothing.
   */
  const signatureRef = useRef("");
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const api = desktopApi();
    if (typeof api.workbenchListWorktrees !== "function") return;
    // The repositories come from the caller rather than from the main process,
    // so a task whose notes have not loaded yet simply has nothing to ask about.
    const targets = reposRef.current.map(pathKey).filter(Boolean);
    if (!noteId || !targets.length) {
      signatureRef.current = "";
      if (mountedRef.current) {
        setListing(null);
        setLoading(false);
        setError(null);
      }
      return;
    }
    const request = ++requestRef.current;
    if (mountedRef.current) setLoading(true);
    try {
      const answer = await api.workbenchListWorktrees({
        noteId,
        repos: targets.map((repoRoot) => ({ repoRoot, label: basename(repoRoot) }))
      });
      if (!mountedRef.current || request !== requestRef.current) return;
      // An answer that is not a listing is no answer: treat it as "none", so a
      // failed or older bridge leaves the panel without the control rather than
      // crashing on a shape it did not expect.
      const next = answer && typeof answer === "object" && Array.isArray(answer.repos) ? answer : null;
      const signature = JSON.stringify(next);
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setListing(next);
      }
      setError(null);
    } catch (failure) {
      if (!mountedRef.current || request !== requestRef.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mountedRef.current && request === requestRef.current) setLoading(false);
    }
  }, [noteId]);

  // A new task, or a different set of repositories, has nothing in common with
  // the previous answer: drop it rather than offer checkouts of another task.
  useEffect(() => {
    signatureRef.current = "";
    setListing(null);
    setShared({});
    setPins({});
    void refresh();
  }, [refresh, reposKey]);

  useEffect(() => {
    const api = desktopApi();
    if (!noteId || typeof api.notesGetWorktreeSettings !== "function") return;
    void api
      .notesGetWorktreeSettings({ noteId })
      .then((next) => {
        if (mountedRef.current) setState(normalizeTaskWorktreeState(next));
      })
      .catch(() => undefined);
  }, [noteId]);

  useEffect(() => {
    if (!noteId || !reposKey) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const api = desktopApi();
    const unsubscribe = typeof api.onWorkbenchFileSystemChanged === "function"
      ? api.onWorkbenchFileSystemChanged(() => void refresh())
      : null;
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribe?.();
    };
  }, [noteId, reposKey, refresh]);

  const checkouts = useMemo<CheckoutOption[]>(() => {
    if (!listing?.repos.length) return EMPTY_CHECKOUTS;
    const rows: CheckoutOption[] = [];
    for (const repo of listing.repos) {
      if (!repo.exists || !repo.isGitRepo) continue;
      for (const worktree of repo.worktrees) {
        // A checkout whose folder is gone cannot be browsed, searched or diffed,
        // so it is not offered as a place to look. The settings sheet is where
        // such a row stays visible, in order to clean it up.
        if (worktree.missing || worktree.prunable) continue;
        rows.push({
          path: worktree.path,
          repoRoot: repo.repoRoot,
          repoLabel: repo.label,
          branchLabel: worktree.branch || (worktree.head ? worktree.head.slice(0, 7) : ""),
          isMain: worktree.isMain,
          merged: worktree.merged
        });
      }
    }
    return rows;
  }, [listing]);

  const optionByPath = useMemo(() => {
    const map = new Map<string, CheckoutOption>();
    for (const option of checkouts) map.set(pathKey(option.path), option);
    return map;
  }, [checkouts]);

  const selectionFor = useCallback(
    (scope: CheckoutScope): CheckoutSelection => (scope === "default" ? shared : pins[scope] ?? shared),
    [pins, shared]
  );

  /**
   * The checkout a repository is diverted to. A checkout whose folder has gone
   * reads as no diversion at all, so a pane falls back to the main checkout
   * instead of pointing at something that is no longer there.
   */
  const checkoutFor = useCallback(
    (scope: CheckoutScope, repoRoot: string): string | null => {
      const wanted = selectionFor(scope)[pathKey(repoRoot)];
      if (!wanted) return null;
      return optionByPath.get(pathKey(wanted))?.path ?? null;
    },
    [optionByPath, selectionFor]
  );

  const rootFor = useCallback(
    (scope: CheckoutScope, repoRoot: string): string => checkoutFor(scope, repoRoot) ?? repoRoot,
    [checkoutFor]
  );

  const isPinned = useCallback((scope: CheckoutScope): boolean => scope !== "default" && pins[scope] !== undefined, [pins]);

  const select = useCallback(
    (scope: CheckoutScope, repoRoot: string, path: string) => {
      const option = optionByPath.get(pathKey(path));
      // Picking the main checkout is how a repository returns to the fold; every
      // other choice diverts exactly that one repository.
      const entry = option?.isMain ? null : path;
      const apply = (current: CheckoutSelection): CheckoutSelection => {
        const next = { ...current };
        if (entry) next[pathKey(repoRoot)] = entry;
        else delete next[pathKey(repoRoot)];
        return next;
      };
      if (scope === "default" || !pins[scope]) {
        // An unpinned pane moves the shared default, so every other pane follows
        // it; a pinned one only ever moves itself.
        setShared(apply);
        return;
      }
      setPins((current) => ({ ...current, [scope]: apply(current[scope] ?? {}) }));
    },
    [optionByPath, pins]
  );

  const pin = useCallback(
    (scope: CheckoutScope) => {
      if (scope === "default") return;
      // A copy, so later moves of the shared default leave this pane where it is.
      setPins((current) => (current[scope] ? current : { ...current, [scope]: { ...shared } }));
    },
    [shared]
  );

  const unpin = useCallback((scope: CheckoutScope) => {
    setPins((current) => {
      if (!current[scope]) return current;
      const next = { ...current };
      delete next[scope];
      return next;
    });
  }, []);

  const saveState = useCallback(
    async (patch: Partial<TaskWorktreeState>) => {
      if (!noteId) return;
      const next = await desktopApi().notesSetWorktreeSettings({ noteId, patch });
      if (mountedRef.current) setState(normalizeTaskWorktreeState(next));
    },
    [noteId]
  );

  return {
    root: listing?.root ?? "",
    listing,
    checkouts,
    loading,
    error,
    state,
    saveState,
    refresh,
    rootFor,
    checkoutFor,
    isPinned,
    select,
    pin,
    unpin
  };
}
