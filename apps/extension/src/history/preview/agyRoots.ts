import * as path from "node:path";

export function candidateAgyRoots(antigravityHome: string): string[] {
  const normalized = path.resolve(antigravityHome);
  const parent = path.dirname(normalized);
  const base = path.basename(normalized);
  const roots = [normalized, path.join(normalized, "antigravity-cli"), path.join(normalized, "antigravity")];

  if (base === "antigravity-cli" || base === "antigravity") {
    roots.push(path.join(parent, "antigravity-cli"), path.join(parent, "antigravity"));
  }

  return [...new Set(roots)];
}