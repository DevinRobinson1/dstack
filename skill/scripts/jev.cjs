#!/usr/bin/env node
// Dstack's client for the System One API (Jev).
//
// Jev is not a writer. It answers a fixed set of typed questions about state
// in one round trip: a choice with a probability per option, a score that is a
// probability weighted mean over ordered levels, or a noul, which is a single
// probability that the answer is yes. Output tokens are free and input is
// priced per million, so the whole question set costs less than the round trip.
//
// Three rules this file exists to hold:
//   1. It never throws. A caller that cannot reach the router must be able to
//      fall back to the stage default, not crash a stage.
//   2. It never sends the diff. Paths, counts, and the plan's own prose leave
//      the machine. The contents of source files do not, and there is no
//      setting that turns that on.
//   3. A failure is never silent. Every failure returns a reason in the words
//      that will be printed on the pull request.
//   4. It never sends an unbounded bundle. Strings and lists are capped here,
//      not by the caller, because a caller that builds its list from a stale
//      branch base will happily hand over a hundred thousand tokens.
"use strict";

const https = require("https");
const { URL } = require("url");

const DEFAULTS = {
  provider: "vercel",
  model: "typesafe-ai/jev",
  timeoutMs: 6000,
  retries: 1,
};

// Two ways to reach the same model, and they are not the same wire format.
//
// The gateway does not put confidence on the answer. It hangs it off
// providerMetadata.typesafe.confidence, keyed by question. Reading it from the
// answer returns undefined, which normalizes to zero, which reads as maximum
// uncertainty, which escalates every routed decision to the top tier forever.
// That is why both providers normalize into one canonical answer shape here
// rather than letting callers touch a raw response.
const PROVIDERS = {
  typesafe: {
    endpoint: "https://api.typesafe.ai/v1/systemone",
    apiKeyEnv: "TYPESAFE_API_KEY",
    defaultModel: "jev-latest",
    build(state, questions, cfg, key) {
      return {
        headers: { Authorization: `Bearer ${key}` },
        body: { state, model: cfg.model || "jev-latest", questions },
      };
    },
    parse(json) {
      return { answers: json.answers, usage: json.usage || null, cost: null, model: json.model || null };
    },
  },

  vercel: {
    endpoint: "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
    apiKeyEnv: "AI_GATEWAY_API_KEY",
    defaultModel: "typesafe-ai/jev",
    // Hard caps the gateway enforces: 64k tokens per request, 32k for state.
    // The client caps below keep a bundle far under both.
    build(state, questions, cfg, key) {
      const translated = {};
      for (const [name, q] of Object.entries(questions)) {
        // The gateway calls a noul a boolean. Same question, different word.
        translated[name] = q.type === "noul" ? Object.assign({}, q, { type: "boolean" }) : q;
      }
      return {
        headers: {
          Authorization: `Bearer ${key}`,
          "ai-gateway-protocol-version": "0.0.1",
          "ai-model-id": cfg.model || "typesafe-ai/jev",
          "ai-evaluation-model-specification-version": "4",
        },
        body: { state, questions: translated, providerOptions: {} },
      };
    },
    parse(json) {
      const meta = json.providerMetadata || {};
      const conf = (meta.typesafe && meta.typesafe.confidence) || {};
      const answers = {};
      for (const [name, a] of Object.entries(json.answers || {})) {
        if (a.type === "boolean") answers[name] = { type: "noul", noul: a.probability };
        else answers[name] = Object.assign({}, a, conf[name] != null ? { confidence: conf[name] } : {});
      }
      const usage = json.usage ? { input_tokens: json.usage.inputTokens, output_tokens: json.usage.outputTokens } : null;
      const gw = meta.gateway || {};
      return { answers, usage, cost: gw.marketCost != null ? Number(gw.marketCost) : null, model: (gw.routing && gw.routing.canonicalSlug) || null };
    },
  },
};

// The key may live in an env file the project already keeps out of git, which
// is where a key that never reaches a tool shell usually is. Read, never log.
function readKey(envName, envFile) {
  if (process.env[envName]) return process.env[envName];
  if (!envFile) return null;
  let text;
  try { text = require("fs").readFileSync(envFile, "utf8"); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${envName}\\s*=\\s*(.*)$`));
    if (!m) continue;
    const v = m[1].trim().replace(/^["']|["']$/g, "");
    if (v) return v;
  }
  return null;
}

// Fields a state bundle may carry. Anything else is dropped before the request
// is built, so a caller cannot widen what leaves the machine by accident.
const ALLOWED_STATE_KEYS = new Set([
  "summary", "claim", "class", "acceptance", "out_of_scope", "risks",
  "files", "insertions", "deletions", "files_changed", "ticket", "stage",
  "reviewer_output", "finding", "prior_findings", "flows",
]);

const CAPS = { string: 4000, list: 60, listItem: 300 };

function capString(v, limit) {
  const s = String(v);
  return s.length <= limit ? s : `${s.slice(0, limit)} ... [${s.length - limit} more characters not sent]`;
}

function capValue(v) {
  if (Array.isArray(v)) {
    const head = v.slice(0, CAPS.list).map((item) => (typeof item === "string" ? capString(item, CAPS.listItem) : item));
    return v.length > CAPS.list ? head.concat(`... and ${v.length - CAPS.list} more, not sent`) : head;
  }
  if (typeof v === "string") return capString(v, CAPS.string);
  return v;
}

function redact(state) {
  if (typeof state === "string") return capString(state, CAPS.string);
  if (!state || typeof state !== "object") return String(state == null ? "" : state);
  const out = {};
  for (const key of Object.keys(state)) {
    if (!ALLOWED_STATE_KEYS.has(key)) continue;
    const value = state[key];
    if (value === undefined || value === null || value === "") continue;
    out[key] = capValue(value);
  }
  return out;
}

function post(url, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { resolve({ status: 0, text: "", error: `endpoint is not a url: ${url}` }); return; }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json", "Content-Length": payload.length }, headers),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), error: null }));
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, text: "", error: `no answer in ${timeoutMs}ms` }); });
    req.on("error", (e) => resolve({ status: 0, text: "", error: e.message }));
    req.end(payload);
  });
}

// ask(state, questions, opts) -> { ok, answers, usage, model, reason }
// Never rejects. On any failure, ok is false and reason is a sentence.
async function ask(state, questions, opts) {
  const cfg = Object.assign({}, DEFAULTS, opts || {});
  const provider = PROVIDERS[cfg.provider];
  if (!provider) return { ok: false, reason: `unknown routing provider "${cfg.provider}", expected one of ${Object.keys(PROVIDERS).join(", ")}`, answers: null, usage: null };
  const envName = cfg.apiKeyEnv || provider.apiKeyEnv;
  const key = readKey(envName, cfg.apiKeyFile);
  if (!key) return { ok: false, reason: `no ${envName} in the environment${cfg.apiKeyFile ? ` or in ${cfg.apiKeyFile}` : ""}`, answers: null, usage: null };
  if (!questions || !Object.keys(questions).length) return { ok: false, reason: "no questions were asked", answers: null, usage: null };

  const endpoint = cfg.endpoint || provider.endpoint;
  const built = provider.build(redact(state), questions, cfg, key);
  const { headers, body } = built;

  let last = null;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    const res = await post(endpoint, body, headers, cfg.timeoutMs);
    if (res.error) { last = `the router could not be reached: ${res.error}`; continue; }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: `the router rejected the key in ${envName} (${res.status})`, answers: null, usage: null };
    if (res.status === 429) { last = "the router is rate limited (429)"; continue; }
    if (res.status >= 500) { last = `the router returned ${res.status}`; continue; }
    if (res.status !== 200) return { ok: false, reason: `the router returned ${res.status}: ${res.text.slice(0, 200)}`, answers: null, usage: null };
    let parsed;
    try { parsed = JSON.parse(res.text); } catch { return { ok: false, reason: "the router returned something that is not json", answers: null, usage: null }; }
    if (!parsed || !parsed.answers) return { ok: false, reason: "the router returned no answers block", answers: null, usage: null };
    const norm = provider.parse(parsed);
    const missing = Object.keys(questions).filter((k) => !(k in norm.answers));
    if (missing.length) return { ok: false, reason: `the router did not answer: ${missing.join(", ")}`, answers: null, usage: null };
    return { ok: true, reason: null, answers: norm.answers, usage: norm.usage, cost: norm.cost, model: norm.model || cfg.model, warnings: parsed.warnings || [] };
  }
  return { ok: false, reason: last || "the router failed for an unstated reason", answers: null, usage: null };
}

// One reading per answer, normalized to 0..1, plus a confidence in the same
// range. This is what lets a score, a noul and a choice sit in one risk index.
//
// A noul has no confidence field of its own: the probability is the whole
// answer, so certainty is its distance from a coin flip, doubled.
function reading(answer) {
  if (!answer || typeof answer !== "object") return null;
  if (answer.type === "noul" || typeof answer.noul === "number") {
    const p = Number(answer.noul);
    if (!Number.isFinite(p)) return null;
    return { kind: "noul", value: clamp01(p), confidence: clamp01(Math.abs(p - 0.5) * 2), label: p >= 0.5 ? "yes" : "no" };
  }
  if (answer.type === "score" || typeof answer.score === "number") {
    const levels = answer.legend ? Object.keys(answer.legend).length : (answer.probabilities ? Object.keys(answer.probabilities).length : 0);
    const top = Math.max(1, levels - 1);
    const s = Number(answer.score);
    if (!Number.isFinite(s)) return null;
    return { kind: "score", value: clamp01(s / top), confidence: clamp01(num(answer.confidence, 0)), label: String(Math.round(s)), raw: s, top };
  }
  if (answer.type === "choice" || typeof answer.choice === "string") {
    return { kind: "choice", value: null, confidence: clamp01(num(answer.confidence, 0)), label: String(answer.choice) };
  }
  return null;
}

function clamp01(n) { return Math.min(1, Math.max(0, Number(n) || 0)); }
function num(v, fallback) { return Number.isFinite(Number(v)) ? Number(v) : fallback; }

module.exports = { ask, reading, redact, readKey, DEFAULTS, PROVIDERS, ALLOWED_STATE_KEYS, CAPS };
