#!/usr/bin/env node
// Fixtures for exec.cjs. The subject is the constraint, not the network: a
// runner that can only produce text cannot do work that edits files, and the
// refusal has to happen before anything runs.
"use strict";

const e = require("./exec.cjs");

const ROUTING = {
  runners: { gateway: { kind: "text" }, codex: { kind: "agent" }, mystery: {} },
  models: {
    "ds/flash": { runner: "gateway", in: 0.13, out: 0.26 },
    codex: { runner: "codex", in: null, out: null },
    odd: { runner: "mystery", in: 1, out: 1 },
    orphan: { runner: "nowhere", in: 1, out: 1 },
  },
  stages: {
    build: { needs: "agent" },
    gate: { needs: ["text", "agent"] },
    plan: { needs: "text" },
    loose: {},
  },
};
const can = (stage, model) => e.canRun({ stage, model }, ROUTING.stages[stage], ROUTING);

const CASES = [
  ["a text runner is refused agent work, and told why", () => {
    const r = can("build", "ds/flash");
    return [r.ok === false, /runs as text and this stage needs agent/.test(r.why),
            /has to edit files and read back what changed/.test(r.why)];
  }],
  ["an agent runner does agent work", () => [can("build", "codex").ok === true]],
  ["a stage accepting both kinds accepts both", () => {
    return [can("gate", "ds/flash").ok === true, can("gate", "codex").ok === true];
  }],
  ["an agent runner is refused text-only work", () => {
    const r = can("plan", "codex");
    return [r.ok === false, /runs as agent and this stage needs text/.test(r.why)];
  }],
  ["a stage that declares no need accepts anything capable", () => {
    return [can("loose", "ds/flash").ok === true, can("loose", "codex").ok === true];
  }],
  ["a runner whose kind is undeclared is refused, not assumed", () => {
    const r = can("gate", "odd");
    // Assuming a kind is how a build ends up returning a paragraph.
    return [r.ok === false, /declares no kind/.test(r.why)];
  }],
  ["a runner the config never mentions is refused", () => {
    return [can("gate", "orphan").ok === false];
  }],
  ["a model the catalog does not contain is refused by name", () => {
    const r = can("gate", "ghost");
    return [r.ok === false, /no model called "ghost"/.test(r.why)];
  }],
  ["the router and the executor answer the same question the same way", () => {
    const route = require("./route.cjs");
    const checks = [];
    for (const stage of ["build", "gate", "plan"]) {
      for (const id of ["ds/flash", "codex"]) {
        const rule = Object.assign({ name: stage }, ROUTING.stages[stage]);
        // Drift between these two is a stage routing to a model the executor
        // then refuses, which nothing notices until someone runs it.
        checks.push(route.runnerCanDo(ROUTING.models[id], rule, ROUTING) === can(stage, id).ok);
      }
    }
    return checks;
  }],
  ["a refusal is a state with a fallback, never a crash", async () => {
    const res = await e.run({ stage: "build", model: "ds/flash" }, { prompt: "x" }, { routing: ROUTING }, {});
    return [res.ok === false, res.refused === true, typeof res.fallback === "string", /needs agent/.test(res.reason)];
  }],
  ["cost is estimated from real usage, and absent when the model is unpriced", () => {
    return [e.estimate({ in: 0.13, out: 0.26 }, { prompt_tokens: 1000000, completion_tokens: 0 }) === 0.13,
            e.estimate({ in: null, out: null }, { prompt_tokens: 100 }) === null,
            e.estimate({ in: 1, out: 1 }, null) === null];
  }],
];

(async () => {
  let pass = 0;
  const failures = [];
  for (const [name, fn] of CASES) {
    let checks;
    try { checks = await fn(); }
    catch (err) { failures.push(`${name}\n      threw: ${err.message}`); continue; }
    if (checks.every(Boolean)) pass++;
    else failures.push(`${name}\n      check ${checks.findIndex((c) => !c) + 1} of ${checks.length} failed`);
  }
  if (failures.length) {
    console.error(`Dstack exec fixtures FAILED: ${failures.length} of ${CASES.length}`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`Dstack exec fixtures OK: ${pass} of ${CASES.length}, no network`);
  process.exit(0);
})();
