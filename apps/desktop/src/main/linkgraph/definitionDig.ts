/**
 * Flow 1: dig definition chain via references + import resolution until VO/DTO.
 * Also follows type annotations when the symbol is a field/value with a type name.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  findBindingForSymbol,
  parseImportsForFile,
  pathKey,
  resolveModuleSpecifier,
  type ImportBinding
} from "./importResolve";
import { escapeRegExp, isStopwordSymbol } from "./nameFamily";
import type {
  LinkGraphChainStep,
  LinkGraphConfidence,
  LinkGraphEdgeKind,
  LinkGraphHopRole,
  LinkGraphNodeKind,
  LinkGraphOpenEnd,
  LinkGraphPageRef
} from "../../shared/linkGraphTypes";

export type DigOptions = {
  root: string;
  startAbsolutePath: string;
  startRelativePath: string;
  symbol: string;
  prunePathKeys?: Set<string>;
  maxHops?: number;
  signal?: AbortSignal;
  branchId?: string;
};

export type DigResult = {
  steps: LinkGraphChainStep[];
  pruned: boolean;
  pruneReason?: string;
  openEnds: LinkGraphOpenEnd[];
  pathKeys: Set<string>;
  importPathKeys: Set<string>;
  reachedTerminal: boolean;
  filesRead: number;
};

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function stepId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

function looksLikeVoPath(relativePath: string): boolean {
  return /(^|\/)(types?|models?|entities|dto|vo|domain|bean)s?(\/|$)/i.test(relativePath)
    || /\b(vo|dto|entity|model|type)s?\.[a-z]+$/i.test(relativePath);
}

function looksLikeApiPath(relativePath: string): boolean {
  return /(^|\/)(api|apis|services?|request)s?(\/|$)/i.test(relativePath);
}

export function findLocalDefinition(
  source: string,
  symbol: string
): { line: number; preview: string; kind: "definition" | "reexport" | "field" } | null {
  const lines = source.split(/\r?\n/);
  const escaped = escapeRegExp(symbol);

  const patterns: Array<{ re: RegExp; kind: "definition" | "reexport" | "field" }> = [
    { re: new RegExp(`export\\s+(?:type\\s+)?\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from`), kind: "reexport" },
    { re: new RegExp(`\\b(?:export\\s+)?(?:interface|type|class|enum)\\s+${escaped}\\b`), kind: "definition" },
    { re: new RegExp(`(?:^|[\\s{,;])${escaped}\\s*\\??\\s*:`), kind: "field" },
    { re: new RegExp(`\\b(?:export\\s+)?(?:const|let|var|function|async\\s+function)\\s+${escaped}\\b`), kind: "definition" },
    { re: new RegExp(`\\b(?:private|public|protected|static|final)?\\s*[\\w.<>,\\s]+\\s+${escaped}\\s*[;=]`), kind: "field" },
    { re: new RegExp(`\\b(?:class|interface|enum|record)\\s+${escaped}\\b`), kind: "definition" }
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const preview = lines[i];
    for (const { re, kind } of patterns) {
      if (re.test(preview)) {
        return { line: i + 1, preview: preview.trim().slice(0, 200), kind };
      }
    }
  }
  return null;
}

/** Extract a type name used with symbol (annotation / generic / assignment). */
export function extractTypeHintForSymbol(source: string, symbol: string): string | null {
  const escaped = escapeRegExp(symbol);
  const patterns = [
    // symbol: Type or symbol?: Type
    new RegExp(`\\b${escaped}\\s*\\??\\s*:\\s*(?:readonly\\s+)?([A-Z][\\w$]*)`),
    // const symbol = ... as Type
    new RegExp(`\\b${escaped}\\b[^=]*=[^;]*\\bas\\s+([A-Z][\\w$]*)`),
    // useState<Type>( / ref<Type>(
    new RegExp(`\\b(?:useState|ref|shallowRef|computed|inject)\\s*<\\s*([A-Z][\\w$]*)`),
    // private Type symbol / Type symbol =
    new RegExp(`\\b([A-Z][\\w$]*)(?:<[^>]+>)?\\s+${escaped}\\s*[;=]`),
    // symbol: Array<Type> / Promise<Type>
    new RegExp(`\\b${escaped}\\s*\\??\\s*:\\s*(?:Array|Promise|Observable|Ref|MaybeRef)\\s*<\\s*([A-Z][\\w$]*)`)
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (m?.[1] && m[1] !== symbol) return m[1];
  }
  return null;
}

export function findSymbolRefsInFile(
  source: string,
  symbol: string
): Array<{ line: number; column: number; endColumn: number; preview: string }> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ line: number; column: number; endColumn: number; preview: string }> = [];
  let re: RegExp;
  try {
    re = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "g");
  } catch {
    return out;
  }
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      out.push({
        line: i + 1,
        column: m.index + 1,
        endColumn: m.index + m[0].length + 1,
        preview: lineText.trim().slice(0, 200)
      });
      if (out.length >= 80) return out;
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return out;
}

function isTerminalVo(
  relativePath: string,
  defKind: "definition" | "reexport" | "field",
  preview: string
): boolean {
  if (defKind === "reexport") return false;
  if (defKind === "field" && looksLikeVoPath(relativePath)) return true;
  if (defKind === "definition" && looksLikeVoPath(relativePath)) return true;
  if (/\b(VO|DTO|Entity|Model)\b/.test(preview)) return true;
  return false;
}

function nodeKindFor(
  relativePath: string,
  edgeKind: LinkGraphEdgeKind,
  terminal: boolean
): LinkGraphNodeKind {
  if (edgeKind === "bridge") return "bridge";
  if (terminal) return "vo_field";
  if (edgeKind === "imports" || edgeKind === "reexports") return "import";
  if (edgeKind === "defines") return looksLikeApiPath(relativePath) ? "api_client" : "definition";
  if (edgeKind === "refers") return "reference";
  return "unknown";
}

function roleFor(edgeKind: LinkGraphEdgeKind, terminal: boolean): LinkGraphHopRole {
  if (edgeKind === "bridge") return "bridge";
  if (edgeKind === "imports" || edgeKind === "reexports") return "import";
  if (terminal || edgeKind === "defines") return "definition";
  if (edgeKind === "refers") return "reference";
  return "other";
}

function makeStep(args: {
  id: string;
  edgeKind: LinkGraphEdgeKind;
  relativePath: string;
  absolutePath: string;
  line: number;
  column?: number;
  endColumn?: number;
  symbol: string;
  preview: string;
  title: string;
  narrative: string;
  confidence?: LinkGraphConfidence;
  terminal?: boolean;
  importSpecifier?: string;
  pageRefs?: LinkGraphPageRef[];
}): LinkGraphChainStep {
  const terminal = Boolean(args.terminal);
  return {
    id: args.id,
    edgeKind: args.edgeKind,
    nodeKind: nodeKindFor(args.relativePath, args.edgeKind, terminal),
    role: roleFor(args.edgeKind, terminal),
    title: args.title,
    narrative: args.narrative,
    file: args.relativePath,
    path: args.absolutePath,
    line: args.line,
    column: args.column,
    endColumn: args.endColumn,
    symbol: args.symbol,
    preview: args.preview,
    confidence: args.confidence || "medium",
    terminal,
    importSpecifier: args.importSpecifier,
    pageRefs: args.pageRefs
  };
}

async function followResolved(
  options: DigOptions,
  abs: string,
  binding: ImportBinding,
  prune: Set<string>
): Promise<{ abs: string; rel: string; symbol: string; rkey: string } | "prune" | null> {
  const resolved = await resolveModuleSpecifier(options.root, abs, binding.specifier);
  if (!resolved) return null;
  const rkey = pathKey(options.root, resolved.absolutePath);
  if (prune.has(rkey)) return "prune";
  const nextSymbol =
    binding.importedName !== "default" && binding.importedName !== "*"
      ? binding.importedName
      : options.symbol;
  return {
    abs: resolved.absolutePath,
    rel: resolved.relativePath,
    symbol: nextSymbol === options.symbol ? binding.importedName === "default" ? options.symbol : nextSymbol : nextSymbol,
    rkey
  };
}

export async function digDefinitionChain(options: DigOptions): Promise<DigResult> {
  const maxHops = options.maxHops ?? 12;
  const prune = options.prunePathKeys || new Set<string>();
  const steps: LinkGraphChainStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  const importPathKeys = new Set<string>();
  let filesRead = 0;
  let symbol = options.symbol;
  let abs = options.startAbsolutePath;
  let rel = options.startRelativePath;
  const visitedFiles = new Set<string>();
  const idPrefix = options.branchId || "p";
  let stepN = 0;

  if (isStopwordSymbol(symbol) && symbol.length <= 2) {
    openEnds.push({ symbol, file: rel, reason: "symbol_too_generic" });
  }

  for (let hop = 0; hop < maxHops; hop += 1) {
    if (options.signal?.aborted) break;
    const fk = pathKey(options.root, abs);
    if (visitedFiles.has(fk)) break;
    visitedFiles.add(fk);
    pathKeys.add(fk);

    if (prune.has(fk) && hop > 0) {
      return {
        steps,
        pruned: true,
        pruneReason: "import_path_on_primary",
        openEnds,
        pathKeys,
        importPathKeys,
        reachedTerminal: false,
        filesRead
      };
    }

    let source: string;
    try {
      source = await fs.readFile(abs, "utf8");
      filesRead += 1;
    } catch {
      openEnds.push({ symbol, file: rel, reason: "file_unreadable" });
      break;
    }

    const refs = findSymbolRefsInFile(source, symbol);
    if (hop === 0 && refs.length) {
      const seedRef = refs[0];
      const pageRefs: LinkGraphPageRef[] = refs.slice(1, 40).map((r) => ({
        line: r.line,
        column: r.column,
        endColumn: r.endColumn,
        preview: r.preview
      }));
      steps.push(
        makeStep({
          id: stepId(idPrefix, ++stepN),
          edgeKind: "refers",
          relativePath: rel,
          absolutePath: abs,
          line: seedRef.line,
          column: seedRef.column,
          endColumn: seedRef.endColumn,
          symbol,
          preview: seedRef.preview,
          title: pageRefs.length
            ? `Reference ${symbol} (+${pageRefs.length} more in file)`
            : `Reference ${symbol}`,
          narrative: seedRef.preview,
          confidence: "high",
          pageRefs: pageRefs.length ? pageRefs : undefined
        })
      );
    }

    const def = findLocalDefinition(source, symbol);
    const bindings = parseImportsForFile(source, abs);

    if (def && def.kind !== "reexport") {
      const terminal = isTerminalVo(rel, def.kind, def.preview);
      steps.push(
        makeStep({
          id: stepId(idPrefix, ++stepN),
          edgeKind: "defines",
          relativePath: rel,
          absolutePath: abs,
          line: def.line,
          symbol,
          preview: def.preview,
          title: terminal ? `VO/DTO ${symbol}` : `Define ${symbol}`,
          narrative: def.preview,
          confidence: terminal ? "high" : "medium",
          terminal
        })
      );
      if (terminal) {
        return {
          steps,
          pruned: false,
          openEnds,
          pathKeys,
          importPathKeys,
          reachedTerminal: true,
          filesRead
        };
      }
    }

    if (def?.kind === "reexport") {
      const binding =
        findBindingForSymbol(bindings, symbol)
        || bindings.find((b) => b.isReexport && (b.localName === symbol || b.importedName === symbol));
      if (binding) {
        steps.push(
          makeStep({
            id: stepId(idPrefix, ++stepN),
            edgeKind: "reexports",
            relativePath: rel,
            absolutePath: abs,
            line: binding.line,
            symbol,
            preview: def.preview,
            title: `Re-export ${symbol}`,
            narrative: binding.specifier,
            importSpecifier: binding.specifier,
            confidence: "high"
          })
        );
        const next = await followResolved(options, abs, binding, prune);
        if (next === "prune") {
          return {
            steps,
            pruned: true,
            pruneReason: "import_path_on_primary",
            openEnds,
            pathKeys,
            importPathKeys,
            reachedTerminal: false,
            filesRead
          };
        }
        if (!next) {
          openEnds.push({ symbol, file: rel, line: binding.line, reason: "unresolved_import" });
          break;
        }
        importPathKeys.add(next.rkey);
        abs = next.abs;
        rel = next.rel;
        if (binding.importedName !== "default" && binding.importedName !== "*") {
          symbol = binding.importedName;
        }
        continue;
      }
    }

    // Import binding for symbol
    const binding: ImportBinding | undefined = findBindingForSymbol(bindings, symbol);
    if (binding) {
      steps.push(
        makeStep({
          id: stepId(idPrefix, ++stepN),
          edgeKind: "imports",
          relativePath: rel,
          absolutePath: abs,
          line: binding.line,
          symbol,
          preview: `import ${symbol} from '${binding.specifier}'`,
          title: `Import ${symbol}`,
          narrative: binding.specifier,
          importSpecifier: binding.specifier,
          confidence: "high"
        })
      );
      const next = await followResolved(options, abs, binding, prune);
      if (next === "prune") {
        return {
          steps,
          pruned: true,
          pruneReason: "import_path_on_primary",
          openEnds,
          pathKeys,
          importPathKeys,
          reachedTerminal: false,
          filesRead
        };
      }
      if (!next) {
        openEnds.push({ symbol, file: rel, line: binding.line, reason: "unresolved_import" });
        break;
      }
      importPathKeys.add(next.rkey);
      abs = next.abs;
      rel = next.rel;
      if (binding.importedName !== "default" && binding.importedName !== "*") {
        symbol = binding.importedName;
      }
      continue;
    }

    // Type annotation follow: field A: UserVO → dig UserVO
    const typeHint = extractTypeHintForSymbol(source, symbol);
    if (typeHint && !isStopwordSymbol(typeHint)) {
      const typeBinding = findBindingForSymbol(bindings, typeHint);
      if (typeBinding) {
        steps.push(
          makeStep({
            id: stepId(idPrefix, ++stepN),
            edgeKind: "imports",
            relativePath: rel,
            absolutePath: abs,
            line: typeBinding.line,
            symbol: typeHint,
            preview: `type ${symbol} → ${typeHint}`,
            title: `Type ${typeHint}`,
            narrative: typeBinding.specifier,
            importSpecifier: typeBinding.specifier,
            confidence: "medium"
          })
        );
        const next = await followResolved(
          { ...options, symbol: typeHint },
          abs,
          typeBinding,
          prune
        );
        if (next === "prune") {
          return {
            steps,
            pruned: true,
            pruneReason: "import_path_on_primary",
            openEnds,
            pathKeys,
            importPathKeys,
            reachedTerminal: false,
            filesRead
          };
        }
        if (next) {
          importPathKeys.add(next.rkey);
          abs = next.abs;
          rel = next.rel;
          symbol = typeHint;
          continue;
        }
      } else {
        // Type defined in same file
        const localType = findLocalDefinition(source, typeHint);
        if (localType) {
          const terminal = isTerminalVo(rel, localType.kind, localType.preview);
          steps.push(
            makeStep({
              id: stepId(idPrefix, ++stepN),
              edgeKind: "defines",
              relativePath: rel,
              absolutePath: abs,
              line: localType.line,
              symbol: typeHint,
              preview: localType.preview,
              title: terminal ? `VO/DTO ${typeHint}` : `Type ${typeHint}`,
              narrative: localType.preview,
              confidence: "medium",
              terminal
            })
          );
          if (terminal) {
            return {
              steps,
              pruned: false,
              openEnds,
              pathKeys,
              importPathKeys,
              reachedTerminal: true,
              filesRead
            };
          }
          symbol = typeHint;
          // stay in file for another hop if needed
          continue;
        }
      }
    }

    if (def) {
      openEnds.push({ symbol, file: rel, line: def.line, reason: "definition_not_vo" });
    } else if (refs.length) {
      openEnds.push({ symbol, file: rel, line: refs[0].line, reason: "no_local_definition_or_import" });
    } else {
      openEnds.push({ symbol, file: rel, reason: "symbol_not_found_in_file" });
    }
    break;
  }

  return {
    steps,
    pruned: false,
    openEnds,
    pathKeys,
    importPathKeys,
    reachedTerminal: steps.some((s) => s.terminal),
    filesRead
  };
}

// silence unused in some builds
void toPosixRel;
