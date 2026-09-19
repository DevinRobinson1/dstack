#!/usr/bin/env node
// Retro. The ledger that corrects the guesses.
//
// Every number in this process is a guess, and each is stated as a guess in the
// contract that carries it: five routing weights, four bands, eight surface
// floors, six triage thresholds, three token shapes, three capability claims.
// Nothing observed any of them. A change routed to skim and one routed to max
// produced the same record: none.
//
// THE REFUSAL, which is stop rule S9 and most of the value here:
//
//   A finding that does not carry its sample count is not a finding.
//
// A metrics tool that reports a number from four rows is worse than one that
// says "four rows, this needs twenty". Five rows will always produce a
// difference that looks like signal. So the minimums live in the pure function,
// not in the documentation, and there is deliberately no flag that relaxes
// them: the only reason anyone reaches for one is to get an answer they had
// already decided on.
//
// This is rates and differences with sample counts beside them. It is not a
// significance test and references/retro.md says so in those words.
"use strict";

const fs = require("fs");
const path = require("path");

const LEDGER = ".dstack/retro/ledger.jsonl";
const TYPES = new Set(["decision", "outcome", "usage", "adjudication", "ship"]);

// ---------------------------------------------------------------------------
// The ledger. Append only, one JSON object per line.
// ---------------------------------------------------------------------------

function record(entry, opts) {
  const cfg = opts || {};
  if (cfg.enabled === false) return { ok: false, reason: "retro is off" };
  if (!entry || !TYPES.has(entry.t)) return { ok: false, reason: `a ledger row needs t as one of ${[...TYPES].join(", ")}` };
  const file = cfg.file || LEDGER;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Append only. Never read, rewrite or truncate: history that can be edited to
  // make a threshold look good is not evidence.
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  return { ok: true, file };
}

// Returns rows plus a count of lines it could not read. A corrupt line is
// counted and reported, never dropped quietly and never fatal.
function load(file) {
  let text;
  try { text = fs.readFileSync(file || LEDGER, "utf8"); }
  catch { return { rows: [], corrupt: 0, missing: true }; }
  const rows = [];
  let corrupt = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && TYPES.has(o.t)) rows.push(o); else corrupt++;
    } catch { corrupt++; }
  }
  return { rows, corrupt, missing: false };
}

// ---------------------------------------------------------------------------
// fit(): pure. No file system, no clock, no network. Same rows, same findings.
// ---------------------------------------------------------------------------

const DEFAULT_MINS = { minPerGroup: 12, minDifference: 0.15, minPairs: 20 };

function rate(rows, pred) {
  if (!rows.length) return null;
  return rows.filter(pred).length / rows.length;
}

function pct(n) { return n == null ? "?" : `${Math.round(n * 100)}%`; }

// The one place "not enough" is decided, so it cannot drift between questions.
function compare(question, groups, mins, describe) {
  const named = Object.entries(groups).filter(([, rows]) => rows.length > 0);
  if (named.length < 2) {
    return { question, enough: false, n: named.reduce((s, [, r]) => s + r.length, 0),
             why: `needs two groups to compare and has ${named.length}`, groups: named.map(([k, r]) => ({ key: k, n: r.length })) };
  }
  const short = named.filter(([, rows]) => rows.length < mins.minPerGroup);
  if (short.length) {
    const need = short.map(([k, rows]) => `${k} needs ${mins.minPerGroup - rows.length} more`).join(", ");
    return { question, enough: false, n: named.reduce((s, [, r]) => s + r.length, 0),
             why: `not enough evidence yet: ${need}`, groups: named.map(([k, r]) => ({ key: k, n: r.length })) };
  }
  const scored = named.map(([key, rows]) => ({ key, n: rows.length, value: describe(rows) })).sort((a, b) => b.value - a.value);
  const spread = scored[0].value - scored[scored.length - 1].value;
  if (spread < mins.minDifference) {
    return { question, enough: true, finding: false, n: scored.reduce((s, g) => s + g.n, 0), spread: Number(spread.toFixed(3)),
             why: `no difference worth acting on: ${scored.map((g) => `${g.key} ${pct(g.value)} (n=${g.n})`).join(", ")}`, groups: scored };
  }
  return { question, enough: true, finding: true, n: scored.reduce((s, g) => s + g.n, 0), spread: Number(spread.toFixed(3)),
           why: `${scored[0].key} ${pct(scored[0].value)} against ${scored[scored.length - 1].key} ${pct(scored[scored.length - 1].value)}`, groups: scored };
}

function byKey(rows, keyOf) {
  const out = {};
  for (const r of rows) {
    const k = keyOf(r);
    if (k == null) continue;
    (out[k] = out[k] || []).push(r);
  }
  return out;
}

// Join a decision to what happened to that head at that stage.
function joinOutcomes(rows) {
  const outcomes = rows.filter((r) => r.t === "outcome");
  const blocked = new Map();
  for (const o of outcomes) {
    if (o.infra) continue; // an infra round is not a round, per S4
    const k = `${o.pr}:${o.head}`;
    blocked.set(k, (blocked.get(k) || false) || o.blocked === true);
  }
  return rows.filter((r) => r.t === "decision").map((d) => Object.assign({}, d, {
    blocked: blocked.get(`${d.pr}:${d.head}`),
    observed: blocked.has(`${d.pr}:${d.head}`),
  })).filter((d) => d.observed);
}

function fit(rows, config) {
  const mins = Object.assign({}, DEFAULT_MINS, (config && config.retro) || {});
  const joined = joinOutcomes(rows);
  const findings = [];

  // 1. Does the tier predict a block? If skim blocks as often as deep, the
  //    risk index is not measuring risk and the weights are wrong.
  findings.push(compare(
    "Does the tier a change was built at predict whether it blocks at the gate?",
    byKey(joined.filter((d) => d.stage === "build"), (d) => d.tier),
    mins, (rs) => rate(rs, (r) => r.blocked)));

  // 2. Does the model matter at a fixed tier? This is the question that judges
  //    a serves line, including the DeepSeek one.
  for (const tier of [...new Set(joined.filter((d) => d.stage === "build").map((d) => d.tier))].sort()) {
    findings.push(compare(
      `At build tier "${tier}", does the model change how often work blocks?`,
      byKey(joined.filter((d) => d.stage === "build" && d.tier === tier), (d) => d.model),
      mins, (rs) => rate(rs, (r) => r.blocked)));
  }

  // 3. Do the triage labels hold against source?
  const adj = rows.filter((r) => r.t === "adjudication");
  findings.push(compare(
    "Are findings triage labelled major confirmed against source more often than ones it questioned?",
    byKey(adj, (r) => r.label), mins, (rs) => rate(rs, (r) => r.confirmed === true)));

  // 4. Are the token shapes right? These decide the cost ranking and were guessed.
  const usage = rows.filter((r) => r.t === "usage");
  const shapes = [];
  for (const [stage, rs] of Object.entries(byKey(usage, (r) => r.stage))) {
    const declared = ((config && config.routing && config.routing.stages) || {})[stage];
    const t = declared && declared.typical;
    if (!t) continue;
    if (rs.length < mins.minPerGroup) { shapes.push({ stage, enough: false, n: rs.length, why: `not enough evidence yet: needs ${mins.minPerGroup - rs.length} more` }); continue; }
    const mIn = Math.round(rs.reduce((s, r) => s + (r.in || 0), 0) / rs.length);
    const mOut = Math.round(rs.reduce((s, r) => s + (r.out || 0), 0) / rs.length);
    const drift = (a, b) => (b ? Math.abs(a - b) / b : 0);
    const off = drift(mIn, t.in) > 0.25 || drift(mOut, t.out) > 0.25;
    shapes.push({ stage, enough: true, finding: off, n: rs.length, measured: { in: mIn, out: mOut }, declared: { in: t.in, out: t.out },
                  why: off ? `configured ${t.in}/${t.out}, measured ${mIn}/${mOut}` : `configured ${t.in}/${t.out}, measured ${mIn}/${mOut}, close enough` });
  }

  // 5. Does the risk index predict how many real rounds a change takes?
  const withRounds = rows.filter((r) => r.t === "ship" && typeof r.rounds === "number");
  const paired = withRounds.map((s) => {
    const d = joined.find((x) => x.pr === s.pr && x.stage === "build");
    return d && typeof d.risk === "number" ? { risk: d.risk, rounds: s.rounds } : null;
  }).filter(Boolean);
  let riskFinding;
  if (paired.length < mins.minPairs) {
    riskFinding = { question: "Does the risk index predict how many gate rounds a change takes?", enough: false, n: paired.length,
                    why: `not enough evidence yet: needs ${mins.minPairs - paired.length} more shipped PRs with a risk reading` };
  } else {
    const mid = [...paired].sort((a, b) => a.risk - b.risk)[Math.floor(paired.length / 2)].risk;
    const lo = paired.filter((p) => p.risk <= mid), hi = paired.filter((p) => p.risk > mid);
    const avg = (xs) => xs.reduce((s, p) => s + p.rounds, 0) / xs.length;
    const diff = avg(hi) - avg(lo);
    riskFinding = { question: "Does the risk index predict how many gate rounds a change takes?", enough: true, finding: diff < 0.5, n: paired.length,
                    why: diff < 0.5
                      ? `it does not: above the median risk ${avg(hi).toFixed(1)} rounds, below it ${avg(lo).toFixed(1)}. The index is not predicting anything.`
                      : `above the median risk ${avg(hi).toFixed(1)} rounds, below it ${avg(lo).toFixed(1)}` };
  }

  // Every finding carries its sample count, or it is not a finding.
  const all = findings.concat([riskFinding]);
  for (const f of all) if (typeof f.n !== "number") throw new Error(`retro emitted a finding with no sample count: ${f.question}`);
  return { findings: all, shapes, rows: rows.length };
}

// ---------------------------------------------------------------------------
// collect(): read what the process already writes.
// ---------------------------------------------------------------------------

function collectDecisions(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("state-")); } catch { return []; }
  const out = [];
  for (const n of names) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")); } catch { continue; }
    if (!d || !d.stage) continue;
    out.push({ t: "decision", stage: d.stage, tier: d.tier || null, model: d.model || null, risk: d.risk,
               confidence: d.confidence, surface: d.surface || null, routed: !!d.routed, escalated: !!d.escalated,
               floor: d.floorApplied || null, est_cost: d.cost == null ? null : d.cost });
    // The artifact already carries what the router actually spent. Question 4
    // asks whether the configured shapes match reality, so take it from here
    // rather than asking a stage to report a number it would have to guess.
    if (d.usage && (d.usage.input_tokens != null || d.usage.output_tokens != null)) {
      out.push({ t: "usage", stage: d.stage, in: d.usage.input_tokens || 0, out: d.usage.output_tokens || 0 });
    }
  }
  return out;
}

// The one place coupled to a gate runner's output. gate-pr.cjs does not exist
// in this repository, so this reads the shape the Foresight runner writes.
// Replacing it when Plan 3 lands is a single edit, which is why it is alone.
function adaptGateRounds(verdictJson) {
  if (!verdictJson) return null;
  const v = verdictJson;
  return {
    t: "outcome", stage: "gate", head: v.head || null, round: v.round || null,
    majors: typeof v.majors === "number" ? v.majors : null,
    distinct: typeof v.distinct === "number" ? v.distinct : null,
    blocked: v.verdict === "BLOCK" || v.result === "BLOCK",
    infra: v.verdict === "infra" || v.result === "infra",
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const arg = (n, fb) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };
const has = (n) => process.argv.includes(`--${n}`);

function report(result, corrupt) {
  console.log(`Retro read ${result.rows} ledger rows${corrupt ? `, and could not read ${corrupt} (reported, not dropped)` : ""}.\n`);
  let findings = 0, waiting = 0;
  for (const f of result.findings) {
    if (!f.enough) { console.log(`  ?  ${f.question}\n     ${f.why}`); waiting++; }
    else if (f.finding) { console.log(`  !  ${f.question}\n     ${f.why}  (n=${f.n})`); findings++; }
    else console.log(`  .  ${f.question}\n     ${f.why}  (n=${f.n})`);
  }
  for (const s of result.shapes) {
    if (!s.enough) { console.log(`  ?  Is the ${s.stage} token shape right?\n     ${s.why}`); waiting++; }
    else if (s.finding) { console.log(`  !  The ${s.stage} token shape is off\n     ${s.why}  (n=${s.n})`); findings++; }
    else console.log(`  .  The ${s.stage} token shape\n     ${s.why}  (n=${s.n})`);
  }
  console.log(`\n  ${findings} finding(s), ${waiting} question(s) still waiting on evidence.`);
  console.log("  Rates and differences with sample counts beside them. Not a significance test.");
  console.log("  Retro reports. A person edits the config: a process that tunes its own");
  console.log("  safety thresholds from its own small sample will talk itself into anything.");
}

function main() {
  const configPath = arg("config", "dstack.config.json");
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { config = {}; }
  const file = arg("ledger", LEDGER);

  // --record <type> k=v k=v ...  One row, from a stage, at the point the
  // thing being recorded actually happened. This is the writer the ledger
  // was merged without.
  if (has("record")) {
    const i = process.argv.indexOf("--record");
    const type = process.argv[i + 1];
    if (!type || !TYPES.has(type)) { console.error(`usage: retro.cjs --record <${[...TYPES].join("|")}> key=value ...`); process.exit(2); }
    const entry = { t: type, at: arg("at", "") || null };
    for (const kv of process.argv.slice(i + 2)) {
      const eq = kv.indexOf("=");
      if (eq === -1 || kv.startsWith("--")) continue;
      const k = kv.slice(0, eq), v = kv.slice(eq + 1);
      // Coerce only when the number round trips back to the same string.
      // "12" is a number. "0055630" is a sha: coercing it drops the leading
      // zeros, the row never joins to its decision, and that PR silently
      // contributes to no rate at all, which reads exactly like having fewer
      // PRs rather than like losing one.
      const asNum = Number(v);
      const roundTrips = v !== "" && Number.isFinite(asNum) && String(asNum) === v;
      entry[k] = v === "true" ? true : v === "false" ? false : (roundTrips ? asNum : v);
    }
    const res = record(entry, { file, enabled: (config.retro || {}).enabled });
    if (!res.ok) { console.error(`Retro did not record: ${res.reason}`); process.exit(1); }
    console.log(`Recorded a ${type} row in ${res.file}.`);
    process.exit(0);
  }

  if (has("collect")) {
    const decisions = collectDecisions(arg("routing-dir", ".dstack/routing"));
    const pr = Number(arg("pr", 0)) || null;
    const head = arg("head", null);
    let n = 0;
    for (const d of decisions) { if (record(Object.assign({ at: arg("at", ""), pr, head }, d), { file, enabled: (config.retro || {}).enabled }).ok) n++; }
    console.log(`Collected ${n} decision row(s) into ${file}.`);
    process.exit(0);
  }

  const { rows, corrupt, missing } = load(file);
  if (missing) { console.log(`No ledger at ${file} yet. Nothing has been recorded.\nRun the stages, then --collect, then --fit.`); process.exit(0); }
  report(fit(rows, config), corrupt);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { record, load, fit, compare, joinOutcomes, collectDecisions, adaptGateRounds, LEDGER, TYPES, DEFAULT_MINS };
