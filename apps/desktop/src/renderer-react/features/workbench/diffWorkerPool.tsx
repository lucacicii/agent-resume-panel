import {
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions
} from "@pierre/diffs/react";

/**
 * Classic (non-module) worker: the renderer is loaded via file:// so module
 * workers are unavailable. The bundled worker script is emitted by
 * scripts/build-renderer-react.mjs next to react-runtime.js.
 */
const DIFF_WORKER_URL = new URL("./pierre-diff-worker.js", window.location.href);

function createDiffHighlightWorker(): Worker {
  return new Worker(DIFF_WORKER_URL);
}

/**
 * Diff highlighting workers.
 *
 * Mounted around the diff view itself, so the pool is created when a diff is
 * actually shown and torn down with it. Two workers per diff view is enough to
 * keep highlighting off the main thread without paying for idle threads in every
 * workbench window.
 */
const diffWorkerPoolOptions: WorkerPoolOptions = {
  workerFactory: createDiffHighlightWorker,
  poolSize: 2
};

const diffWorkerHighlighterOptions: WorkerInitializationRenderOptions = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  lineDiffType: "word",
  langs: [
    "typescript",
    "javascript",
    "tsx",
    "jsx",
    "json",
    "jsonc",
    "markdown",
    "css",
    "html",
    "python",
    "shellscript",
    "yaml",
    "sql",
    "rust",
    "go",
    "java",
    "c",
    "cpp",
    "php",
    "ruby"
  ]
};

export function DiffWorkerPool({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <WorkerPoolContextProvider
      poolOptions={diffWorkerPoolOptions}
      highlighterOptions={diffWorkerHighlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
