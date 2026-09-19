#!/usr/bin/env node
// Dstack's router. It decides what a stage costs, and writes down why.
//
// Split in two halves on purpose:
//
//   measure()  asks Jev one question set and returns the answers. It touches
//              the network, so nothing here is tested by the fixtures.
//   decide()   is pure. Answers and config in, a tier and a sentence out. No
//              network, no clock, no environment. This half holds the policy,
//              and this half is what route.test.cjs proves.
//
// The questions describe the work. No model name ever appears in one, so the
// question set does not go stale when the lineup changes. Jev measures, the
// config prices, and the two are separate files on purpose.
"use strict";

const fs = require("fs");
const path = require("path");
const jev = require("./jev.cjs");

// ---------------------------------------------------------------------------
// The question set. One call per stage: Jev answers all of them in one query.
// ---------------------------------------------------------------------------

const RISK_QUESTIONS = {
  blast_radius: {
    type: "score",
    instructions: "How far through the system does this change reach?",
    criteria: [
      "One file, and nothing else calls into what changed",
      "One module, with callers inside it only",
      "Several modules, or a shared helper many callers use",
      "A boundary the whole system depends on: schema, auth, money, or a public contract",
    ],
  },
  ambiguity: {
    type: "score",
    instructions: "How much does this work leave to the judgment of whoever does it?",
    criteria: [
      "Fully specified: the edits are named and there is one way to make them",
      "Mostly specified, with small choices left open",
      "The goal is clear but the approach is not decided",
      "The problem itself is still being worked out",
    ],
  },
  irreversibility: {
    type: "score",
    instructions: "If this turns out to be wrong after it reaches customers, how hard is it to undo?",
    criteria: [
      "Revert the commit and it is over",
      "Revert, plus a deploy or a cache to clear",
      "Data was written or migrated, and undoing needs a repair step",
      "Money moved, messages were sent, or data was destroyed; it cannot be undone",
    ],
  },
  security_relevant: {
    type: "noul",
    instructions: "Does this change touch authentication, authorization, tenant isolation, secrets, or the handling of untrusted input?",
  },
  mechanical: {
    type: "noul",
    instructions: "Is this a mechanical change that follows an existing pattern already present in the codebase, rather than one that requires a new idea?",
  },
  surface: {
    type: "choice",
    instructions: "Which part of the product does this change sit in?",
    criteria: {
      auth: "Login, sessions, permissions, tenant isolation, secrets",
      money: "Billing, charges, refunds, subscriptions, payouts",
      migration: "Database schema changes, backfills, or data rewrites",
      data: "Reads and writes of customer records outside of a migration",
      messaging: "Anything that sends to a customer: email, SMS, calls, push",
      ui: "What a person sees and clicks, with no change to what is stored",
      internal: "Tooling, build, configuration, or code no customer path reaches",
      docs: "Documentation, comments, or copy with no behavior change",
    },
  },
};

const VISIBILITY_QUESTION = {
  user_visible: {
    type: "noul",
    instructions: "After this change, would a person using the product notice a difference in what they see on screen or what happens when they click? Answer yes if the difference is only visible in a state that is hard to reach.",
  },
};

const QUESTION_SETS = {
  plan: RISK_QUESTIONS,
  build: RISK_QUESTIONS,
  gate: RISK_QUESTIONS,
  see: Object.assign({}, RISK_QUESTIONS, VISIBILITY_QUESTION),
};

// ---------------------------------------------------------------------------
// decide(): pure. This is the policy.
// ---------------------------------------------------------------------------

function tierIndex(ladderOrder, tier) {
  const i = ladderOrder.indexOf(tier);
  return i === -1 ? null : i;
}

// The risk index: a weighted sum over every answer that carries a number,
// each normalized to 0..1 first so a score and a noul are comparable. A choice
// carries no number; it acts through the surface floors instead.
function riskIndex(readings, weights) {
  let risk = 0;
  const parts = [];
  for (const [name, w] of Object.entries(weights)) {
    const r = readings[name];
    if (!r || r.value === null) continue;
    const contribution = w * r.value;
    risk += contribution;
    parts.push({ name, weight: w, value: Number(r.value.toFixed(3)), contribution: Number(contribution.toFixed(3)) });
  }
  parts.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { risk: Number(risk.toFixed(3)), parts };
}

function bandFor(risk, bands) {
  for (const b of bands) if (risk <= b.upTo) return b.tier;
  return bands[bands.length - 1].tier;
}

// The confidence the decision rests on: the least certain answer that fed it.
// A set is only as calibrated as its weakest reading.
function decidingConfidence(readings, weights) {
  let worst = null;
  for (const name of Object.keys(weights)) {
    const r = readings[name];
    if (!r) continue;
    if (worst === null || r.confidence < worst.confidence) worst = { name, confidence: r.confidence };
  }
  const surface = readings.surface;
  if (surface && (worst === null || surface.confidence < worst.confidence)) worst = { name: "surface", confidence: surface.confidence };
  return worst;
}

// decide(stage, answers, routing) -> a decision object, always.
// answers may be null, which is how a router failure arrives here.
function decide(stage, answers, routing) {
  const rule = (routing.stages || {})[stage];
  if (!routing.enabled) return offDecision(stage, rule, "routing is off in the config");
  if (!rule) return offDecision(stage, rule, `the config has no routing rule for ${stage}`);

  const order = routing.ladderOrder || Object.keys(routing.tiers || {});
  const readings = {};
  if (answers) for (const [k, v] of Object.entries(answers)) { const r = jev.reading(v); if (r) readings[k] = r; }

  // Binary stages answer "does this apply at all", not "what should it cost".
  if (rule.kind === "binary") {
    const r = readings[rule.question];
    if (!r) return { stage, kind: "binary", applies: true, tier: null, why: rule.onUnknown || "the router could not say, so this stage runs", routed: false, confidence: null, risk: null, parts: [], answers: answers || null };
    const applies = r.value >= rule.appliesAtOrAbove;
    const pct = Math.round(r.value * 100);
    return {
      stage, kind: "binary", applies, tier: null, routed: true,
      why: applies
        ? `${pct} in 100 that a customer would see a difference, so this stage runs`
        : `${pct} in 100 that a customer would see a difference, below the ${Math.round(rule.appliesAtOrAbove * 100)} in 100 mark, so this stage is not applicable`,
      confidence: Number(r.confidence.toFixed(3)), risk: null, parts: [], answers,
    };
  }

  // A router failure is not a cheap answer. It is the stage default.
  if (!answers || !Object.keys(readings).length) {
    return {
      stage, kind: "ladder", tier: rule.default, routed: false, applies: true,
      why: `the router did not answer, so this stage runs at its default, ${rule.default}`,
      confidence: null, risk: null, parts: [], floorApplied: null, escalated: false, answers: null,
    };
  }

  const { risk, parts } = riskIndex(readings, routing.weights || {});
  const measured = bandFor(risk, routing.bands || [{ upTo: Infinity, tier: rule.default }]);

  // Floors. The stage declares one. The surface declares one. The higher wins,
  // and nothing below it is reachable, whatever the index computed.
  const surfaceName = readings.surface ? readings.surface.label : null;
  // A surface floor says how hard a change must be scrutinized. Build is not a
  // scrutiny stage: the plan already did the thinking, so a stage may opt out.
  const honorsSurface = rule.surfaceFloorsApply !== false;
  const surfaceFloor = surfaceName && honorsSurface ? (routing.surfaceFloors || {})[surfaceName] : null;
  let floor = rule.floor;
  let floorSource = `the ${stage} floor`;
  if (surfaceFloor && tierIndex(order, surfaceFloor) > tierIndex(order, floor)) { floor = surfaceFloor; floorSource = `the ${surfaceName} surface`; }

  let tier = measured;
  let floorApplied = null;
  if (tierIndex(order, tier) < tierIndex(order, floor)) { tier = floor; floorApplied = floorSource; }

  // Uncertainty costs money, never safety: a weak reading routes one rung up.
  const worst = decidingConfidence(readings, routing.weights || {});
  const threshold = routing.escalateBelowConfidence != null ? routing.escalateBelowConfidence : 0;
  let escalated = false;
  if (worst && worst.confidence < threshold) {
    const up = order[Math.min(order.length - 1, tierIndex(order, tier) + 1)];
    if (up !== tier) { tier = up; escalated = true; }
  }

  // The ceiling saves money, but it may never reach below a floor.
  if (rule.ceiling && tierIndex(order, tier) > tierIndex(order, rule.ceiling)) {
    const capped = tierIndex(order, rule.ceiling) < tierIndex(order, floor) ? floor : rule.ceiling;
    tier = capped;
  }

  const top = parts[0];
  const why = buildWhy({ tier, measured, floorApplied, escalated, worst, top, risk, surfaceName, rule, order });
  const spend = (routing.tiers || {})[tier] || null;

  return {
    stage, kind: "ladder", tier, runner: spend ? spend.runner : null, effort: spend ? spend.effort : null,
    routed: true, applies: true, why, risk, parts, measured, floorApplied, escalated,
    confidence: worst ? Number(worst.confidence.toFixed(3)) : null, surface: surfaceName,
    skippable: rule.skipAtOrBelow ? tierIndex(order, tier) <= tierIndex(order, rule.skipAtOrBelow) : false,
    answers,
  };
}

function offDecision(stage, rule, reason) {
  return { stage, kind: "off", tier: rule ? rule.default : null, routed: false, applies: true, why: reason, confidence: null, risk: null, parts: [], answers: null };
}

// The sentence the owner reads. No model jargon, one reason, the loudest first.
function buildWhy(d) {
  if (d.floorApplied && d.floorApplied.includes("surface")) return `${d.surfaceName} is involved, and ${d.floorApplied} is never reviewed below ${d.tier}`;
  if (d.escalated) return `the reading on ${d.worst.name} was not confident (${Math.round(d.worst.confidence * 100)} in 100), so this went up a rung to ${d.tier}`;
  if (d.floorApplied) return `measured as ${d.measured}, raised to ${d.tier} because ${d.floorApplied} does not go lower`;
  if (d.top) return `risk index ${d.risk}, driven by ${d.top.name.replace(/_/g, " ")}`;
  return `risk index ${d.risk}`;
}

// ---------------------------------------------------------------------------
// measure(): the half that talks to the router.
// ---------------------------------------------------------------------------

async function measure(stage, state, routing) {
  const questions = QUESTION_SETS[stage];
  if (!questions) return { ok: false, reason: `there is no question set for ${stage}`, answers: null };
  return jev.ask(state, questions, {
    endpoint: routing.endpoint, model: routing.model, apiKeyEnv: routing.apiKeyEnv, timeoutMs: routing.timeoutMs,
  });
}

// route(): measure, then decide, then hand back something writable.
async function route(stage, state, config) {
  const routing = (config && config.routing) || { enabled: false };
  if (!routing.enabled) return Object.assign(decide(stage, null, routing), { usage: null });
  const res = await measure(stage, state, routing);
  const decision = decide(stage, res.ok ? res.answers : null, routing);
  if (!res.ok) {
    decision.why = decision.kind === "binary"
      ? `the router did not answer (${res.reason}), so this stage runs`
      : `the router did not answer (${res.reason}), so this stage runs at its default, ${decision.tier}`;
  }
  decision.usage = res.usage || null;
  decision.router = res.ok ? (res.model || routing.model) : `unavailable: ${res.reason}`;
  return decision;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const stage = arg("stage");
  if (!stage) { console.error("usage: route.cjs --stage <plan|build|gate|see> [--state-file f.json] [--config dstack.config.json] [--out f.json]"); process.exit(2); }
  const configPath = arg("config", "dstack.config.json");
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
  catch { console.error(`Dstack routing cannot run: ${configPath} is missing or is not json.`); process.exit(2); }

  const stateFile = arg("state-file");
  let state = {};
  if (stateFile) { try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { console.error(`Dstack routing cannot run: ${stateFile} is not json.`); process.exit(2); } }

  const decision = await route(stage, state, config);
  const out = arg("out");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(decision, null, 2) + "\n"); }

  if (decision.kind === "binary") console.log(`${stage}: ${decision.applies ? "applies" : "not_applicable"}, ${decision.why}`);
  else console.log(`${stage}: ${decision.tier}${decision.effort ? ` (${decision.runner} at ${decision.effort})` : ""}, ${decision.why}`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { decide, measure, route, riskIndex, bandFor, decidingConfidence, QUESTION_SETS, RISK_QUESTIONS, VISIBILITY_QUESTION };
