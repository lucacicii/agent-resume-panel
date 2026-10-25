import { execFile } from "node:child_process";

/**
 * Directory names every workbench file scan skips (quick access, file index):
 * dependency dirs and build output dwarf real sources on every stack.
 */
export const WORKBENCH_SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "release",
  ".yarn",
  ".pnpm-store",
  "Pods",
  "DerivedData"
]);

let rgAvailableCache: boolean | null = null;

export async function detectRipgrep(): Promise<boolean> {
  if (rgAvailableCache !== null) return rgAvailableCache;
  rgAvailableCache = await new Promise<boolean>((resolve) => {
    execFile("rg", ["--version"], { timeout: 2000 }, (error) => {
      resolve(!error);
    });
  });
  return rgAvailableCache;
}
