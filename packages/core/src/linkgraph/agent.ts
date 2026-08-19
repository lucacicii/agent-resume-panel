/**
 * LLM-first link graph agent for MCP / shared use.
 * LLM decides the search; tools only verify (read/search/resolve).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { chatCompletionDetailed } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { loadSettings } from "../settings/store";
import { expandHome } from "../pathUtils";
import { factsFromSteps, reconcileOpenEnds, sanitizeLinkGraphSummary } from "./evidence";
import { readWindow, searchText } from "./search";
import { resolveModuleSpecifier, resolveSearchRoots, toPosixRel } from "./resolve";
import { normalizeLinkGraphSymbol } from "./symbol";
import type {
  LinkGraphOpenEnd,
  LinkGraphStep,
  LinkGraphTimelineItem,
  LinkGraphTraceArgs,
  LinkGraphTraceResult
} from "./types";

function now(): number {
  return Date.now();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

async function llmJson(
  system: string,
  user: string,
  maxTokens = 800,
  signal?: AbortSignal
): Promise<{ ok: boolean; parsed: Record<string, unknown> | null; unconfigured?: boolean; error?: string }> {
  const settings = await loadSettings();
  const llm = llmConfigFromSettings(settings);
  if (!llm) return { ok: false, parsed: null, unconfigured: true, error: "LLM unconfigured" };
  try {
    const content = (await chatCompletionDetailed(
      llm,
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      maxTokens,
      signal
    )).content;
    const raw = String(content || "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, parsed: null, error: "no json" };
    return {
      ok: true,
      parsed: JSON.parse(m[0].replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>
    };
  } catch (error) {
    return {
      ok: false,
      parsed: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function extractHttpPaths(source: string): Array<{ path: string; line: number; preview: string }> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ path: string; line: number; preview: string }> = [];
  const re =
    /['"`](\/(?:api|manager|admin|service|services|v\d+)[A-Za-z0-9_./${}:-]{1,140}|\/[A-Za-z][A-Za-z0-9_./${}:-]{2,140})['"`]/g;
  for (let i = 0; i < lines.length; i += 1) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      const raw = m[1];
      if (raw.split("/").filter(Boolean).length < 2) continue;
      if (/\.(js|css|png|jpg)(\?|$)/i.test(raw)) continue;
      out.push({
        path: raw.toLowerCase().replace(/\/+/g, "/"),
        line: i + 1,
        preview: lines[i].trim().slice(0, 200)
      });
    }
  }
  return out;
}

function findApiCalls(source: string): Array<{ client: string; method: string; line: number; preview: string }> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ client: string; method: string; line: number; preview: string }> = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (let i = 0; i < lines.length; i += 1) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      const client = m[1];
      const method = m[2];
      if (/^(console|Math|JSON|Object|Array|Promise|this|props|formData|ref)$/.test(client)) continue;
      if (/^(then|catch|map|filter|forEach|value|push)$/.test(method)) continue;
      out.push({ client, method, line: i + 1, preview: lines[i].trim().slice(0, 200) });
    }
  }
  return out;
}

function parseJsImports(source: string): Array<{ localName: string; specifier: string; line: number }> {
  const out: Array<{ localName: string; specifier: string; line: number }> = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const named = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (named) {
      for (const part of named[1].split(",")) {
        const m = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
        if (m) out.push({ localName: m[2] || m[1], specifier: named[2], line: i + 1 });
      }
      continue;
    }
    const def = line.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (def) out.push({ localName: def[1], specifier: def[2], line: i + 1 });
  }
  return out;
}

function isFeClientHit(rel: string, preview: string): boolean {
  if (/\.(vue|tsx|jsx)$/i.test(rel)) return true;
  if (/\$post\s*\(|\$get\s*\(|axios\.|fetch\s*\(/i.test(preview)) return true;
  if (/(^|\/)api\/[^/]+\.(ts|js)$/i.test(rel) && !/@ (Get|Post|Controller|RequestMapping)/.test(preview)) {
    return true;
  }
  return false;
}

function pushTl(
  timeline: LinkGraphTimelineItem[],
  item: Omit<LinkGraphTimelineItem, "at">,
  onTimeline?: LinkGraphTraceArgs["onTimeline"]
): void {
  const full: LinkGraphTimelineItem = { ...item, at: now() };
  const i = timeline.findIndex((t) => t.id === full.id);
  if (i >= 0) timeline[i] = full;
  else timeline.push(full);
  onTimeline?.([...timeline], full.title);
}

/**
 * One-shot link graph trace: LLM drives search; tools only verify.
 */
export async function runLinkGraphTrace(raw: LinkGraphTraceArgs): Promise<LinkGraphTraceResult> {
  const workspaceRoot = path.resolve(expandHome(raw.workspaceRoot.trim()));
  const normalized =
    normalizeLinkGraphSymbol(raw.selection || raw.symbol || "")
    || (raw.symbol?.trim()
      ? { symbol: raw.symbol.trim(), wholeWord: true as const }
      : null);
  const symbol = normalized?.symbol || "";
  if (!symbol) {
    return {
      ok: false,
      error: "symbol is required",
      engine: "llm_agent",
      primaryChain: [],
      timeline: [],
      summary: "",
      openEnds: [],
      bridgeStatus: "skipped",
      facts: {
        hasFeApiClient: false,
        hasHttpPath: false,
        hasBackendHandler: false,
        hasVoField: false
      },
      workspaceRoot,
      seed: { symbol: "" }
    };
  }

  const settings = await loadSettings();
  if (!llmConfigFromSettings(settings)) {
    return {
      ok: false,
      error: "LLM unconfigured — configure Agent Resume LLM settings first",
      engine: "llm_agent",
      primaryChain: [],
      timeline: [],
      summary: "",
      openEnds: [],
      bridgeStatus: "skipped",
      facts: {
        hasFeApiClient: false,
        hasHttpPath: false,
        hasBackendHandler: false,
        hasVoField: false
      },
      workspaceRoot,
      seed: { symbol }
    };
  }

  const roots = await resolveSearchRoots(workspaceRoot, raw.backendRoots);
  const deadline = Date.now() + (raw.timeBudgetMs ?? 90_000);
  const timeline: LinkGraphTimelineItem[] = [];
  const steps: LinkGraphStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  let stepN = 0;
  let bridgeStatus: LinkGraphTraceResult["bridgeStatus"] = "skipped";
  const urls: string[] = [];

  let seedAbs = raw.filePath ? path.resolve(expandHome(raw.filePath)) : "";
  if (seedAbs && !seedAbs.startsWith(workspaceRoot)) {
    // allow absolute under workspace children
    if (!roots.some((r) => seedAbs.startsWith(r + path.sep) || seedAbs.startsWith(r))) {
      seedAbs = path.resolve(workspaceRoot, raw.filePath!);
    }
  }
  const seedLine = Math.max(1, Math.floor(raw.line || 1));

  // ─── locate ───
  throwIfAborted(raw.signal);
  pushTl(timeline, {
    id: "locate",
    phase: "locate",
    status: "running",
    title: `定位 ${symbol}`
  }, raw.onTimeline);

  if (!seedAbs) {
    // LLM asks to search for symbol definition — tool verifies
    const matches = await searchText({
      root: workspaceRoot,
      query: symbol,
      wholeWord: true,
      matchCase: true,
      maxResults: 20
    });
    const pick = await llmJson(
      'Pick the best seed file for this symbol (form field / page). JSON: {"file":"relative/path","line":1,"thought":"..."}',
      `Symbol: ${symbol}\nMatches:\n${matches.map((m) => `${m.relativePath}:${m.line} ${m.preview}`).join("\n")}`,
      undefined,
      raw.signal
    );
    const f = typeof pick.parsed?.file === "string" ? pick.parsed.file : matches[0]?.relativePath;
    if (f) {
      seedAbs = path.resolve(workspaceRoot, f);
    }
  }

  if (!seedAbs || !(await fs.stat(seedAbs).then((s) => s.isFile()).catch(() => false))) {
    pushTl(timeline, {
      id: "locate",
      phase: "locate",
      status: "failed",
      title: `定位 ${symbol}`,
      detail: "seed file not found"
    }, raw.onTimeline);
    return {
      ok: false,
      error: "filePath required or symbol not found in workspace",
      engine: "llm_agent",
      primaryChain: [],
      timeline,
      summary: "",
      openEnds: [{ symbol, reason: "seed_file_missing" }],
      bridgeStatus: "failed",
      facts: {
        hasFeApiClient: false,
        hasHttpPath: false,
        hasBackendHandler: false,
        hasVoField: false
      },
      workspaceRoot,
      seed: { symbol, filePath: raw.filePath, line: seedLine }
    };
  }

  const seedRel = toPosixRel(workspaceRoot, seedAbs);
  const seedSource = await fs.readFile(seedAbs, "utf8");
  const seedLines = seedSource.split(/\r?\n/);
  // find refs
  const refLines: number[] = [];
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  for (let i = 0; i < seedLines.length; i += 1) {
    if (re.test(seedLines[i])) refLines.push(i + 1);
    re.lastIndex = 0;
  }
  const firstRef = refLines[0] || seedLine;
  steps.push({
    id: `s${++stepN}`,
    role: "reference",
    title: `Reference ${symbol}${refLines.length > 1 ? ` (+${refLines.length - 1} more)` : ""}`,
    narrative: seedLines[firstRef - 1]?.trim() || "",
    file: seedRel,
    path: seedAbs,
    line: firstRef,
    symbol,
    preview: seedLines[firstRef - 1]?.trim().slice(0, 200) || "",
    confidence: "high",
    kind: "reference"
  });
  // definition-ish line
  const defLine = seedLines.findIndex((l) => new RegExp(`${symbol}\\s*[:=]`).test(l));
  if (defLine >= 0) {
    steps.push({
      id: `s${++stepN}`,
      role: "definition",
      title: `Define ${symbol}`,
      narrative: seedLines[defLine].trim(),
      file: seedRel,
      path: seedAbs,
      line: defLine + 1,
      symbol,
      preview: seedLines[defLine].trim().slice(0, 200),
      confidence: "high",
      kind: "definition"
    });
  }

  const locateThought = await llmJson(
    'Phase locate. JSON: {"thought":"one sentence about local usage"}',
    `Symbol ${symbol} in ${seedRel}\n${(await readWindow(seedAbs, firstRef, 20)).text.slice(0, 3000)}`,
    undefined,
    raw.signal
  );
  pushTl(timeline, {
    id: "locate",
    phase: "locate",
    status: "done",
    title: `定位 ${symbol}`,
    detail: typeof locateThought.parsed?.thought === "string" ? locateThought.parsed.thought : steps[0]?.preview,
    evidence: [{ file: seedRel, line: firstRef, path: seedAbs, preview: steps[0]?.preview }]
  }, raw.onTimeline);

  // ─── expand_fe ───
  throwIfAborted(raw.signal);
  pushTl(timeline, {
    id: "expand_fe",
    phase: "expand_fe",
    status: "running",
    title: "发现前端 API 调用"
  }, raw.onTimeline);

  const calls = findApiCalls(seedSource);
  const imports = parseJsImports(seedSource);
  const fePick = await llmJson(
    [
      "You search a frontend code link. Pick the API client call that likely sends this form field.",
      'Prefer ajax_*/api* and pageQuery/list/query. JSON: {"thought":"...","client":"ajax_invoice","method":"pageQuery"}'
    ].join("\n"),
    [
      `Field: ${symbol}`,
      `File: ${seedRel}`,
      "API-like calls:",
      calls.map((c) => `L${c.line}: ${c.client}.${c.method} :: ${c.preview}`).join("\n") || "(none)",
      "Imports:",
      imports.map((i) => `${i.localName} from ${i.specifier}`).join("\n") || "(none)"
    ].join("\n"),
    undefined,
    raw.signal
  );

  let client =
    typeof fePick.parsed?.client === "string" ? fePick.parsed.client : "";
  let method =
    typeof fePick.parsed?.method === "string" ? fePick.parsed.method : "";
  if (!client || !method) {
    const ranked = [...calls].sort(
      (a, b) =>
        (/^ajax_/i.test(b.client) ? 1 : 0) - (/^ajax_/i.test(a.client) ? 1 : 0)
    );
    if (ranked[0]) {
      client = ranked[0].client;
      method = ranked[0].method;
    }
  }

  if (client && method) {
    const call = calls.find((c) => c.client === client && c.method === method) || calls[0];
    if (call) {
      steps.push({
        id: `s${++stepN}`,
        role: "call",
        title: `Call ${client}.${method}`,
        narrative: call.preview,
        file: seedRel,
        path: seedAbs,
        line: call.line,
        symbol,
        preview: call.preview,
        confidence: "high",
        kind: "api_call"
      });
    }
    const imp = imports.find((i) => i.localName === client);
    if (imp) {
      steps.push({
        id: `s${++stepN}`,
        role: "import",
        title: `API client ${client}`,
        narrative: imp.specifier,
        file: seedRel,
        path: seedAbs,
        line: imp.line,
        symbol: client,
        preview: `from '${imp.specifier}'`,
        confidence: "high",
        kind: "api_import"
      });
      const resolved = await resolveModuleSpecifier(workspaceRoot, seedAbs, imp.specifier);
      if (resolved) {
        const apiSource = await fs.readFile(resolved.absolutePath, "utf8");
        const paths = extractHttpPaths(apiSource);
        // method-scoped
        const methodRe = new RegExp(`${method}\\s*[:(=]`);
        const apiLines = apiSource.split(/\r?\n/);
        let methodLine = 1;
        for (let i = 0; i < apiLines.length; i += 1) {
          if (methodRe.test(apiLines[i])) {
            methodLine = i + 1;
            break;
          }
        }
        const chunk = apiLines.slice(methodLine - 1, methodLine + 15).join("\n");
        const methodPaths = extractHttpPaths(chunk);
        const urlHit = methodPaths[0] || paths[0];
        steps.push({
          id: `s${++stepN}`,
          role: "call",
          title: `${client}.${method}`,
          narrative: urlHit ? urlHit.path : "api module",
          file: resolved.relativePath,
          path: resolved.absolutePath,
          line: urlHit?.line || methodLine,
          symbol: method,
          preview: urlHit?.preview || method,
          confidence: "high",
          kind: "api_method"
        });
        if (urlHit) {
          urls.push(urlHit.path);
          steps.push({
            id: `s${++stepN}`,
            role: "bridge",
            title: `URL ${urlHit.path}`,
            narrative: `${client}.${method} → ${urlHit.path}`,
            file: resolved.relativePath,
            path: resolved.absolutePath,
            line: urlHit.line,
            symbol,
            preview: urlHit.preview,
            confidence: "high",
            kind: "http_url"
          });
        }
      } else {
        openEnds.push({ symbol: client, reason: "unresolved_api_import", file: imp.specifier });
      }
    } else {
      openEnds.push({ symbol: client, reason: "api_client_import_not_found", file: seedRel });
    }
  }

  pushTl(timeline, {
    id: "expand_fe",
    phase: "expand_fe",
    status: urls.length ? "done" : client ? "done" : "failed",
    title: client ? `API ${client}.${method}` : "未发现 API 调用",
    detail: urls.length
      ? `URLs: ${urls.join(", ")}`
      : typeof fePick.parsed?.thought === "string"
        ? String(fePick.parsed.thought)
        : "no url",
    evidence: steps
      .filter((s) => s.kind?.startsWith("api") || s.kind === "http_url")
      .slice(0, 4)
      .map((s) => ({ file: s.file, line: s.line, path: s.path, preview: s.preview }))
  }, raw.onTimeline);

  // ─── bridge ───
  throwIfAborted(raw.signal);
  pushTl(timeline, {
    id: "bridge",
    phase: "bridge",
    status: "running",
    title: "匹配后端 handler"
  }, raw.onTimeline);

  let handler: { path: string; relativePath: string; line: number; preview: string } | null = null;
  const uniqueUrls = [...new Set(urls)];

  for (const feUrl of uniqueUrls.slice(0, 3)) {
    throwIfAborted(raw.signal);
    if (Date.now() > deadline) break;
    const segs = feUrl.split("/").filter(Boolean);
    const queries = [
      segs.slice(-2).join("/"),
      segs[segs.length - 2],
      segs[segs.length - 1],
      segs.slice(0, -1).join("/")
    ].filter((q) => q && q.length >= 2);

    const candidates: Array<{
      id: string;
      path: string;
      relativePath: string;
      line: number;
      preview: string;
      score: number;
      snippet: string;
    }> = [];
    let cid = 0;
    for (const root of roots) {
      for (const q of [...new Set(queries)].slice(0, 3)) {
        const matches = await searchText({
          root,
          query: q,
          matchCase: false,
          maxResults: 30
        });
        for (const m of matches) {
          if (isFeClientHit(m.relativePath, m.preview)) continue;
          let score = 0;
          if (/@(?:RestController|RequestMapping|PostMapping|GetMapping|Controller)\b/.test(m.preview)) {
            score += 40;
          }
          if (/Controller\.(java|ts)$/i.test(m.relativePath)) score += 25;
          if (/\.java$/i.test(m.relativePath)) score += 10;
          if (m.preview.includes(segs[segs.length - 1] || "")) score += 15;
          if (score < 20) continue;
          let snippet = m.preview;
          try {
            const w = await readWindow(m.path, m.line, 10);
            snippet = w.text.slice(0, 900);
          } catch {
            /* ignore */
          }
          cid += 1;
          candidates.push({
            id: `c${cid}`,
            path: m.path,
            relativePath: toPosixRel(workspaceRoot, m.path),
            line: m.line,
            preview: m.preview,
            score,
            snippet
          });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 10);

    const pick = await llmJson(
      [
        "Pick the REAL server handler for this FE URL. Never pick frontend $post/api modules.",
        'JSON: {"thought":"...","candidateId":"c1"|null}'
      ].join("\n"),
      [
        `FE URL: ${feUrl}`,
        `Field: ${symbol}`,
        "Candidates:",
        top
          .map((c) => `[${c.id}] score=${c.score} ${c.relativePath}:${c.line}\n${c.snippet}`)
          .join("\n---\n") || "(none)"
      ].join("\n"),
      900,
      raw.signal
    );

    const id = typeof pick.parsed?.candidateId === "string" ? pick.parsed.candidateId : null;
    const chosen = (id && top.find((c) => c.id === id)) || top[0];
    if (chosen) {
      handler = {
        path: chosen.path,
        relativePath: chosen.relativePath,
        line: chosen.line,
        preview: chosen.preview
      };
      steps.push({
        id: `s${++stepN}`,
        role: "bridge",
        title: `Handler ${path.basename(chosen.relativePath)}`,
        narrative:
          typeof pick.parsed?.thought === "string"
            ? String(pick.parsed.thought)
            : `${feUrl} → ${chosen.relativePath}`,
        file: chosen.relativePath,
        path: chosen.path,
        line: chosen.line,
        symbol,
        preview: chosen.preview,
        confidence: "high",
        kind: "be_handler"
      });
      bridgeStatus = "partial";
      break;
    }
  }

  if (!handler) {
    openEnds.push({
      symbol,
      reason: uniqueUrls.length ? "no_be_endpoint_candidate" : "no_fe_http_path",
      file: uniqueUrls[0]
    });
    bridgeStatus = uniqueUrls.length ? "partial" : steps.some((s) => s.kind === "api_call") ? "partial" : "failed";
  }

  pushTl(timeline, {
    id: "bridge",
    phase: "bridge",
    status: handler ? "done" : "failed",
    title: handler ? `后端 ${path.basename(handler.relativePath)}` : "未匹配后端 handler",
    detail: uniqueUrls[0] ? `URL ${uniqueUrls[0]}` : "no url",
    evidence: handler
      ? [{ file: handler.relativePath, line: handler.line, path: handler.path, preview: handler.preview }]
      : undefined
  }, raw.onTimeline);

  // ─── expand_be ───
  throwIfAborted(raw.signal);
  pushTl(timeline, {
    id: "expand_be",
    phase: "expand_be",
    status: "running",
    title: "展开后端类型"
  }, raw.onTimeline);

  if (handler) {
    const handlerText = await fs.readFile(handler.path, "utf8");
    const bePlan = await llmJson(
      [
        "From this handler, name the request body / query DTO type for the field.",
        'JSON: {"thought":"...","bodyType":"InvoiceDetailQueryVo"|null}'
      ].join("\n"),
      `Field: ${symbol}\nHandler:\n${handlerText.slice(0, 5000)}`,
      undefined,
      raw.signal
    );
    let bodyType =
      typeof bePlan.parsed?.bodyType === "string" ? bePlan.parsed.bodyType : null;
    if (!bodyType) {
      const m =
        handlerText.match(/@RequestBody\s+(?:\w+\s+)?([A-Z][\w]*)/)
        || handlerText.match(/\(([A-Z][\w]*)\s+\w+\s*\)/);
      bodyType = m?.[1] || null;
    }

    if (bodyType) {
      // search type
      let typeFile: { path: string; relativePath: string; line: number; preview: string } | null = null;
      for (const root of roots) {
        const matches = await searchText({
          root,
          query: bodyType,
          wholeWord: true,
          matchCase: true,
          maxResults: 25
        });
        for (const m of matches) {
          if (new RegExp(`\\b(class|interface|record|type)\\s+${bodyType}\\b`).test(m.preview)) {
            typeFile = {
              path: m.path,
              relativePath: toPosixRel(workspaceRoot, m.path),
              line: m.line,
              preview: m.preview
            };
            break;
          }
        }
        if (typeFile) break;
      }
      // java import path
      if (!typeFile) {
        const imp = handlerText.match(new RegExp(`import\\s+([\\w.]+\\.${bodyType})\\s*;`));
        if (imp) {
          const relJava = imp[1].replace(/\./g, "/") + ".java";
          for (const root of roots) {
            const tryPath = path.join(root, "src/main/java", relJava);
            try {
              await fs.access(tryPath);
              typeFile = {
                path: tryPath,
                relativePath: toPosixRel(workspaceRoot, tryPath),
                line: 1,
                preview: bodyType
              };
              break;
            } catch {
              /* next */
            }
          }
        }
      }

      if (typeFile) {
        steps.push({
          id: `s${++stepN}`,
          role: "definition",
          title: `Type ${bodyType}`,
          narrative:
            typeof bePlan.parsed?.thought === "string"
              ? String(bePlan.parsed.thought)
              : "request body",
          file: typeFile.relativePath,
          path: typeFile.path,
          line: typeFile.line,
          symbol: bodyType,
          preview: typeFile.preview,
          confidence: "high",
          kind: "dto_type"
        });
        const voText = await fs.readFile(typeFile.path, "utf8");
        const voLines = voText.split(/\r?\n/);
        let fieldLine = -1;
        let fieldPreview = "";
        const aliases = [symbol];
        // camel ↔ snake soft
        if (/[A-Z]/.test(symbol)) {
          aliases.push(
            symbol.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
          );
        }
        for (let i = 0; i < voLines.length; i += 1) {
          for (const a of aliases) {
            if (new RegExp(`\\b${a}\\b`).test(voLines[i])) {
              fieldLine = i + 1;
              fieldPreview = voLines[i].trim();
              break;
            }
          }
          if (fieldLine > 0) break;
        }
        if (fieldLine > 0) {
          steps.push({
            id: `s${++stepN}`,
            role: "definition",
            title: `${bodyType}.${symbol}`,
            narrative: fieldPreview,
            file: typeFile.relativePath,
            path: typeFile.path,
            line: fieldLine,
            symbol,
            preview: fieldPreview.slice(0, 200),
            confidence: "high",
            kind: "vo_field",
            terminal: true
          });
          bridgeStatus = "ok";
        } else {
          openEnds.push({
            symbol,
            file: typeFile.relativePath,
            reason: "field_not_on_type"
          });
        }
      } else {
        openEnds.push({ symbol: bodyType, reason: "type_not_found" });
      }
    }
  }

  pushTl(timeline, {
    id: "expand_be",
    phase: "expand_be",
    status: bridgeStatus === "ok" ? "done" : handler ? "done" : "skipped",
    title: bridgeStatus === "ok" ? "已挂接 VO 字段" : "后端纵深",
    evidence: steps
      .filter((s) => s.kind === "vo_field" || s.kind === "dto_type")
      .map((s) => ({ file: s.file, line: s.line, path: s.path, preview: s.preview }))
  }, raw.onTimeline);

  // ─── structure ───
  throwIfAborted(raw.signal);
  pushTl(timeline, {
    id: "structure",
    phase: "structure",
    status: "running",
    title: "生成结构化结果"
  }, raw.onTimeline);

  const facts = factsFromSteps(steps);
  const cleanedEnds = reconcileOpenEnds(steps, openEnds);

  const langHint = raw.language && !/^auto$/i.test(raw.language) ? raw.language : "Chinese";
  const pathTitles = steps.map((s) => s.title).join(" → ");
  let summary = steps.length
    ? `主链 ${steps.length} 步：${pathTitles.slice(0, 320)}。`
    : "未形成主链。";
  if (facts.hasFeApiClient) summary += " 已含前端 API 客户端。";
  if (facts.hasHttpPath) summary += " 已含 HTTP 路径。";
  if (facts.hasBackendHandler) summary += " 已对接后端 handler。";
  if (facts.hasVoField) summary += " 已定位 VO/DTO 字段。";
  if (cleanedEnds.length) {
    summary += ` 未闭合：${cleanedEnds.slice(0, 3).map((o) => o.reason).join("、")}。`;
  }

  const polish = await llmJson(
    [
      "Polish the summary. Do NOT invent missing API client or HTTP path if Facts say they exist.",
      `Write in ${langHint}.`,
      'JSON: {"summary":"2-4 sentences"}'
    ].join("\n"),
    `Facts: ${JSON.stringify(facts)}\nDraft: ${summary}\nSteps:\n${steps
      .map((s) => `- ${s.title} @ ${s.file}:${s.line}`)
      .join("\n")}\nOpenEnds: ${cleanedEnds.map((o) => o.reason).join(", ") || "(none)"}`,
    undefined,
    raw.signal
  );
  if (typeof polish.parsed?.summary === "string" && polish.parsed.summary.trim()) {
    summary = sanitizeLinkGraphSummary(polish.parsed.summary.trim(), facts).slice(0, 800)
      || polish.parsed.summary.trim().slice(0, 800);
  } else {
    summary = sanitizeLinkGraphSummary(summary, facts) || summary;
  }

  pushTl(timeline, {
    id: "structure",
    phase: "structure",
    status: "done",
    title: "结构化完成",
    detail: summary.slice(0, 200)
  }, raw.onTimeline);

  return {
    ok: steps.length > 0,
    engine: "llm_agent",
    primaryChain: steps,
    timeline,
    summary,
    openEnds: cleanedEnds,
    bridgeStatus,
    facts,
    workspaceRoot,
    seed: { symbol, filePath: seedRel, line: firstRef }
  };
}
