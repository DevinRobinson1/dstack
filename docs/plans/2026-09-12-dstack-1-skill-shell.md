# Dstack Plan 1: The Skill Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

_Round 3 revision after Codex review. What changed each round is in the review log beside this file._

**Goal:** One skill, `/dstack <stage>`, that routes a change through nine named stages (Intake, Plan, Build, Prove, Gate, See it, Ship, Watch, Retro), records where every change is in a file rather than in memory, and refuses to let any stage be skipped without the PR saying so, for an owner who reads evidence rather than code.

**Architecture:** A single entry skill under `~/.claude/skills/dstack/` with routing, the canonical stop-rule block and the mandatory triad in `SKILL.md`, and three reference files loaded on demand: the full stage contract (which also carries each stage's exact pre-flight requirements), the PR evidence template, and the class rule. Every stage reads and writes `.dstack/state.json` at the lane root; Intake creates it and every stage after checks its predecessor's recorded state, so no stage can be entered from memory. Plans live where the house convention puts them, `docs/superpowers/plans/`, and Plan commits them, so Build's clean-tree gate is honest. Stages whose code is not built yet (the three-wide runner, See it, Watch, Retro) write an explicit `not_built` state with a note that reaches the PR body, and Watch reports `unknown`, never green, until it exists. The gate is invoked in a way that cannot merge.

**Tech Stack:** Markdown skill files and one Node verifier, `scripts/verify.cjs`, which parses the routing table row by row as `(number, name, command)` tuples, parses the stage contract's headings and per-line fields, and compares the stop-rule block between the two files byte for byte. YAML for the 4-brain frontmatter check is parsed with the `yaml` package, declared as this repository's only devDependency and installed into this repository's own `node_modules` by Task 0. It shares nothing with any other project.

**Claim, in the owner's words:** "When I ask for a change, I get a plan I can say yes to before any code exists, then a PR whose body tells me the claim, what was proved and on which commit, the gate verdict, what I would see on screen, the ticket it closes or why it cannot, the risks, and how to undo it. Nothing merges until I say so, and the gate cannot merge on its own."

**Class of defect this closes:** process steps that depend on the agent remembering them. Every stage becomes a named command with a stop rule, a required artifact, and a state entry that the next stage checks, so skipping one is visible in a file and in the PR.

**Out of scope for this plan:** the mutation ledger writer (Plan 2), the three-wide runner (Plan 3), the browser stage (Plan 4), the deploy watch (Plan 5), retro metrics (Plan 6). Each exists here as a routed command that records `not_built` and names what ran instead. Also out of scope: judging whether a plan's prose is vague. Pre-flight checks that named sections exist and are non-empty; it cannot judge quality, and does not claim to.

**Proof command:** `cd skill && node scripts/verify.cjs`, exit 0 on the files exactly as written here, after Task 5 Step 3 has shown it exit 1 on each of five deliberate breaks.

**What the verifier does and does not guarantee, said plainly:** identical canonical stop-rule blocks prevent the two files from drifting apart inside those blocks. They do not prevent someone weakening both copies identically, or writing stage prose that contradicts a rule. That is what Plan review and the owner's yes are for.

---

## File structure

Every task in this plan is built inside the **dstack repository** at `C:/Users/Owner/Desktop/Claude Code Projects/dstack` (https://github.com/DevinRobinson1/dstack), not directly in `~/.claude/skills`. The repository is the source of truth and the skill directory becomes a link into it, created by the installer in Task 8. Building here is what turns the work into a diff somebody can review before it is live.

Run every command in this plan from the repository root, and export the 4-brain repository path once for Task 6:

```bash
cd "C:/Users/Owner/Desktop/Claude Code Projects/dstack"
export FOURBRAIN="C:/Users/Owner/Desktop/Claude Code Projects/4-brain"
```

```
dstack/
├── README.md                      built (scaffold commit)
├── LICENSE, .gitattributes        built
├── install.sh / install.ps1       built: link skill/ into ~/.claude/skills/dstack, probe CLIs, run the verifier
├── dstack.config.example.json     built: the engine/context split
├── package.json                   Task 0: one devDependency, `yaml`
├── docs/plans/                    this plan and its review log
└── skill/                         TASKS 1 TO 5 BUILD EVERYTHING BELOW
    ├── SKILL.md                   entry point: routing table, canonical stop rules, state file, triad
    ├── references/
    │   ├── stages.md              the contract per stage: who, needs (the exact pre-flight), produces, owner reads, stop
    │   ├── pr-evidence.md         the PR body template every Dstack PR carries
    │   └── class-rule.md          the checklist run before any finding is fixed
    └── scripts/
        └── verify.cjs             structural self-check; Task 5
```

Both installers already refuse to run while `skill/SKILL.md` is absent, so nobody can install a half-built process by accident. Task 8 is what makes the install real.

`SKILL.md` stays under 1,600 words; the per-stage pre-flight detail lives in `stages.md` under each stage's `Needs`, and SKILL.md's pre-flight says to read it. The state file `.dstack/state.json` lives at the root of the lane worktree, is excluded by appending `.dstack/` to the file `git rev-parse --git-path info/exclude` names (in a linked worktree that resolves into the main repository's git directory, so the exclusion is repository-wide; never a repo `.gitignore` edit), and is the single authoritative record of where a change is.

---

### Task 0: The one dependency

**Files:**
- Create: `package.json`

Task 6 parses 4-brain's YAML frontmatter, which needs a real YAML parser. It gets one here, in this repository's own `node_modules`, so nothing reaches into another project.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "dstack",
  "version": "0.1.0",
  "private": true,
  "description": "Nine stages, one command, and readable evidence at every gate.",
  "license": "MIT",
  "scripts": {
    "verify": "cd skill && node scripts/verify.cjs"
  },
  "devDependencies": {
    "yaml": "^2.5.0"
  }
}
```

- [ ] **Step 2: Install it and prove the parser resolves**

Run:
```bash
npm install && node -e 'const Y=require("yaml");console.log("yaml OK:",Y.parse("a: 1").a)'
```
Expected: an npm summary, then `yaml OK: 1`.

This install is safe and is the one exception to the house no-install rule: this repository has its own `node_modules`, shares nothing with the PFP gates, and `node_modules/` is already in `.gitignore`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json && git commit -m "build: one devDependency, a real YAML parser for the 4-brain check

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: The entry skill

**Files:**
- Create: `skill/SKILL.md`

- [ ] **Step 1: Write the skill file exactly as below**

```markdown
---
name: dstack
description: Run a change through Devin's eight-stage delivery process (Plan, Build, Prove, Gate, See it, Ship, Watch, Retro) so the owner reads evidence, never code. Use when starting any fix or feature, or when asked to /dstack <stage>. For a one-off external review, use /4-brain.
---

# Dstack

Devin's stack, after gstack, for an owner who reads evidence and not code.

**Announce at start:** "Running Dstack, stage: <stage>." Then echo the brains, one line: `codex <ver> / gemini <ver> / grok <ver>, models per CLI defaults`.

## The principle

The owner never reads code. He reads evidence. Every stage turns a change into a **claim**, a **proof** of that claim, and an **independent verdict** on it, in plain language, on the pull request itself.

If a stage cannot produce evidence he can read, it is not finished. If a stage is skipped, the state file records it and the PR body's Stages block says so, with his yes beside it.

## The state file

Every stage reads and writes `.dstack/state.json` at the lane root; Intake creates it. Nothing about where a change is lives in memory.

    {
      "pr": 1265,
      "head": "<full sha the evidence is about>",
      "plan_file": "docs/superpowers/plans/2026-09-12-fs58.md",
      "runner_available": false,
      "stages": {
        "intake":  { "state": "done", "at": "<iso>", "artifact": ".dstack/work-order.json" },
        "plan":    { "state": "done", "at": "<iso>", "codex_review": "APPROVED", "owner_yes": "<iso>" },
        "build":   { "state": "done", "at": "<iso>", "by": "codex", "fix_rounds": 1 },
        "prove":   { "state": "done", "at": "<iso>", "head": "<full sha>", "guarantees": 6, "seen_to_fail": 6, "tool": "scripts/ci/mutate.cjs" },
        "gate":    { "state": "pass", "at": "<iso>", "head": "<full sha>", "round": 2, "majors": 0, "runner": "review-loop3.sh", "concurrency": 1 },
        "see":     { "state": "not_built", "note": "UI claims are on a source guard only" },
        "ship":    { "state": "pending" },
        "watch":   { "state": "not_built", "note": "deploy is unwatched; treat as unknown" },
        "retro":   { "state": "not_built", "note": "counted by hand from review-loop.log" }
      }
    }

Allowed `state` values: `pending`, `done`, `pass`, `block`, `skipped`, `not_applicable`, `not_built`, `unknown`, `stale`. A `skipped` entry carries `"owner_yes": "<iso>"` or it is invalid. Whenever the plan file or the branch head changes, every stage after the one that changed it is set to `stale` and must run again. `codex_review` on the plan entry is `APPROVED` or `skipped`; the plan itself is `done` only with `owner_yes`.

`/dstack` with no argument prints the state file as a table and names the next stage.

## Routing

`/dstack <stage>` runs one stage. Read `references/stages.md` for that stage's contract before running it. Do not run a stage from memory.

| # | Stage | Command | Who | Produces | Owner reads |
|---|---|---|---|---|---|
| 1 | Intake | `/dstack intake` | shop intake, or Devin | the state file and a work order with the ticket block | nothing yet |
| 2 | Plan | `/dstack plan` | Claude writes, Codex reviews, Devin says yes | the plan and its review log, committed | the claim, the acceptance criteria, the named flows |
| 3 | Build | `/dstack build` | Codex at medium effort | a diff and Codex's report | nothing |
| 4 | Prove | `/dstack prove` | Claude | the proof ledger, the commit, the pushed branch, the PR with its evidence body | "N guarantees, N seen to fail, on <sha>" |
| 5 | Gate | `/dstack gate` | Codex at xhigh + Grok in parallel, Claude adjudicates | verdict and two reviews, one PR comment | PASS or BLOCK, one line per major |
| 6 | See it | `/dstack see` | a real browser, Gemini judges, Claude adjudicates | screenshots and pass or fail per named flow | the screenshots |
| 7 | Ship | `/dstack ship` | Devin says merge, Claude merges | a merge, then ticket, email and deploy outcomes as separate states | one row per PR |
| 8 | Watch | `/dstack watch` | automated, then Claude | a deploy report | one line per deploy |
| 9 | Retro | `/dstack retro` | Claude | rounds per PR, time per shipped PR, infra rate | one table a week |

## Stop rules

Canonical. `references/stages.md` carries this block verbatim under the same heading and `scripts/verify.cjs` fails if the two differ by a character.

<!-- dstack-stop-rules-begin -->
- **S1 Plan.** No build starts unless BOTH are true: Codex wrote `VERDICT: APPROVED` on the plan, and Devin said yes. For a change under twenty lines the Codex review may be skipped; Devin's yes may never be skipped.
- **S2 Prove.** A mutation that stays green is a test that proves nothing. Fix the test or drop the guarantee. A dropped guarantee is removed from the plan's Acceptance and from the PR Claim in the same commit, and if Acceptance changed, Plan runs again for Devin's yes.
- **S3 Gate.** Compare each round's in-scope major count to the previous real round's. Infra rounds do not count as rounds. After two consecutive comparisons where the count did not fall, stop: hand over on the PR with two options and do not run a third.
- **S4 Gate.** An `infra` verdict is not a verdict. Retry once. If it is infra again, hold and say so in the state file.
- **S5 Ship.** A ticket-backed PR ships in exactly one of two ways. Closes-ticket: the marker from `ticket-directive.cjs --lookup FS-NN` is on the PR and matches the live id and customer message count. Partial-fix: no marker, and the PR body says why the ticket cannot close and what the customer must do, and Devin's yes names it as a partial fix. Any other shape does not merge.
- **S6 Ship.** Nothing merges on a conversation. Only Devin's explicit say-so, only a gate PASS whose `head` equals the live PR head, only `--match-head-commit <full sha>`. The gate runner is invoked with auto-merge off, and Gate refuses to run if `shop.config.json` has `autoMergeOnPass` true.
<!-- dstack-stop-rules-end -->

## What may be skipped

Exactly these, and each is recorded in the state file and in the PR Stages block:

- Plan's Codex review, for a change under twenty lines: `codex_review: skipped` with `owner_yes`. The plan is still `done`.
- See it, when the diff touches nothing under `client/`: `not_applicable`, which needs no yes.

Nothing else may be skipped. Pre-flight refuses.

## Who builds, and when Claude may

Codex builds from the frozen plan. Claude writes code only when `/codex-build`'s two fix rounds are spent, and then the state file records `"by": "claude", "reason": "codex fix rounds spent"` and the PR Stages block says the same.

## Reviews land before edits begin

During Gate, read Codex's findings as soon as they arrive and start the class rule on them. Do not edit a file until both reviews have landed against the same `verdict.head`. The class rule needs every finding to name the class.

## The class rule

Before fixing any finding from any reviewer, read `references/class-rule.md` and answer its four questions in the PR comment.

## What each PR carries

Every Dstack PR body follows `references/pr-evidence.md`. The owner reads the body, never the diff. Pre-delivery for Prove, Gate, See it and Ship verifies the body has every section with content.

## Tools this routes to

- Plan: `/grill-me-codex` when the design is open, `/codex-review` when it is not, with `PLAN_FILE` under `docs/superpowers/plans/`.
- Build: `/codex-build` with `SPEC_FILE` set to the plan file, the build invocation carrying `-c model_reasoning_effort="medium"`.
- Prove: `scripts/ci/mutate.cjs` in the repo (Plan 2). Until it lands, `C:/tmp/mutate.py`, and the state records `"tool"`.
- Gate: `scripts/agent-bridge/gate-pr.cjs` via the runner (Plan 3). Until it lands, `review-loop3.sh` one PR at a time; the state records `"runner_available": false`, and the PR Gate line says `three-wide runner: not_built; review-loop3.sh, concurrency 1`.
- See it: `scripts/ci/see-it.cjs` (Plan 4). Until it lands, `not_built` with note `UI claims are on a source guard only`, which goes into the PR Stages block.
- Ship: `gh pr merge --squash --match-head-commit <full sha>` after S5 and S6 hold.
- Watch: `scripts/ci/deploy-watch.cjs` (Plan 5). Until it lands, `not_built` with note `deploy is unwatched; treat as unknown`, into the merge report. Silence means unknown, never green.
- Retro: `scripts/ci/retro.cjs` (Plan 6). Until it lands, `not_built` with note `counted by hand from review-loop.log`, and the table cites the log lines.

## Pre-flight

Before routing, load `.dstack/state.json`. If it does not exist and the stage is not Intake, refuse. Then check the stage's `Needs` in `references/stages.md`: the predecessor's recorded state, and the named artifact sections present and non-empty. Refuse and print this if anything is missing:

    Dstack cannot run <stage>: <what is missing>.
    <stage> needs: <the predecessor state and the artifact sections named in stages.md>.
    Run /dstack <previous stage> first. Only Plan's Codex review (under twenty lines) and See it (no client/ change) may be skipped, and a skip is recorded with Devin's yes.

This checks presence and non-emptiness only; the plan review and the owner's yes judge quality.

## Pre-delivery check

Before reporting a stage done, print and verify:

    Dstack <stage> check
    - state written: .dstack/state.json, stages.<stage>.state = <value>
    - produced: <artifact path, or "not_built: <note>">
    - owner reads: <the sentence he will see>
    - PR body sections present and non-empty: <list, or "not applicable before Prove">
    - stop rules checked: <S-ids that apply and their result>
    - em dashes in anything written: 0

If any line is wrong, fix it before delivering. Not after.

## Style

No em dashes anywhere: not in code, comments, tests, PR bodies, or this file. Periods, commas, colons, parentheses. Every commit and PR ends with the attribution the session specifies.
```

- [ ] **Step 2: Verify the description obeys the skill-creator rules, strictly under 300, and the file is under 1,600 words**

Run:
```bash
cd skill && node -e '
const fs=require("fs");const s=fs.readFileSync("SKILL.md","utf8");
const m=s.match(/^description:\s*(.+)$/m);if(!m)throw new Error("no description");
const d=m[1];console.log("chars:",d.length,"words:",s.split(/\s+/).length);
if(d.length>=300)throw new Error("description must be under 300 chars");
if(!/^[A-Z][a-z]+ /.test(d))throw new Error("description must start with an action verb");
if(!/Use when/.test(d))throw new Error("description needs a Use when clause");
if(s.split(/\s+/).length>1600)throw new Error("SKILL.md over 1600 words");
console.log("description and length OK");'
```
Expected: `chars: 270 words: <n under 1600>` then `description and length OK`.

- [ ] **Step 3: Verify no em dash anywhere in the file**

Run:
```bash
cd skill && node -e 'const s=require("fs").readFileSync("SKILL.md","utf8");const n=(s.match(/\u2014/g)||[]).length;console.log("em dashes:",n);process.exit(n?1:0)'
```
Expected: `em dashes: 0`

- [ ] **Step 4: Commit**

```bash
git add skill/SKILL.md && git commit -m "feat(dstack): the entry skill, nine stages, canonical stop rules, state file

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The stage contract

**Files:**
- Create: `skill/references/stages.md`

Every field (`**Who:**`, `**Needs:**`, `**Produces:**`, `**Owner reads:**`, `**Stop:**`) is one line with its value on that same line; the verifier reads them line by line. `Needs` is the exact pre-flight for that stage. `Stop` names S-rules, or `none`, or begins `see ` and points to the clause that blocks.

- [ ] **Step 1: Write the reference exactly as below**

```markdown
# Dstack stages: the full contract

Read the section for the stage you are running. Each has: who does it, what it needs (this is the pre-flight, exactly), what it produces, what the owner reads, and the stop rule that applies. The stop rules themselves are the canonical block at the end of this file, identical to SKILL.md's; the verifier fails if they differ.

## 1. Intake

**Who:** the shop intake script, or Devin by hand.
**Needs:** a support ticket, or Devin's written ask. Nothing else; this is the first stage and creates the state file.
**Produces:** `.dstack/state.json` at the lane root with every stage `pending`; `.dstack/` appended to the file `git rev-parse --git-path info/exclude` names (a linked worktree's `.git` is a file, and this resolves it correctly to the main repository's git directory, so the exclusion is repository-wide); and the work order at `.dstack/work-order.json` carrying the ticket block: `{ "ticket": { "number": N, "id": "<uuid>", "customer_msgs": M } }`, or for an ask with no ticket, `{ "ticket": null, "ask": "<Devin's words>" }`. Writes `stages.intake` to `done`.
**Owner reads:** nothing yet.
**Stop:** none. Pre-flight refuses a work order naming a ticket number with no id; `ticket-directive.cjs --lookup FS-NN` fetches it.

## 2. Plan

**Who:** Claude writes. Codex reviews read-only. Devin says yes.
**Needs:** `stages.intake.state = done` and `.dstack/work-order.json`.
**Produces:** the plan at `docs/superpowers/plans/<YYYY-MM-DD>-<name>.md` and its review log at `<same>.review-log.md`, both committed on the lane branch in a commit whose message starts `plan:`, so Build's clean-tree check passes; `stages.plan` with `codex_review` (`APPROVED` or `skipped`) and `owner_yes`; and `plan_file` at the top of the state file. The plan contains, in this order, each non-empty: Claim, Class, Change, Proof command (with the guarantee list), Flows (or the line `Flows: none, no client/ change`), Out of scope, Acceptance, Risks and prerequisites (or `none identified`), Rollback.
**Owner reads:** Claim, Flows, Acceptance, and Risks and prerequisites. He says yes or no, and the yes is stamped into the state file.
**Stop:** S1.

Detail on the sections:
1. **Claim**, one paragraph, in the words the customer or Devin would use: what they will observe that they cannot observe today.
2. **Class**, one paragraph: what kind of defect this is, not which instance, and every code path that class runs through, found by grep, with the grep pasted.
3. **Change**, the concrete edits per file.
4. **Proof command**, the exact test invocation, and the list of guarantees Prove will mutate, one line each.
5. **Flows**, when the change will touch `client/`: each user-visible flow See it must walk, as "start at <route>, do <steps>, expect <what is on screen>".
6. **Out of scope**, named.
7. **Acceptance**, three to six lines Devin can check without reading code, each of which Prove or See it will report an observed result against.
8. **Risks and prerequisites**, in plain language: downtime, irreversible data changes, configuration or environment that must exist first, or `none identified`.
9. **Rollback**, one paragraph: how to undo this if Watch reports it broke something. For a migration, whether it reverses and what data it touches.

Route: `/grill-me-codex` when any design question is open; `/codex-review` when the plan is already settled. Either ends with `VERDICT: APPROVED` in the log, or a recorded skip for a change under twenty lines.

## 3. Build

**Who:** Codex, with write access, from the frozen plan.
**Needs:** `stages.plan.state = done` with `codex_review` set and `owner_yes` set; a clean tree (`git status -sb` shows nothing modified; the plan commit from stage 2 is what makes that true).
**Produces:** a diff in the working tree, Codex's report appended to the review log under `## Act 3 - Build`, and `stages.build` with `by` and `fix_rounds`.
**Owner reads:** nothing. Prove is what makes this safe.
**Stop:** S1. A dirty tree also stops it before it starts. Codex never commits, and nothing is committed in this stage at all.

How: `/codex-build` with `SPEC_FILE` set to `plan_file` from the state, `PROOF_CMD` from the plan, and the build invocation carrying `-c model_reasoning_effort="medium"`. Up to two fix rounds in the same Codex session. If both are spent, Claude finishes the build and the state records `"by": "claude", "reason": "codex fix rounds spent"`.

## 4. Prove

**Who:** Claude, before the gate or anyone else sees the diff.
**Needs:** `stages.plan.state = done` with `owner_yes`, `stages.build.state = done`, the diff, and the plan's guarantee list and Acceptance. Prove refuses without the recorded plan and build states; a diff alone is not an input.
**Produces:** in this order, all owned by this stage: the proof ledger; the baseline proof (the plan's proof command run by Claude, with its verbatim summary line); observed results against each Acceptance line; the commit on the lane branch with the attribution line; the push; the PR, created or updated, with its body per `references/pr-evidence.md` (stages after Prove are written as `pending` at creation); and `stages.prove` with `head`, `guarantees`, `seen_to_fail`, `tool`.
**Owner reads:** "6 guarantees, 6 seen to fail, on <short sha>, proof command green." If it is 5 of 6, the ledger names the sixth and why, and the Claim no longer promises it.
**Stop:** S2.

How:
- Read the full diff against the plan. Anything outside the plan's Change section is a deviation and is named in the PR body.
- Run the proof command yourself. Codex's pasted output does not count.
- For each guarantee, write a mutation that removes it, run the tests, watch them fail, restore. Tool: `scripts/ci/mutate.cjs` (Plan 2); until then `C:/tmp/mutate.py`, and the state records which.
- Redundant guards are mutated together or neither is tested.
- A guard nothing can observe is dropped from the ledger, the ledger says why, and per S2 the plan's Acceptance and the PR Claim are edited in the same commit.
- Fixtures acquire their subject the way production does.
- The PR body links the plan and review log at the commit they were approved in, and attaches or links the proof output at `stages.prove.head`.

## 5. Gate

**Who:** Codex (config default, xhigh) and Grok, in parallel, on the diff. Claude adjudicates.
**Needs:** `stages.prove.state = done`, a pushed branch whose head equals `stages.prove.head`, a PR body with the Proof ledger section non-empty, and `shop.config.json` with `autoMergeOnPass` false or absent (if true, refuse under S6).
**Produces:** the round directory `.4-brain-out/<date>-pr<N>/round-<n>/` with `verdict.json`, and the two reviews at the paths `verdict.json` names in `codex.reviewFile` and `grok.reviewFile`, both of which must exist; a PR comment with PASS or BLOCK, the major count, one line per major, and the class-rule answers if BLOCK; and `stages.gate` with `round`, `majors`, `head`, `runner`, `concurrency`. The PR Gate line also states the runner: `three-wide runner: not_built; review-loop3.sh, concurrency 1` until Plan 3 lands.
**Owner reads:** PASS or BLOCK, the major count, one sentence per major.
**Stop:** S3, S4, S6.

How: the runner (Plan 3) dispatches up to three PRs at once, each lane with its own `DATABASE_URL_TEST`, with auto-merge off. Until it lands, `review-loop3.sh` one at a time, which never merges. Read the reviews at the paths in `verdict.json`'s `codex.reviewFile` and `grok.reviewFile`, never a `.md` by name: a round directory is reused. Compare `verdict.head` to the live PR head before acting on any finding; if they differ, the round is about a different commit and does not count.

On BLOCK: read Codex's findings as they land and begin the class rule on them. Edit nothing until both reviews are in against the same head. Then answer the four class-rule questions in the PR comment, fix every finding in the round (majors and minors), then Prove again (which marks Gate `stale` and re-runs), then Gate again.

## 6. See it

**Who:** a real browser drives the app on the lane. Gemini judges the screenshots against the plan's Flows. Claude adjudicates Gemini the way it adjudicates Codex and Grok.
**Needs:** `stages.gate.state = pass` at the current head, and the plan's Flows section. If the diff touches nothing under `client/`, this stage writes `not_applicable` with the reason and returns; that needs no yes.
**Produces:** per named flow: a before screenshot, an after screenshot, Gemini's one-paragraph read, and pass or fail, attached to the PR under the See it section; and `stages.see` with `head`, `flows`, `passed`, `failed`.
**Owner reads:** the screenshots. The one stage where he judges the work directly.
**Stop:** see "What Ship accepts" below, enforced by Ship's pre-flight.

How: `scripts/ci/see-it.cjs` (Plan 4) using the repo's installed `@playwright/test`. Until it lands, this stage writes `not_built` with note `UI claims are on a source guard only`, and the PR Stages block carries that line. Gemini is not a code reviewer here and gets no vote on code.

What Ship accepts from See it, exhaustively: `pass` at the current head with `flows >= 1` and `failed = 0`; or `not_applicable` with its reason; or a recorded waiver, where Devin's yes at Ship names the missing evidence in his own words and the PR Stages block records it. Every other state (`pending`, `unknown`, `not_built`, `stale`, missing, a pass at an older head, or zero flows executed) blocks Ship.

## 7. Ship

**Who:** Devin says merge. Claude merges.
**Needs:** `stages.gate.state = pass` with `stages.gate.head` equal to the live PR head; See it in a state Ship accepts; the PR body complete per `references/pr-evidence.md`, every section non-empty; and S5 satisfied in exactly one of its two shapes.
**Produces:** the merge, then four outcomes reported as separate states in the merge report and in `stages.ship`: `merge` (with the squash sha and per-file containment), `ticket` (`resolved`, `pending`, `not-applicable`, `partial-fix`, or `unknown`), `email` (`sent`, `queued`, `failed`, `not-applicable`, or `unknown`), and `deploy` (`unknown` until Watch exists).
**Owner reads:** the merge list page, one row per PR: claim, proof line, verdict, ticket outcome, email outcome, deploy state.
**Stop:** S5, S6.

How, and what each step proves:
1. `gh pr view N --json baseRefName` says `main`. Proves the base, nothing else.
2. `gh pr merge N --squash --match-head-commit <full 40-char sha>`. Proves the branch did not move after the gate.
3. Containment for a squash: `git fetch origin main` then, for every file the PR touched, `git diff --stat origin/main <sha> -- <file>` is empty. For a file another PR also touched since, each of the PR's own hunks (`git diff <base>..<sha> -- <file>`) must be present in `origin/main`. `git merge-base --is-ancestor` is the wrong test for a squash and is not used. Proves the change landed, file by file.
4. Ticket outcome: for closes-ticket, run `ticket-directive.cjs --lookup FS-NN` again and read the status it prints; `resolved` is the only value reported as resolved. A webhook 200 proves the event was delivered, not that the ticket resolved, and is not used as evidence.
5. Email outcome: read `support_ticket_merge_events` and its notification row for the ticket and PR. `queued` is reported as queued, not as sent.
6. Deploy: `unknown` until Watch (Plan 5) exists. A merge to main triggers a deploy; it does not prove one finished.

## 8. Watch

**Who:** automated for fifteen minutes after deploy, then Claude reads the report.
**Needs:** `stages.ship.state = done`.
**Produces:** a deploy report: green, or what broke and which PR, or `unknown` with the reason; and `stages.watch`.
**Owner reads:** one line per deploy.
**Stop:** none. This stage reports; it does not block.

How: `scripts/ci/deploy-watch.cjs` (Plan 5): `/api/health`, error rate, and the known hazards, first among them attempts left in `accepted` with no communications row after a restart. Until it lands: `not_built` with note `deploy is unwatched; treat as unknown`, and the merge report says exactly that. Silence is unknown, never green.

## 9. Retro

**Who:** Claude, weekly or after a batch.
**Needs:** `review-loop.log` and the gate ledger.
**Produces:** one table: rounds per PR, time per shipped PR, infra rate, PRs handed over and why, and the log line ranges the numbers came from; and `stages.retro`.
**Owner reads:** the table. If rounds per PR are not falling within ten PRs of adopting Plan, the Plan stage is not working and the process changes.
**Stop:** none.

How: `scripts/ci/retro.cjs` (Plan 6). Until it lands, by hand from the log, and the table says so and cites the lines.

## Stop rules

Canonical. Identical to SKILL.md's block; the verifier fails if they differ.

<!-- dstack-stop-rules-begin -->
- **S1 Plan.** No build starts unless BOTH are true: Codex wrote `VERDICT: APPROVED` on the plan, and Devin said yes. For a change under twenty lines the Codex review may be skipped; Devin's yes may never be skipped.
- **S2 Prove.** A mutation that stays green is a test that proves nothing. Fix the test or drop the guarantee. A dropped guarantee is removed from the plan's Acceptance and from the PR Claim in the same commit, and if Acceptance changed, Plan runs again for Devin's yes.
- **S3 Gate.** Compare each round's in-scope major count to the previous real round's. Infra rounds do not count as rounds. After two consecutive comparisons where the count did not fall, stop: hand over on the PR with two options and do not run a third.
- **S4 Gate.** An `infra` verdict is not a verdict. Retry once. If it is infra again, hold and say so in the state file.
- **S5 Ship.** A ticket-backed PR ships in exactly one of two ways. Closes-ticket: the marker from `ticket-directive.cjs --lookup FS-NN` is on the PR and matches the live id and customer message count. Partial-fix: no marker, and the PR body says why the ticket cannot close and what the customer must do, and Devin's yes names it as a partial fix. Any other shape does not merge.
- **S6 Ship.** Nothing merges on a conversation. Only Devin's explicit say-so, only a gate PASS whose `head` equals the live PR head, only `--match-head-commit <full sha>`. The gate runner is invoked with auto-merge off, and Gate refuses to run if `shop.config.json` has `autoMergeOnPass` true.
<!-- dstack-stop-rules-end -->
```

- [ ] **Step 2: Verify no em dash**

Run:
```bash
cd skill && node -e 'const s=require("fs").readFileSync("references/stages.md","utf8");const n=(s.match(/\u2014/g)||[]).length;console.log("em dashes:",n);process.exit(n?1:0)'
```
Expected: `em dashes: 0`

- [ ] **Step 3: Commit**

```bash
git add skill/references/stages.md && git commit -m "feat(dstack): the full contract per stage, exact pre-flight, canonical stop rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The PR evidence template

**Files:**
- Create: `skill/references/pr-evidence.md`

- [ ] **Step 1: Write the reference exactly as below**

```markdown
# What every Dstack PR body carries

The owner reads this and never the diff. Every section is present and non-empty, in this order, or the PR is not ready for `/dstack ship`. A section that does not apply says so in one line; it is never omitted. Prove writes the first version, with every later stage `pending`; Gate, See it and Ship overwrite their own lines.

    ## Claim
    One paragraph, in the customer's or Devin's words: what they will observe that they cannot today. If Prove dropped a guarantee, this paragraph no longer promises it.

    ## Evidence is about
    Commit: <full 40-char sha>
    Environment: node <version>, test database <host:port/name>, run by <claude | codex-build>
    Plan: <link to docs/superpowers/plans/<file>.md at the commit it was approved in>
    Review log: <link to <file>.review-log.md at that commit>
    Proof output: <link or attachment of the proof command's output at the commit above>

    ## Stages
    intake:  done, <ticket or "Devin's ask">
    plan:    done, Codex APPROVED <date>, Devin yes <date>   | done, Codex review skipped (under twenty lines), Devin yes <date>
    build:   done, by codex, <n> fix rounds   | done, by claude, because codex fix rounds spent
    prove:   done, <n> guarantees, <n> seen to fail, proof command green, on <short sha>
    gate:    pending   | pass at <short sha>, round <n>, Codex <verdict>(<findings>), Grok <verdict>(<findings>), three-wide runner: <built | not_built; review-loop3.sh, concurrency 1>   | block, <majors> majors, see comment
    see:     pending   | pass at <short sha>, <n> flows, 0 fail   | fail, <n> of <m> flows   | not_applicable, no client/ change   | not_built, UI claims on a source guard only   | waived by Devin <date>: "<his words>"
    ship:    pending   | merged <short squash sha>, containment verified file by file; ticket <state>; email <state>; deploy <state>
    watch:   pending   | not_built, deploy is unwatched, treat as unknown   | green   | broke: <what>
    retro:   pending   | counted in the week of <date>   | not_built, counted by hand from review-loop.log lines <a>-<b>
    ticket:  FS-<n>, closes-ticket, marker verified against live id and message count   | FS-<n>, partial-fix, no marker, because <reason>, Devin yes <date>   | none

    ## Baseline proof
    Command: <the exact proof command from the plan>
    Result: <vitest's own summary line, verbatim>

    ## Proof ledger
    | Guarantee | Mutation | Result |
    |---|---|---|
    | <what the fix guarantees, in one line> | <what was removed> | seen to fail |
    Dropped from the set: <guard>, because <nothing can observe it>; Claim and Acceptance updated in <short sha>.   (or: none)

    ## Acceptance
    | Criterion from the plan | Observed | Evidence |
    |---|---|---|
    | <line from the plan's Acceptance> | <what was actually seen> | <link to the test output, the query and its rows, or the screenshot> |

    ## Class
    <the class of defect, and every path it runs through, from the plan, with the grep that found them>

    ## Out of scope
    <named, from the plan>

    ## Deviations from the plan
    <what the diff does that the plan did not say, and why>   (or: none)

    ## Not verified
    <anything the Claim implies that no row above demonstrates, said plainly>   (or: none)

    ## Risks and prerequisites
    <from the plan: downtime, irreversible data changes, configuration that must exist first>   (or: none identified)

    ## Rollback
    <from the plan: how to undo this, and for a migration whether it reverses and what data it touches>

Rules:
- The ticket marker itself, `<!-- support-ticket-autoresolve: ... -->`, is emitted by `ticket-directive.cjs --lookup FS-NN` and pasted verbatim below Rollback. Never typed by hand. Absent on a partial-fix PR, with the reason in the Stages block.
- No em dashes.
- The attribution line the session specifies ends the body.
```

- [ ] **Step 2: Verify no em dash**

Run:
```bash
cd skill && node -e 'const s=require("fs").readFileSync("references/pr-evidence.md","utf8");const n=(s.match(/\u2014/g)||[]).length;console.log("em dashes:",n);process.exit(n?1:0)'
```
Expected: `em dashes: 0`

- [ ] **Step 3: Commit**

```bash
git add skill/references/pr-evidence.md && git commit -m "feat(dstack): the PR body every change carries, all nine stages, risks and evidence links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The class rule

**Files:**
- Create: `skill/references/class-rule.md`

- [ ] **Step 1: Write the reference exactly as below**

```markdown
# The class rule

Run this before fixing any finding from any reviewer, once both reviews have landed against the same head. Answer all four in the PR comment before the first edit.

On 12 September 2026 one identity-collision defect was found four times on PR #1265, once per code path: the card save, then the v1 PATCH, then the two synchronous import branches, then bulk across requests. Four gate rounds, forty minutes, one idea. Every round fixed the path the reviewer named and left the siblings. This rule exists so that does not happen again.

1. **What class is this finding?** Not "the PATCH identity collides" but "an observation identity that does not include a per-request component collides whenever two requests land in one millisecond".
2. **Where else does that class run?** List every code path with the same shape. `grep` for the pattern and paste the grep; do not recall it. If the answer is "only here", say what was grepped.
3. **What is the one change that closes the class on every path?** If it is one change in one place, make it there. If it is the same change in N places, make all N in this round.
4. **What would make this finding come back with a different name?** That is the mutation Prove must add.

Signals that the rule was skipped:
- the same reviewer finds the same shape on a different path next round
- the major count does not fall after a fix
- a fix comment says "also" more than once

The stop rule this feeds is S3: two consecutive real rounds where the major count did not fall, and the change is the wrong shape. Hand over.
```

- [ ] **Step 2: Verify no em dash**

Run:
```bash
cd skill && node -e 'const s=require("fs").readFileSync("references/class-rule.md","utf8");const n=(s.match(/\u2014/g)||[]).length;console.log("em dashes:",n);process.exit(n?1:0)'
```
Expected: `em dashes: 0`

- [ ] **Step 3: Commit**

```bash
git add skill/references/class-rule.md && git commit -m "feat(dstack): the class rule, run before any finding is fixed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The proof for this plan

**Files:**
- Create: `skill/scripts/verify.cjs`

The proof is structural: every routing row is checked as a `(number, name, command)` tuple; every contract section has its five fields each with a value on the same line; the stop-rule block is byte-identical in both files; the triad sections exist and are non-empty; the description is strictly under 300 characters; the PR template and the state example name every stage. Step 3 breaks it five ways and watches it fail each time, then restores and watches it pass. All line endings are normalized before any parsing.

- [ ] **Step 1: Write the verifier**

```javascript
#!/usr/bin/env node
// Dstack's own pre-delivery check. Exit 0 means the skill files are ready.
// Structural, not substring: routing rows as (number, name, command) tuples,
// contract sections with five same-line fields, and the canonical stop-rule
// block compared byte for byte between the two files.
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const problems = [];

const ROUTES = [
  [1, "Intake", "intake"], [2, "Plan", "plan"], [3, "Build", "build"], [4, "Prove", "prove"],
  [5, "Gate", "gate"], [6, "See it", "see"], [7, "Ship", "ship"], [8, "Watch", "watch"], [9, "Retro", "retro"],
];
const STAGES = ROUTES.map((r) => r[2]);
const HEADINGS = ROUTES.map((r) => `## ${r[0]}. ${r[1]}`);
const FIELDS = ["**Who:**", "**Needs:**", "**Produces:**", "**Owner reads:**", "**Stop:**"];
const files = ["SKILL.md", "references/stages.md", "references/pr-evidence.md", "references/class-rule.md"];

for (const f of files) {
  if (!fs.existsSync(path.join(root, f))) problems.push(`${f}: missing`);
}
if (problems.length) report();
for (const f of files) {
  const dashes = (read(f).match(/\u2014/g) || []).length;
  if (dashes) problems.push(`${f}: ${dashes} em dash(es)`);
}

const skill = read("SKILL.md");
const contract = read("references/stages.md");
const evidence = read("references/pr-evidence.md");

// Description: exactly one single-line field, action verb, Use when, strictly under 300.
const fm = skill.split("---")[1] || "";
const descLines = fm.split("\n").filter((l) => /^description:/.test(l));
if (descLines.length !== 1) problems.push(`SKILL.md: expected exactly one single-line description, found ${descLines.length}`);
const desc = (descLines[0] || "").replace(/^description:\s*/, "");
if (desc.length >= 300) problems.push(`SKILL.md: description is ${desc.length} chars, must be under 300`);
if (!/^[A-Z][a-z]+ /.test(desc)) problems.push("SKILL.md: description must start with an action verb");
if (!/Use when/.test(desc)) problems.push("SKILL.md: description needs a Use when clause");
const words = skill.split(/\s+/).filter(Boolean).length;
if (words > 1600) problems.push(`SKILL.md: ${words} words, limit 1600`);

// Routing table: each row is checked as its (number, name, command) tuple, in order.
const rows = skill.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
if (rows.length !== ROUTES.length) problems.push(`SKILL.md: routing table has ${rows.length} rows, expected ${ROUTES.length}`);
for (const [num, name, cmd] of ROUTES) {
  const row = rows.find((l) => new RegExp(`^\\|\\s*${num}\\s*\\|`).test(l));
  if (!row) { problems.push(`SKILL.md: routing table has no row ${num}`); continue; }
  const cells = row.split("|").map((c) => c.trim());
  if (cells[2] !== name) problems.push(`SKILL.md: row ${num} is named "${cells[2]}", expected "${name}"`);
  if (cells[3] !== `\`/dstack ${cmd}\``) problems.push(`SKILL.md: row ${num} routes to ${cells[3]}, expected \`/dstack ${cmd}\``);
}

// Contract: every heading, in order; every field on its own line with a value on that line.
let last = -1;
for (let i = 0; i < HEADINGS.length; i++) {
  const h = HEADINGS[i];
  const at = contract.indexOf(h + "\n");
  if (at === -1) { problems.push(`stages.md: missing ${h}`); continue; }
  if (at < last) problems.push(`stages.md: ${h} is out of order`);
  last = at;
  const nextAt = i + 1 < HEADINGS.length ? contract.indexOf(HEADINGS[i + 1] + "\n") : contract.indexOf("\n## Stop rules");
  const section = contract.slice(at, nextAt === -1 ? undefined : nextAt);
  for (const field of FIELDS) {
    const line = section.split("\n").find((l) => l.startsWith(field));
    if (!line) { problems.push(`stages.md: ${h} has no ${field} line`); continue; }
    if (!line.slice(field.length).trim()) problems.push(`stages.md: ${h} ${field} is empty`);
  }
  const stop = (section.split("\n").find((l) => l.startsWith("**Stop:**")) || "").slice("**Stop:**".length).trim();
  if (stop && !/^(S\d|none|see )/.test(stop)) problems.push(`stages.md: ${h} Stop must begin with an S-rule, "none", or "see ": got "${stop.slice(0, 30)}"`);
}

// Stop rules: canonical block, byte-identical in both files, with all six ids and the two load-bearing phrases.
const block = (text, name) => {
  const m = text.match(/<!-- dstack-stop-rules-begin -->\n([\s\S]*?)<!-- dstack-stop-rules-end -->/);
  if (!m) { problems.push(`${name}: no canonical stop-rule block`); return null; }
  return m[1];
};
const a = block(skill, "SKILL.md"), b = block(contract, "stages.md");
if (a !== null && b !== null && a !== b) problems.push("stop-rule block differs between SKILL.md and stages.md");
if (a) {
  for (const id of ["S1", "S2", "S3", "S4", "S5", "S6"]) if (!a.includes(`**${id} `)) problems.push(`stop rules: ${id} missing from the canonical block`);
  if (!/autoMergeOnPass/.test(a)) problems.push("stop rules: S6 must name autoMergeOnPass");
  if (!/BOTH/.test(a)) problems.push("stop rules: S1 must require BOTH the Codex verdict and the owner's yes");
}

// The triad: pre-flight and pre-delivery sections exist with real content.
for (const heading of ["## Pre-flight", "## Pre-delivery check"]) {
  const at = skill.indexOf(heading + "\n");
  if (at === -1) { problems.push(`SKILL.md: no ${heading} section`); continue; }
  const end = skill.indexOf("\n## ", at + heading.length);
  const body = skill.slice(at + heading.length, end === -1 ? undefined : end);
  if (body.trim().split("\n").filter((l) => l.trim()).length < 3) problems.push(`SKILL.md: ${heading} section is too short to be real`);
}

// The PR template carries every stage line and every required section.
for (const s of STAGES) if (!new RegExp(`^\\s*${s}:`, "m").test(evidence)) problems.push(`pr-evidence.md: Stages block has no line for ${s}`);
for (const section of ["## Claim", "## Evidence is about", "## Stages", "## Baseline proof", "## Proof ledger", "## Acceptance", "## Class", "## Out of scope", "## Deviations from the plan", "## Not verified", "## Risks and prerequisites", "## Rollback"]) {
  if (!evidence.includes(section)) problems.push(`pr-evidence.md: missing ${section}`);
}

// The state file example in SKILL.md names every stage, and the vocabulary includes stale.
for (const s of STAGES) if (!new RegExp(`"${s}":\\s*\\{`).test(skill)) problems.push(`SKILL.md: state file example has no "${s}" entry`);
if (!/`stale`/.test(skill)) problems.push("SKILL.md: state vocabulary must include stale");

function report() {
  if (problems.length) {
    console.error("Dstack skill check FAILED");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`Dstack skill check OK: ${files.length} files, description ${desc.length} chars, SKILL.md ${words} words, ${ROUTES.length} stages routed and contracted, stop rules identical`);
  process.exit(0);
}
report();
```

- [ ] **Step 2: Run it and see it pass on the files exactly as written in Tasks 1 to 4**

Run: `cd skill && node scripts/verify.cjs`
Expected: `Dstack skill check OK: 4 files, description 270 chars, SKILL.md <n under 1600> words, 9 stages routed and contracted, stop rules identical`

If this does not pass on the unmodified files, the plan is wrong, not the files: stop and report which line, do not edit the files to make it pass.

Tasks 1 to 6 are built and proven with the wording exactly as given. Task 7 changes that wording and re-runs this verifier and all five breaks afterwards. Do not reorder them: Break 2 and Break 5 quote strings that Task 7 edits.

- [ ] **Step 3: Break it five ways and watch each one fail, then restore and watch it pass**

Every mutation normalizes line endings first and asserts its anchor was found, so a break fails for the reason named and not by accident.

```bash
cd skill && cp SKILL.md SKILL.md.bak && cp references/stages.md references/stages.md.bak

# Break 1: swap the Plan and Build command cells (both routes still exist, but on the wrong rows).
node -e 'const fs=require("fs");let s=fs.readFileSync("SKILL.md","utf8").replace(/\r\n/g,"\n");if(!s.includes("`/dstack plan`")||!s.includes("`/dstack build`"))throw new Error("anchor");s=s.replace("`/dstack plan`","`/dstack TEMP`").replace("`/dstack build`","`/dstack plan`").replace("`/dstack TEMP`","`/dstack build`");fs.writeFileSync("SKILL.md",s)'
node scripts/verify.cjs; echo "exit=$?"; cp SKILL.md.bak SKILL.md

# Break 2: alter S1 in stages.md only, so the canonical blocks differ.
node -e 'const fs=require("fs");let s=fs.readFileSync("references/stages.md","utf8");if(!s.includes("and Devin said yes"))throw new Error("anchor");fs.writeFileSync("references/stages.md",s.replace("and Devin said yes","and nobody said anything"))'
node scripts/verify.cjs; echo "exit=$?"; cp references/stages.md.bak references/stages.md

# Break 3: empty the pre-flight section (line endings normalized, both boundaries asserted).
node -e 'const fs=require("fs");let s=fs.readFileSync("SKILL.md","utf8").replace(/\r\n/g,"\n");const a=s.indexOf("## Pre-flight\n");const b=s.indexOf("\n## ",a+14);if(a===-1||b===-1)throw new Error("anchor");fs.writeFileSync("SKILL.md",s.slice(0,a+14)+"\n"+s.slice(b))'
node scripts/verify.cjs; echo "exit=$?"; cp SKILL.md.bak SKILL.md

# Break 4: pad the description to exactly 300 characters.
node -e 'const fs=require("fs");let s=fs.readFileSync("SKILL.md","utf8").replace(/\r\n/g,"\n");const m=s.match(/^description:\s*(.+)$/m);if(!m)throw new Error("anchor");const d=m[1]+" ".repeat(300-m[1].length)+"x";fs.writeFileSync("SKILL.md",s.replace(m[0],"description: "+d.slice(0,300)))'
node scripts/verify.cjs; echo "exit=$?"; cp SKILL.md.bak SKILL.md

# Break 5: empty the Who field of Gate in stages.md (the value must be on the same line).
node -e 'const fs=require("fs");let s=fs.readFileSync("references/stages.md","utf8").replace(/\r\n/g,"\n");const line="**Who:** Codex (config default, xhigh) and Grok, in parallel, on the diff. Claude adjudicates.";if(!s.includes(line))throw new Error("anchor");fs.writeFileSync("references/stages.md",s.replace(line,"**Who:**"))'
node scripts/verify.cjs; echo "exit=$?"; cp references/stages.md.bak references/stages.md

# Restored: must pass.
node scripts/verify.cjs; echo "exit=$?"

# Remove the backups so a later run cannot read a stale one.
rm -f SKILL.md.bak references/stages.md.bak
```
Expected, in order: `SKILL.md: row 2 routes to \`/dstack build\`, expected \`/dstack plan\`` exit=1; `stop-rule block differs between SKILL.md and stages.md` exit=1; `SKILL.md: ## Pre-flight section is too short to be real` exit=1; `SKILL.md: description is 300 chars, must be under 300` exit=1; `stages.md: ## 5. Gate **Who:** is empty` exit=1; then `Dstack skill check OK` exit=0.

- [ ] **Step 4: Commit**

```bash
git add skill/scripts/verify.cjs && git commit -m "feat(dstack): the skill checks itself structurally, and is seen to fail five ways

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Make 4-brain's description compliant, remove its em dashes, and point it at Dstack

**Files:**
- Modify: `$FOURBRAIN/skill/SKILL.md` (the repo at `C:/Users/Owner/Desktop/Claude Code Projects/4-brain`, which `~/.claude/skills/4-brain` is a junction into) (frontmatter, one heading added to the body, and em-dash punctuation throughout the body)

The 4-brain skill keeps its verified CLI invocation reference, which Dstack routes to. Its description today is a multi-line block containing em dashes and the whole NO-SELF-REVIEW law, violating the single-line, under-300 and em-dash rules; its body carries 24 more em dashes. The law moves into the body, the description becomes one compliant line that routes a process request to Dstack, and every em dash in the file is replaced.

- [ ] **Step 1: Replace the frontmatter description**

Replace the entire `description: |` block (from the line `description: |` through the last indented line before the closing `---`) with this single line:

```
description: Route a review, build, or verification to Codex, Gemini, or Grok when their lens beats Claude alone, and never let Claude review its own work. Use when asked to check, review, audit, or second-opinion anything Claude produced. For the full delivery process, use /dstack.
```

- [ ] **Step 2: Move the law into the body**

Immediately after the frontmatter's closing `---` and before the existing `# 4-Brain` heading, insert:

```markdown
## Hard rule: the no-self-review law (read this first)

When the user asks Claude to check, review, look over, proof, verify, audit, sanity-check, or second-opinion ANY work Claude just produced (code, writing, plan, design, anything), this is a MUST-FIRE situation. Route to at least one external brain.

Claude reviewing Claude's own output is the exact failure mode this skill exists to prevent. Same architecture, same blind spots. A self-review catches nothing meaningful.

Phrases that MUST trigger an external review, not exhaustive: "check over your work", "review what you just did", "look over this", "is this right?", "second opinion", "sanity check", "double-check", "proof this", "audit this", "make sure this works".

Do NOT silently self-review. Do NOT say "I'll review it inline."

Also fires on: "ask all four", "cross-model check", "grill this", "what would X say", and any task needing eyes or ears Claude lacks (video, audio, images, very long documents).
```

- [ ] **Step 3: Replace every remaining em dash in the body**

An em dash between spaces becomes a comma and a space; an em dash with no surrounding spaces becomes a comma and a space too. This is mechanical, so the executor then reads every changed line for sense and adjusts a comma to a period or a colon where the sentence needs it. The `# 4-Brain` heading, which used an em dash, becomes `# 4-Brain: one driver, four perspectives`.

Run:
```bash
cd "$FOURBRAIN/skill" && node -e '
const fs=require("fs");let s=fs.readFileSync("SKILL.md","utf8");
const before=(s.match(/\u2014/g)||[]).length;
s=s.replace(/# 4-Brain \u2014 One Driver, Four Perspectives/,"# 4-Brain: one driver, four perspectives");
s=s.replace(/ \u2014 /g,", ").replace(/\u2014/g,", ");
fs.writeFileSync("SKILL.md",s);
console.log("replaced",before,"em dashes; remaining",(s.match(/\u2014/g)||[]).length);'
git -C "$FOURBRAIN" diff --stat skill/SKILL.md
```
Expected: `replaced 24 em dashes; remaining 0` (the count may differ by one or two if the file changed since; `remaining 0` is what matters), then a diff stat. Then read the diff (`git -C "$FOURBRAIN" diff skill/SKILL.md`) and fix any comma that should be a period or colon.

- [ ] **Step 4: Verify by parsing the YAML, and that no em dash remains anywhere in the file**

Run:
```bash
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const YAML=require("yaml");
const s=fs.readFileSync("SKILL.md","utf8");
const fm=s.split("---")[1];
const doc=YAML.parse(fm);
if(doc.name!=="4-brain")throw new Error("name is "+doc.name);
if(typeof doc.description!=="string")throw new Error("description is not a string");
const d=doc.description;
if(/\n/.test(d))throw new Error("description is multi-line");
if(d.length>=300)throw new Error("description is "+d.length+" chars");
if(!/^[A-Z][a-z]+ /.test(d))throw new Error("description must start with an action verb");
if(!/Use when/.test(d))throw new Error("no Use when clause");
if(!/use \/dstack/.test(d))throw new Error("pointer to /dstack missing from the description");
if(/\u2014/.test(s))throw new Error("em dash still present in 4-brain SKILL.md");
if(!/## Hard rule: the no-self-review law/.test(s))throw new Error("the law did not move into the body");
console.log("4-brain frontmatter OK:",d.length,"chars, no em dashes anywhere, law in body");'
```
Expected: `4-brain frontmatter OK: <n under 300> chars, no em dashes anywhere, law in body`

If `require("yaml")` fails, Task 0 was skipped. Run it. Do not reach into another project's `node_modules`.

- [ ] **Step 5: See it fail on the unindented form Codex tested**

Run:
```bash
cd "$FOURBRAIN/skill" && cp SKILL.md SKILL.md.bak && node -e 'const fs=require("fs");fs.writeFileSync("SKILL.md",fs.readFileSync("SKILL.md","utf8").replace(/^description: /m,"description:\n"))' && node -e '
const fs=require("fs"),path=require("path");
const YAML=require("yaml");
try{const doc=YAML.parse(fs.readFileSync("SKILL.md","utf8").split("---")[1]);if(typeof doc.description!=="string")throw new Error("description is not a string")}catch(e){console.log("caught as expected:",e.message);process.exit(0)}
console.log("NOT CAUGHT");process.exit(1)'; echo "exit=$?"; cp SKILL.md.bak SKILL.md
```
Expected: `caught as expected: ...` and `exit=0`, then the restored file passes Step 4 again.

- [ ] **Step 6: Commit**

```bash
git -C "$FOURBRAIN" add skill/SKILL.md && git -C "$FOURBRAIN" commit -m "docs(4-brain): one compliant description, the law in the body, no em dashes, a pointer to dstack

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Make the owner configurable, so the skill is shareable

**Files:**
- Modify: `skill/SKILL.md`, `skill/references/stages.md`, `skill/references/pr-evidence.md`, `skill/references/class-rule.md`, `skill/scripts/verify.cjs`

Tasks 1 to 6 name Devin directly, about thirty times. That is correct for this machine and wrong for a repository other people install. The engine keeps no owner in it; the owner is named once, in each project's `dstack.config.json`, under `owner.name`. This task is what has to be finished before the repository is made public.

Do this task only after Task 5's five breaks have been seen to fail and restore, because two of those breaks quote strings this task edits.

- [ ] **Step 1: Replace every naming of the owner with the role**

Run:
```bash
node -e '
const fs=require("fs");
const files=["skill/SKILL.md","skill/references/stages.md","skill/references/pr-evidence.md","skill/references/class-rule.md","skill/scripts/verify.cjs"];
let total=0;
for(const f of files){
  let s=fs.readFileSync(f,"utf8");
  const before=(s.match(/Devin/g)||[]).length;
  s=s.replace(/Devin.s\b/g,"the owner\u2019s").replace(/\bDevin\b/g,"the owner");
  fs.writeFileSync(f,s);
  console.log(f,before,"->",(s.match(/Devin/g)||[]).length);
  total+=before;
}
console.log("replaced",total,"namings");'
```
Expected: one line per file, each ending `-> 0`, then a total around thirty. The exact total does not matter; every file ending in `-> 0` does.

- [ ] **Step 2: Say once, in SKILL.md, where the owner comes from**

In `skill/SKILL.md`, immediately after the `## The principle` section's last line, insert this paragraph:

```markdown
The owner is one named person, read from `owner.name` in the project's `dstack.config.json`. If that file is missing or the key is unset, every stage that needs a yes stops and says so. Dstack never guesses who is allowed to approve a change.
```

- [ ] **Step 3: Raise the word ceiling to 1,700, with the reason recorded**

Thirty substitutions of a one-word name for a two-word role cost about thirty words, and `SKILL.md` sat at 1,594 of 1,600. In `skill/scripts/verify.cjs`, change the two places that carry the limit:

```javascript
// was: if (words > 1600) fail(`SKILL.md is ${words} words, over the 1600 limit`);
if (words > 1700) fail(`SKILL.md is ${words} words, over the 1700 limit`);
```

and in the success line, `SKILL.md ${words} words` needs no change.

The ceiling exists to keep the always-loaded file cheap, not as a magic number. 1,700 is the honest cost of the name becoming a role.

- [ ] **Step 4: Update the two break anchors Task 5 uses**

Break 2's anchor `and Devin said yes` is now `and the owner said yes`. Break 5's anchor is unchanged. Re-run the whole of Task 5 Step 3 with that one substitution.

Run:
```bash
grep -c "and the owner said yes" skill/references/stages.md && grep -c "and Devin said yes" skill/references/stages.md; echo "second grep exit=$? (1 is correct: the old anchor must be gone)"
```
Expected: `1` from the first grep, then nothing from the second and `second grep exit=1`.

- [ ] **Step 5: Re-run the verifier and all five breaks**

Run the whole of Task 5 Step 2 and Task 5 Step 3 again, using the Break 2 anchor from Step 4.

Expected: the same six results in the same order, the five exit=1 failures for their named reasons and a final `Dstack skill check OK` at exit 0, with the description now a few characters longer and still under 300 and the word count under 1,700.

If any break stops biting, Step 1 changed something structural and not just a name. Stop and report which break went quiet. A break that no longer fails is the verifier going blind, which is worse than the name being wrong.

- [ ] **Step 6: Prove no owner name survives anywhere in the shipped skill**

Run:
```bash
grep -rn "Devin" skill/ ; echo "exit=$?"
```
Expected: no output and `exit=1` (grep exits 1 when it finds nothing). Any line printed is a leak that must be fixed before the repository is public.

- [ ] **Step 7: Commit**

```bash
git add skill/ && git commit -m "refactor(dstack): the owner is a role read from config, not a name in the engine

Thirty namings of one person became the role, and SKILL.md says once that
the name is read from owner.name in the project's dstack.config.json. A
missing key stops the stage rather than guessing who may approve a change.

The word ceiling moves 1600 to 1700, which is the measured cost of a
one-word name becoming a two-word role. All five structural breaks were
re-run afterwards and still fail for their named reasons.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Install it and prove the command exists

**Files:**
- None created. This runs the installer already in the repository.

- [ ] **Step 1: Install**

Run:
```bash
./install.ps1
```
Expected: `installed (junction) -> ...\.claude\skills\dstack -> ...\dstack\skill`, then the CLI probe table, then `Dstack skill check OK: ...` from the verifier, then the two closing lines.

If the verifier fails here, the install is refused by design. Fix the skill, do not rerun with the check removed.

- [ ] **Step 2: Prove the junction points at the repository and not a copy**

Run:
```bash
node -e 'const fs=require("fs");const p=require("os").homedir()+"/.claude/skills/dstack";const st=fs.lstatSync(p);console.log("symlink/junction:",st.isSymbolicLink()||st.isDirectory());console.log("resolves to:",fs.realpathSync(p))'
```
Expected: `resolves to:` the repository's `skill` directory. If it resolves to anywhere under `.claude`, the installer copied instead of linking and a `git pull` will not update the skill.

- [ ] **Step 3: Prove the skill is discoverable**

In Claude Code, run `/dstack` with no argument.

Expected: the routing table, nine rows, and a refusal to act without a stage. Record the output in the review log. This is the first evidence that the process exists as a command and not only as a plan.

---

## Self-review

**Spec coverage.** Nine stages: each has a routing row checked as a tuple (Tasks 1, 5), a contract section with five same-line fields (Tasks 2, 5), a state-file entry (Tasks 1, 5), and a line in the PR Stages block that allows `pending` at creation (Tasks 3, 5). Six stop rules in one canonical block, byte-compared (Task 5). Skippable steps enumerated, and the plan's Codex-review skip is recorded separately from the plan being done (Task 1). The gate cannot merge (S6, Gate pre-flight, verifier). The runner's absence reaches the PR Gate line (Tasks 1, 2, 3). See it's accepted states are exhaustive and everything else blocks Ship (Task 2). Watch reports unknown, never green. The PR template carries the commit, environment, links to the plan and log at the approved commit, proof output, baseline proof, acceptance with evidence links, not-verified claims, risks and prerequisites, and rollback (Task 3). Dropped guarantees update Claim and Acceptance (S2). State lifecycle: Intake creates the file and the exclude entry; Plan commits its artifacts so Build's clean-tree check is honest; Prove requires recorded plan and build states; any plan or head change marks downstream stages `stale` (Tasks 1, 2). Ship reports merge, ticket, email and deploy as separate states and does not use a webhook 200 as evidence (Task 2). 4-brain's description becomes compliant, its 24 body em dashes are replaced, and its frontmatter is parsed as YAML with a negative case (Task 6).

**Placeholder scan.** No "TBD", no "similar to Task N". Every file's content is in its step. Every negative case is a command with the expected failure text.

**Consistency.** The nine `(number, name, command)` tuples in the verifier's `ROUTES` are the routing table's rows, the contract's headings, the state example's keys, and the PR template's stage lines. S1 to S6 are used identically in SKILL.md, stages.md, class-rule.md and the verifier. The description in Task 1 is 270 characters, the string the verifier measures. Task 2's `Stop` values all begin with an S-rule, `none`, or `see `. Task 2's Ship section has a `Produces` line. Field values are on the same line as their label, which is what the verifier reads.

**Not tested here, said plainly.** Whether the process cuts gate rounds is the bet the whole thing rests on; Plan 6 measures it. The Task 6 YAML check depends on `yaml` or `js-yaml` already under the PFP repo's `node_modules`; Codex confirmed one is present. Task 6 Step 3's punctuation replacement is mechanical and needs a human read of the diff, which the step requires.
