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

const diffWorkerPoolOptions: WorkerPoolOptions = {
  workerFactory: createDiffHighlightWorker,
  poolSize: 4
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
