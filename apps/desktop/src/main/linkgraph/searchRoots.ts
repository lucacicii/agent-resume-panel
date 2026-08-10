/**
 * Resolve project + backend search roots for Link Graph (FE + sibling BE repos).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Roots to search for routes / controllers.
 * Always includes projectPath. Adds explicit backendRoots, then sibling dirs of the
 * project parent that look like backend/java repos (heuristic).
 */
export async function resolveLinkGraphSearchRoots(
  projectPath: string,
  backendRoots?: string[]
): Promise<string[]> {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const abs = path.resolve(expandHome(raw.trim()));
    const key = abs.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(abs);
  };

  add(projectPath);

  for (const extra of backendRoots || []) {
    if (extra?.trim()) add(extra);
  }

  // Sibling auto-detect: parent/demo-tms when project is parent/web-app
  const parent = path.dirname(path.resolve(projectPath));
  const projectBase = path.basename(path.resolve(projectPath)).toLowerCase();
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (name.startsWith(".")) continue;
      const full = path.join(parent, name);
      const lower = name.toLowerCase();
      // skip self
      if (path.resolve(full) === path.resolve(projectPath)) continue;
      // Prefer java/backend-ish siblings when FE project name ends with -web / -frontend / -ui
      const feHint = /(-web|-frontend|-ui|-client|-h5|-admin-web)$/i.test(projectBase);
      const beHint =
        /(-server|-service|-backend|-be|-api|-tms|-boot|-svc)$/i.test(lower)
        || lower.includes("server")
        || lower.includes("backend");
      if (feHint && beHint) {
        // Confirm looks like a code root
        const markers = ["src/main/java", "pom.xml", "build.gradle", "build.gradle.kts", "src"];
        let ok = false;
        for (const m of markers) {
          if (await isDir(path.join(full, m)) || await fileExists(path.join(full, m))) {
            ok = true;
            break;
          }
        }
        if (ok) add(full);
      }
    }
  } catch {
    /* ignore parent scan */
  }

  return roots;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Prefer displaying path relative to the closest root. */
export function relativeToAnyRoot(roots: string[], absolute: string): string {
  const abs = path.resolve(absolute);
  let best = abs;
  let bestLen = 0;
  for (const root of roots) {
    const r = path.resolve(root);
    if (abs === r || abs.startsWith(r + path.sep)) {
      if (r.length > bestLen) {
        bestLen = r.length;
        best = path.relative(r, abs).split(path.sep).join("/");
      }
    }
  }
  return best;
}
