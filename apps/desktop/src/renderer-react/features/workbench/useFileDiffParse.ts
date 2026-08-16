import { parseDiffFromFile } from "@pierre/diffs";
import { useEffect, useMemo, useState } from "react";
import type {
  DiffParseWorkerFile,
  DiffParseWorkerRequest,
  DiffParseWorkerResponse
} from "./diffParseWorker";

/**
 * Diffs larger than this are parsed in a dedicated worker so the renderer
 * main thread never blocks on the full-file line diff (`createTwoFilesPatch`).
 */
export const PARSE_WORKER_THRESHOLD = 100 * 1024;

type ParsedFileDiff = ReturnType<typeof parseDiffFromFile>;

type WorkerParseState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; fileDiff: ParsedFileDiff };

let parseWorker: Worker | null = null;
let parseWorkerFailed = false;
let parseWorkerRequestId = 0;
const pendingParses = new Map<number, {
  resolve: (fileDiff: ParsedFileDiff) => void;
  reject: (error: Error) => void;
}>();

function getParseWorker(): Worker | null {
  if (parseWorkerFailed) return null;
  if (parseWorker) return parseWorker;
  try {
    const url = new URL("./pierre-diff-parse-worker.js", window.location.href);
    parseWorker = new Worker(url);
    parseWorker.onerror = () => {
      parseWorkerFailed = true;
      for (const { reject } of pendingParses.values()) {
        reject(new Error("diff parse worker failed"));
      }
      pendingParses.clear();
    };
  } catch {
    parseWorkerFailed = true;
  }
  return parseWorker;
}

function parseDiffInWorker(
  oldFile: DiffParseWorkerFile | null,
  newFile: DiffParseWorkerFile | null
): Promise<ParsedFileDiff> {
  return new Promise((resolve, reject) => {
    const worker = getParseWorker();
    if (!worker) {
      reject(new Error("diff parse worker unavailable"));
      return;
    }
    const id = ++parseWorkerRequestId;
    pendingParses.set(id, { resolve, reject });
    const onMessage = (event: MessageEvent<DiffParseWorkerResponse>) => {
      const data = event.data;
      if (!data || data.id !== id) return;
      worker.removeEventListener("message", onMessage);
      pendingParses.delete(id);
      if (data.error) reject(new Error(data.error));
      else if (data.fileDiff) resolve(data.fileDiff);
      else reject(new Error("diff parse worker returned no result"));
    };
    worker.addEventListener("message", onMessage);
    const request: DiffParseWorkerRequest = { id, oldFile, newFile };
    worker.postMessage(request);
  });
}

/**
 * Parses a file diff without blocking the main thread for large files:
 * small diffs parse synchronously (same behavior as before), large diffs are
 * delegated to a dedicated worker with a synchronous fallback if the worker
 * is unavailable.
 */
export function useFileDiffParse(
  oldFile: DiffParseWorkerFile | null,
  newFile: DiffParseWorkerFile | null
): { fileDiff: ParsedFileDiff | null; pending: boolean } {
  const oldContents = oldFile?.contents ?? null;
  const newContents = newFile?.contents ?? null;
  const totalChars = (oldContents?.length ?? 0) + (newContents?.length ?? 0);
  const useWorker = totalChars > PARSE_WORKER_THRESHOLD;

  const syncFileDiff = useMemo<ParsedFileDiff | null>(() => {
    if (useWorker) return null;
    return parseDiffFromFile(oldFile, newFile);
  }, [
    useWorker,
    oldFile?.name,
    oldContents,
    oldFile?.cacheKey,
    newFile?.name,
    newContents,
    newFile?.cacheKey
  ]);

  const [workerState, setWorkerState] = useState<WorkerParseState>({ status: "idle" });

  useEffect(() => {
    if (!useWorker) return;
    let cancelled = false;
    // Guard against redundant updates so an unchanged state never triggers a
    // re-render (the file objects below are recreated every render; only the
    // content strings may change the effect's behavior).
    setWorkerState((prev) => (prev.status === "pending" ? prev : { status: "pending" }));
    parseDiffInWorker(oldFile, newFile)
      .then((fileDiff) => {
        if (!cancelled) setWorkerState({ status: "done", fileDiff });
      })
      .catch(() => {
        if (cancelled) return;
        // Worker unavailable/failed: fall back to a synchronous parse so the
        // diff still renders (rare path; same behavior as before workers).
        try {
          const fileDiff = parseDiffFromFile(oldFile, newFile);
          if (!cancelled) setWorkerState({ status: "done", fileDiff });
        } catch {
          // Leave the state pending forever is wrong; surface nothing parsed.
          if (!cancelled) setWorkerState({ status: "idle" });
        }
      });
    return () => {
      cancelled = true;
    };
    // oldFile/newFile are recreated every render; only their contents decide
    // whether a new parse is needed.
  }, [useWorker, oldContents, newContents]);

  if (!useWorker) return { fileDiff: syncFileDiff, pending: false };
  if (workerState.status === "done") return { fileDiff: workerState.fileDiff, pending: false };
  return { fileDiff: null, pending: workerState.status === "pending" };
}
