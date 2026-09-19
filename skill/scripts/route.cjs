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
    const pick = selectModel(rule.default, Object.assign({ name: stage }, rule), routing);
    return {
      stage, kind: "ladder", tier: rule.default, routed: false, applies: true,
      model: pick.model, runner: pick.runner, cost: pick.cost, model_why: pick.why, alternatives: pick.alternatives,
      effort: ((routing.tiers || {})[rule.default] || {}).effort || null,
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
  const pick = selectModel(tier, Object.assign({ name: stage }, rule), routing);

  return {
    stage, kind: "ladder", tier,
    model: pick.model, runner: pick.runner || (spend ? spend.runner : null), effort: spend ? spend.effort : null,
    cost: pick.cost, model_why: pick.why, alternatives: pick.alternatives,
    routed: true, applies: true, why, risk, parts, measured, floorApplied, escalated,
    confidence: worst ? Number(worst.confidence.toFixed(3)) : null, surface: surfaceName,
    skippable: rule.skipAtOrBelow ? tierIndex(order, tier) <= tierIndex(order, rule.skipAtOrBelow) : false,
    answers,
  };
}

// ---------------------------------------------------------------------------
// Choosing the model. Pure, like decide(): catalog and tier in, one row out.
//
// The router never decides what a model is capable of. The catalog says which
// tiers each model serves, and that line is the owner's to write. All the
// router does is pick the cheapest model the owner already said could do the
// job, which is why this can lower a bill and cannot lower a standard.
//
// Cheapest is per stage, not global. A gate reads eighty thousand tokens and
// writes six; a build writes twenty. A model with cheap input and dear output
// wins one and loses the other, so the estimate uses the stage's own shape.
// ---------------------------------------------------------------------------

// `serves` answers "what is this model trusted with", and the honest answer is
// often "depends what you are asking it to do". Writing code and adversarially
// reviewing code are different jobs, and a model can be strong at one and weak
// at the other. So serves takes either shape:
//
//   serves: ["skim", "standard"]                        the same everywhere
//   serves: { build: ["skim","deep"], gate: ["skim"] }   per stage
//
// The per stage form exists because Dstack is asymmetric about where mistakes
// get caught. A build passes through Prove and then Gate before it can ship, so
// a weak builder is caught by two later stages. A gate passes through nothing:
// it is the last line. Trust on the generation side is recoverable. Trust on
// the judgment side is not.
function servesTier(model, tier, stage) {
  const s = model.serves;
  if (Array.isArray(s)) return s.includes(tier);
  if (s && typeof s === "object") {
    const forStage = s[stage] !== undefined ? s[stage] : s.default;
    return Array.isArray(forStage) ? forStage.includes(tier) : false;
  }
  return false;
}

function estimateCost(model, typical) {
  if (!model || model.in == null || model.out == null || !typical) return null;
  const cost = ((typical.in || 0) * model.in + (typical.out || 0) * model.out) / 1e6;
  return Number(cost.toFixed(4));
}

function selectModel(tier, rule, routing) {
  const catalog = routing.models || {};
  const typical = (rule && rule.typical) || null;
  const rows = Object.entries(catalog)
    .filter(([id, m]) => !id.startsWith("$") && m && !m.disabled && servesTier(m, tier, rule && rule.name))
    .map(([id, m]) => ({ id, runner: m.runner || id, provider: m.provider || null, cost: estimateCost(m, typical), in: m.in, out: m.out, context: m.context }));

  if (!rows.length) return { model: null, runner: null, cost: null, why: `no model in the catalog serves ${tier}`, alternatives: [] };

  // A pin skips ranking, but only to a model the owner said serves this tier.
  const pinned = rule && rule.pin ? rows.find((r) => r.id === rule.pin) : null;
  if (rule && rule.pin && !pinned) {
    return { model: null, runner: null, cost: null, why: `${stageSafe(rule)} is pinned to ${rule.pin}, which the catalog does not list as serving ${tier}`, alternatives: rows, pinFailed: true };
  }

  const priced = rows.filter((r) => r.cost != null).sort((a, b) => a.cost - b.cost);
  const unpriced = rows.filter((r) => r.cost == null);
  const alternatives = priced.concat(unpriced);

  if (pinned) return { model: pinned.id, runner: pinned.runner, cost: pinned.cost, why: `pinned to ${pinned.id}`, alternatives, pinned: true };

  if (!priced.length) {
    const first = unpriced[0];
    return { model: first.id, runner: first.runner, cost: null, why: `${first.id} serves ${tier} and carries no per token price, so it cannot be ranked on cost`, alternatives };
  }

  const best = priced[0];
  const next = priced[1];
  const why = next
    ? `cheapest of ${priced.length} that serve ${tier}: about $${best.cost.toFixed(2)} a run against $${next.cost.toFixed(2)} for ${next.id}`
    : `the only priced model that serves ${tier}, about $${best.cost.toFixed(2)} a run`;
  return { model: best.id, runner: best.runner, cost: best.cost, why, alternatives };
}

function stageSafe(rule) { return (rule && rule.name) || "this stage"; }

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
    provider: routing.provider, endpoint: routing.endpoint, model: routing.model,
    apiKeyEnv: routing.apiKeyEnv, apiKeyFile: routing.apiKeyFile, timeoutMs: routing.timeoutMs,
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

function explain(config) {
  const routing = (config && config.routing) || {};
  const order = routing.ladderOrder || [];
  console.log("Model catalog. Prices are dollars per million tokens, from your config.\n");
  const rows = Object.entries(routing.models || {}).filter(([id]) => !id.startsWith("$"));
  console.log("  " + "model".padEnd(30) + "in".padStart(7) + "out".padStart(8) + "  trusted with");
  const servesLabel = (m) => {
    if (m.disabled) return "disabled, out of the catalog";
    if (Array.isArray(m.serves)) return m.serves.length ? m.serves.join(", ") : "nothing yet (inert)";
    if (m.serves && typeof m.serves === "object") {
      const parts = Object.entries(m.serves).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k}: ${v.join("/")}`);
      return parts.length ? parts.join("  ") : "nothing yet (inert)";
    }
    return "nothing yet (inert)";
  };
  for (const [id, m] of rows) {
    const serves = servesLabel(m);
    console.log("  " + id.padEnd(30) + (m.in == null ? "n/a" : m.in.toFixed(2)).padStart(7) + (m.out == null ? "n/a" : m.out.toFixed(2)).padStart(8) + "  " + serves);
  }

  for (const [stage, rule] of Object.entries(routing.stages || {})) {
    if (rule.kind === "binary") continue;
    const t = rule.typical;
    console.log(`\n  ${stage}: reads about ${t ? t.in.toLocaleString() : "?"} tokens, writes about ${t ? t.out.toLocaleString() : "?"}`);
    for (const tier of order) {
      if (order.indexOf(tier) < order.indexOf(rule.floor) || order.indexOf(tier) > order.indexOf(rule.ceiling)) continue;
      const pick = selectModel(tier, Object.assign({ name: stage }, rule), routing);
      const alts = pick.alternatives.map((a) => `${a.id} ${a.cost == null ? "n/a" : "$" + a.cost.toFixed(2)}`).join(", ");
      const note = pick.pinned ? "pinned, ranking skipped" : pick.cost == null ? "unpriced" : "$" + pick.cost.toFixed(2) + " a run";
      console.log(`    ${tier.padEnd(9)} -> ${String(pick.model).padEnd(30)} ${note}`);
      console.log(`    ${"".padEnd(9)}    ${pick.pinned ? "would have ranked" : "ranked"}: ${alts}`);
    }
  }
  console.log("\n  The catalog's serves list is yours to write. The router only ever picks the");
  console.log("  cheapest model you already said could do the job, so it lowers a bill and");
  console.log("  never a standard.");
}

async function main() {
  const wantsExplain = process.argv.includes("--explain");
  const stage = arg("stage");
  if (!stage && !wantsExplain) { console.error("usage: route.cjs --stage <plan|build|gate|see> [--state-file f.json] [--config dstack.config.json] [--head <full sha>] [--out f.json]\n       route.cjs --explain [--config dstack.config.json]"); process.exit(2); }
  const configPath = arg("config", "dstack.config.json");
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
  catch { console.error(`Dstack routing cannot run: ${configPath} is missing or is not json.`); process.exit(2); }
  if (wantsExplain) { explain(config); process.exit(0); }

  const stateFile = arg("state-file");
  let state = {};
  if (stateFile) { try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { console.error(`Dstack routing cannot run: ${stateFile} is not json.`); process.exit(2); } }

  const decision = await route(stage, state, config);
  // The artifact carries the commit it is about. Retro matches on this, not on
  // the filename, because a filename carries seven characters and a head is
  // forty. Without it an artifact cannot be attributed and is skipped.
  const head = arg("head", state && state.head ? state.head : null);
  if (head) decision.head = head;
  const out = arg("out");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(decision, null, 2) + "\n"); }

  if (decision.kind === "binary") console.log(`${stage}: ${decision.applies ? "applies" : "not_applicable"}, ${decision.why}`);
  else console.log(`${stage}: ${decision.tier} -> ${decision.model || decision.runner}${decision.effort ? ` at ${decision.effort}` : ""}${decision.cost != null ? `, about $${decision.cost.toFixed(2)} a run` : ""}\n  tier: ${decision.why}\n  model: ${decision.model_why || "no catalog"}`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { decide, measure, route, selectModel, servesTier, estimateCost, riskIndex, bandFor, decidingConfidence, QUESTION_SETS, RISK_QUESTIONS, VISIBILITY_QUESTION };
