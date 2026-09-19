#!/usr/bin/env node
// The model catalog, kept honest against the gateway.
//
// Hand typed prices were always going to be the wrong design. They are stale
// the day a provider changes them, and nothing in the process would notice: the
// router would go on confidently ranking models by numbers that used to be
// true. The gateway publishes what it actually charges, so the catalog reads
// it rather than remembering it.
//
// The split this file protects:
//
//   PRICE is a fact.       It comes from the gateway. Never typed, never guessed.
//   CAPABILITY is a claim.  It is the `serves` line, and it is the owner's.
//
// sync only ever writes prices and context windows. It never writes `serves`,
// never enables a disabled model, and never adds a model on its own. A model
// added by hand arrives with `serves: []`, which is inert: the router cannot
// pick it until a person says what it is good for. Adding a model must not
// silently make it eligible for work.
"use strict";

const https = require("https");
const fs = require("fs");
const jev = require("./jev.cjs");

const GATEWAY_MODELS = "https://ai-gateway.vercel.sh/v1/models";

function get(url, key, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: { Authorization: `Bearer ${key}` } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, text: "", error: `no answer in ${timeoutMs}ms` }); });
    req.on("error", (e) => resolve({ status: 0, text: "", error: e.message }));
    req.end();
  });
}

// Prices arrive as dollars per token, as strings. Per million is what a person
// can read, and what the config carries.
function perMTok(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Number((n * 1e6).toFixed(4)) : null;
}

// Pure: the live payload becomes a flat map this file and the fixtures can use.
function normalizeLive(json) {
  const out = {};
  for (const m of (json && json.data) || []) {
    if (!m || !m.id) continue;
    const p = m.pricing || {};
    out[m.id] = {
      in: perMTok(p.input),
      out: perMTok(p.output),
      context: m.context_window != null ? Number(m.context_window) : null,
      name: m.name || m.id,
      owned_by: m.owned_by || null,
      varies: p.varies_by_provider === true,
    };
  }
  return out;
}

// Pure: returns the changes rather than applying them, so a caller can print
// them before writing and a fixture can assert on them.
function diffPrices(catalog, live) {
  const changes = [];
  for (const [id, model] of Object.entries(catalog)) {
    if (id.startsWith("$")) continue;
    const l = live[id];
    if (!l) {
      // A model the gateway no longer lists cannot be priced or chosen. Say so
      // rather than leaving a stale price standing in for a live one.
      if (model.provider !== "cli") changes.push({ id, field: "*", from: "listed", to: "not on the gateway", missing: true });
      continue;
    }
    for (const field of ["in", "out", "context"]) {
      const from = model[field] == null ? null : Number(model[field]);
      const to = l[field];
      if (to == null) continue;
      if (from !== to) changes.push({ id, field, from, to, varies: l.varies });
    }
  }
  return changes;
}

// Pure: apply price changes only. serves, disabled and pin are never touched.
function applyPrices(catalog, changes) {
  const next = JSON.parse(JSON.stringify(catalog));
  let applied = 0;
  for (const c of changes) {
    if (c.missing || c.field === "*") continue;
    if (!next[c.id]) continue;
    next[c.id][c.field] = c.to;
    applied++;
  }
  return { catalog: next, applied };
}

// Pure: what a stage would pay each candidate, cheapest first. This is the
// list a person reads before deciding what any of them is allowed to do.
function suggest(live, { typical, limit = 15, match = null, maxIn = null }) {
  const rows = Object.entries(live)
    .filter(([id, m]) => m.in != null && m.out != null)
    .filter(([id]) => (match ? new RegExp(match, "i").test(id) : true))
    .filter(([, m]) => (maxIn == null ? true : m.in <= maxIn))
    .map(([id, m]) => ({
      id, in: m.in, out: m.out, context: m.context, varies: m.varies,
      cost: typical ? Number((((typical.in || 0) * m.in + (typical.out || 0) * m.out) / 1e6).toFixed(4)) : null,
    }));
  rows.sort((a, b) => (a.cost != null ? a.cost - b.cost : a.in - b.in));
  return rows.slice(0, limit);
}

// Reachability is a fact, like price, and a different fact from either price
// or capability. A model can be listed, priced, and trusted by the owner, and
// still 403 because the account cannot reach it. The router would pick it,
// the call would fail, and the failure would land at the stage rather than
// here where it can be seen and fixed.
async function checkReachable(id, key, timeoutMs) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify({ model: id, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }), "utf8");
    const req = https.request(
      { hostname: "ai-gateway.vercel.sh", path: "/v1/chat/completions", method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Content-Length": payload.length } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let why = null;
          try { why = (JSON.parse(text).error || {}).message || null; } catch { /* keep null */ }
          resolve({ id, status: res.statusCode, ok: res.statusCode === 200, why });
        });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ id, status: 0, ok: false, why: `no answer in ${timeoutMs}ms` }); });
    req.on("error", (e) => resolve({ id, status: 0, ok: false, why: e.message }));
    req.end(payload);
  });
}

async function fetchLive(routing) {
  const envName = (routing && routing.apiKeyEnv) || "AI_GATEWAY_API_KEY";
  const key = jev.readKey(envName, routing && routing.apiKeyFile);
  if (!key) return { ok: false, reason: `no ${envName} in the environment${routing && routing.apiKeyFile ? ` or in ${routing.apiKeyFile}` : ""}` };
  const res = await get(GATEWAY_MODELS, key, (routing && routing.timeoutMs) || 20000);
  if (res.error) return { ok: false, reason: `the gateway could not be reached: ${res.error}` };
  if (res.status !== 200) return { ok: false, reason: `the gateway returned ${res.status}` };
  let json;
  try { json = JSON.parse(res.text); } catch { return { ok: false, reason: "the gateway returned something that is not json" }; }
  return { ok: true, live: normalizeLive(json), count: (json.data || []).length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const arg = (name, fb) => { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const configPath = arg("config", "dstack.config.json");
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
  catch { console.error(`Dstack catalog cannot run: ${configPath} is missing or is not json.`); process.exit(2); }
  const routing = config.routing || {};

  const res = await fetchLive(routing);
  if (!res.ok) { console.error(`Dstack catalog cannot run: ${res.reason}`); process.exit(2); }
  console.log(`Gateway lists ${res.count} models.\n`);

  if (has("suggest")) {
    const stage = arg("stage", "gate");
    const rule = (routing.stages || {})[stage] || {};
    const typical = rule.typical;
    const rows = suggest(res.live, { typical, limit: Number(arg("limit", 15)), match: arg("match", null), maxIn: arg("max-in") ? Number(arg("max-in")) : null });
    console.log(`Cheapest on the ${stage} shape (reads ~${typical ? typical.in.toLocaleString() : "?"}, writes ~${typical ? typical.out.toLocaleString() : "?"}):\n`);
    console.log("  " + "model".padEnd(34) + "in".padStart(8) + "out".padStart(9) + "context".padStart(11) + "  a run");
    const inCatalog = new Set(Object.keys(routing.models || {}));
    for (const r of rows) {
      const mark = inCatalog.has(r.id) ? " (in your catalog)" : "";
      console.log("  " + r.id.padEnd(34) + r.in.toFixed(3).padStart(8) + r.out.toFixed(3).padStart(9) +
        String(r.context ? r.context.toLocaleString() : "?").padStart(11) + "  $" + (r.cost != null ? r.cost.toFixed(3) : "?") + mark + (r.varies ? "  [price varies by provider]" : ""));
    }
    console.log("\n  Prices are facts from the gateway. What any of these is allowed to do is");
    console.log("  a claim, and it is yours: add one with --add <id>, and it arrives inert");
    console.log("  with an empty serves list until you write that line yourself.");
    process.exit(0);
  }

  if (has("check")) {
    const envName = routing.apiKeyEnv || "AI_GATEWAY_API_KEY";
    const key = jev.readKey(envName, routing.apiKeyFile);
    const ids = Object.entries(routing.models || {})
      .filter(([id, m]) => !id.startsWith("$") && m.provider !== "cli" && !m.disabled);
    console.log("Can this account actually reach what the catalog trusts?\n");
    const results = [];
    for (const [id] of ids) {
      const r = await checkReachable(id, key, (routing.timeoutMs || 20000) * 3);
      results.push(r);
      console.log(`  ${r.ok ? "OK  " : String(r.status).padEnd(4)} ${id}${r.ok ? "" : `   ${(r.why || "").slice(0, 70)}`}`);
    }
    const dead = results.filter((r) => !r.ok);
    if (!dead.length) { console.log("\n  Every priced model in the catalog is reachable."); process.exit(0); }
    console.log(`\n  ${dead.length} model(s) the router could pick and the call would fail.`);
    if (!has("write")) { console.log("  Re-run with --write to mark them disabled, which takes them out of the ranking."); process.exit(0); }
    for (const r of dead) {
      config.routing.models[r.id].disabled = true;
      config.routing.models[r.id].$unreachable = `${r.status}: ${(r.why || "").slice(0, 120)}`;
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`  Marked ${dead.length} disabled in ${configPath}. Capability lines untouched: they are still what you trust, just not reachable today.`);
    process.exit(0);
  }

  const changes = diffPrices(routing.models || {}, res.live);
  if (!changes.length) { console.log("Catalog prices already match the gateway. Nothing to write."); process.exit(0); }

  console.log(`${changes.length} difference(s) between your catalog and the gateway:\n`);
  for (const c of changes) {
    if (c.missing) { console.log(`  ${c.id}: ${c.to}`); continue; }
    console.log(`  ${c.id}.${c.field}: ${c.from == null ? "unset" : c.from} -> ${c.to}${c.varies ? "  [price varies by provider]" : ""}`);
  }

  if (!has("write")) { console.log("\nRead only. Re-run with --write to apply. serves, disabled and pin are never touched."); process.exit(0); }
  const { catalog, applied } = applyPrices(routing.models || {}, changes);
  config.routing.models = catalog;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`\nWrote ${applied} price change(s) to ${configPath}. No capability line was touched.`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { normalizeLive, diffPrices, applyPrices, suggest, perMTok, fetchLive, checkReachable, GATEWAY_MODELS };
