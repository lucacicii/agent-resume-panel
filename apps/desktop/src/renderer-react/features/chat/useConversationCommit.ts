import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../bridge";
import {
  conversationFileKey,
  groupConversationFilesByRepo,
  type ConversationGitFile
} from "./gitDiffUtils";

export type CommitPhase = "idle" | "generating-message" | "committing" | "pushing" | "done";

export interface RepoCommitOutcome {
  repoRoot: string;
  paths: string[];
  committed: boolean;
  pushed: boolean;
  /** Submodules the server refused to commit (reported by `terminal:gitCommit`). */
  skipped?: string[];
  /** This repo's failure reason; never blocks the other repos. */
  error?: string;
}

export interface ConversationCommit {
  /** Selected file keys (`${repoRoot}\0${repoPath}`), always a subset of the current files. */
  selected: Set<string>;
  isAllSelected: boolean;
  toggle: (key: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  message: string;
  setMessage: (value: string) => void;
  suggestMessage: () => Promise<void>;
  phase: CommitPhase;
  isBusy: boolean;
  phaseLabel: string;
  outcomes: RepoCommitOutcome[];
  error?: string;
  success?: string;
  run: () => Promise<void>;
  retryPush: (repoRoot: string) => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Commit state machine for the conversation's dirty files. Selection defaults to
 * "everything" (tracked as a deselection set, so newly dirty files join the next
 * commit), the message is generated per repository when left empty, and one repo's
 * failure never blocks the rest.
 */
export function useConversationCommit(options: {
  files: ConversationGitFile[];
  refresh: () => Promise<void> | void;
  onCommitSuccess?: () => void;
}): ConversationCommit {
  const { files, refresh, onCommitSuccess } = options;

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<CommitPhase>("idle");
  const [outcomes, setOutcomes] = useState<RepoCommitOutcome[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<string | undefined>(undefined);

  // Drop deselections for files that are no longer dirty.
  useEffect(() => {
    setDeselected((previous) => {
      if (!previous.size) return previous;
      const available = new Set(files.map(conversationFileKey));
      let changed = false;
      const next = new Set<string>();
      for (const key of previous) {
        if (available.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [files]);

  const selected = useMemo(() => {
    const keys = new Set<string>();
    for (const file of files) {
      const key = conversationFileKey(file);
      if (!deselected.has(key)) keys.add(key);
    }
    return keys;
  }, [files, deselected]);

  const selectedFiles = useMemo(
    () => files.filter((file) => selected.has(conversationFileKey(file))),
    [files, selected]
  );

  const toggle = useCallback((key: string) => {
    setDeselected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setDeselected(new Set()), []);

  const clearSelection = useCallback(
    () => setDeselected(new Set(files.map(conversationFileKey))),
    [files]
  );

  const isBusy = phase === "generating-message" || phase === "committing" || phase === "pushing";
  const phaseLabel =
    phase === "generating-message"
      ? "Generating message..."
      : phase === "committing"
        ? "Committing..."
        : phase === "pushing"
          ? "Pushing..."
          : "";
  const isAllSelected = files.length > 0 && selected.size === files.length;

  const suggestMessage = useCallback(async () => {
    const target = selectedFiles[0] ?? files[0];
    if (!target) return;
    const paths = selectedFiles
      .filter((file) => file.repoRoot === target.repoRoot)
      .map((file) => file.repoPath);
    setPhase("generating-message");
    setError(undefined);
    try {
      const result = await desktopApi().terminalGitSuggestCommit({
        repoRoot: target.repoRoot,
        paths: paths.length ? paths : [target.repoPath]
      });
      if (result?.message) setMessage(result.message);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPhase("idle");
    }
  }, [files, selectedFiles]);

  const run = useCallback(async () => {
    if (!selectedFiles.length || isBusy) return;
    const groups = groupConversationFilesByRepo(selectedFiles);
    if (!groups.length) return;

    setError(undefined);
    setSuccess(undefined);
    setOutcomes([]);

    const typed = message.trim();
    const results: RepoCommitOutcome[] = [];
    let anyFailure = false;

    for (const group of groups) {
      const outcome: RepoCommitOutcome = {
        repoRoot: group.repoRoot,
        paths: group.paths,
        committed: false,
        pushed: false
      };

      let repoMessage = typed;
      if (!repoMessage) {
        setPhase("generating-message");
        try {
          const suggestion = await desktopApi().terminalGitSuggestCommit({
            repoRoot: group.repoRoot,
            paths: group.paths
          });
          repoMessage = (suggestion?.message || "").trim();
        } catch (caught) {
          outcome.error = messageOf(caught);
          anyFailure = true;
          results.push(outcome);
          continue;
        }
      }
      if (!repoMessage) {
        outcome.error = "Unable to generate commit message.";
        anyFailure = true;
        results.push(outcome);
        continue;
      }

      setPhase("committing");
      try {
        const committed = await desktopApi().terminalGitCommit({
          repoRoot: group.repoRoot,
          message: repoMessage,
          paths: group.paths
        });
        outcome.committed = true;
        if (Array.isArray(committed?.skipped) && committed.skipped.length) {
          outcome.skipped = committed.skipped;
        }
      } catch (caught) {
        outcome.error = messageOf(caught);
        anyFailure = true;
        results.push(outcome);
        continue;
      }

      setPhase("pushing");
      try {
        await desktopApi().terminalGitPush({ repoRoot: group.repoRoot });
        outcome.pushed = true;
      } catch (caught) {
        outcome.error = messageOf(caught);
        anyFailure = true;
      }
      results.push(outcome);
    }

    setOutcomes(results);
    setPhase("done");
    await refresh();
    onCommitSuccess?.();

    if (!anyFailure && results.length) {
      setMessage("");
      setSuccess(
        `Committed and pushed ${selectedFiles.length} file${
          selectedFiles.length === 1 ? "" : "s"
        } across ${results.length} repositor${results.length === 1 ? "y" : "ies"}.`
      );
    } else {
      setError("Some repositories could not be committed or pushed.");
    }
  }, [selectedFiles, message, isBusy, refresh, onCommitSuccess]);

  const retryPush = useCallback(
    async (repoRoot: string) => {
      setPhase("pushing");
      try {
        await desktopApi().terminalGitPush({ repoRoot });
        setOutcomes((previous) =>
          previous.map((outcome) =>
            outcome.repoRoot === repoRoot ? { ...outcome, pushed: true, error: undefined } : outcome
          )
        );
        setError(undefined);
      } catch (caught) {
        setOutcomes((previous) =>
          previous.map((outcome) =>
            outcome.repoRoot === repoRoot ? { ...outcome, pushed: false, error: messageOf(caught) } : outcome
          )
        );
        setError(messageOf(caught));
      } finally {
        setPhase("idle");
      }
    },
    []
  );

  return {
    selected,
    isAllSelected,
    toggle,
    selectAll,
    clearSelection,
    message,
    setMessage,
    suggestMessage,
    phase,
    isBusy,
    phaseLabel,
    outcomes,
    error,
    success,
    run,
    retryPush
  };
}
