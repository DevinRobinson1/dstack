#!/usr/bin/env node
// Fixtures for retro.cjs. Most of these are about refusing to conclude.
//
// The failure mode this guards is not a wrong number. It is a number that
// looks right, computed from five rows, that someone then edits a safety
// threshold on. Six of these hold stop rule S9.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const r = require("./retro.cjs");

const MINS = { retro: { minPerGroup: 12, minDifference: 0.15, minPairs: 20 } };
const CONFIG = Object.assign({ routing: { stages: { build: { typical: { in: 60000, out: 20000 } } } } }, MINS);

// n decisions at a tier/model, of which `blocked` of them blocked.
let seq = 0;
function rows(stage, tier, model, n, blocked) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pr = ++seq, head = `h${pr}`;
    out.push({ t: "decision", pr, head, stage, tier, model, risk: 2 });
    out.push({ t: "outcome", pr, head, stage: "gate", blocked: i < blocked, infra: false });
  }
  return out;
}

const find = (res, re) => res.findings.find((f) => re.test(f.question));

const CASES = [
  // ---- the refusal ------------------------------------------------------
  ["S9a a group under the minimum reports not enough, and how many more", () => {
    const res = r.fit(rows("build", "skim", "m1", 4, 4).concat(rows("build", "deep", "m2", 40, 2)), CONFIG);
    const f = find(res, /tier a change was built at/);
    return [f.enough === false, f.finding === undefined, /not enough evidence yet/.test(f.why), /skim needs 8 more/.test(f.why)];
  }],
  ["S9b a difference under the margin is not a finding, however many rows", () => {
    // 50% against 40%: a 10 point spread under a 15 point margin.
    const res = r.fit(rows("build", "skim", "m1", 200, 100).concat(rows("build", "deep", "m2", 200, 80)), CONFIG);
    const f = find(res, /tier a change was built at/);
    return [f.enough === true, f.finding === false, f.n === 400, /no difference worth acting on/.test(f.why)];
  }],
  ["S9c every finding carries its sample count", () => {
    const res = r.fit(rows("build", "skim", "m1", 40, 36).concat(rows("build", "deep", "m2", 40, 4)), CONFIG);
    return [res.findings.every((f) => typeof f.n === "number"), res.findings.length > 0];
  }],
  ["S9d one group alone is never a comparison", () => {
    const res = r.fit(rows("build", "deep", "m1", 500, 250), CONFIG);
    const f = find(res, /tier a change was built at/);
    return [f.enough === false, /needs two groups/.test(f.why)];
  }],
  ["S9e there is no threshold that can be relaxed at the call site", () => {
    const loose = { retro: { minPerGroup: 1, minDifference: 0 } };
    const res = r.fit(rows("build", "skim", "m1", 2, 2).concat(rows("build", "deep", "m2", 2, 0)), loose);
    const f = find(res, /tier a change was built at/);
    // A caller CAN lower the config minimums; what it cannot do is get a
    // finding without the count coming with it, which is what S9 protects.
    return [typeof f.n === "number", f.n === 4];
  }],
  ["S9f fit is pure: same rows in, same findings out, twice", () => {
    const rs = rows("build", "skim", "m1", 40, 36).concat(rows("build", "deep", "m2", 40, 4));
    return [JSON.stringify(r.fit(rs, CONFIG)) === JSON.stringify(r.fit(rs, CONFIG))];
  }],

  // ---- the ledger --------------------------------------------------------
  ["the ledger is append only: existing lines survive byte for byte", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    r.record({ t: "ship", pr: 1, rounds: 2 }, { file: f });
    const first = fs.readFileSync(f, "utf8");
    r.record({ t: "ship", pr: 2, rounds: 3 }, { file: f });
    const after = fs.readFileSync(f, "utf8");
    const ok = after.startsWith(first) && after.length > first.length && r.load(f).rows.length === 2;
    fs.rmSync(d, { recursive: true, force: true });
    return [ok];
  }],
  ["a corrupt line is counted and reported, never dropped and never fatal", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    fs.writeFileSync(f, '{"t":"ship","pr":1,"rounds":2}\nnot json at all\n{"t":"nope"}\n{"t":"ship","pr":2,"rounds":3}\n');
    const l = r.load(f);
    fs.rmSync(d, { recursive: true, force: true });
    return [l.rows.length === 2, l.corrupt === 2, l.missing === false];
  }],
  ["a row of an unknown type is refused rather than written", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    const bad = r.record({ t: "vibes", pr: 1 }, { file: f });
    const off = r.record({ t: "ship", pr: 1 }, { file: f, enabled: false });
    const exists = fs.existsSync(f);
    fs.rmSync(d, { recursive: true, force: true });
    return [bad.ok === false, /needs t as one of/.test(bad.reason), off.ok === false, /retro is off/.test(off.reason), exists === false];
  }],
  ["a missing ledger is a state, not an error", () => {
    const l = r.load(path.join(os.tmpdir(), "definitely-not-here", "l.jsonl"));
    const res = r.fit(l.rows, CONFIG);
    return [l.missing === true, l.rows.length === 0, res.findings.every((f) => f.enough === false)];
  }],

  // ---- the questions -----------------------------------------------------
  ["a real difference between tiers is reported, with both rates", () => {
    const res = r.fit(rows("build", "skim", "m1", 40, 36).concat(rows("build", "deep", "m2", 40, 4)), CONFIG);
    const f = find(res, /tier a change was built at/);
    return [f.enough === true, f.finding === true, /skim 90%/.test(f.why), /deep 10%/.test(f.why), f.n === 80];
  }],
  ["a model that blocks more at the same tier is named", () => {
    const res = r.fit(rows("build", "deep", "cheap", 30, 24).concat(rows("build", "deep", "frontier", 30, 3)), CONFIG);
    const f = find(res, /At build tier "deep"/);
    return [f.enough === true, f.finding === true, /cheap 80%/.test(f.why), /frontier 10%/.test(f.why)];
  }],
  ["an infra round is not a round, so it never counts as a block", () => {
    const rs = [
      { t: "decision", pr: 1, head: "h1", stage: "build", tier: "deep", model: "m" },
      { t: "outcome", pr: 1, head: "h1", stage: "gate", blocked: true, infra: true },
      { t: "outcome", pr: 1, head: "h1", stage: "gate", blocked: false, infra: false },
    ];
    const j = r.joinOutcomes(rs);
    return [j.length === 1, j[0].blocked === false];
  }],
  ["a decision nothing was ever observed about is left out, not counted as a pass", () => {
    const rs = [{ t: "decision", pr: 9, head: "h9", stage: "build", tier: "deep", model: "m" }];
    return [r.joinOutcomes(rs).length === 0];
  }],
  ["a drifted token shape is reported against what the config claims", () => {
    const usage = Array.from({ length: 20 }, (_, i) => ({ t: "usage", pr: i, stage: "build", in: 120000, out: 40000 }));
    const res = r.fit(usage, CONFIG);
    const s = res.shapes.find((x) => x.stage === "build");
    return [s.enough === true, s.finding === true, s.measured.in === 120000, s.declared.in === 60000, /configured 60000\/20000, measured 120000\/40000/.test(s.why)];
  }],
  ["the gate adapter is one function, and reads BLOCK and infra", () => {
    const b = r.adaptGateRounds({ head: "abc", round: 2, majors: 3, verdict: "BLOCK" });
    const i = r.adaptGateRounds({ head: "abc", round: 1, verdict: "infra" });
    return [b.blocked === true, b.infra === false, b.majors === 3, i.infra === true, r.adaptGateRounds(null) === null];
  }],
];

let pass = 0;
const failures = [];
for (const [name, fn] of CASES) {
  let checks;
  try { checks = fn(); }
  catch (e) { failures.push(`${name}\n      threw: ${e.message}`); continue; }
  if (checks.every(Boolean)) pass++;
  else failures.push(`${name}\n      check ${checks.findIndex((c) => !c) + 1} of ${checks.length} failed`);
}
if (failures.length) {
  console.error(`Dstack retro fixtures FAILED: ${failures.length} of ${CASES.length}`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`Dstack retro fixtures OK: ${pass} of ${CASES.length}, six of them the refusal, no network and no api key`);
process.exit(0);
