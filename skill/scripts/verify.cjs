#!/usr/bin/env node
// Dstack's own pre-delivery check. Exit 0 means the skill files are ready.
// Structural, not substring: routing rows as (number, name, command) tuples,
// contract sections with five same-line fields, and the canonical stop-rule
// block compared byte for byte between the two files.
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const problems = [];

const ROUTES = [
  [1, "Intake", "intake"], [2, "Plan", "plan"], [3, "Build", "build"], [4, "Prove", "prove"],
  [5, "Gate", "gate"], [6, "See it", "see"], [7, "Ship", "ship"], [8, "Watch", "watch"], [9, "Retro", "retro"],
];
const STAGES = ROUTES.map((r) => r[2]);
const HEADINGS = ROUTES.map((r) => `## ${r[0]}. ${r[1]}`);
const FIELDS = ["**Who:**", "**Needs:**", "**Produces:**", "**Owner reads:**", "**Stop:**"];
const files = ["SKILL.md", "references/stages.md", "references/pr-evidence.md", "references/class-rule.md", "references/routing.md", "references/triage.md", "references/state.md", "references/retro.md"];

for (const f of files) {
  if (!fs.existsSync(path.join(root, f))) problems.push(`${f}: missing`);
}
if (problems.length) report();
for (const f of files) {
  const dashes = (read(f).match(/\u2014/g) || []).length;
  if (dashes) problems.push(`${f}: ${dashes} em dash(es)`);
}

const skill = read("SKILL.md");
const contract = read("references/stages.md");
const evidence = read("references/pr-evidence.md");

// Description: exactly one single-line field, action verb, Use when, strictly under 300.
const fm = skill.split("---")[1] || "";
const descLines = fm.split("\n").filter((l) => /^description:/.test(l));
if (descLines.length !== 1) problems.push(`SKILL.md: expected exactly one single-line description, found ${descLines.length}`);
const desc = (descLines[0] || "").replace(/^description:\s*/, "");
if (desc.length >= 300) problems.push(`SKILL.md: description is ${desc.length} chars, must be under 300`);
if (!/^[A-Z][a-z]+ /.test(desc)) problems.push("SKILL.md: description must start with an action verb");
if (!/Use when/.test(desc)) problems.push("SKILL.md: description needs a Use when clause");
const words = skill.split(/\s+/).filter(Boolean).length;
// 1700, unchanged since Plan 1. Routing and triage were fitted under it by
// moving the state schema to references/state.md, not by moving the number.
// A threshold that moves when it is inconvenient is the defect Plan 7 is about.
if (words > 1700) problems.push(`SKILL.md: ${words} words, limit 1700`);

// Routing table: each row is checked as its (number, name, command) tuple, in order.
const rows = skill.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
if (rows.length !== ROUTES.length) problems.push(`SKILL.md: routing table has ${rows.length} rows, expected ${ROUTES.length}`);
for (const [num, name, cmd] of ROUTES) {
  const row = rows.find((l) => new RegExp(`^\\|\\s*${num}\\s*\\|`).test(l));
  if (!row) { problems.push(`SKILL.md: routing table has no row ${num}`); continue; }
  const cells = row.split("|").map((c) => c.trim());
  if (cells[2] !== name) problems.push(`SKILL.md: row ${num} is named "${cells[2]}", expected "${name}"`);
  if (cells[3] !== `\`/dstack ${cmd}\``) problems.push(`SKILL.md: row ${num} routes to ${cells[3]}, expected \`/dstack ${cmd}\``);
}

// Contract: every heading, in order; every field on its own line with a value on that line.
let last = -1;
for (let i = 0; i < HEADINGS.length; i++) {
  const h = HEADINGS[i];
  const at = contract.indexOf(h + "\n");
  if (at === -1) { problems.push(`stages.md: missing ${h}`); continue; }
  if (at < last) problems.push(`stages.md: ${h} is out of order`);
  last = at;
  const nextAt = i + 1 < HEADINGS.length ? contract.indexOf(HEADINGS[i + 1] + "\n") : contract.indexOf("\n## Stop rules");
  const section = contract.slice(at, nextAt === -1 ? undefined : nextAt);
  for (const field of FIELDS) {
    const line = section.split("\n").find((l) => l.startsWith(field));
    if (!line) { problems.push(`stages.md: ${h} has no ${field} line`); continue; }
    if (!line.slice(field.length).trim()) problems.push(`stages.md: ${h} ${field} is empty`);
  }
  const stop = (section.split("\n").find((l) => l.startsWith("**Stop:**")) || "").slice("**Stop:**".length).trim();
  if (stop && !/^(S\d|none|see )/.test(stop)) problems.push(`stages.md: ${h} Stop must begin with an S-rule, "none", or "see ": got "${stop.slice(0, 30)}"`);
}

// Stop rules: canonical block, byte-identical in both files, with all six ids and the two load-bearing phrases.
const block = (text, name) => {
  const m = text.match(/<!-- dstack-stop-rules-begin -->\n([\s\S]*?)<!-- dstack-stop-rules-end -->/);
  if (!m) { problems.push(`${name}: no canonical stop-rule block`); return null; }
  return m[1];
};
const a = block(skill, "SKILL.md"), b = block(contract, "stages.md");
if (a !== null && b !== null && a !== b) problems.push("stop-rule block differs between SKILL.md and stages.md");
if (a) {
  for (const id of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]) if (!a.includes(`**${id} `)) problems.push(`stop rules: ${id} missing from the canonical block`);
  if (!/autoMergeOnPass/.test(a)) problems.push("stop rules: S6 must name autoMergeOnPass");
  if (!/BOTH/.test(a)) problems.push("stop rules: S1 must require BOTH the Codex verdict and the owner's yes");
}

// The triad: pre-flight and pre-delivery sections exist with real content.
for (const heading of ["## Pre-flight", "## Pre-delivery check"]) {
  const at = skill.indexOf(heading + "\n");
  if (at === -1) { problems.push(`SKILL.md: no ${heading} section`); continue; }
  const end = skill.indexOf("\n## ", at + heading.length);
  const body = skill.slice(at + heading.length, end === -1 ? undefined : end);
  if (body.trim().split("\n").filter((l) => l.trim()).length < 3) problems.push(`SKILL.md: ${heading} section is too short to be real`);
}

// The PR template carries every stage line and every required section.
for (const s of STAGES) if (!new RegExp(`^\\s*${s}:`, "m").test(evidence)) problems.push(`pr-evidence.md: Stages block has no line for ${s}`);
for (const section of ["## Claim", "## Evidence is about", "## Stages", "## Baseline proof", "## Proof ledger", "## Acceptance", "## Routing", "## Class", "## Out of scope", "## Deviations from the plan", "## Not verified", "## Risks and prerequisites", "## Rollback"]) {
  // Line anchored: "## Routing-renamed" contains "## Routing" and must not pass.
  if (!new RegExp(`^\\s*${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`, "m").test(evidence)) problems.push(`pr-evidence.md: missing ${section}`);
}

// The state schema lives in its own reference and names every stage; SKILL.md
// keeps only the vocabulary, which is all routing a stage actually needs.
const state = read("references/state.md");
for (const s of STAGES) if (!new RegExp(`"${s}":\\s*\\{`).test(state)) problems.push(`state.md: state file example has no "${s}" entry`);
if (!/`stale`/.test(skill)) problems.push("SKILL.md: state vocabulary must include stale");
if (!/references\/state\.md/.test(skill)) problems.push("SKILL.md: does not point at references/state.md");

// Routing: the policy is data, so the verifier reads the data and not the prose.
// Every tier a rule names must exist in the ladder, every weight must name a
// question the router actually asks, and the bands must climb.
(function routing() {
  const cfgPath = path.join(root, "..", "dstack.config.example.json");
  if (!fs.existsSync(cfgPath)) { problems.push("dstack.config.example.json: missing, routing policy cannot be checked"); return; }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
  catch (e) { problems.push(`dstack.config.example.json: not valid json (${e.message})`); return; }
  const r = cfg.routing;
  if (!r) { problems.push("dstack.config.example.json: no routing block"); return; }

  const providers = Object.keys(require("./jev.cjs").PROVIDERS);
  for (const [block, b] of [["routing", r], ["triage", cfg.triage]]) {
    if (b && b.provider && !providers.includes(b.provider)) problems.push(`${block}: provider "${b.provider}" is not one jev.cjs serves (${providers.join(", ")})`);
  }

  const order = r.ladderOrder || [];
  if (order.length < 2) problems.push("routing: ladderOrder needs at least two tiers");
  for (const t of order) if (!r.tiers || !r.tiers[t]) problems.push(`routing: ladderOrder names "${t}", which tiers does not define`);

  for (const [stage, rule] of Object.entries(r.stages || {})) {
    if (rule.kind === "binary") {
      if (!rule.question) problems.push(`routing: stage ${stage} is binary with no question`);
      if (typeof rule.appliesAtOrAbove !== "number") problems.push(`routing: stage ${stage} has no numeric appliesAtOrAbove`);
      continue;
    }
    for (const key of ["floor", "default", "ceiling"]) {
      if (!rule[key]) { problems.push(`routing: stage ${stage} has no ${key}`); continue; }
      if (!order.includes(rule[key])) problems.push(`routing: stage ${stage}.${key} is "${rule[key]}", not a tier in the ladder`);
    }
    if (rule.floor && rule.ceiling && order.indexOf(rule.ceiling) < order.indexOf(rule.floor))
      problems.push(`routing: stage ${stage} has ceiling "${rule.ceiling}" below floor "${rule.floor}"`);
    if (rule.skipAtOrBelow && !order.includes(rule.skipAtOrBelow)) problems.push(`routing: stage ${stage}.skipAtOrBelow is "${rule.skipAtOrBelow}", not a tier in the ladder`);
    // A default below the floor would make a router failure cheaper than a
    // successful route, which is the one thing routing must never be.
    if (rule.floor && rule.default && order.indexOf(rule.default) < order.indexOf(rule.floor))
      problems.push(`routing: stage ${stage} defaults to "${rule.default}", below its own floor "${rule.floor}": a router failure would buy less than a success`);
  }

  for (const [surface, tier] of Object.entries(r.surfaceFloors || {})) {
    if (surface.startsWith("$")) continue;
    if (!order.includes(tier)) problems.push(`routing: surfaceFloors.${surface} is "${tier}", not a tier in the ladder`);
  }

  // The catalog. A tier no model serves is a stage that can route nowhere, and
  // a price that is a string ranks as unpriced without anyone noticing.
  const models = Object.entries(r.models || {}).filter(([id]) => !id.startsWith("$"));
  if (!models.length) problems.push("routing: the models catalog is empty, so no stage can pick a model");
  const served = new Set();
  for (const [id, m] of models) {
    // An empty serves list is legal and means inert: in the catalog, trusted
    // with nothing, unpickable until a person writes that line. That is the
    // state a newly added model must arrive in.
    // serves is an array (every stage) or an object keyed by stage.
    let lists;
    if (Array.isArray(m.serves)) lists = { "*": m.serves };
    else if (m.serves && typeof m.serves === "object") lists = m.serves;
    else { problems.push(`routing: model ${id} has no serves list`); continue; }
    for (const [stage, tiers] of Object.entries(lists)) {
      if (!Array.isArray(tiers)) { problems.push(`routing: model ${id} serves.${stage} is not a list of tiers`); continue; }
      if (stage !== "*" && stage !== "default" && !(r.stages || {})[stage]) problems.push(`routing: model ${id} names serves.${stage}, which is not a stage`);
      for (const tier of tiers) {
        if (!order.includes(tier)) problems.push(`routing: model ${id} serves "${tier}", not a tier in the ladder`);
        else if (!m.disabled) served.add(tier);
      }
    }
    for (const key of ["in", "out"]) {
      if (m[key] != null && typeof m[key] !== "number") problems.push(`routing: model ${id}.${key} is ${typeof m[key]}, must be a number or null`);
    }
    if ((m.in == null) !== (m.out == null)) problems.push(`routing: model ${id} prices only one side, which cannot be estimated; set both or neither`);
  }
  for (const tier of order) if (!served.has(tier)) problems.push(`routing: no enabled model serves tier "${tier}"`);

  for (const [stage, rule] of Object.entries(r.stages || {})) {
    if (rule.kind === "binary") continue;
    if (rule.pin && !r.models[rule.pin]) problems.push(`routing: stage ${stage} is pinned to "${rule.pin}", which the catalog does not define`);
    if (rule.pin && r.models[rule.pin] && !require("./route.cjs").servesTier(r.models[rule.pin], rule.floor, stage))
      problems.push(`routing: stage ${stage} is pinned to "${rule.pin}", which does not serve that stage's floor "${rule.floor}"`);
    if (!rule.typical) { problems.push(`routing: stage ${stage} has no typical shape, so models cannot be ranked on cost`); continue; }
    for (const key of ["in", "out"]) {
      if (typeof rule.typical[key] !== "number") problems.push(`routing: stage ${stage}.typical.${key} is not a number`);
    }
  }

  let prev = -Infinity;
  for (const b of r.bands || []) {
    if (!order.includes(b.tier)) problems.push(`routing: a band names tier "${b.tier}", not in the ladder`);
    if (b.upTo <= prev) problems.push(`routing: bands must climb, ${b.upTo} follows ${prev}`);
    prev = b.upTo;
  }

  // Every weighted name must be a question the router asks, or it silently
  // contributes nothing and the index quietly means something else.
  let asked = new Set();
  try {
    const route = require("./route.cjs");
    for (const set of Object.values(route.QUESTION_SETS)) for (const k of Object.keys(set)) asked.add(k);
  } catch (e) { problems.push(`route.cjs: does not load (${e.message})`); }
  for (const name of Object.keys(r.weights || {})) {
    if (name.startsWith("$")) continue;
    if (!asked.has(name)) problems.push(`routing: weights name "${name}", which no question asks`);
  }
  for (const [stage, rule] of Object.entries(r.stages || {})) {
    if (rule.kind === "binary" && rule.question && !asked.has(rule.question))
      problems.push(`routing: stage ${stage} decides on "${rule.question}", which no question asks`);
  }
})();

// The skill must tell the reader where the routing contract lives.
if (!/references\/routing\.md/.test(skill)) problems.push("SKILL.md: does not point at references/routing.md");
if (!/references\/triage\.md/.test(skill)) problems.push("SKILL.md: does not point at references/triage.md");
if (!/references\/retro\.md/.test(skill)) problems.push("SKILL.md: does not point at references/retro.md");

// Retro: the refusal has to be real, not described. The minimums must be
// numbers, and the pure function must actually withhold a finding below them.
(function retro() {
  const cfgPath = path.join(root, "..", "dstack.config.example.json");
  if (!fs.existsSync(cfgPath)) return;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { return; }
  const t = cfg.retro;
  if (!t) { problems.push("dstack.config.example.json: no retro block"); return; }
  if (!Number.isInteger(t.minPerGroup) || t.minPerGroup < 2) problems.push("retro: minPerGroup must be an integer of at least 2");
  if (typeof t.minDifference !== "number" || t.minDifference < 0 || t.minDifference > 1) problems.push("retro: minDifference must be a proportion between 0 and 1");
  if (!Number.isInteger(t.minPairs) || t.minPairs < 2) problems.push("retro: minPairs must be an integer of at least 2");
  const contract = read("references/retro.md");
  if (!/not a significance test/i.test(contract)) problems.push("retro.md: must say plainly that this is not a significance test");
  if (!/does not carry its sample count is not a finding/.test(contract)) problems.push("retro.md: does not state the refusal");
  try {
    const mod = require("./retro.cjs");
    // Four rows against a minimum of twelve must withhold, whatever else changes.
    const rows = [];
    for (let i = 0; i < 4; i++) { rows.push({ t: "decision", pr: i, head: `h${i}`, stage: "build", tier: "skim", model: "m" }, { t: "outcome", pr: i, head: `h${i}`, blocked: true }); }
    for (let i = 10; i < 40; i++) { rows.push({ t: "decision", pr: i, head: `h${i}`, stage: "build", tier: "deep", model: "m" }, { t: "outcome", pr: i, head: `h${i}`, blocked: false }); }
    const res = mod.fit(rows, { retro: t });
    const f = res.findings.find((x) => /tier a change was built at/.test(x.question));
    if (!f || f.enough !== false) problems.push("retro: fit() reported on a group below minPerGroup, which S9 forbids");
    for (const x of res.findings) if (typeof x.n !== "number") problems.push("retro: fit() emitted a finding with no sample count");
    // The defect this check exists for: Retro was merged as a reader with no
    // writer. Every row type it reads must have a contract that produces it,
    // or the question that row answers is unanswerable and nobody notices,
    // because the report says "not enough evidence yet" either way.
    const contracts = read("references/stages.md") + read("references/pr-evidence.md");
    for (const type of mod.TYPES) {
      if (!new RegExp(`retro\\.cjs --record ${type}\\b`).test(contracts))
        problems.push(`retro: nothing produces a "${type}" row. A contract in stages.md must name "retro.cjs --record ${type}", or the questions it feeds can never be answered.`);
    }
  } catch (e) { problems.push(`retro.cjs: does not load (${e.message})`); }
})();

// Prices go stale the day a provider changes them. Something must say when to
// check, or catalog.cjs is a tool nobody is told to run.
if (!/catalog\.cjs/.test(read("references/stages.md") + skill))
  problems.push("catalog: no contract names catalog.cjs, so nothing says when to check prices against the gateway");

// Triage: thresholds must be numbers in range, and the invariant has to be
// stated where a reader of the contract will hit it.
(function triage() {
  const cfgPath = path.join(root, "..", "dstack.config.example.json");
  if (!fs.existsSync(cfgPath)) return;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { return; }
  const t = cfg.triage;
  if (!t) { problems.push("dstack.config.example.json: no triage block"); return; }
  const ranges = [
    ["infra.treatAsInfraAtOrAbove", t.infra && t.infra.treatAsInfraAtOrAbove],
    ["findings.inScopeAtOrAbove", t.findings && t.findings.inScopeAtOrAbove],
    ["findings.guardedAtOrAbove", t.findings && t.findings.guardedAtOrAbove],
    ["progress.sameIdeaAtOrAbove", t.progress && t.progress.sameIdeaAtOrAbove],
    ["classHits.rankAtOrAbove", t.classHits && t.classHits.rankAtOrAbove],
    ["plan.requireAtOrAbove", t.plan && t.plan.requireAtOrAbove],
  ];
  for (const [name, v] of ranges) {
    if (typeof v !== "number") problems.push(`triage: ${name} is not a number`);
    else if (v < 0 || v > 1) problems.push(`triage: ${name} is ${v}, must be a probability between 0 and 1`);
  }
  for (const [name, v] of [["findings.maxFindings", t.findings && t.findings.maxFindings], ["classHits.maxHits", t.classHits && t.classHits.maxHits]]) {
    if (!Number.isInteger(v) || v < 1) problems.push(`triage: ${name} must be a positive integer cap`);
  }
  const contract = read("references/triage.md");
  if (!/may only ever add work or add caution/.test(contract)) problems.push("triage.md: does not state the invariant");
  try {
    const mod = require("./triage.cjs");
    const verdicts = new Set();
    for (const v of [0.05, 0.5, 0.95]) verdicts.add(mod.judgePlan(Object.fromEntries(Object.keys(mod.PLAN_QUESTIONS).map((k) => [k, { type: "noul", noul: v }])), {}).verdict);
    for (const bad of ["ready", "approved", "pass"]) if (verdicts.has(bad)) problems.push(`triage: judgePlan can return "${bad}", which would let a reading approve a plan`);
  } catch (e) { problems.push(`triage.cjs: does not load (${e.message})`); }
})();

function report() {
  if (problems.length) {
    console.error("Dstack skill check FAILED");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`Dstack skill check OK: ${files.length} files, description ${desc.length} chars, SKILL.md ${words} words, ${ROUTES.length} stages routed and contracted, stop rules identical, routing, triage and retro policy resolve`);
  process.exit(0);
}
report();
