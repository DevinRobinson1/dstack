#!/usr/bin/env node
// The executor. Runs the model the router picked, instead of naming it.
//
// Until this existed the router was advisory: it said "build at deep on
// deepseek-v4-pro" and then Build ran the same CLI it always had. Naming a
// model and running one are different things, and the gap hid a real problem.
//
// THE CONSTRAINT THIS FILE EXISTS TO HOLD:
//
//   A runner that can only produce text cannot do work that edits files.
//
// Dstack's stages are not one kind of work. Build is "Codex, with write
// access, from the frozen plan": an agent that edits a repository and reacts
// to what happens. Gate is a review of a diff: text in, findings out. A chat
// completion can do the second and physically cannot do the first, however
// good the model is at writing code in the abstract.
//
// So runners declare a kind, stages declare what they need, and a mismatch is
// refused here rather than discovered when a build produces a paragraph
// describing the edits it would have made.
"use strict";

const https = require("https");
const { spawn } = require("child_process");
const jev = require("./jev.cjs");

const GATEWAY_CHAT = "https://ai-gateway.vercel.sh/v1/chat/completions";

// text:  produces a string. Reviews, judgements, summaries.
// agent: holds a tool loop with write access. Builds, fixes, anything that
//        changes a file and then reads back what changed.
const RUNNER_KINDS = { gateway: "text", codex: "agent", gemini: "agent", grok: "agent" };

function runnerKind(model, routing) {
  const declared = ((routing && routing.runners) || {})[model && model.runner];
  if (declared && declared.kind) return declared.kind;
  return RUNNER_KINDS[model && model.runner] || null;
}

// Pure: can this decision's model do this stage's kind of work?
function canRun(decision, rule, routing) {
  // No silent default. A stage that does not declare its kind of work is
  // permitted anything capable here, and the verifier refuses such a config,
  // so the permissive branch can never apply to a real run. Defaulting to
  // "text" instead would have quietly excluded every agent runner.
  const needs = rule && rule.needs;
  const model = ((routing && routing.models) || {})[decision && decision.model];
  if (!model) return { ok: false, why: `the catalog has no model called "${decision && decision.model}"` };
  const kind = runnerKind(model, routing);
  if (!kind) return { ok: false, why: `runner "${model.runner}" declares no kind, so it is not known whether it can do ${needs} work` };
  // A stage may accept more than one kind. This is the ONLY implementation of
  // that question: route.cjs imports it rather than keeping its own, because
  // two copies of "can this runner do this work" drift, and the drift shows up
  // as a stage that routes to a model the executor then refuses.
  if (!needs) return { ok: true, kind };
  const accepted = Array.isArray(needs) ? needs : [needs];
  if (!accepted.includes(kind)) {
    return { ok: false, why: `${decision.model} runs as ${kind} and this stage needs ${accepted.join(" or ")}` +
      (accepted.length === 1 && accepted[0] === "agent" ? ": a text runner returns a string, and this stage has to edit files and read back what changed" : "") };
  }
  return { ok: true, kind };
}

// ---------------------------------------------------------------------------
// The two runners.
// ---------------------------------------------------------------------------

function chat(model, messages, key, timeoutMs, maxTokens) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify({ model, messages, max_tokens: maxTokens || 4000 }), "utf8");
    const u = new URL(GATEWAY_CHAT);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Content-Length": payload.length } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            let why = text.slice(0, 200);
            try { why = (JSON.parse(text).error || {}).message || why; } catch { /* keep raw */ }
            resolve({ ok: false, status: res.statusCode, reason: why });
            return;
          }
          try {
            const d = JSON.parse(text);
            resolve({ ok: true, text: d.choices[0].message.content, usage: d.usage || null, model: d.model || model });
          } catch (e) { resolve({ ok: false, status: 200, reason: `the gateway returned something unreadable: ${e.message}` }); }
        });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, reason: `no answer in ${timeoutMs}ms` }); });
    req.on("error", (e) => resolve({ ok: false, status: 0, reason: e.message }));
    req.end(payload);
  });
}

function cli(command, args, input, timeoutMs) {
  return new Promise((resolve) => {
    let out = "", err = "", done = false;
    const p = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { if (!done) { done = true; p.kill(); resolve({ ok: false, reason: `${command} did not finish in ${timeoutMs}ms` }); } }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, reason: `${command} could not start: ${e.message}` }); } });
    p.on("close", (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve(code === 0 ? { ok: true, text: out } : { ok: false, reason: `${command} exited ${code}: ${err.slice(0, 300)}`, text: out });
    });
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// run(): the one entry point.
// ---------------------------------------------------------------------------

async function run(decision, task, config, opts) {
  const routing = (config && config.routing) || {};
  const rule = (routing.stages || {})[decision && decision.stage] || {};
  const gate = canRun(decision, rule, routing);
  // A refusal is a state, not a crash: the stage falls back to the runner it
  // used before routing, and says on the PR that it did and why.
  if (!gate.ok) return { ok: false, refused: true, reason: gate.why, fallback: rule.fallbackRunner || "the stage default" };

  const model = routing.models[decision.model];
  if (gate.kind === "text") {
    const envName = routing.apiKeyEnv || "AI_GATEWAY_API_KEY";
    const key = jev.readKey(envName, routing.apiKeyFile);
    if (!key) return { ok: false, reason: `no ${envName} in the environment${routing.apiKeyFile ? ` or in ${routing.apiKeyFile}` : ""}` };
    const res = await chat(decision.model, [
      { role: "system", content: task.system || "You are reviewing software changes. Be concrete and brief." },
      { role: "user", content: task.prompt },
    ], key, (opts && opts.timeoutMs) || 120000, task.maxTokens);
    if (!res.ok) return { ok: false, reason: `${decision.model} did not answer (${res.status}): ${res.reason}` };
    return { ok: true, kind: "text", model: res.model, text: res.text, usage: res.usage,
             cost: estimate(model, res.usage) };
  }

  const argv = (task.args || []).slice();
  const res = await cli(model.runner, argv, task.prompt, (opts && opts.timeoutMs) || 600000);
  return res.ok
    ? { ok: true, kind: "agent", model: decision.model, text: res.text, usage: null, cost: null }
    : { ok: false, reason: res.reason, text: res.text };
}

function estimate(model, usage) {
  if (!model || !usage || model.in == null || model.out == null) return null;
  const i = usage.prompt_tokens || usage.input_tokens || 0;
  const o = usage.completion_tokens || usage.output_tokens || 0;
  return Number(((i * model.in + o * model.out) / 1e6).toFixed(6));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const arg = (n, fb) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };

async function main() {
  const fs = require("fs");
  const decisionFile = arg("decision");
  const promptFile = arg("prompt-file");
  if (!decisionFile || !promptFile) { console.error("usage: exec.cjs --decision <routing artifact.json> --prompt-file <f> [--config dstack.config.json] [--out f]"); process.exit(2); }
  let config = {}, decision = null, prompt = "";
  try { config = JSON.parse(fs.readFileSync(arg("config", "dstack.config.json"), "utf8")); } catch { console.error("Dstack exec cannot run: the config is missing or is not json."); process.exit(2); }
  try { decision = JSON.parse(fs.readFileSync(decisionFile, "utf8")); } catch { console.error(`Dstack exec cannot run: ${decisionFile} is not json.`); process.exit(2); }
  try { prompt = fs.readFileSync(promptFile, "utf8"); } catch { console.error(`Dstack exec cannot run: ${promptFile} cannot be read.`); process.exit(2); }

  const res = await run(decision, { prompt, system: arg("system", null) }, config, {});
  if (res.refused) { console.error(`Dstack exec refused: ${res.reason}. This stage falls back to ${res.fallback}.`); process.exit(3); }
  if (!res.ok) { console.error(`Dstack exec failed: ${res.reason}`); process.exit(1); }
  const out = arg("out");
  if (out) fs.writeFileSync(out, res.text);
  console.error(`ran ${res.model} as ${res.kind}${res.cost != null ? `, about $${res.cost}` : ""}`);
  process.stdout.write(res.text);
  process.exit(0);
}

if (require.main === module) main();

// The single predicate. route.cjs filters candidates with this so that what
// the router picks and what the executor accepts can never disagree.
function runnerCanDo(model, rule, routing) {
  const needs = rule && rule.needs;
  if (!needs) return true;
  const kind = runnerKind(model, routing);
  const accepted = Array.isArray(needs) ? needs : [needs];
  return accepted.includes(kind);
}

module.exports = { run, canRun, runnerCanDo, runnerKind, chat, cli, estimate, RUNNER_KINDS, GATEWAY_CHAT };
