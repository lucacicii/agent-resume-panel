import { describe, expect, it } from "vitest";
import {
  chainEvidenceFacts,
  isStopwordSymbol,
  normalizeLinkGraphSymbol,
  parseLinkGraphAnalysis,
  reconcileOpenEnds,
  repairCommonJsonIssues,
  sanitizeLinkGraphSummary,
  symbolSpecificity
} from "./linkGraphService";
import type { LinkGraphChainStep } from "../../shared/linkGraphTypes";
import {
  buildNameFamily,
  isValidSymbolMatch,
  shouldExpandNameFamily,
  splitIdentifierSegments
} from "./nameFamily";
import { parseJsImports, findBindingForSymbol } from "./importResolve";
import {
  extractTypeHintForSymbol,
  findLocalDefinition,
  findSymbolRefsInFile
} from "./definitionDig";
import {
  normalizeRoutePath,
  routesCompatible,
  extractHttpPathsFromSource,
  findFieldInDtoScope
} from "./httpBridge";
import {
  findApiClientCalls,
  findMethodUrlInApiModule
} from "./discover/actions";
import { isFrontendClientHit } from "./endpointMatch";
import type { LinkGraphHit } from "../../shared/linkGraphTypes";

describe("normalizeLinkGraphSymbol", () => {
  it("keeps simple identifiers", () => {
    expect(normalizeLinkGraphSymbol("userId")).toEqual({ symbol: "userId", wholeWord: true });
  });

  it("takes the last member segment", () => {
    expect(normalizeLinkGraphSymbol("user.profile.id")).toEqual({ symbol: "id", wholeWord: true });
  });

  it("rejects empty or oversized input", () => {
    expect(normalizeLinkGraphSymbol("")).toBeNull();
    expect(normalizeLinkGraphSymbol("x".repeat(100))).toBeNull();
  });
});

describe("stopwords and specificity", () => {
  it("flags common short tokens", () => {
    expect(isStopwordSymbol("id")).toBe(true);
    expect(isStopwordSymbol("getUserProfile")).toBe(false);
  });

  it("scores camelCase higher than short names", () => {
    expect(symbolSpecificity("getUserProfile")).toBeGreaterThan(symbolSpecificity("data"));
  });
});

describe("name family", () => {
  it("expands multi-segment camel to snake", () => {
    const family = buildNameFamily("userName");
    expect(family).toContain("user_name");
    expect(family).toContain("UserName");
  });

  it("does not snake-expand single short segment", () => {
    expect(shouldExpandNameFamily("a")).toBe(false);
  });

  it("rejects invalid matches for short seed", () => {
    expect(isValidSymbolMatch("a", "aa", "const aa = 1")).toBe(false);
    expect(isValidSymbolMatch("a", "a", "const a = 1")).toBe(true);
  });

  it("splits identifiers", () => {
    expect(splitIdentifierSegments("userName")).toEqual(["user", "name"]);
  });
});

describe("import parse", () => {
  it("parses multi-line named imports", () => {
    const src = `
import {
  bar,
  baz as qux
} from '../types/user';
`;
    const bindings = parseJsImports(src);
    expect(findBindingForSymbol(bindings, "bar")?.specifier).toBe("../types/user");
    expect(findBindingForSymbol(bindings, "qux")?.importedName).toBe("baz");
  });
});

describe("definition dig helpers", () => {
  it("finds field and interface definitions", () => {
    const src = `
export interface UserVO {
  userName: string;
}
`;
    expect(findLocalDefinition(src, "UserVO")?.kind).toBe("definition");
    expect(findLocalDefinition(src, "userName")?.kind).toBe("field");
    expect(findSymbolRefsInFile(src, "userName").length).toBeGreaterThan(0);
  });

  it("extracts type hints", () => {
    const src = `const x: UserVO = {};\nfunction f(a: OrderDTO) {}`;
    expect(extractTypeHintForSymbol(src, "x")).toBe("UserVO");
  });
});

describe("http bridge helpers", () => {
  it("normalizes routes", () => {
    expect(normalizeRoutePath("/api/users/:id")).toBe("/api/users/{param}");
    expect(routesCompatible("/api/users/1", "/api/users/{id}")).toBe(true);
  });

  it("extracts api paths including /manager", () => {
    const paths = extractHttpPathsFromSource(`
      return request.get('/api/user/profile');
      pageQuery: (data) => $post('/manager/invoice/pageQuery', data),
    `);
    expect(paths.some((p) => p.path.includes("/api/user/profile"))).toBe(true);
    expect(paths.some((p) => p.path.includes("/manager/invoice/pagequery"))).toBe(true);
  });

  it("finds field in dto scope", () => {
    const src = `
public class UserVO {
  private String user_name;
}
`;
    const hit = findFieldInDtoScope(src, "userName");
    expect(hit?.matched).toBe("user_name");
  });
});

describe("endpoint FE exclude", () => {
  it("treats $post api modules as frontend clients", () => {
    expect(isFrontendClientHit("src/api/invoice.ts", "pageQuery: (data) => $post('/manager/invoice/pageQuery', data)")).toBe(true);
  });
  it("does not treat Spring controller as frontend", () => {
    expect(isFrontendClientHit("InvoiceController.java", '@PostMapping("/pageQuery")')).toBe(false);
  });
});

describe("discover api client", () => {
  it("finds ajax_invoice.pageQuery calls", () => {
    const src = `
  return ajax_invoice.pageQuery(params).then(res => {
    return res;
  });
`;
    const calls = findApiClientCalls(src);
    expect(calls.some((c) => c.client === "ajax_invoice" && c.method === "pageQuery")).toBe(true);
  });

  it("extracts method URL from api module", () => {
    const src = `
export const ajax_invoice = {
  pageQuery: (data: any) => $post('/manager/invoice/pageQuery', data),
  excel: (data: any) => $post('/manager/invoice/excel', data),
}
`;
    const hit = findMethodUrlInApiModule(src, "pageQuery");
    expect(hit?.path).toContain("/manager/invoice/pagequery");
  });
});

describe("reconcileOpenEnds vs chain facts", () => {
  const chainWithApiAndPath: LinkGraphChainStep[] = [
    {
      id: "1",
      edgeKind: "refers",
      nodeKind: "reference",
      role: "reference",
      title: "Reference meteringOrgId",
      narrative: "form field",
      file: "index.vue",
      path: "/p/index.vue",
      line: 54,
      symbol: "meteringOrgId",
      preview: "meteringOrgId",
      confidence: "high"
    },
    {
      id: "2",
      edgeKind: "imports",
      nodeKind: "api_client",
      role: "import",
      title: "API client ajax_invoice",
      narrative: "@/api/invoice",
      file: "index.vue",
      path: "/p/index.vue",
      line: 37,
      symbol: "ajax_invoice",
      preview: "import",
      confidence: "high",
      bridgeKind: "api_client"
    },
    {
      id: "3",
      edgeKind: "bridge",
      nodeKind: "bridge",
      role: "bridge",
      title: "URL /manager/invoice/pageQuery",
      narrative: "ajax_invoice.pageQuery → /manager/invoice/pageQuery",
      file: "api/invoice.ts",
      path: "/p/api/invoice.ts",
      line: 4,
      symbol: "meteringOrgId",
      preview: "$post",
      confidence: "high",
      bridgeKind: "api_client"
    }
  ];

  it("marks http path and api client as present", () => {
    const facts = chainEvidenceFacts(chainWithApiAndPath);
    expect(facts.hasFeApiClient).toBe(true);
    expect(facts.hasHttpPath).toBe(true);
  });

  it("drops stale no_fe_http_path and api import open ends", () => {
    const cleaned = reconcileOpenEnds(chainWithApiAndPath, [
      { symbol: "meteringOrgId", reason: "no_fe_http_path" },
      { symbol: "ajax_invoice", reason: "api_client_import_not_found" },
      { symbol: "x", reason: "unresolved_import", file: "other.ts" }
    ]);
    expect(cleaned.map((o) => o.reason)).toEqual(["unresolved_import"]);
  });

  it("treats api/*.ts path steps as FE client evidence", () => {
    const chain: LinkGraphChainStep[] = [
      {
        id: "1",
        edgeKind: "bridge",
        nodeKind: "bridge",
        role: "bridge",
        title: "HTTP /manager/invoice/pageQuery",
        narrative: "path",
        file: "src/api/invoice.ts",
        path: "/p/src/api/invoice.ts",
        line: 4,
        symbol: "meteringOrgId",
        preview: "pageQuery",
        confidence: "high",
        bridgeKind: "http_route"
      },
      {
        id: "2",
        edgeKind: "bridge",
        nodeKind: "be_controller",
        role: "bridge",
        title: "Handler InvoiceController",
        narrative: "pageQuery",
        file: "InvoiceController.java",
        path: "/p/InvoiceController.java",
        line: 46,
        symbol: "meteringOrgId",
        preview: "@PostMapping",
        confidence: "high",
        bridgeKind: "http_route"
      }
    ];
    const facts = chainEvidenceFacts(chain);
    expect(facts.hasHttpPath).toBe(true);
    expect(facts.hasFeApiClient).toBe(true);
    expect(facts.hasBackendHandler).toBe(true);
    const summary = sanitizeLinkGraphSummary(
      "链路完整。当前主要缺口是前端 API 客户端导入未找到，可能影响封装。",
      facts
    );
    expect(summary).not.toMatch(/API 客户端/);
    expect(summary).toMatch(/链路完整/);
  });
});

describe("parseLinkGraphAnalysis", () => {
  const hits: LinkGraphHit[] = [
    {
      path: "/proj/src/a.ts",
      relativePath: "src/a.ts",
      line: 10,
      column: 1,
      endColumn: 5,
      preview: "const userId = 1",
      depth: 0,
      symbol: "userId",
      reason: "seed",
      score: 50
    }
  ];

  it("accepts evidence-backed hops", () => {
    const raw = JSON.stringify({
      summary: "userId is defined in a.ts",
      complete: false,
      hops: [
        {
          id: "h1",
          role: "definition",
          title: "define userId",
          narrative: "const",
          file: "src/a.ts",
          line: 10,
          confidence: "high"
        }
      ]
    });
    const analysis = parseLinkGraphAnalysis(raw, hits, true);
    expect(analysis?.hops).toHaveLength(1);
    expect(analysis?.summary).toContain("userId");
  });

  it("repairs trailing commas", () => {
    const broken = '{"summary":"ok","complete":false,"hops":[],"confidence":"low",}';
    expect(JSON.parse(repairCommonJsonIssues(broken))).toMatchObject({ summary: "ok" });
  });
});
