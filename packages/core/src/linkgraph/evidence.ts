/**
 * Structural facts + open-end reconciliation + summary sanitization.
 * Shared by the agent engine (and any thin host adapters).
 */

import type { LinkGraphFacts, LinkGraphOpenEnd, LinkGraphStep } from "./types";

/** Structural facts derived from primary chain. */
export function factsFromSteps(steps: LinkGraphStep[]): LinkGraphFacts {
  const textOf = (s: LinkGraphStep) =>
    `${s.title} ${s.narrative || ""} ${s.preview || ""} ${s.file}`;

  const hasFeApiClient = steps.some((s) => {
    const t = textOf(s);
    if (s.kind === "api_call" || s.kind === "api_method" || s.kind === "api_import") return true;
    if (/ajax_[\w$]*|API client|Call \w+\.\w+/i.test(t)) return true;
    if (s.role === "import" && /(^|\/)api\//i.test(s.file)) return true;
    if (/(^|\/)api\/[^/]+\.(ts|js|tsx|jsx)$/i.test(s.file)) return true;
    if (/\$post\s*\(|\$get\s*\(|\$put\s*\(|\$delete\s*\(/i.test(t)) return true;
    return false;
  });

  const hasHttpPath = steps.some((s) => {
    const t = textOf(s);
    if (s.kind === "http_url") return true;
    if (/^URL\s+|HTTP\s+\//i.test(s.title)) return true;
    if (/\/(?:api|manager|admin|service|v\d+)\/[a-z0-9_./${}-]+/i.test(t)) return true;
    if (/\/[a-z][a-z0-9_-]*(?:\/[a-z0-9_.${}-]+){2,}/i.test(t)) return true;
    return false;
  });

  const hasBackendHandler = steps.some((s) => {
    if (s.kind === "be_handler") return true;
    if (/\.java$/i.test(s.file) || /Controller\.(java|ts|go)$/i.test(s.file)) return true;
    return false;
  });

  const hasVoField = steps.some((s) => s.terminal === true || s.kind === "vo_field");

  return {
    hasFeApiClient: hasFeApiClient || hasHttpPath,
    hasHttpPath,
    hasBackendHandler,
    hasVoField
  };
}

/** Drop open-end reasons contradicted by proven chain steps. */
export function reconcileOpenEnds(
  steps: LinkGraphStep[],
  openEnds: LinkGraphOpenEnd[]
): LinkGraphOpenEnd[] {
  const facts = factsFromSteps(steps);
  return openEnds.filter((o) => {
    const r = `${o.reason || ""} ${o.symbol || ""} ${o.file || ""}`;
    if (
      facts.hasHttpPath
      && /no_fe_http_path|no_be_route_match|no_be_endpoint|endpoint_match_empty|openapi_only|api_client|import_not_found|unresolved_api|客户端|HTTP 路径|http path/i.test(
        r
      )
    ) {
      return false;
    }
    if (
      facts.hasFeApiClient
      && /api_client|unresolved_api|import_not_found|客户端|ajax_/i.test(r)
    ) {
      return false;
    }
    if (
      facts.hasBackendHandler
      && /no_be_endpoint|no_be_route_match|endpoint_match_empty|be_path_pruned|Controller/i.test(o.reason || "")
    ) {
      return false;
    }
    if (facts.hasVoField && /field_not_on_type|definition_not_vo|type_not_found/i.test(o.reason || "")) {
      return false;
    }
    if (
      steps.length >= 3
      && /no_local_definition_or_import|symbol_not_found_in_file|definition_not_vo|seed_file_missing/i.test(
        o.reason || ""
      )
    ) {
      return false;
    }
    return true;
  });
}

/** Strip summary sentences that contradict proven Facts. */
export function sanitizeLinkGraphSummary(summary: string, facts: LinkGraphFacts): string {
  let text = String(summary || "").trim();
  if (!text) return text;

  const dropPatterns: RegExp[] = [];
  if (facts.hasFeApiClient || facts.hasHttpPath) {
    dropPatterns.push(
      /[^。.!?\n]*(?:API\s*客户端|api\s*client|ajax_)[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found|未解析)[^。.!?\n]*[。.!?]?/gi
    );
    dropPatterns.push(
      /[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found)[^。.!?\n]*(?:API\s*客户端|api\s*client|前端调用|导入)[^。.!?\n]*[。.!?]?/gi
    );
  }
  if (facts.hasHttpPath) {
    dropPatterns.push(
      /[^。.!?\n]*(?:HTTP\s*路径|http path|接口路径|前端路径)[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found)[^。.!?\n]*[。.!?]?/gi
    );
    dropPatterns.push(
      /[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found)[^。.!?\n]*(?:HTTP|路径|路由|route)[^。.!?\n]*[。.!?]?/gi
    );
  }
  if (facts.hasBackendHandler) {
    dropPatterns.push(
      /[^。.!?\n]*(?:后端|handler|Controller)[^。.!?\n]*(?:未找到|缺失|缺少|未对接)[^。.!?\n]*[。.!?]?/gi
    );
  }
  if (facts.hasVoField) {
    dropPatterns.push(
      /[^。.!?\n]*(?:VO|DTO|查询对象)[^。.!?\n]*(?:未映射|未找到|缺少)[^。.!?\n]*[。.!?]?/gi
    );
  }

  for (const re of dropPatterns) {
    text = text.replace(re, "");
  }
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/[，,]\s*[，,]/g, "，")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[，,。.]\s*/g, "")
    .trim();
}
