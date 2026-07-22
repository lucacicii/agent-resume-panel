import assert from "node:assert/strict";
import test from "node:test";
import {
  filterReportGtdProposals
} from "../dist/workflow/analyzeGtd.js";
import { buildDailySystemPrompt } from "../dist/report/prompts.js";
import { buildSummarizeSystemPrompt } from "../dist/session/prompts.js";

const sessionKeys = new Set(["codex:session-1"]);
const reportIds = new Set(["daily:2026-07-22"]);
const evidenceSources = [
  {
    id: "report:daily:2026-07-22",
    text: "The migration is not finished. Verify the release panel after the migration."
  },
  {
    id: "session:codex:session-1",
    text: "State: active\nOpen work: Verify the release panel\nNext action: Run the release panel verification."
  }
];

test("strict session and report prompts distinguish completed work from explicit next actions", () => {
  const summaryPrompt = buildSummarizeSystemPrompt("English");
  assert.match(summaryPrompt, /State: <completed\|active\|blocked\|unclear>/);
  assert.match(summaryPrompt, /Next action: None/);

  const reportPrompt = buildDailySystemPrompt("English");
  assert.match(reportPrompt, /Completed work must not be reintroduced as unfinished/);
  assert.match(reportPrompt, /only explicit concrete next actions/);
});

test("filterReportGtdProposals accepts a next action with traceable evidence", () => {
  const result = filterReportGtdProposals({
    candidates: [{
      provider: "codex",
      sessionId: "session-1",
      gtd: "next",
      reason: "The release verification remains unfinished.",
      tasks: ["Run the release panel verification."],
      sourceReportIds: ["daily:2026-07-22"],
      evidence: {
        unresolved: {
          source: "report:daily:2026-07-22",
          quote: "The migration is not finished."
        },
        nextAction: {
          source: "session:codex:session-1",
          quote: "Next action: Run the release panel verification."
        }
      }
    }],
    sessionKeys,
    reportIds,
    evidenceSources
  });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].gtd, "next");
});

test("filterReportGtdProposals rejects unverified and stale-source next actions", () => {
  const candidate = {
    provider: "codex",
    sessionId: "session-1",
    gtd: "next",
    reason: "Needs verification",
    tasks: ["Verify it"],
    sourceReportIds: ["daily:2026-07-22"],
    evidence: {
      unresolved: { source: "report:daily:2026-07-22", quote: "The migration is not finished." },
      nextAction: { source: "session:codex:session-1", quote: "Not present in the current context" }
    }
  };
  const result = filterReportGtdProposals({
    candidates: [candidate, { ...candidate, sourceReportIds: ["daily:old"] }],
    sessionKeys,
    reportIds,
    evidenceSources
  });

  assert.equal(result.proposals.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every((warning) => warning.includes("skip")));
});

test("filterReportGtdProposals keeps only one proposal per session", () => {
  const candidate = {
    provider: "codex",
    sessionId: "session-1",
    gtd: "next",
    reason: "The release verification remains unfinished.",
    tasks: ["Run the release panel verification."],
    sourceReportIds: ["daily:2026-07-22"],
    evidence: {
      unresolved: { source: "report:daily:2026-07-22", quote: "The migration is not finished." },
      nextAction: { source: "session:codex:session-1", quote: "Next action: Run the release panel verification." }
    }
  };
  const result = filterReportGtdProposals({
    candidates: [candidate, candidate],
    sessionKeys,
    reportIds,
    evidenceSources
  });

  assert.equal(result.proposals.length, 1);
  assert.ok(result.warnings.includes("skip duplicate proposal: codex:session-1"));
});
