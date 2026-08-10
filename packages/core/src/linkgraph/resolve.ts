/**
 * Module path resolution for FE aliases (@/) in monorepos.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".json"];

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveWithExt(base: string): Promise<string | null> {
  if (await isFile(base)) return base;
  for (const ext of EXTS) {
    const p = base.endsWith(ext) ? base : base + ext;
    if (await isFile(p)) return p;
  }
  if (await isDir(base)) {
    for (const ext of EXTS) {
      const idx = path.join(base, "index" + ext);
      if (await isFile(idx)) return idx;
    }
  }
  return null;
}

export async function findNearestPackageRoot(fromFile: string, workspaceRoot?: string): Promise<string> {
  let dir = path.dirname(path.resolve(fromFile));
  const stop = workspaceRoot ? path.resolve(workspaceRoot) : null;
  for (let i = 0; i < 16; i += 1) {
    if (await isFile(path.join(dir, "package.json"))) return dir;
    if ((await isDir(path.join(dir, "src"))) && (await isFile(path.join(dir, "tsconfig.json")))) {
      return dir;
    }
    if (stop && dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(path.resolve(fromFile));
}

export async function resolveModuleSpecifier(
  workspaceRoot: string,
  fromAbsoluteFile: string,
  specifier: string
): Promise<{ absolutePath: string; relativePath: string } | null> {
  const root = path.resolve(workspaceRoot);
  const fromAbs = path.resolve(fromAbsoluteFile);

  if (specifier.startsWith(".")) {
    const base = path.resolve(path.dirname(fromAbs), specifier);
    const hit = await resolveWithExt(base);
    if (!hit) return null;
    return {
      absolutePath: hit,
      relativePath: path.relative(root, hit).split(path.sep).join("/")
    };
  }

  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    const rest = specifier.replace(/^[@~]\//, "");
    const pkgRoot = await findNearestPackageRoot(fromAbs, root);
    const tryBases = [
      path.join(pkgRoot, "src", rest),
      path.join(pkgRoot, "app", rest),
      path.join(pkgRoot, rest),
      path.join(root, "src", rest),
      path.join(root, rest)
    ];
    try {
      const kids = await fs.readdir(root, { withFileTypes: true });
      for (const ent of kids) {
        if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
        tryBases.push(path.join(root, ent.name, "src", rest), path.join(root, ent.name, rest));
      }
    } catch {
      /* ignore */
    }
    for (const base of tryBases) {
      const hit = await resolveWithExt(base);
      if (!hit) continue;
      if (hit !== root && !hit.startsWith(root + path.sep) && !hit.startsWith(pkgRoot + path.sep)) {
        continue;
      }
      return {
        absolutePath: hit,
        relativePath: path.relative(root, hit).split(path.sep).join("/")
      };
    }
  }

  return null;
}

export function toPosixRel(root: string, abs: string): string {
  return path.relative(path.resolve(root), path.resolve(abs)).split(path.sep).join("/");
}

export async function resolveSearchRoots(
  workspaceRoot: string,
  backendRoots?: string[]
): Promise<string[]> {
  const root = path.resolve(workspaceRoot);
  const out: string[] = [root];
  const seen = new Set([root.toLowerCase()]);
  const add = (p: string) => {
    const abs = path.resolve(p);
    const k = abs.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(abs);
  };
  for (const b of backendRoots || []) {
    if (b?.trim()) add(b);
  }
  try {
    const kids = await fs.readdir(root, { withFileTypes: true });
    const base = path.basename(root).toLowerCase();
    const feHint = /(-web|-frontend|-ui|-client)$/i.test(base);
    for (const ent of kids) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const lower = ent.name.toLowerCase();
      const beHint =
        /(-server|-service|-backend|-be|-api|-tms|-boot)$/i.test(lower)
        || lower.includes("server")
        || lower.includes("backend");
      if (feHint && beHint) {
        const full = path.join(root, ent.name);
        if (
          (await isDir(path.join(full, "src/main/java")))
          || (await isFile(path.join(full, "pom.xml")))
          || (await isDir(path.join(full, "src")))
        ) {
          add(full);
        }
      }
    }
    // If workspace is monorepo parent, include all first-level code dirs
    if (!(await isFile(path.join(root, "package.json")))) {
      for (const ent of kids) {
        if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
        const full = path.join(root, ent.name);
        if ((await isFile(path.join(full, "package.json"))) || (await isDir(path.join(full, "src")))) {
          add(full);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}
