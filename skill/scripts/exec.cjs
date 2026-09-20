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

// How an agent is actually invoked. A bare `codex` opens an interactive CLI
// and waits for a TTY this piped child does not have, so a routed build would
// hang rather than build. The runner declares its command line.
function runnerCommand(model, routing) {
  const declared = ((routing && routing.runners) || {})[model && model.runner] || {};
  return {
    command: declared.command || (model && model.runner),
    args: Array.isArray(declared.args) ? declared.args.slice() : [],
    // Some CLIs take the prompt as an argument and some read stdin. Gemini's
    // -p is documented as taking a string, so passing the flag with the prompt
    // on stdin invokes it with a missing option value and it fails before
    // doing any work. A runner declares which it wants.
    promptVia: declared.promptVia === "arg" ? "arg" : "stdin",
  };
}

// THE predicate. One body, and both public entry points call it, so they
// cannot disagree about anything including cases nobody thought to test. The
// previous version had two bodies that "agreed", and they disagreed the moment
// a runner had no declared kind and a stage declared no need: the router
// accepted the model and the executor refused it, which is a stage routing to
// something that will not run. A fixture claimed to guard this and only
// covered the cases where both already knew the answer.
function runnerCapability(model, rule, routing) {
  const kind = runnerKind(model, routing);
  if (!kind) return { ok: false, kind: null, why: `runner "${model && model.runner}" declares no kind, so it is not known whether it can do this stage's work` };
  const needs = rule && rule.needs;
  // No silent default: a stage that declares no need accepts anything capable,
  // and the verifier refuses such a config, so this branch never applies live.
  if (!needs) return { ok: true, kind };
  const accepted = Array.isArray(needs) ? needs : [needs];
  if (!accepted.includes(kind)) {
    return { ok: false, kind, why: `${(model && model.id) || "this model"} runs as ${kind} and this stage needs ${accepted.join(" or ")}` +
      (accepted.length === 1 && accepted[0] === "agent" ? ": a text runner returns a string, and this stage has to edit files and read back what changed" : "") };
  }
  return { ok: true, kind };
}

// Pure: can this decision's model do this stage's kind of work?
function canRun(decision, rule, routing) {
  const model = ((routing && routing.models) || {})[decision && decision.model];
  if (!model) return { ok: false, why: `the catalog has no model called "${decision && decision.model}"` };
  const r = runnerCapability(Object.assign({ id: decision.model }, model), rule, routing);
  return r.ok ? { ok: true, kind: r.kind } : { ok: false, why: r.why };
}

// ---------------------------------------------------------------------------
// The two runners.
// ---------------------------------------------------------------------------

// Pure, so the guarantee below is a fixture rather than a live call.
//
// A review cut off at the token limit reads exactly like a short review. Any
// stop that is not a natural one is a failure, because the caller cannot tell
// a finished judgement from half of one, and half a gate review that looks
// whole is worse than no review.
function readCompletion(d, model) {
  const choice = d && d.choices && d.choices[0];
  if (!choice || !choice.message) return { ok: false, reason: "the gateway returned no message" };
  const fin = choice.finish_reason;
  // No stop reason is not a natural stop, it is an unproven one. The earlier
  // version blessed absence as "legacy", which contradicted the rule it was
  // written to enforce: the caller still cannot tell a finished judgement from
  // half of one. Every gateway provider returns this field, so absence is
  // anomalous and says so loudly rather than passing quietly.
  if (fin !== "stop" && fin !== "end_turn") {
    const why = fin ? `stopped early (${fin})` : "returned no stop reason, so completion is unproven";
    return { ok: false, reason: `${model} ${why}, so its answer cannot be read as complete`, partial: choice.message.content || "" };
  }
  return { ok: true, text: choice.message.content, usage: d.usage || null, model: d.model || model };
}

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
          try { resolve(Object.assign({ status: 200 }, readCompletion(JSON.parse(text), model))); }
          catch (e) { resolve({ ok: false, status: 200, reason: `the gateway returned something unreadable: ${e.message}` }); }
        });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, reason: `no answer in ${timeoutMs}ms` }); });
    req.on("error", (e) => resolve({ ok: false, status: 0, reason: e.message }));
    req.end(payload);
  });
}

// An agent runner has write access. Reporting a timeout while it is still
// alive means Dstack starts its fallback while the first process keeps editing
// the same files. So a timeout escalates and waits: nothing resolves until the
// process is actually gone.
function cli(command, args, input, timeoutMs, graceMs) {
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false, settled = false;
    const detach = process.platform !== "win32";
    let p;
    try { p = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], detached: detach }); }
    catch (e) { resolve({ ok: false, reason: `${command} could not start: ${e.message}` }); return; }

    // Signal the whole group: an agent that spawned children leaves them
    // editing when only the parent is asked to stop.
    const signal = (sig) => {
      // POSIX: signal the group, so an agent's children stop too. Windows has
      // no process group to signal, and p.kill() reaches only the parent while
      // a grandchild writer keeps editing, so the tree is killed by taskkill.
      if (!detach) {
        try { spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); }
        catch { try { p.kill(sig); } catch { /* already gone */ } }
        return;
      }
      try { if (p.pid) process.kill(-p.pid, sig); else p.kill(sig); }
      catch { try { p.kill(sig); } catch { /* already gone */ } }
    };
    let killer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
      killer = setTimeout(() => signal("SIGKILL"), graceMs || 10000);
    }, timeoutMs);

    const finish = (res) => { if (settled) return; settled = true; clearTimeout(timer); if (killer) clearTimeout(killer); resolve(res); };
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => finish({ ok: false, reason: `${command} could not start: ${e.message}` }));
    // Only on close, never on the timer: close fires once the process is gone.
    p.on("close", (code) => {
      if (timedOut) return finish({ ok: false, timedOut: true, reason: `${command} did not finish in ${timeoutMs}ms and was stopped`, text: out });
      finish(code === 0 ? { ok: true, text: out } : { ok: false, reason: `${command} exited ${code}: ${err.slice(0, 300)}`, text: out });
    });
    try { if (input) p.stdin.write(input); p.stdin.end(); } catch { /* may already be gone */ }
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
    if (!res.ok) return { ok: false, reason: `${decision.model} did not answer (${res.status}): ${res.reason}`, partial: res.partial };
    return { ok: true, kind: "text", model: res.model, text: res.text, usage: res.usage,
             usageSource: "runner", cost: estimate(model, res.usage) };
  }

  const invoke = runnerCommand(model, routing);
  const argv = invoke.args.concat(task.args || []);
  const viaArg = invoke.promptVia === "arg";
  if (viaArg) argv.push(task.prompt);
  const res = await cli(invoke.command, argv, viaArg ? "" : task.prompt, (opts && opts.timeoutMs) || 600000, (opts && opts.graceMs) || 10000);
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
  // Write what the runner actually spent back into the artifact. Without this
  // Retro reads the router's measurement tokens as the stage's shape: a few
  // hundred where the reviewer spent eighty thousand, which makes question 4
  // answer about Jev rather than about the stage.
  if (res.usage) {
    try {
      const d = JSON.parse(fs.readFileSync(decisionFile, "utf8"));
      d.runner_usage = { input_tokens: res.usage.prompt_tokens || res.usage.input_tokens || 0,
                         output_tokens: res.usage.completion_tokens || res.usage.output_tokens || 0 };
      d.runner_cost = res.cost;
      fs.writeFileSync(decisionFile, JSON.stringify(d, null, 2) + "\n");
    } catch { /* the artifact may be read only; the run still counts */ }
  }
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
  return runnerCapability(model, rule, routing).ok;
}

module.exports = { run, canRun, runnerCanDo, runnerCapability, readCompletion, runnerKind, runnerCommand, chat, cli, estimate, RUNNER_KINDS, GATEWAY_CHAT };
