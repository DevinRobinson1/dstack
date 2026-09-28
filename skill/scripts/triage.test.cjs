#!/usr/bin/env node
// Fixtures for the five pure judgements in triage.cjs.
//
// Six of these are the invariant: a triage reading may only ever add work or
// add caution. They are the reason this module is safe to point at a gate, so
// they are tests and not a paragraph.
"use strict";

const t = require("./triage.cjs");

const score = (lvl, conf, levels = 4) => ({ type: "score", score: lvl, confidence: conf, legend: Object.fromEntries(Array.from({ length: levels }, (_, i) => [i, ""])) });
const noul = (p) => ({ type: "noul", noul: p });
const choice = (name, conf, probs) => ({ type: "choice", choice: name, confidence: conf, probabilities: probs });

const finding = (over) => Object.assign({ title: "a finding", file: "server/x.ts", line: 10, severity: "minor" }, over || {});
const reading = (over) => Object.assign({
  severity: score(1, 0.8), in_scope: noul(0.9), already_guarded: noul(0.05), actionable: noul(0.9), names_class: noul(0.5),
}, over || {});

const CASES = [
  // ---- the invariant -----------------------------------------------------
  ["I1 every finding that goes in comes back out", () => {
    const fs = Array.from({ length: 15 }, (_, i) => finding({ title: `f${i}` }));
    const readings = fs.map((_, i) => (i % 3 === 0 ? null : reading({ severity: score(0, 0.9), in_scope: noul(0.05), already_guarded: noul(0.99) })));
    const r = t.judgeFindings(fs, readings, {});
    return [r.findings.length === 15, r.counts.total === 15, new Set(r.findings.map((f) => f.title)).size === 15];
  }],
  ["I2 a reviewer blocker is never lowered", () => {
    const fs = [finding({ severity: "blocker", title: "b" })];
    const r = t.judgeFindings(fs, [reading({ severity: score(0, 0.95), in_scope: noul(0.02), already_guarded: noul(0.99) })], {});
    return [r.findings[0].triage.label === "major", r.findings[0].triage.overridden === true, /does not lower/.test(r.findings[0].triage.why)];
  }],
  ["I3 no plan verdict means approved", () => {
    const all = new Set();
    for (const v of [0.05, 0.5, 0.95]) {
      const a = Object.fromEntries(Object.keys(t.PLAN_QUESTIONS).map((k) => [k, noul(v)]));
      all.add(t.judgePlan(a, {}).verdict);
    }
    all.add(t.judgePlan(null, {}).verdict);
    return [!all.has("ready"), !all.has("approved"), all.has("not_ready"), all.has("no_objection"),
            /not an approval/.test(t.judgePlan(Object.fromEntries(Object.keys(t.PLAN_QUESTIONS).map((k) => [k, noul(0.99)])), {}).why)];
  }],
  ["I4 an unsure infra reading resolves to infra", () => {
    const a = t.judgeInfra({ is_infra: noul(0.5), infra_kind: choice("timeout", 0.4) }, { treatAsInfraAtOrAbove: 0.35 });
    const b = t.judgeInfra(null, {});
    return [a.infra === true, b.infra === true, b.routed === false, /retried once/.test(b.why)];
  }],
  ["I5 same idea lowers the distinct count, never raises it", () => {
    const fs = [finding({ title: "x", severity: "major" }), finding({ title: "y", severity: "major" }), finding({ title: "z", severity: "major" })];
    const triaged = t.judgeFindings(fs, fs.map(() => reading({ severity: score(3, 0.9) })), {}).findings;
    const prior = [{ title: "the same idea" }];
    const answers = triaged.map(() => ({ matches_prior: choice("prior_0", 0.9, { prior_0: 0.9, new: 0.1 }) }));
    const r = t.judgeProgress(triaged, prior, answers, { sameIdeaAtOrAbove: 0.6 });
    // Three findings, all the same idea as one the previous round raised: one
    // distinct idea, three findings that repeat it. S3 then sees 1 against the
    // previous round's 1, does not fall, and stops the line. That is the point.
    return [r.distinct === 1, r.repeats === 3, r.distinct <= triaged.length];
  }],
  ["I6 a triage failure returns the input unchanged and says so", () => {
    const fs = [finding({ title: "a" }), finding({ title: "b", severity: "major" })];
    const r = t.judgeFindings(fs, null, {});
    const h = t.judgeClassHits(["a.ts:1", "b.ts:2"], null, {});
    const p = t.judgePlan(null, {});
    return [r.findings.length === 2, r.findings.every((f) => f.triage.routed === false),
            /reviewer's own severity stands/.test(r.findings[0].triage.why),
            r.findings.find((f) => f.title === "b").triage.label === "major",
            h.hits.length === 2, h.unread === 2, p.routed === false];
  }],

  // ---- behavior ----------------------------------------------------------
  ["a guarded, out of scope, low severity finding is questioned and ordered last", () => {
    const fs = [finding({ title: "real", severity: "minor" }), finding({ title: "noise", severity: "minor" })];
    const r = t.judgeFindings(fs, [
      reading({ severity: score(3, 0.9) }),
      reading({ severity: score(0, 0.9), in_scope: noul(0.1), already_guarded: noul(0.95) }),
    ], {});
    return [r.findings[0].title === "real", r.findings[1].title === "noise",
            r.findings[1].triage.label === "questioned", r.counts.major === 1, r.counts.questioned === 1];
  }],
  ["a completed run that reported findings is not infra", () => {
    const r = t.judgeInfra({ is_infra: noul(0.02), infra_kind: choice("not_infra", 0.98) }, { treatAsInfraAtOrAbove: 0.35 });
    return [r.infra === false, r.kind === "not_infra", /counts as a round/.test(r.why)];
  }],
  ["a network failure is infra and names the kind", () => {
    const r = t.judgeInfra({ is_infra: noul(0.96), infra_kind: choice("network", 0.93) }, { treatAsInfraAtOrAbove: 0.35 });
    return [r.infra === true, r.kind === "network", /network/.test(r.why), /not a round/.test(r.why)];
  }],
  ["a class hit below the threshold is ordered last, not dropped", () => {
    const hits = ["a.ts:1", "b.ts:2", "c.ts:3"];
    const r = t.judgeClassHits(hits, [{ same_class: noul(0.1) }, { same_class: noul(0.95) }, { same_class: noul(0.55) }], { rankAtOrAbove: 0.5 });
    return [r.hits.length === 3, r.hits[0].hit === "b.ts:2", r.hits[2].hit === "a.ts:1",
            r.likely === 2, r.hits[2].likely === false, /not a filter/.test(r.why)];
  }],
  ["an unread class hit is ordered first, so a person sees it", () => {
    const r = t.judgeClassHits(["a.ts:1", "b.ts:2"], [null, { same_class: noul(0.9) }], {});
    return [r.hits[0].hit === "a.ts:1", r.hits[0].routed === false, r.unread === 1];
  }],
  ["a plan missing a concrete proof command is held back, and told why", () => {
    const a = Object.fromEntries(Object.keys(t.PLAN_QUESTIONS).map((k) => [k, noul(0.9)]));
    a.proof_command_is_concrete = noul(0.1);
    const r = t.judgePlan(a, { requireAtOrAbove: 0.6 });
    return [r.verdict === "not_ready", r.missing.length === 1, r.missing[0].key === "proof_command_is_concrete", /invocation/.test(r.why)];
  }],
  ["a first round has no previous round to compare against", () => {
    const fs = [finding({ severity: "major" })];
    const triaged = t.judgeFindings(fs, [reading({ severity: score(3, 0.9) })], {}).findings;
    const r = t.judgeProgress(triaged, [], null, {});
    return [r.distinct === 1, r.routed === false, /no previous round/.test(r.why)];
  }],
  ["a weak same idea reading counts as distinct", () => {
    const fs = [finding({ severity: "major", title: "x" })];
    const triaged = t.judgeFindings(fs, [reading({ severity: score(3, 0.9) })], {}).findings;
    const r = t.judgeProgress(triaged, [{ title: "p" }], [{ matches_prior: choice("prior_0", 0.3, { prior_0: 0.3, new: 0.7 }) }], { sameIdeaAtOrAbove: 0.6 });
    return [r.distinct === 1, r.repeats === 0];
  }],
  ["the reviewer severity vocabulary is read the way reviewers write it", () => {
    const vals = ["blocker", "critical", "major", "HIGH", "High"];
    return vals.map((v) => t.isReviewerMajor({ severity: v }) === true)
      .concat([t.isReviewerMajor({ severity: "minor" }) === false, t.isReviewerMajor({ major: true }) === true]);
  }],
  ["a cap leaves findings unread and says so, rather than shortening the list", () => {
    const fs = Array.from({ length: 5 }, (_, i) => finding({ title: `f${i}` }));
    const answers = [reading({}), reading({}), null, null, null]; // as a cap of 2 pads it
    const r = t.judgeFindings(fs, answers, {});
    return [r.findings.length === 5, r.counts.total === 5, r.counts.unread === 3, /3 triage did not read/.test(r.why)];
  }],
  ["the concurrency pool preserves order", async () => {
    const out = await t.pool([5, 1, 4, 2, 3], 3, async (n) => { await new Promise((r) => setTimeout(r, n * 4)); return n; });
    return [JSON.stringify(out) === JSON.stringify([5, 1, 4, 2, 3])];
  }],
];

(async () => {
  let pass = 0;
  const failures = [];
  for (const [name, fn] of CASES) {
    let checks;
    try { checks = await fn(); }
    catch (e) { failures.push(`${name}\n      threw: ${e.message}`); continue; }
    if (checks.every(Boolean)) pass++;
    else failures.push(`${name}\n      check ${checks.findIndex((c) => !c) + 1} of ${checks.length} failed`);
  }
  if (failures.length) {
    console.error(`Dstack triage fixtures FAILED: ${failures.length} of ${CASES.length}`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`Dstack triage fixtures OK: ${pass} of ${CASES.length}, six of them the invariant, no network and no api key`);
  process.exit(0);
})();
