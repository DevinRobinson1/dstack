#!/usr/bin/env node
// Dstack's triage. Five judgements about a review, not about code.
//
// Split the way route.cjs is split: a measure half that calls the model, and a
// pure judge half that holds the policy and is what the fixtures test.
//
// THE INVARIANT, which is the whole safety argument:
//
//   A triage reading may only ever add work or add caution.
//
// A model that ranks findings is one step from a model that hides them, and
// that step makes a gate worse than no gate. So the invariant is enforced here
// rather than described somewhere: findings are labelled and ordered and never
// removed, a severity is never lowered, a plan can be held back and never
// approved, an unsure infra reading costs a retry, and a failure of any kind
// returns the input unchanged and says so.
"use strict";

const jev = require("./jev.cjs");

// ---------------------------------------------------------------------------
// Question sets. Each asks about the review, never about which model to use.
// ---------------------------------------------------------------------------

const INFRA_QUESTIONS = {
  is_infra: {
    type: "noul",
    instructions: "Did this review run fail for a reason unrelated to the code being reviewed: a network error, a missing or rejected credential, a rate limit, a timeout, a crashed tool, or a broken environment? Answer no if the run completed and simply reported findings, or if it failed because the code under review does not build or its tests fail.",
  },
  infra_kind: {
    type: "choice",
    instructions: "What kind of failure does this output show?",
    criteria: {
      network: "Connection refused, DNS, TLS, socket hang up, or an unreachable host",
      credential: "A missing, expired, or rejected key, token, or login",
      rate_limit: "A quota, a 429, or a request to slow down",
      timeout: "The run exceeded a time limit without finishing",
      environment: "A missing dependency, an unset variable, a database that is not there, or a bad path",
      tool_crash: "The reviewer process itself crashed or returned unparseable output",
      not_infra: "The run completed, or it failed because of the code under review",
    },
  },
};

const FINDING_QUESTIONS = {
  severity: {
    type: "score",
    instructions: "If this finding is correct, how bad is the consequence for a customer?",
    criteria: [
      "Style, naming, or a preference with no behavioral effect",
      "A rough edge: confusing, inefficient, or awkward, but nothing breaks",
      "A real defect a customer can hit, with a workaround or a narrow trigger",
      "Data loss, money moving wrongly, a security hole, or an outage",
    ],
  },
  in_scope: {
    type: "noul",
    instructions: "Is this finding about code the change under review introduced or modified, rather than about pre-existing code the change only sits near?",
  },
  already_guarded: {
    type: "noul",
    instructions: "Does the code quoted in the finding itself already prevent the condition the finding describes, for example by a check, an early return, a constraint, or a type, on or near the line named?",
  },
  actionable: {
    type: "noul",
    instructions: "Does this finding name a specific change to make, rather than raising a general concern or asking a question?",
  },
  names_class: {
    type: "noul",
    instructions: "Does this finding describe a shape of defect that could occur at other code locations too, rather than a problem unique to this one site?",
  },
};

const PLAN_QUESTIONS = {
  claim_is_observable: {
    type: "noul",
    instructions: "Does the Claim describe something a customer or an owner could observe for themselves, rather than describing what the code will do internally?",
  },
  acceptance_checkable_without_code: {
    type: "noul",
    instructions: "Could every line of the Acceptance section be checked by someone who cannot read the diff, using a screen, a query result, or a test output?",
  },
  class_names_paths: {
    type: "noul",
    instructions: "Does the Class section name the code paths the defect class runs through, and show the search that found them, rather than describing the class in the abstract?",
  },
  proof_command_is_concrete: {
    type: "noul",
    instructions: "Is the Proof command an exact invocation that could be pasted into a shell, rather than a description of what should be tested?",
  },
  rollback_is_real: {
    type: "noul",
    instructions: "Does the Rollback section say what undoing this would actually involve, including any data it touches, rather than only saying the change can be reverted?",
  },
};

const classHitQuestion = (defectClass) => ({
  same_class: {
    type: "noul",
    instructions: `Could the following defect occur at this code location, because the location has the same shape? The defect: ${String(defectClass).slice(0, 600)}`,
  },
});

const priorMatchQuestion = (priorFindings) => ({
  matches_prior: {
    type: "choice",
    instructions: "Is this finding the same underlying idea as one the previous round already raised, or is it new? Two findings are the same idea when fixing one properly would resolve the other, even if they name different files or lines.",
    criteria: Object.assign(
      { new: "A different idea from every finding the previous round raised" },
      Object.fromEntries(priorFindings.map((f, i) => [`prior_${i}`, String(f.title || f.summary || `finding ${i}`).slice(0, 240)]))
    ),
  },
});

// ---------------------------------------------------------------------------
// The pure judgements. No network, no clock, no environment.
// ---------------------------------------------------------------------------

const off = (reason) => ({ ok: false, reason });

// An unsure reading resolves to infra, which costs a retry. S4 caps the retry
// at one and then holds, so the expensive direction is also the safe one.
function judgeInfra(answers, cfg) {
  const t = (cfg && cfg.treatAsInfraAtOrAbove != null) ? cfg.treatAsInfraAtOrAbove : 0.35;
  if (!answers) return { infra: true, kind: "unknown", confidence: null, routed: false, why: "triage could not read the run, so it is held as infra and retried once" };
  const r = jev.reading(answers.is_infra);
  const kind = jev.reading(answers.infra_kind);
  if (!r) return { infra: true, kind: "unknown", confidence: null, routed: false, why: "triage returned no reading, so it is held as infra and retried once" };
  const infra = r.value >= t;
  const pct = Math.round(r.value * 100);
  return {
    infra, kind: kind ? kind.label : "unknown", confidence: Number(r.confidence.toFixed(3)), routed: true,
    why: infra
      ? `${pct} in 100 that this run failed for a reason outside the code${kind && kind.label !== "not_infra" ? ` (${kind.label})` : ""}, so it is not a round`
      : `${pct} in 100 that this run failed for a reason outside the code, below the ${Math.round(t * 100)} in 100 mark, so it counts as a round`,
  };
}

// Labels and orders. Never removes. Never lowers what the reviewer said.
function judgeFindings(findings, answersByIndex, cfg) {
  const c = Object.assign({ majorAtOrAbove: 2, inScopeAtOrAbove: 0.6, guardedAtOrAbove: 0.7 }, cfg || {});
  const RANK = { major: 0, minor: 1, questioned: 2 };
  const out = findings.map((finding, i) => {
    const a = answersByIndex ? answersByIndex[i] : null;
    const reviewerMajor = isReviewerMajor(finding);
    if (!a) {
      // No reading is not a reason to demote anything.
      return Object.assign({}, finding, {
        triage: { label: reviewerMajor ? "major" : "minor", routed: false, severity: null, why: "triage did not read this finding, so the reviewer's own severity stands" },
      });
    }
    const sev = jev.reading(a.severity);
    const inScope = jev.reading(a.in_scope);
    const guarded = jev.reading(a.already_guarded);
    const actionable = jev.reading(a.actionable);
    const namesClass = jev.reading(a.names_class);

    const reasons = [];
    let label = "minor";
    if (sev && sev.raw >= c.majorAtOrAbove) { label = "major"; reasons.push(`severity ${sev.raw.toFixed(1)} of ${sev.top}`); }
    if (inScope && inScope.value < c.inScopeAtOrAbove) { label = "questioned"; reasons.push(`${Math.round(inScope.value * 100)} in 100 that it is about this diff`); }
    if (guarded && guarded.value >= c.guardedAtOrAbove) { label = "questioned"; reasons.push(`${Math.round(guarded.value * 100)} in 100 that the quoted code already guards it`); }
    if (actionable && actionable.value < 0.4) reasons.push("names no specific change");

    // The invariant, in code: a reading may add caution, never remove it. A
    // finding the reviewer called a blocker stays a major whatever we read.
    let overridden = false;
    if (reviewerMajor && label !== "major") { label = "major"; overridden = true; reasons.push("the reviewer called it a blocker, which triage does not lower"); }

    return Object.assign({}, finding, {
      triage: {
        label, routed: true, overridden,
        severity: sev ? Number(sev.raw.toFixed(2)) : null,
        in_scope: inScope ? Number(inScope.value.toFixed(2)) : null,
        already_guarded: guarded ? Number(guarded.value.toFixed(2)) : null,
        names_class: namesClass ? Number(namesClass.value.toFixed(2)) : null,
        why: reasons.join("; ") || "nothing stood out",
      },
    });
  });

  out.sort((x, y) => {
    const d = RANK[x.triage.label] - RANK[y.triage.label];
    if (d !== 0) return d;
    return (y.triage.severity || 0) - (x.triage.severity || 0);
  });

  const unread = out.filter((f) => f.triage.routed === false).length;
  return {
    findings: out,
    counts: {
      total: out.length,
      major: out.filter((f) => f.triage.label === "major").length,
      minor: out.filter((f) => f.triage.label === "minor").length,
      questioned: out.filter((f) => f.triage.label === "questioned").length,
      unread,
    },
    // No silent caps. A cap that left findings unread says so here, and the
    // gate comment prints it, because a truncated list reads as a complete one.
    why: `${out.length} findings${unread ? `, ${unread} triage did not read, carrying the reviewer's own severity` : ""}`,
  };
}

function isReviewerMajor(finding) {
  const s = String(finding.severity || finding.level || finding.priority || "").toLowerCase();
  return s === "major" || s === "blocker" || s === "critical" || s === "high" || finding.major === true;
}

// Counts distinct ideas. Can only lower the count, which makes S3 more likely
// to stop the line, never less.
function judgeProgress(triagedFindings, priorFindings, answersByIndex, cfg) {
  const t = (cfg && cfg.sameIdeaAtOrAbove != null) ? cfg.sameIdeaAtOrAbove : 0.6;
  const majors = triagedFindings.filter((f) => f.triage && f.triage.label === "major");
  if (!answersByIndex || !priorFindings || !priorFindings.length) {
    return { distinct: majors.length, repeats: 0, routed: false, repeated: [], why: priorFindings && priorFindings.length ? "triage could not compare rounds, so every major counts as distinct" : "no previous round to compare against" };
  }
  const repeated = [];
  const seenPrior = new Set();
  let distinct = 0;
  for (const f of majors) {
    const i = triagedFindings.indexOf(f);
    const a = answersByIndex[i];
    const r = a ? jev.reading(a.matches_prior) : null;
    const p = a && a.matches_prior && a.matches_prior.probabilities ? a.matches_prior.probabilities : null;
    const isNew = !r || r.label === "new" || (p && (p.new || 0) >= t);
    if (isNew) { distinct++; continue; }
    const conf = p ? (p[r.label] || 0) : r.confidence;
    if (conf < t) { distinct++; continue; }
    repeated.push({ finding: f.title || f.summary, sameAs: r.label, confidence: Number(conf.toFixed(2)) });
    if (!seenPrior.has(r.label)) { seenPrior.add(r.label); distinct++; }
  }
  return {
    distinct, repeats: repeated.length, repeated, routed: true,
    why: repeated.length
      ? `${majors.length} majors, ${repeated.length} of them the same idea the previous round already raised, so ${distinct} distinct`
      : `${majors.length} majors, all distinct ideas`,
  };
}

// Ranks. A hit below the threshold is ordered last, never dropped: the class
// rule's second question is answered by a person reading the list.
function judgeClassHits(hits, answersByIndex, cfg) {
  const t = (cfg && cfg.rankAtOrAbove != null) ? cfg.rankAtOrAbove : 0.5;
  const out = hits.map((hit, i) => {
    const a = answersByIndex ? answersByIndex[i] : null;
    const r = a ? jev.reading(a.same_class) : null;
    return Object.assign({}, typeof hit === "string" ? { hit } : hit, {
      same_class: r ? Number(r.value.toFixed(3)) : null,
      likely: r ? r.value >= t : null,
      routed: !!r,
    });
  });
  // A hit triage could not read sorts first, not last: the one thing worse
  // than an unranked list is a list that buries what the machine skipped.
  const rank = (h) => (h.same_class == null ? Infinity : h.same_class);
  out.sort((x, y) => rank(y) - rank(x));
  if (out.length !== hits.length) throw new Error(`triage dropped class hits: ${hits.length} in, ${out.length} out`);
  const likely = out.filter((h) => h.likely === true).length;
  const unread = out.filter((h) => h.routed === false).length;
  return {
    hits: out, likely, unread, total: out.length,
    why: `${out.length} locations, ${likely} with the same shape${unread ? `, ${unread} triage could not read, ordered first` : ""}. Every one is in the list; the ranking is an order, not a filter.`,
  };
}

// Two verdicts, and neither of them approves anything. There is deliberately
// no value here that means "ready", because S1 already says who decides that.
function judgePlan(answers, cfg) {
  const t = (cfg && cfg.requireAtOrAbove != null) ? cfg.requireAtOrAbove : 0.6;
  const LABELS = {
    claim_is_observable: "the Claim does not describe something anyone could observe",
    acceptance_checkable_without_code: "the Acceptance cannot be checked without reading the diff",
    class_names_paths: "the Class section names no code paths and shows no search",
    proof_command_is_concrete: "the Proof command is a description and not an invocation",
    rollback_is_real: "the Rollback says revert it and nothing else",
  };
  if (!answers) return { verdict: "no_objection", routed: false, missing: [], why: "triage could not read the plan, so it raises no objection. That is not an approval." };
  const missing = [];
  const readings = {};
  for (const key of Object.keys(LABELS)) {
    const r = jev.reading(answers[key]);
    if (!r) continue;
    readings[key] = Number(r.value.toFixed(2));
    if (r.value < t) missing.push({ key, said: LABELS[key], reading: Number(r.value.toFixed(2)) });
  }
  if (!Object.keys(readings).length) return { verdict: "no_objection", routed: false, missing: [], why: "triage returned no readings, so it raises no objection. That is not an approval." };
  return {
    verdict: missing.length ? "not_ready" : "no_objection", routed: true, missing, readings,
    why: missing.length
      ? `not ready for a review: ${missing.map((m) => m.said).join("; ")}`
      : "triage raises no objection to this plan. That is not an approval, and the owner's yes is still required.",
  };
}

// ---------------------------------------------------------------------------
// The measuring halves.
// ---------------------------------------------------------------------------

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const opts = (t) => ({ endpoint: t.endpoint, model: t.model, apiKeyEnv: t.apiKeyEnv, timeoutMs: t.timeoutMs });

async function measureInfra(runnerOutput, t) {
  if (!t || !t.enabled) return off("triage is off");
  return jev.ask({ reviewer_output: String(runnerOutput || "") }, INFRA_QUESTIONS, opts(t));
}

async function measureFindings(findings, summary, t) {
  if (!t || !t.enabled) return off("triage is off");
  const cap = (t.findings && t.findings.maxFindings) || 60;
  const conc = (t.findings && t.findings.concurrency) || 6;
  const results = await pool(findings.slice(0, cap), conc, (f) =>
    jev.ask({ summary: String(summary || ""), finding: typeof f === "string" ? f : JSON.stringify(f) }, FINDING_QUESTIONS, opts(t))
  );
  // Padded to the full length, so a finding past the cap arrives as unread
  // rather than as a shorter array the caller might zip against the wrong item.
  const answers = findings.map((_, i) => (i < results.length && results[i] && results[i].ok ? results[i].answers : null));
  return { ok: true, answers, truncated: Math.max(0, findings.length - cap) };
}

async function measureProgress(findings, priorFindings, t) {
  if (!t || !t.enabled) return off("triage is off");
  if (!priorFindings || !priorFindings.length) return off("no previous round to compare against");
  const q = priorMatchQuestion(priorFindings.slice(0, 20));
  const conc = (t.progress && t.progress.concurrency) || 6;
  const results = await pool(findings, conc, (f) =>
    jev.ask({ finding: typeof f === "string" ? f : JSON.stringify(f), prior_findings: priorFindings.slice(0, 20).map((p) => p.title || p.summary || String(p)) }, q, opts(t))
  );
  return { ok: true, answers: results.map((r) => (r && r.ok ? r.answers : null)) };
}

async function measureClassHits(defectClass, hits, t) {
  if (!t || !t.enabled) return off("triage is off");
  const cap = (t.classHits && t.classHits.maxHits) || 200;
  const conc = (t.classHits && t.classHits.concurrency) || 6;
  const q = classHitQuestion(defectClass);
  const results = await pool(hits.slice(0, cap), conc, (h) =>
    jev.ask({ finding: typeof h === "string" ? h : JSON.stringify(h) }, q, opts(t))
  );
  const answers = hits.map((_, i) => (i < results.length && results[i] && results[i].ok ? results[i].answers : null));
  return { ok: true, answers, truncated: Math.max(0, hits.length - cap) };
}

async function measurePlan(planText, t) {
  if (!t || !t.enabled) return off("triage is off");
  return jev.ask({ claim: String(planText || "") }, PLAN_QUESTIONS, opts(t));
}

module.exports = {
  judgeInfra, judgeFindings, judgeProgress, judgeClassHits, judgePlan,
  measureInfra, measureFindings, measureProgress, measureClassHits, measurePlan,
  INFRA_QUESTIONS, FINDING_QUESTIONS, PLAN_QUESTIONS, classHitQuestion, priorMatchQuestion,
  isReviewerMajor, pool,
};
