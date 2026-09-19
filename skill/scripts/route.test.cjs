#!/usr/bin/env node
// Fixtures for decide(), the pure half of the router.
//
// These run with no API key and no network. Each fixture is a named situation,
// the tier it must produce, and the reason it must give. The policy under test
// is the one the repository actually ships, read from dstack.config.example.json,
// so a change to the weights that breaks a floor fails here and not in a gate.
"use strict";

const fs = require("fs");
const path = require("path");
const { decide } = require("./route.cjs");
const jev = require("./jev.cjs");

const ROUTING = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "dstack.config.example.json"), "utf8")).routing;

const score = (level, levels, confidence) => ({
  type: "score", score: level, confidence,
  legend: Object.fromEntries(Array.from({ length: levels }, (_, i) => [i, `level ${i}`])),
});
const noul = (p) => ({ type: "noul", noul: p });
const choice = (name, confidence) => ({ type: "choice", choice: name, confidence });

// A set of answers with sane, confident defaults that each fixture overrides.
const answers = (over) => Object.assign({
  blast_radius: score(0, 4, 0.9),
  irreversibility: score(0, 4, 0.9),
  ambiguity: score(0, 4, 0.9),
  security_relevant: noul(0.02),
  mechanical: noul(0.95),
  surface: choice("internal", 0.95),
}, over || {});

const CASES = [
  {
    name: "G1 a small change on a money surface routes to the top tier anyway",
    stage: "gate",
    answers: answers({ blast_radius: score(1, 4, 0.9), surface: choice("money", 0.97) }),
    expect: (d) => [
      [d.tier === "max", `tier was ${d.tier}, expected max`],
      [/money/.test(d.why), `the reason did not name the surface: ${d.why}`],
      [d.floorApplied === "the money surface", `floorApplied was ${d.floorApplied}`],
    ],
  },
  {
    name: "G1b a small change on an auth surface routes to the top tier anyway",
    stage: "gate",
    answers: answers({ blast_radius: score(1, 4, 0.9), security_relevant: noul(0.97), mechanical: noul(0.9), surface: choice("auth", 0.94) }),
    expect: (d) => [[d.tier === "max", `tier was ${d.tier}, expected max`], [/auth/.test(d.why), `the reason did not name auth: ${d.why}`]],
  },
  {
    name: "G2 a reading below the confidence threshold routes one rung up",
    stage: "build",
    answers: answers({ blast_radius: score(1, 4, 0.9), ambiguity: score(2, 4, 0.4), mechanical: noul(0.9) }),
    expect: (d) => [
      [d.escalated === true, "the decision was not escalated"],
      [d.tier === "standard", `tier was ${d.tier}, expected standard (one rung above skim)`],
      [/ambiguity/.test(d.why), `the reason did not name the weak reading: ${d.why}`],
    ],
  },
  {
    name: "G2b escalation never routes down",
    stage: "build",
    answers: answers({ blast_radius: score(3, 4, 0.2), irreversibility: score(3, 4, 0.2), ambiguity: score(3, 4, 0.2), mechanical: noul(0.05) }),
    expect: (d) => [[d.tier === "deep", `tier was ${d.tier}, expected deep (the build ceiling, reached from above)`]],
  },
  {
    name: "G3 a router failure routes to the stage default and says so",
    stage: "gate",
    answers: null,
    expect: (d) => [
      [d.tier === "max", `tier was ${d.tier}, expected the gate default max`],
      [d.routed === false, "a failed route was recorded as routed"],
      [/router did not answer/.test(d.why), `the reason did not name the failure: ${d.why}`],
    ],
  },
  {
    name: "G3b a missing key is a router failure, not a cheap answer",
    stage: "build",
    answers: {},
    expect: (d) => [[d.tier === "standard", `tier was ${d.tier}, expected the build default standard`], [d.routed === false, "recorded as routed"]],
  },
  {
    name: "G4 the gate floor holds under the cheapest possible measurement",
    stage: "gate",
    answers: answers({ surface: choice("docs", 0.99) }),
    expect: (d) => [
      [d.measured === "skim", `measured as ${d.measured}, expected skim`],
      [d.tier === "standard", `tier was ${d.tier}, expected the gate floor standard`],
      [d.floorApplied === "the gate floor", `floorApplied was ${d.floorApplied}`],
    ],
  },
  {
    // Defense in depth: the verifier rejects a config whose ceiling sits under
    // its floor, and the router refuses to honor one if a config slips through.
    name: "G5 a ceiling never reaches below a floor",
    stage: "build",
    answers: answers({ surface: choice("docs", 0.99) }),
    routing: Object.assign({}, ROUTING, { stages: Object.assign({}, ROUTING.stages, { build: { kind: "ladder", floor: "deep", default: "deep", ceiling: "standard" } }) }),
    expect: (d) => [[d.tier === "deep", `tier was ${d.tier}, expected deep: a ceiling below a floor is ignored`]],
  },
  {
    name: "G5c Build ignores the surface floor that Gate honors",
    stage: "build",
    answers: answers({ blast_radius: score(2, 4, 0.9), irreversibility: score(1, 4, 0.9), mechanical: noul(0.3), surface: choice("money", 0.95) }),
    expect: (d) => [
      [d.tier !== "max", `build routed to ${d.tier}: a surface floor must not push the builder above its ceiling`],
      [d.floorApplied === null, `a surface floor was applied to build: ${d.floorApplied}`],
    ],
  },
  {
    name: "G5d Gate honors the surface floor Build ignores",
    stage: "gate",
    answers: answers({ blast_radius: score(2, 4, 0.9), irreversibility: score(1, 4, 0.9), mechanical: noul(0.3), surface: choice("money", 0.95) }),
    expect: (d) => [[d.tier === "max", `gate routed to ${d.tier}, expected max`], [d.floorApplied === "the money surface", `floorApplied was ${d.floorApplied}`]],
  },
  {
    name: "G5b a ceiling does cap when it sits above the floor",
    stage: "build",
    answers: answers({ blast_radius: score(3, 4, 0.9), irreversibility: score(3, 4, 0.9), ambiguity: score(3, 4, 0.9), security_relevant: noul(0.9), mechanical: noul(0.05) }),
    expect: (d) => [[d.tier === "deep", `tier was ${d.tier}, expected the build ceiling deep`]],
  },
  {
    name: "a copy change is skippable at Plan, with no line count involved",
    stage: "plan",
    answers: answers({ surface: choice("docs", 0.99), mechanical: noul(0.97) }),
    expect: (d) => [[d.tier === "skim", `tier was ${d.tier}`], [d.skippable === true, "a docs copy change was not marked skippable"]],
  },
  {
    name: "a plan that leaves the approach open is not skippable",
    stage: "plan",
    answers: answers({ blast_radius: score(2, 4, 0.9), ambiguity: score(3, 4, 0.9), mechanical: noul(0.1), surface: choice("data", 0.9) }),
    expect: (d) => [[d.skippable === false, `marked skippable at ${d.tier}`]],
  },
  {
    name: "See it runs on a server side change that a customer would notice",
    stage: "see",
    answers: answers({ surface: choice("data", 0.95), user_visible: noul(0.88) }),
    expect: (d) => [[d.applies === true, "a visible change was ruled not applicable"], [/88 in 100/.test(d.why), `the reason did not carry the probability: ${d.why}`]],
  },
  {
    name: "See it is not applicable when nothing reaches a screen",
    stage: "see",
    answers: answers({ surface: choice("internal", 0.98), user_visible: noul(0.03) }),
    expect: (d) => [[d.applies === false, "an invisible change was sent to a browser run"]],
  },
  {
    name: "See it runs when the router cannot say",
    stage: "see",
    answers: answers({ surface: choice("internal", 0.98) }),
    expect: (d) => [[d.applies === true, "an unknown was treated as not applicable"], [d.routed === false, "an unknown was recorded as routed"]],
  },
  {
    name: "routing off returns the stage default and says why",
    stage: "gate",
    answers: answers({}),
    routing: Object.assign({}, ROUTING, { enabled: false }),
    expect: (d) => [[d.tier === "max", `tier was ${d.tier}`], [d.kind === "off", `kind was ${d.kind}`], [/routing is off/.test(d.why), d.why]],
  },
];

// What leaves the machine. These guard the client, not the policy: a caller
// that builds its file list off a stale branch base would otherwise hand over
// a hundred thousand tokens without anyone noticing.
const CLIENT_CASES = [
  ["a long string is capped and says it was cut", () => {
    const out = jev.redact({ claim: "x".repeat(9000) });
    return [out.claim.length < 5000, /not sent/.test(out.claim)];
  }],
  ["a long list is capped and says how many were dropped", () => {
    const out = jev.redact({ files: Array.from({ length: 500 }, (_, i) => `f${i}.ts`) });
    return [out.files.length <= jev.CAPS.list + 1, /and 440 more, not sent/.test(out.files[out.files.length - 1])];
  }],
  ["a key the allow list does not name never leaves", () => {
    const out = jev.redact({ claim: "ok", diff: "-secret\n+secret", env: "KEY=abc" });
    return [!("diff" in out), !("env" in out), out.claim === "ok"];
  }],
  ["a bare string state is capped too", () => {
    const out = jev.redact("y".repeat(9000));
    return [typeof out === "string", out.length < 5000];
  }],
  ["a missing api key is a failure, never an answer", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const res = await jev.ask({ claim: "x" }, { q: { type: "noul", instructions: "?" } }, {});
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    return [res.ok === false, res.answers === null, /TYPESAFE_API_KEY/.test(res.reason)];
  }],
];

let pass = 0;
const failures = [];
for (const c of CASES) {
  let d;
  try { d = decide(c.stage, c.answers, c.routing || ROUTING); }
  catch (e) { failures.push(`${c.name}\n      threw: ${e.message}`); continue; }
  const checks = c.expect(d);
  const bad = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (bad.length) failures.push(`${c.name}\n      ${bad.join("\n      ")}\n      decision: ${JSON.stringify({ tier: d.tier, risk: d.risk, why: d.why })}`);
  else pass++;
}

(async () => {
for (const [name, fn] of CLIENT_CASES) {
  let checks;
  try { checks = await fn(); }
  catch (e) { failures.push(`${name}\n      threw: ${e.message}`); continue; }
  if (checks.every(Boolean)) pass++;
  else failures.push(`${name}\n      check ${checks.findIndex((c) => !c) + 1} of ${checks.length} failed`);
}

const total = CASES.length + CLIENT_CASES.length;
if (failures.length) {
  console.error(`Dstack routing fixtures FAILED: ${failures.length} of ${total}`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`Dstack routing fixtures OK: ${pass} of ${total}, policy read from dstack.config.example.json, no network and no api key`);
process.exit(0);
})();
