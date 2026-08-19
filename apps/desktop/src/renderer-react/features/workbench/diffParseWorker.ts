import { parseDiffFromFile } from "@pierre/diffs";

export interface DiffParseWorkerFile {
  name: string;
  contents: string;
  cacheKey: string;
}

export interface DiffParseWorkerRequest {
  id: number;
  oldFile: DiffParseWorkerFile | null;
  newFile: DiffParseWorkerFile | null;
}

export interface DiffParseWorkerResponse {
  id: number;
  fileDiff?: ReturnType<typeof parseDiffFromFile>;
  error?: string;
}

/**
 * Off-main-thread `parseDiffFromFile` for large diffs. Bundled by
 * scripts/build-renderer-react.mjs into pierre-diff-parse-worker.js and
 * driven by useFileDiffParse.ts.
 */
self.onmessage = (event: MessageEvent<DiffParseWorkerRequest>) => {
  const { id, oldFile, newFile } = event.data;
  try {
    const fileDiff = parseDiffFromFile(oldFile, newFile);
    const response: DiffParseWorkerResponse = { id, fileDiff };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: DiffParseWorkerResponse = {
      id,
      error: error instanceof Error ? error.message : String(error)
    };
    (self as unknown as Worker).postMessage(response);
  }
};
