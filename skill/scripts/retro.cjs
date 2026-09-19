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

// What each row must carry to be usable later. This is the single source: a
// row type without an entry here fails the verifier, so the class cannot come
// back under a new name when someone adds a sixth type.
//
// The reason these are required and not merely documented: a decision joins to
// an outcome on pr and head. An outcome written without a head keys as
// "12:undefined", matches no decision, and takes that decision out of every
// rate. Nothing errors. The PR simply stops existing, and the report reads as
// though there were fewer PRs rather than as though one was lost.
// Field and type. Presence alone is not enough: an outcome carrying pr and
// head but no `blocked` reads as blocked:false, so a round that reported
// nothing is counted as a round that passed. Silence is not a value, and
// inventing a result is the one thing this ledger may never do.
const ROW_SCHEMA = {
  decision:     { required: { pr: "number", head: "string", stage: "string" } },
  outcome:      { required: { pr: "number", head: "string", blocked: "boolean" } },
  usage:        { required: { stage: "string", in: "number", out: "number" } },
  adjudication: { required: { pr: "number", label: "string", confirmed: "boolean" } },
  ship:         { required: { pr: "number", rounds: "number" } },
};
const TYPES = new Set(Object.keys(ROW_SCHEMA));

// `t` decides how every later reader interprets the row. It is set by the
// subcommand and may never be set by a field, or a row can lie about itself.
const RESERVED_KEYS = new Set(["t"]);

function missingFields(entry) {
  const schema = ROW_SCHEMA[entry && entry.t];
  if (!schema) return null;
  const bad = [];
  for (const [field, want] of Object.entries(schema.required)) {
    const v = entry[field];
    if (v === undefined || v === null || v === "") { bad.push(`${field} (missing)`); continue; }
    if (typeof v !== want) bad.push(`${field} (must be a ${want}, got ${typeof v})`);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// The ledger. Append only, one JSON object per line.
// ---------------------------------------------------------------------------

function record(entry, opts) {
  const cfg = opts || {};
  if (cfg.enabled === false) return { ok: false, reason: "retro is off" };
  if (!entry || !TYPES.has(entry.t)) return { ok: false, reason: `a ledger row needs t as one of ${[...TYPES].join(", ")}` };
  const missing = missingFields(entry);
  if (missing.length) return { ok: false, reason: `a ${entry.t} row needs ${missing.join(" and ")}, or it can never be joined to anything` };
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
      // Also skip a row that is well formed but unusable: a hand edited ledger
      // is an input like any other, and the same rule has to hold on the way in.
      if (o && TYPES.has(o.t) && !missingFields(o).length) rows.push(o); else corrupt++;
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
    // Splitting on a value empties the upper half when the median IS the upper
    // value. Splitting on an index puts equal risks on both sides, so "above
    // the median" holds rows whose risk matches the group below it and the
    // answer turns on input order among ties. Neither is a split on risk.
    //
    // So: search the distinct risk values for a boundary giving two cohorts of
    // adequate size whose risks genuinely differ, and take the most balanced.
    // If none exists, this sample cannot answer the question at any size.
    const avg = (xs) => xs.reduce((s, p) => s + p.rounds, 0) / xs.length;
    const minCohort = Math.max(3, Math.floor(mins.minPairs / 4));
    const distinct = [...new Set(paired.map((p) => p.risk))].sort((a, b) => a - b);
    let best = null;
    for (const t of distinct.slice(0, -1)) {
      const loT = paired.filter((p) => p.risk <= t), hiT = paired.filter((p) => p.risk > t);
      if (loT.length < minCohort || hiT.length < minCohort) continue;
      const balance = Math.abs(loT.length - hiT.length);
      if (!best || balance < best.balance) best = { t, lo: loT, hi: hiT, balance };
    }
    if (!best) {
      riskFinding = { question: "Does the risk index predict how many gate rounds a change takes?", enough: false, n: paired.length,
                      why: distinct.length < 2
                        ? `not enough evidence yet: all ${paired.length} shipped PRs measured the same risk, so there is nothing to split on`
                        : `not enough evidence yet: no risk boundary splits these ${paired.length} PRs into two groups of at least ${minCohort} with genuinely different risk` };
      const all2 = findings.concat([riskFinding]);
      for (const f of all2) if (typeof f.n !== "number") throw new Error(`retro emitted a finding with no sample count: ${f.question}`);
      return { findings: all2, shapes, rows: rows.length };
    }
    const lo = best.lo, hi = best.hi;
    const diff = avg(hi) - avg(lo);
    riskFinding = { question: "Does the risk index predict how many gate rounds a change takes?", enough: true, finding: diff < 0.5, n: paired.length,
                    why: diff < 0.5
                      ? `it does not: above risk ${best.t} (n=${hi.length}) ${avg(hi).toFixed(1)} rounds, at or below (n=${lo.length}) ${avg(lo).toFixed(1)}. The index is not predicting anything.`
                      : `above risk ${best.t} (n=${hi.length}) ${avg(hi).toFixed(1)} rounds, at or below (n=${lo.length}) ${avg(lo).toFixed(1)}` };
  }

  // Every finding carries its sample count, or it is not a finding.
  const all = findings.concat([riskFinding]);
  for (const f of all) if (typeof f.n !== "number") throw new Error(`retro emitted a finding with no sample count: ${f.question}`);
  return { findings: all, shapes, rows: rows.length };
}

// ---------------------------------------------------------------------------
// collect(): read what the process already writes.
// ---------------------------------------------------------------------------

// `head` is required, not optional. The routing directory accumulates
// artifacts across PRs, and stamping all of them with the current pr and head
// records another PR's decision as belonging to this one, where it joins to
// this PR's outcome and reports a result about work that never happened.
// The sha is in the filename because that is how route.cjs --out writes it.
function collectDecisions(dir, head) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("state-")); } catch { return []; }
  if (!head) return [];

  const out = [];
  for (const n of names) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")); } catch { continue; }
    if (!d || !d.stage) continue;
    // Provenance is carried, never inferred. A filename gives seven characters
    // and a head is forty; two commits share a seven character prefix often
    // enough that an old PR's artifact would be attributed to this one, join
    // to this one's outcome, and report on work that never happened. An
    // artifact with no head is skipped rather than guessed at.
    if (d.head !== head) continue;
    out.push({ t: "decision", head: d.head, stage: d.stage, tier: d.tier || null, model: d.model || null, risk: d.risk,
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
      if (RESERVED_KEYS.has(k)) { console.error(`Retro will not accept "${k}" as a field: it decides how every later reader interprets the row.`); process.exit(2); }
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
    const head = arg("head", null);
    if (!head) { console.error("Retro cannot collect without --head: the routing directory holds artifacts from other PRs, and stamping them with this one records decisions about work that never happened."); process.exit(2); }
    const decisions = collectDecisions(arg("routing-dir", ".dstack/routing"), head);
    const pr = Number(arg("pr", 0)) || null;
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

module.exports = { record, load, fit, compare, joinOutcomes, collectDecisions, adaptGateRounds, missingFields, LEDGER, TYPES, ROW_SCHEMA, RESERVED_KEYS, DEFAULT_MINS };
