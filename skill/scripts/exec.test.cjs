#!/usr/bin/env node
// Fixtures for exec.cjs. The subject is the constraint, not the network: a
// runner that can only produce text cannot do work that edits files, and the
// refusal has to happen before anything runs.
"use strict";

const e = require("./exec.cjs");

const ROUTING = {
  runners: { gateway: { kind: "text" }, codex: { kind: "agent", command: "codex", args: ["exec"] }, mystery: {} },
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
    // Every stage against every model, including the combinations the earlier
    // version of this fixture skipped: an undeclared runner kind and a stage
    // that declares no need. That pair is exactly where the two bodies
    // disagreed while this fixture reported they agreed.
    for (const stage of Object.keys(ROUTING.stages)) {
      for (const id of Object.keys(ROUTING.models)) {
        const rule = Object.assign({ name: stage }, ROUTING.stages[stage]);
        checks.push(route.runnerCanDo(Object.assign({ id }, ROUTING.models[id]), rule, ROUTING) === can(stage, id).ok);
      }
    }
    return checks;
  }],
  ["R4a an unknown runner kind is refused by both, not allowed by one", () => {
    const route = require("./route.cjs");
    const rule = { name: "loose" };
    const m = Object.assign({ id: "odd" }, ROUTING.models.odd);
    return [route.runnerCanDo(m, rule, ROUTING) === false, can("loose", "odd").ok === false];
  }],
  ["R4b an agent runner is invoked non-interactively, as it declares", () => {
    const inv = e.runnerCommand({ runner: "codex" }, ROUTING);
    const bare = e.runnerCommand({ runner: "grok" }, ROUTING);
    // A bare `codex` waits for a TTY a piped child does not have, so a routed
    // build would hang instead of building.
    return [inv.command === "codex", inv.args[0] === "exec", bare.command === "grok", Array.isArray(bare.args)];
  }],
  ["R4c a CLI that ignores SIGTERM is killed, and nothing resolves until it dies", async () => {
    const start = Date.now();
    // Guarded: without the SIGKILL escalation this never resolves at all, and
    // a fixture that hangs tells you less than one that fails.
    const res = await Promise.race([
      e.cli(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);"], "", 300, 400),
      new Promise((r) => setTimeout(() => r({ ok: false, hung: true }), 5000)),
    ]);
    const elapsed = Date.now() - start;
    if (res.hung) return [false];
    // The old version resolved the moment it sent SIGTERM, so Dstack started
    // its fallback while an agent with write access was still running.
    return [res.ok === false, res.timedOut === true, /did not finish in 300ms and was stopped/.test(res.reason), elapsed >= 600];
  }],
  ["R4d a CLI that exits cleanly is read as success", async () => {
    const res = await e.cli(process.execPath, ["-e", "process.stdout.write('done')"], "", 5000);
    const bad = await e.cli(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(3)"], "", 5000);
    return [res.ok === true, res.text === "done", bad.ok === false, /exited 3/.test(bad.reason)];
  }],
  ["R4e a command that does not exist fails rather than hanging", async () => {
    const res = await e.cli("definitely-not-a-real-command-xyz", [], "", 5000);
    return [res.ok === false, /could not start/.test(res.reason)];
  }],
  ["a refusal is a state with a fallback, never a crash", async () => {
    const res = await e.run({ stage: "build", model: "ds/flash" }, { prompt: "x" }, { routing: ROUTING }, {});
    return [res.ok === false, res.refused === true, typeof res.fallback === "string", /needs agent/.test(res.reason)];
  }],
  ["R4f a completion that stopped early is a failure, not a short answer", () => {
    const cut = e.readCompletion({ choices: [{ message: { content: "half a review" }, finish_reason: "length" }] }, "m");
    const filt = e.readCompletion({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }, "m");
    const whole = e.readCompletion({ choices: [{ message: { content: "a whole review" }, finish_reason: "stop" }] }, "m");
    const none = e.readCompletion({ choices: [] }, "m");
    const legacy = e.readCompletion({ choices: [{ message: { content: "ok" } }] }, "m");
    return [
      // Half a gate review that looks whole is worse than no review.
      cut.ok === false, /stopped early \(length\)/.test(cut.reason), cut.partial === "half a review",
      filt.ok === false, whole.ok === true, whole.text === "a whole review",
      none.ok === false, /no message/.test(none.reason),
      // A provider that omits finish_reason entirely is not thereby truncated.
      legacy.ok === true,
    ];
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
