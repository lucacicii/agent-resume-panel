export type NoteSearchMode = "exact" | "semantic";
export type NoteSearchOperator = "all" | "any";
export type NoteSearchField = "content" | "title" | "filename" | "path";

export interface NoteSearchPlan {
  mode: NoteSearchMode;
  terms: string[];
  operator: NoteSearchOperator;
  fields: NoteSearchField[];
  semanticQuery: string;
  notesOnly: boolean;
  confidence: number;
  source: "deterministic" | "llm";
}

const NOTE_SCOPE_RE = /笔记|日记|便签|备忘录|\bnotes?\b/i;
const EXACT_CUE_RE = /(?:文件名|标题|标签|标记)\s*(?:为|是|等于|包含|含有|带有|匹配)|精确(?:查找|搜索|匹配)?|完全匹配|包含|含有|带有|带着|出现|字样|关键词|关键字|(?:标签|标记|文件名|标题)|\b(?:containing|contains|matching|matches|with)\b/i;
const SEMANTIC_CUE_RE = /关于|相关|类似|相似|涉及|讲(?:到|述)|讨论|主题|内容/i;
const SEARCH_ACTION_RE = /查|找|搜|列出|显示|哪些|所有|有没有|是否|find|search|list|show|containing|contains|matching|matches/i;
const QUOTED_RE = /["'`“”‘’]([^"'`“”‘’]{1,120})["'`“”‘’]/g;
const CODE_TOKEN_RE = /(?:#[\p{L}\p{N}_-]{2,}|\b[A-Z][A-Z0-9_-]{2,}\b|\b[\p{L}\p{N}]+(?:[_:/.-][\p{L}\p{N}_:/.-]+)+\b)/gu;

function uniqueTerms(values: string[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    const term = value
      .trim()
      .replace(/^["'`“”‘’\s:：]+|["'`“”‘’\s,，。！？?]+$/g, "");
    if (!term || term.length > 120) {
      continue;
    }
    if (!output.some((item) => item.toLocaleLowerCase() === term.toLocaleLowerCase())) {
      output.push(term);
    }
  }
  return output.slice(0, 12);
}

function quotedTerms(query: string): string[] {
  return [...query.matchAll(QUOTED_RE)].map((match) => match[1]);
}

function exactCuePayload(query: string): string | undefined {
  const match = EXACT_CUE_RE.exec(query);
  if (!match) {
    return undefined;
  }
  let payload = query.slice(match.index + match[0].length).trim();
  payload = payload.replace(/^(?:为|是|了|着|的|词|内容)?\s*[:：]?\s*/, "");
  const stopPatterns = [
    /(?:的)?(?:笔记|日记|便签|备忘录)/i,
    /(?:的\s*)?\bnotes?\b/i,
    /\b(?:in|from)\s+notes?\b/i
  ];
  let end = payload.length;
  for (const pattern of stopPatterns) {
    const stop = pattern.exec(payload);
    if (stop && stop.index < end) {
      end = stop.index;
    }
  }
  payload = payload.slice(0, end).trim();
  return payload || undefined;
}

function splitExactTerms(payload: string): { terms: string[]; operator: NoteSearchOperator } {
  const operator: NoteSearchOperator = /(?:或者|任一|任意|或|\bor\b)/i.test(payload)
    ? "any"
    : "all";
  const normalized = payload.replace(/["'`“”‘’]/g, "");
  const terms = normalized.split(
    operator === "any"
      ? /\s*(?:或者|任一|任意|或|\bor\b|、|,|，)\s*/i
      : /\s*(?:并且|同时|以及|和|与|及|\band\b|、|,|，)\s*/i
  );
  return { terms: uniqueTerms(terms), operator };
}

function exactFields(query: string): NoteSearchField[] {
  if (/文件名|filename/i.test(query)) {
    return ["filename"];
  }
  if (/标题|title/i.test(query)) {
    return ["title"];
  }
  if (/路径|path/i.test(query)) {
    return ["path"];
  }
  if (/正文|内容|标签|标记|tag/i.test(query)) {
    return ["content"];
  }
  return ["content", "title", "filename", "path"];
}

export function planNoteSearchDeterministically(query: string): NoteSearchPlan {
  const normalized = query.trim();
  const notesOnly = NOTE_SCOPE_RE.test(normalized);
  const quoted = quotedTerms(normalized);
  const payload = exactCuePayload(normalized);

  if (payload) {
    const split = splitExactTerms(payload);
    const terms = uniqueTerms([...quoted, ...split.terms]);
    if (terms.length) {
      return {
        mode: "exact",
        terms,
        operator: split.operator,
        fields: exactFields(normalized),
        semanticQuery: normalized,
        notesOnly,
        confidence: 0.98,
        source: "deterministic"
      };
    }
  }

  if (quoted.length) {
    return {
      mode: "exact",
      terms: uniqueTerms(quoted),
      operator: /(?:或者|任一|任意|或|\bor\b)/i.test(normalized) ? "any" : "all",
      fields: exactFields(normalized),
      semanticQuery: normalized,
      notesOnly,
      confidence: 0.96,
      source: "deterministic"
    };
  }

  const underNoteMatch = normalized.match(
    /(?:查|找|搜|列出|显示|看看)?(?:一下)?\s*(.+?)\s*(?:下面|之下|以内|文件夹|目录)(?:的)?(?:所有|全部)?(?:的)?(?:笔记|日记|便签)?/iu
  );
  if (underNoteMatch && notesOnly) {
    const term = underNoteMatch[1].trim().replace(/^(?:关于|有关)\s*/u, "");
    if (term) {
      return {
        mode: "exact",
        terms: uniqueTerms([term]),
        operator: "all",
        fields: ["path", "title", "content", "filename"],
        semanticQuery: normalized,
        notesOnly,
        confidence: 0.92,
        source: "deterministic"
      };
    }
  }

  const codeTerms = uniqueTerms([...normalized.matchAll(CODE_TOKEN_RE)].map((match) => match[0]));
  if (codeTerms.length && SEARCH_ACTION_RE.test(normalized)) {
    return {
      mode: "exact",
      terms: codeTerms,
      operator: /(?:或者|任一|任意|或|\bor\b)/i.test(normalized) ? "any" : "all",
      fields: exactFields(normalized),
      semanticQuery: normalized,
      notesOnly,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  return {
    mode: "semantic",
    terms: [],
    operator: "all",
    fields: ["content", "title", "filename", "path"],
    semanticQuery: normalized,
    notesOnly,
    confidence: SEMANTIC_CUE_RE.test(normalized) ? 0.95 : SEARCH_ACTION_RE.test(normalized) ? 0.55 : 0.85,
    source: "deterministic"
  };
}

export function shouldAnalyzeNoteSearchWithLlm(plan: NoteSearchPlan): boolean {
  return plan.notesOnly && plan.mode === "semantic" && plan.confidence < 0.8;
}

export function normalizeLlmNoteSearchPlan(
  raw: unknown,
  fallback: NoteSearchPlan
): NoteSearchPlan | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  if (value.mode !== "exact" && value.mode !== "semantic") {
    return undefined;
  }
  const terms = Array.isArray(value.terms)
    ? uniqueTerms(value.terms.filter((item): item is string => typeof item === "string"))
    : [];
  const fields = Array.isArray(value.fields)
    ? value.fields.filter(
        (item): item is NoteSearchField =>
          item === "content" || item === "title" || item === "filename" || item === "path"
      )
    : [];
  if (value.mode === "exact" && !terms.length) {
    return undefined;
  }
  return {
    mode: value.mode,
    terms,
    operator: value.operator === "any" ? "any" : "all",
    fields: fields.length ? [...new Set(fields)] : fallback.fields,
    semanticQuery:
      typeof value.semanticQuery === "string" && value.semanticQuery.trim()
        ? value.semanticQuery.trim()
        : fallback.semanticQuery,
    notesOnly: fallback.notesOnly || value.notesOnly === true,
    confidence: 0.85,
    source: "llm"
  };
}
