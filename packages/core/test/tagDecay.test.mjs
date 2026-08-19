import assert from "node:assert/strict";
import test from "node:test";
import {
  computeConsensusBoost,
  computeDecayedWeight,
  determineTagStatus,
  normalizeCategory,
  normalizeTagName,
  DEFAULT_PRUNE_THRESHOLD
} from "../dist/tagging/decay.js";
import { isKnownTagCategory } from "../dist/tagging/extract.js";

test("normalizeTagName strips hashes, case, and noise", () => {
  assert.equal(normalizeTagName("  #React.js!  "), "react.js!");
  assert.equal(normalizeTagName("OAuth  2.0"), "oauth 2.0");
  assert.equal(normalizeTagName("###TypeScript"), "typescript");
  assert.equal(normalizeTagName(""), "");
  assert.equal(normalizeTagName("  ,;:-  "), "");
});

test("normalizeCategory falls back to tech_stack for unknowns", () => {
  assert.equal(normalizeCategory("architecture"), "architecture");
  assert.equal(normalizeCategory("BUSINESS_DOMAIN"), "business_domain");
  assert.equal(normalizeCategory("not-a-category"), "tech_stack");
  assert.equal(normalizeCategory(null), "tech_stack");
});

test("isKnownTagCategory only accepts the seven dimensions", () => {
  assert.equal(isKnownTagCategory("tech_stack"), true);
  assert.equal(isKnownTagCategory("problem_domain"), true);
  assert.equal(isKnownTagCategory("unknown"), false);
  assert.equal(isKnownTagCategory(undefined), false);
});

test("computeConsensusBoost is log2 capped at 2.5", () => {
  assert.equal(computeConsensusBoost(1), 0);
  assert.equal(computeConsensusBoost(0), 0);
  assert.equal(computeConsensusBoost(2), 0.5);
  assert.equal(computeConsensusBoost(4), 1);
  assert.ok(computeConsensusBoost(16) >= 2);
  assert.equal(computeConsensusBoost(1_000_000), 2.5);
});

test("computeDecayedWeight applies hit + consensus and decays auto tags", () => {
  const now = 1_700_000_000_000;
  const halfLifeMs = 7 * 86_400_000;

  const base = computeDecayedWeight({
    baseWeight: 1,
    consensusCount: 1,
    hitCount: 0,
    lastDecayAtMs: now,
    nowMs: now,
    halfLifeDays: 7,
    source: "auto"
  });
  assert.equal(base, 1);

  const withHit = computeDecayedWeight({
    baseWeight: 1,
    consensusCount: 1,
    hitCount: 2,
    hitBoost: 0.5,
    lastDecayAtMs: now,
    nowMs: now,
    source: "auto"
  });
  assert.equal(withHit, 2);

  const withConsensus = computeDecayedWeight({
    baseWeight: 1,
    consensusCount: 4,
    hitCount: 0,
    lastDecayAtMs: now,
    nowMs: now,
    source: "auto"
  });
  assert.equal(withConsensus, 2);

  const halfLife = computeDecayedWeight({
    baseWeight: 1,
    consensusCount: 1,
    hitCount: 0,
    lastDecayAtMs: now - halfLifeMs,
    nowMs: now,
    halfLifeDays: 7,
    source: "auto"
  });
  assert.ok(Math.abs(halfLife - 0.5) < 0.02);

  const manual = computeDecayedWeight({
    baseWeight: 2,
    consensusCount: 1,
    hitCount: 0,
    lastDecayAtMs: now - halfLifeMs * 10,
    nowMs: now,
    source: "manual"
  });
  assert.equal(manual, 2);
});

test("determineTagStatus soft-obsoletes only after grace + low weight", () => {
  const now = 1_700_000_000_000;
  const graceMs = 14 * 86_400_000;

  assert.equal(
    determineTagStatus({
      weight: 0.05,
      pruneThreshold: DEFAULT_PRUNE_THRESHOLD,
      lastHitAtMs: now - graceMs,
      nowMs: now,
      source: "auto"
    }),
    "obsolete"
  );

  assert.equal(
    determineTagStatus({
      weight: 0.05,
      lastHitAtMs: now - 86_400_000,
      nowMs: now,
      source: "auto"
    }),
    "active"
  );

  assert.equal(
    determineTagStatus({
      weight: 0.05,
      lastHitAtMs: now - graceMs,
      nowMs: now,
      source: "manual"
    }),
    "active"
  );

  assert.equal(
    determineTagStatus({
      weight: 0.05,
      lastHitAtMs: now - graceMs,
      nowMs: now,
      source: "auto",
      pinned: true
    }),
    "active"
  );

  assert.equal(
    determineTagStatus({
      weight: 1.2,
      lastHitAtMs: now - graceMs * 3,
      nowMs: now,
      source: "auto"
    }),
    "active"
  );
});
