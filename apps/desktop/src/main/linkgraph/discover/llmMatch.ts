/**
 * LLM-driven endpoint confirm + backend dig (Chat-style), tool-verified.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  chatCompletion,
  llmConfigFromSettings,
  loadSettings
} from "@agent-resume/core";
import {
  collectEndpointCandidates,
  formatCandidatesForLlm,
  pickDecisiveEndpoint,
  type EndpointCandidate
} from "../endpointMatch";
import { findFieldInDtoScope, normalizeRoutePath, routesCompatible } from "../httpBridge";
import {
  findBindingForSymbol,
  parseImportsForFile,
  pathKey,
  resolveModuleSpecifier
} from "../importResolve";
import { relativeToAnyRoot } from "../searchRoots";
import { searchWorkbenchText } from "../../workbenchSearch";
import type {
  LinkGraphBridgeStatus,
  LinkGraphChainStep,
  LinkGraphOpenEnd
} from "../../../shared/linkGraphTypes";

type MatchKind =
  | "confirm_endpoint"
  | "follow_call"
  | "resolve_type"
  | "attach_field"
  | "stop";

type MatchHypothesis = {
  kind: MatchKind;
  reason: string;
  confidence: "high" | "medium" | "low";
  args: {
    candidateId?: string;
    pathHint?: string;
    query?: string;
    symbol?: string;
    typeName?: string;
    method?: string;
    field?: string;
    fromFile?: string;
  };
};

export type MatchLoopResult = {
  steps: LinkGraphChainStep[];
  openEnds: LinkGraphOpenEnd[];
  pathKeys: Set<string>;
  bridgeStatus: LinkGraphBridgeStatus;
  llmStatus: "skipped" | "ok" | "unconfigured" | "failed";
  llmError?: string;
};

function parseHypotheses(raw: string): MatchHypothesis[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  const bodies: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) bodies.push(fence[1].trim());
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) bodies.push(brace[0]);
  for (const body of bodies) {
    try {
      const parsed = JSON.parse(body.replace(/,\s*([}\]])/g, "$1")) as { hypotheses?: unknown };
      if (!Array.isArray(parsed.hypotheses)) continue;
      const out: MatchHypothesis[] = [];
      for (const h of parsed.hypotheses) {
        if (!h || typeof h !== "object") continue;
        const r = h as Record<string, unknown>;
        const kind = r.kind as MatchKind;
        if (
          kind !== "confirm_endpoint"
          && kind !== "follow_call"
          && kind !== "resolve_type"
          && kind !== "attach_field"
          && kind !== "stop"
        ) {
          continue;
        }
        const args = (r.args && typeof r.args === "object" ? r.args : {}) as Record<string, unknown>;
        out.push({
          kind,
          reason: typeof r.reason === "string" ? r.reason.slice(0, 300) : "",
          confidence: r.confidence === "high" || r.confidence === "low" ? r.confidence : "medium",
          args: {
            candidateId: typeof args.candidateId === "string" ? args.candidateId : undefined,
            pathHint: typeof args.pathHint === "string" ? args.pathHint : undefined,
            query: typeof args.query === "string" ? args.query : undefined,
            symbol: typeof args.symbol === "string" ? args.symbol : undefined,
            typeName: typeof args.typeName === "string" ? args.typeName : undefined,
            method: typeof args.method === "string" ? args.method : undefined,
            field: typeof args.field === "string" ? args.field : undefined,
            fromFile: typeof args.fromFile === "string" ? args.fromFile : undefined
          }
        });
      }
      if (out.length) return out.slice(0, 4);
    } catch {
      /* next */
    }
  }
  return [];
}

async function proposeMatch(args: {
  seedSymbol: string;
  fePath: string;
  candidatesText: string;
  chainSummary: string;
  failed: string[];
  systemLocale?: string;
  signal?: AbortSignal;
}): Promise<{ hypotheses: MatchHypothesis[]; status: MatchLoopResult["llmStatus"]; error?: string }> {
  if (args.signal?.aborted) return { hypotheses: [], status: "skipped" };
  const settings = await loadSettings();
  const llm = llmConfigFromSettings(settings, args.systemLocale);
  if (!llm) return { hypotheses: [], status: "unconfigured" };

  const system = [
    "You are a senior engineer mapping an HTTP API to backend handlers and request DTOs.",
    "Use ONLY candidate snippets and chain facts provided. Never invent file paths not listed.",
    "Respond with ONE JSON object only.",
    'Shape: {"hypotheses":[{"kind":"confirm_endpoint|follow_call|resolve_type|attach_field|stop","reason":"...","confidence":"high|medium|low","args":{"candidateId":"c1","typeName":"InvoiceDetailQueryVo","symbol":"invoiceService","method":"pageQuery","field":"meteringOrgId"}}]}',
    "confirm_endpoint: pick the real server handler for the FE URL (NOT frontend $post/api client files).",
    "resolve_type: open request body / param type (e.g. InvoiceDetailQueryVo).",
    "attach_field: locate seed field on that type.",
    "follow_call: follow service/repository call inside the handler body.",
    "Prefer candidateId from the list. Max 3 hypotheses per turn."
  ].join("\n");

  const user = [
    `Seed field: ${args.seedSymbol}`,
    `FE URL: ${args.fePath}`,
    "",
    "Current chain:",
    args.chainSummary.slice(0, 1200) || "(empty)",
    "",
    "Endpoint candidates (choose among these):",
    args.candidatesText.slice(0, 12000) || "(none)",
    "",
    "Failed actions:",
    args.failed.join(", ") || "(none)",
    "",
    "Return JSON now."
  ].join("\n");

  try {
    const content = await chatCompletion(
      llm,
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      1000
    );
    const hypotheses = parseHypotheses(content);
    if (!hypotheses.length) return { hypotheses: [], status: "failed", error: "empty hypotheses" };
    return { hypotheses, status: "ok" };
  } catch (error) {
    return {
      hypotheses: [],
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function findCandidate(
  candidates: EndpointCandidate[],
  h: MatchHypothesis
): EndpointCandidate | undefined {
  if (h.args.candidateId) {
    const byId = candidates.find((c) => c.id === h.args.candidateId);
    if (byId) return byId;
  }
  const hint = (h.args.pathHint || h.args.query || "").toLowerCase();
  if (!hint) return candidates[0];
  return (
    candidates.find((c) => c.relativePath.toLowerCase().includes(hint) || c.preview.toLowerCase().includes(hint))
    || candidates[0]
  );
}

async function searchTypeFile(
  roots: string[],
  typeName: string,
  signal?: AbortSignal
): Promise<{ absolutePath: string; relativePath: string; line: number; preview: string } | null> {
  for (const root of roots) {
    const result = await searchWorkbenchText({
      rootPath: root,
      query: typeName,
      matchCase: true,
      wholeWord: true,
      useRegex: false,
      maxResults: 40,
      timeBudgetMs: 4_000,
      signal
    });
    for (const m of result.matches) {
      const preview = m.preview || "";
      if (
        new RegExp(`\\b(class|interface|type|record|struct)\\s+${typeName}\\b`).test(preview)
        || new RegExp(`\\bexport\\s+(?:interface|type|class)\\s+${typeName}\\b`).test(preview)
      ) {
        return {
          absolutePath: m.path,
          relativePath: relativeToAnyRoot(roots, m.path) || m.relativePath,
          line: m.line,
          preview: preview.slice(0, 200)
        };
      }
    }
  }
  return null;
}

/**
 * After FE URL is known: rule-pick or LLM-confirm backend endpoint, then dig types/calls.
 */
export async function runEndpointMatchLoop(args: {
  roots: string[];
  projectRoot: string;
  fePath: string;
  seedSymbol: string;
  chainSummary: string;
  prunePathKeys: Set<string>;
  skipLlm?: boolean;
  systemLocale?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  onProgress?: (msg: string) => void;
}): Promise<MatchLoopResult> {
  const steps: LinkGraphChainStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  let bridgeStatus: LinkGraphBridgeStatus = "failed";
  let llmStatus: MatchLoopResult["llmStatus"] = "skipped";
  let llmError: string | undefined;

  args.onProgress?.("Collecting endpoint candidates…");
  const candidates = await collectEndpointCandidates({
    roots: args.roots,
    fePath: args.fePath,
    signal: args.signal
  });

  if (!candidates.length) {
    openEnds.push({ symbol: args.seedSymbol, reason: "no_be_endpoint_candidate", file: args.fePath });
    return { steps, openEnds, pathKeys, bridgeStatus: "failed", llmStatus: "skipped" };
  }

  let confirmed: EndpointCandidate | null = pickDecisiveEndpoint(candidates, args.fePath);
  let focusAbs: string | null = confirmed?.absolutePath || null;
  let focusRoot = confirmed?.root || args.projectRoot;

  // Rule-confirm decisive endpoint without LLM
  if (confirmed) {
    steps.push({
      id: "match_endpoint_rule",
      edgeKind: "bridge",
      nodeKind: "be_controller",
      role: "bridge",
      title: `Handler ${path.basename(confirmed.relativePath)}`,
      narrative: confirmed.combinedPath
        ? `${args.fePath} ↔ ${confirmed.combinedPath}`
        : `matched ${confirmed.relativePath}:${confirmed.line}`,
      file: confirmed.relativePath,
      path: confirmed.absolutePath,
      line: confirmed.line,
      symbol: args.seedSymbol,
      preview: confirmed.preview,
      confidence: "high",
      bridgeKind: "http_route"
    });
    pathKeys.add(pathKey(confirmed.root, confirmed.absolutePath));
    bridgeStatus = "partial";
  }

  const failed: string[] = [];
  const maxRounds = args.skipLlm && confirmed ? 0 : 5;

  for (let round = 0; round < maxRounds; round += 1) {
    if (args.signal?.aborted) break;
    if (args.deadlineMs && Date.now() >= args.deadlineMs) break;

    args.onProgress?.(`LLM endpoint match round ${round + 1}…`);
    const proposed = await proposeMatch({
      seedSymbol: args.seedSymbol,
      fePath: args.fePath,
      candidatesText: formatCandidatesForLlm(candidates),
      chainSummary: args.chainSummary + "\n" + steps.map((s) => `${s.file}:${s.line} ${s.title}`).join("\n"),
      failed,
      systemLocale: args.systemLocale,
      signal: args.signal
    });
    llmStatus = proposed.status === "ok" ? "ok" : proposed.status;
    if (proposed.error) llmError = proposed.error;
    if (proposed.status !== "ok" || !proposed.hypotheses.length) break;

    let stop = false;
    for (const h of proposed.hypotheses) {
      const key = `${h.kind}:${JSON.stringify(h.args)}`;
      if (failed.includes(key)) continue;

      if (h.kind === "stop") {
        stop = true;
        break;
      }

      if (h.kind === "confirm_endpoint") {
        const cand = findCandidate(candidates, h);
        if (!cand) {
          failed.push(key);
          continue;
        }
        // Verify route compatibility when possible
        if (cand.combinedPath && !routesCompatible(normalizeRoutePath(args.fePath), cand.combinedPath)) {
          // still allow high-score controller with resource name
          if (cand.score < 50) {
            failed.push(key);
            continue;
          }
        }
        if (!steps.some((s) => s.path === cand.absolutePath && s.edgeKind === "bridge")) {
          steps.push({
            id: `match_ep_${cand.id}`,
            edgeKind: "bridge",
            nodeKind: "be_controller",
            role: "bridge",
            title: `Handler ${path.basename(cand.relativePath)}`,
            narrative: h.reason || cand.combinedPath || args.fePath,
            file: cand.relativePath,
            path: cand.absolutePath,
            line: cand.line,
            symbol: args.seedSymbol,
            preview: cand.preview,
            confidence: h.confidence,
            bridgeKind: "llm_discover"
          });
          pathKeys.add(pathKey(cand.root, cand.absolutePath));
        }
        confirmed = cand;
        focusAbs = cand.absolutePath;
        focusRoot = cand.root;
        bridgeStatus = "partial";
        continue;
      }

      if (h.kind === "resolve_type" || h.kind === "attach_field") {
        const typeName = h.args.typeName;
        const field = h.args.field || args.seedSymbol;
        if (!typeName && h.kind === "resolve_type") {
          failed.push(key);
          continue;
        }

        // Prefer type from handler signature if typeName omitted on attach
        let typeFile = typeName
          ? await searchTypeFile(args.roots, typeName, args.signal)
          : null;

        // Also try reading focus file for @RequestBody Type
        if (!typeFile && focusAbs) {
          try {
            const text = await fs.readFile(focusAbs, "utf8");
            const bodyType =
              text.match(/@RequestBody\s+(?:\w+\s+)?(\w+)\s+\w+/)
              || text.match(/\((\w+)\s+\w+\s*\)\s*\{/)
              || text.match(/:\s*(\w+(?:Dto|VO|Vo|Request|Body|Query))\b/);
            const inferred = typeName || bodyType?.[1];
            if (inferred) {
              typeFile = await searchTypeFile(args.roots, inferred, args.signal);
            }
            // Java import resolve
            if (!typeFile && inferred) {
              const bindings = parseImportsForFile(text, focusAbs);
              const b = findBindingForSymbol(bindings, inferred);
              if (b) {
                const resolved = await resolveModuleSpecifier(focusRoot, focusAbs, b.specifier);
                if (resolved) {
                  typeFile = {
                    absolutePath: resolved.absolutePath,
                    relativePath: relativeToAnyRoot(args.roots, resolved.absolutePath),
                    line: 1,
                    preview: inferred
                  };
                }
              }
              // Spring: com.foo.Bar → src/main/java/com/foo/Bar.java
              if (!typeFile) {
                const imp = text.match(new RegExp(`import\\s+([\\w.]+\\.${inferred})\\s*;`));
                if (imp) {
                  const relJava = imp[1].replace(/\./g, "/") + ".java";
                  for (const root of args.roots) {
                    const tryPath = path.join(root, "src/main/java", relJava);
                    try {
                      await fs.access(tryPath);
                      typeFile = {
                        absolutePath: tryPath,
                        relativePath: relativeToAnyRoot(args.roots, tryPath),
                        line: 1,
                        preview: inferred
                      };
                      break;
                    } catch {
                      /* next */
                    }
                  }
                }
              }
            }
          } catch {
            /* ignore */
          }
        }

        if (!typeFile) {
          failed.push(key);
          openEnds.push({ symbol: typeName || field, reason: "type_not_found" });
          continue;
        }

        if (h.kind === "resolve_type" || !steps.some((s) => s.path === typeFile!.absolutePath)) {
          steps.push({
            id: `match_type_${typeFile.relativePath}`,
            edgeKind: "defines",
            nodeKind: "definition",
            role: "definition",
            title: `Type ${typeName || path.basename(typeFile.relativePath)}`,
            narrative: h.reason || typeFile.preview,
            file: typeFile.relativePath,
            path: typeFile.absolutePath,
            line: typeFile.line,
            symbol: typeName || args.seedSymbol,
            preview: typeFile.preview,
            confidence: "high",
            bridgeKind: "llm_discover"
          });
          pathKeys.add(pathKey(args.projectRoot, typeFile.absolutePath));
        }

        try {
          const voText = await fs.readFile(typeFile.absolutePath, "utf8");
          const fieldHit = findFieldInDtoScope(voText, field);
          if (fieldHit) {
            steps.push({
              id: `match_field_${fieldHit.line}`,
              edgeKind: "defines",
              nodeKind: "vo_field",
              role: "definition",
              title: fieldHit.className ? `${fieldHit.className}.${fieldHit.matched}` : fieldHit.matched,
              narrative: fieldHit.preview,
              file: typeFile.relativePath,
              path: typeFile.absolutePath,
              line: fieldHit.line,
              symbol: fieldHit.matched,
              preview: fieldHit.preview,
              confidence: "high",
              terminal: true,
              bridgeKind: "name_family"
            });
            bridgeStatus = "ok";
          } else if (h.kind === "attach_field") {
            openEnds.push({
              symbol: field,
              file: typeFile.relativePath,
              reason: "field_not_on_type"
            });
            failed.push(key);
          }
        } catch {
          failed.push(key);
        }
        focusAbs = typeFile.absolutePath;
        continue;
      }

      if (h.kind === "follow_call") {
        const method = h.args.method || "pageQuery";
        const symbol = h.args.symbol;
        const from = focusAbs;
        if (!from || !symbol) {
          failed.push(key);
          continue;
        }
        try {
          const text = await fs.readFile(from, "utf8");
          const callRe = new RegExp(
            `\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\.\\s*${method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`
          );
          if (!callRe.test(text)) {
            // try any .method(
            const any = text.match(
              new RegExp(`(\\w+)\\s*\\.\\s*${method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`)
            );
            if (!any) {
              failed.push(key);
              continue;
            }
          }
          // Resolve field type: private InvoiceService invoiceService
          const fieldDecl =
            text.match(new RegExp(`(\\w+)\\s+${symbol}\\s*;`))
            || text.match(new RegExp(`@Autowired[\\s\\S]{0,80}?(\\w+)\\s+${symbol}\\s*;`));
          const typeName = fieldDecl?.[1] || h.args.typeName;
          if (!typeName) {
            failed.push(key);
            continue;
          }
          const typeFile = await searchTypeFile(args.roots, typeName, args.signal);
          // Also try Impl
          const implFile =
            (await searchTypeFile(args.roots, `${typeName}Impl`, args.signal))
            || typeFile;
          const target = implFile || typeFile;
          if (!target) {
            failed.push(key);
            continue;
          }
          steps.push({
            id: `match_call_${symbol}_${method}`,
            edgeKind: "refers",
            nodeKind: "definition",
            role: "call",
            title: `${symbol}.${method}`,
            narrative: h.reason || `→ ${target.relativePath}`,
            file: relativeToAnyRoot(args.roots, from),
            path: from,
            line: 1,
            symbol: method,
            preview: `${symbol}.${method}(…)`,
            confidence: "medium",
            bridgeKind: "llm_discover"
          });
          steps.push({
            id: `match_target_${target.relativePath}`,
            edgeKind: "defines",
            nodeKind: "definition",
            role: "definition",
            title: path.basename(target.relativePath),
            narrative: target.preview,
            file: target.relativePath,
            path: target.absolutePath,
            line: target.line,
            symbol: typeName,
            preview: target.preview,
            confidence: "medium",
            bridgeKind: "llm_discover"
          });
          pathKeys.add(pathKey(args.projectRoot, target.absolutePath));
          focusAbs = target.absolutePath;
        } catch {
          failed.push(key);
        }
        continue;
      }

      failed.push(key);
    }
    if (stop || bridgeStatus === "ok") break;
  }

  // Rule fallback: if we confirmed handler but no field yet, try RequestBody type + field
  if (confirmed && bridgeStatus !== "ok") {
    try {
      const text = await fs.readFile(confirmed.absolutePath, "utf8");
      const bodyType = text.match(/@RequestBody\s+(?:\w+\s+)?([A-Z]\w+)/);
      if (bodyType?.[1]) {
        const typeFile = await searchTypeFile(args.roots, bodyType[1], args.signal);
        if (typeFile) {
          if (!steps.some((s) => s.path === typeFile.absolutePath)) {
            steps.push({
              id: "match_body_type_rule",
              edgeKind: "defines",
              nodeKind: "definition",
              role: "definition",
              title: `Type ${bodyType[1]}`,
              narrative: "@RequestBody",
              file: typeFile.relativePath,
              path: typeFile.absolutePath,
              line: typeFile.line,
              symbol: bodyType[1],
              preview: typeFile.preview,
              confidence: "high",
              bridgeKind: "http_route"
            });
          }
          const voText = await fs.readFile(typeFile.absolutePath, "utf8");
          const fieldHit = findFieldInDtoScope(voText, args.seedSymbol);
          if (fieldHit) {
            steps.push({
              id: "match_body_field_rule",
              edgeKind: "defines",
              nodeKind: "vo_field",
              role: "definition",
              title: fieldHit.className ? `${fieldHit.className}.${fieldHit.matched}` : fieldHit.matched,
              narrative: fieldHit.preview,
              file: typeFile.relativePath,
              path: typeFile.absolutePath,
              line: fieldHit.line,
              symbol: fieldHit.matched,
              preview: fieldHit.preview,
              confidence: "high",
              terminal: true,
              bridgeKind: "name_family"
            });
            bridgeStatus = "ok";
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!steps.length) {
    openEnds.push({ symbol: args.seedSymbol, reason: "endpoint_match_empty", file: args.fePath });
  }

  return {
    steps,
    openEnds,
    pathKeys,
    bridgeStatus,
    llmStatus,
    llmError
  };
}
