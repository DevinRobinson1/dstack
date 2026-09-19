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
    const off = r.record({ t: "ship", pr: 1, rounds: 2 }, { file: f, enabled: false });
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
  ["collect emits a usage row beside the decision, from what the router spent", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    fs.writeFileSync(path.join(d, "gate-abc.json"), JSON.stringify({
      stage: "gate", head: "abc", tier: "max", model: "m", risk: 2.3, cost: 0.5,
      usage: { input_tokens: 984, output_tokens: 157 },
    }));
    const rows = r.collectDecisions(d, "abc");
    fs.rmSync(d, { recursive: true, force: true });
    const usage = rows.find((x) => x.t === "usage");
    // Question 4 asks whether the configured shape matches reality. Taking it
    // from the artifact beats asking a stage to report a number it would guess.
    return [rows.length === 2, !!usage, usage.in === 984, usage.out === 157, usage.stage === "gate"];
  }],
  ["a routing artifact with no usage block yields a decision and no usage row", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    fs.writeFileSync(path.join(d, "plan-abc.json"), JSON.stringify({ stage: "plan", head: "abc", tier: "deep", model: "m" }));
    const rows = r.collectDecisions(d, "abc");
    fs.rmSync(d, { recursive: true, force: true });
    return [rows.length === 1, rows[0].t === "decision"];
  }],
  ["a value is coerced only when the number round trips to the same string", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    const { execFileSync } = require("child_process");
    const cli = path.join(__dirname, "retro.cjs");
    execFileSync(process.execPath, [cli, "--record", "outcome", "pr=12", "head=0055630", "round=2", "blocked=true", "--ledger", f], { cwd: d });
    const row = r.load(f).rows[0];
    fs.rmSync(d, { recursive: true, force: true });
    return [
      // A sha keeps every character. Losing a leading zero loses the join,
      // and a PR that joins to nothing is invisible rather than absent.
      row.head === "0055630",
      row.pr === 12, row.round === 2, row.blocked === true,
    ];
  }],
  // ---- the five Codex found, one fixture each -------------------------
  ["C1 a row that could never join is refused at the door", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    const noHead = r.record({ t: "outcome", pr: 12, blocked: true }, { file: f });
    const noPr = r.record({ t: "adjudication", label: "major" }, { file: f });
    const ok = r.record({ t: "outcome", pr: 12, head: "abc", blocked: true }, { file: f });
    const rows = r.load(f).rows;
    fs.rmSync(d, { recursive: true, force: true });
    return [noHead.ok === false, /needs pr and head|needs head/.test(noHead.reason), /never be joined/.test(noHead.reason),
            noPr.ok === false, ok.ok === true, rows.length === 1];
  }],
  ["C1b a hand edited ledger is an input too: an unusable row is counted, not read", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    fs.writeFileSync(f, '{"t":"outcome","pr":12,"blocked":true}\n{"t":"outcome","pr":13,"head":"abc","blocked":true}\n');
    const l = r.load(f);
    fs.rmSync(d, { recursive: true, force: true });
    return [l.rows.length === 1, l.corrupt === 1];
  }],
  ["C2 twenty PRs at one risk value cannot be split, and are not averaged", () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(
      { t: "decision", pr: i, head: `h${i}`, stage: "build", tier: "deep", model: "m", risk: 2.0 },
      { t: "outcome", pr: i, head: `h${i}`, blocked: false }, { t: "ship", pr: i, rounds: 2 });
    const f = r.fit(rows, MINS).findings.find((x) => /risk index predict/.test(x.question));
    return [f.enough === false, f.n === 20, !/NaN/.test(f.why), /all 20 shipped PRs measured the same risk/.test(f.why)];
  }],
  ["C2b a clean bimodal set is split on a real risk boundary and reports", () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(
      { t: "decision", pr: i, head: `h${i}`, stage: "build", tier: "deep", model: "m", risk: i < 10 ? 1.0 : 3.0 },
      { t: "outcome", pr: i, head: `h${i}`, blocked: false }, { t: "ship", pr: i, rounds: i < 10 ? 1 : 3 });
    const f = r.fit(rows, MINS).findings.find((x) => /risk index predict/.test(x.question));
    return [f.enough === true, !/NaN/.test(f.why), f.n === 20];
  }],
  ["C4 a field may not overwrite the row type", () => {
    return [r.RESERVED_KEYS.has("t"), r.ROW_SCHEMA.outcome.required.head === "string", r.ROW_SCHEMA.outcome.required.blocked === "boolean"];
  }],
  ["C5 collect takes only artifacts about the head being collected", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    fs.writeFileSync(path.join(d, "build-aaaaaaa.json"), JSON.stringify({ stage: "build", head: "aaaaaaa1234", tier: "deep", model: "m" }));
    fs.writeFileSync(path.join(d, "gate-bbbbbbb.json"), JSON.stringify({ stage: "gate", head: "bbbbbbb9999", tier: "max", model: "m" }));
    const mine = r.collectDecisions(d, "aaaaaaa1234");
    const noHead = r.collectDecisions(d, null);
    // Another PR's artifact recorded as this PR's would join to this PR's
    // outcome and report a result about work that never happened.
    // An empty head is the dangerous one: "".includes(x) is true for every
    // filename, so without the guard this collects the whole directory.
    const emptyHead = r.collectDecisions(d, "");
    fs.rmSync(d, { recursive: true, force: true });
    return [mine.length === 1, mine[0].stage === "build", noHead.length === 0, emptyHead.length === 0];
  }],
  ["every row type declares required fields, so the class cannot return renamed", () => {
    return [...r.TYPES].map((t) => { const req = r.ROW_SCHEMA[t].required; return req && typeof req === "object" && Object.keys(req).length > 0 && Object.values(req).every((v) => ["string","number","boolean"].includes(v)); });
  }],
  // ---- round two ------------------------------------------------------
  ["R1 ties may not straddle the boundary, so order among equals cannot decide", () => {
    // 19 PRs at risk 1 and one at 3, with rounds arranged so an index split
    // would report a relationship that is really just input order.
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(
      { t: "decision", pr: i, head: `h${i}`, stage: "build", tier: "deep", model: "m", risk: i === 19 ? 3 : 1 },
      { t: "outcome", pr: i, head: `h${i}`, blocked: false }, { t: "ship", pr: i, rounds: i < 10 ? 1 : 3 });
    const f = r.fit(rows, MINS).findings.find((x) => /risk index predict/.test(x.question));
    return [f.enough === false, /no risk boundary/.test(f.why), f.n === 20];
  }],
  ["R2 an outcome that states no result is refused: silence is not a pass", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    const f = path.join(d, "l.jsonl");
    const noResult = r.record({ t: "outcome", pr: 12, head: "abc" }, { file: f });
    const wrongType = r.record({ t: "outcome", pr: 12, head: "abc", blocked: "yes" }, { file: f });
    const noConfirm = r.record({ t: "adjudication", pr: 12, label: "major" }, { file: f });
    const noTokens = r.record({ t: "usage", stage: "build" }, { file: f });
    const ok = r.record({ t: "outcome", pr: 12, head: "abc", blocked: false }, { file: f });
    fs.rmSync(d, { recursive: true, force: true });
    return [noResult.ok === false, /blocked \(missing\)/.test(noResult.reason),
            wrongType.ok === false, /must be a boolean, got string/.test(wrongType.reason),
            noConfirm.ok === false, noTokens.ok === false, ok.ok === true];
  }],
  ["R3 provenance is carried, not read off a filename", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "retro-"));
    // Two heads sharing a seven character prefix, which a filename cannot tell apart.
    fs.writeFileSync(path.join(d, "gate-abcdef0.json"), JSON.stringify({ stage: "gate", head: "abcdef011111", tier: "max", model: "old" }));
    fs.writeFileSync(path.join(d, "build-abcdef0.json"), JSON.stringify({ stage: "build", head: "abcdef022222", tier: "deep", model: "mine" }));
    fs.writeFileSync(path.join(d, "plan-noheadx.json"), JSON.stringify({ stage: "plan", tier: "deep", model: "legacy" }));
    const got = r.collectDecisions(d, "abcdef022222");
    fs.rmSync(d, { recursive: true, force: true });
    return [got.length === 1, got[0].model === "mine", got[0].head === "abcdef022222",
            // An artifact with no head is skipped rather than guessed at.
            got.every((x) => x.model !== "legacy")];
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
