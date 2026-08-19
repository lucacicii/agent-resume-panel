import assert from "node:assert/strict";
import { test } from "node:test";
import {
  factsFromSteps,
  reconcileOpenEnds,
  sanitizeLinkGraphSummary
} from "../dist/linkgraph/evidence.js";
import { normalizeLinkGraphSymbol } from "../dist/linkgraph/symbol.js";

test("normalizeLinkGraphSymbol keeps identifiers and last member", () => {
  assert.deepEqual(normalizeLinkGraphSymbol("deliveryNum"), {
    symbol: "deliveryNum",
    wholeWord: true
  });
  assert.deepEqual(normalizeLinkGraphSymbol("form.deliveryNum"), {
    symbol: "deliveryNum",
    wholeWord: true
  });
  assert.equal(normalizeLinkGraphSymbol(""), null);
});

test("facts + sanitize drop false missing-API claims", () => {
  const steps = [
    {
      id: "s1",
      role: "call",
      title: "Call ajax_invoice.pageQuery",
      narrative: "ajax_invoice.pageQuery",
      file: "src/api/invoice.ts",
      path: "/ws/src/api/invoice.ts",
      line: 10,
      symbol: "pageQuery",
      preview: "pageQuery: () => $post('/manager/invoice/pageQuery')",
      confidence: "high",
      kind: "api_method"
    },
    {
      id: "s2",
      role: "bridge",
      title: "URL /manager/invoice/pageQuery",
      narrative: "HTTP path",
      file: "src/api/invoice.ts",
      path: "/ws/src/api/invoice.ts",
      line: 12,
      symbol: "pageQuery",
      preview: "$post('/manager/invoice/pageQuery')",
      confidence: "high",
      kind: "http_url"
    }
  ];
  const facts = factsFromSteps(steps);
  assert.equal(facts.hasFeApiClient, true);
  assert.equal(facts.hasHttpPath, true);

  const ends = reconcileOpenEnds(steps, [
    { symbol: "x", reason: "no_fe_http_path" },
    { symbol: "y", reason: "other_gap" }
  ]);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, "other_gap");

  const cleaned = sanitizeLinkGraphSummary(
    "链路完整。未找到 API 客户端。HTTP 路径未找到。",
    facts
  );
  assert.doesNotMatch(cleaned, /未找到 API/);
  assert.doesNotMatch(cleaned, /HTTP 路径未找到/);
});
