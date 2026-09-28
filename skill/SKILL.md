---
name: dstack
description: Run a change through the owner’s eight-stage delivery process (Plan, Build, Prove, Gate, See it, Ship, Watch, Retro) so the owner reads evidence, never code. Use when starting any fix or feature, or when asked to /dstack <stage>. For a one-off external review, use /4-brain.
---

# Dstack

the owner’s stack, after gstack, for an owner who reads evidence and not code.

**Announce at start:** "Running Dstack, stage: <stage>." Then echo the brains, one line: `claude opus-5.5 / codex <ver> (review gpt-6-astra, build gpt-5.6-sol) / gemini <ver> / grok <ver>`. Codex reviews on Astra (from `~/.codex/config.toml`) and builds on Sol (pinned by `/codex-build`). If anything does not match, say so before Build or Gate.

## The principle

The owner never reads code. They read evidence. Every stage turns a change into a **claim**, a **proof** of that claim, and an **independent verdict** on it, in plain language, on the pull request itself.

A stage that cannot produce evidence they can read is not finished. A skipped stage is recorded in the state file and in the PR body's Stages block, with their yes beside it.

The owner is one named person, from `owner.name` in the project's `dstack.config.json`. Missing file or unset key: every stage needing a yes stops and says so. Dstack never guesses who may approve a change.

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

Allowed `state` values: `pending`, `done`, `pass`, `block`, `skipped`, `not_applicable`, `not_built`, `unknown`, `stale`. A `skipped` entry carries `"owner_yes": "<iso>"` or it is invalid. Whenever the plan file or the branch head changes, every stage after the one that changed it is set to `stale` and must run again. The plan entry's `codex_review` is `APPROVED` or `skipped`, and the plan is `done` only with `owner_yes`.

`/dstack` with no argument prints the state file as a table and names the next stage.

## Routing

`/dstack <stage>` runs one stage. Read `references/stages.md` for that stage's contract before running it. Do not run a stage from memory.

| # | Stage | Command | Who | Produces | Owner reads |
|---|---|---|---|---|---|
| 1 | Intake | `/dstack intake` | shop intake, or the owner | the state file and a work order with the ticket block | nothing yet |
| 2 | Plan | `/dstack plan` | Claude writes, Codex reviews, the owner says yes | the plan and its review log, committed | the claim, the acceptance criteria, the named flows |
| 3 | Build | `/dstack build` | Codex at medium effort | a diff and Codex's report | nothing |
| 4 | Prove | `/dstack prove` | Claude | the proof ledger, the commit, the pushed branch, the PR with its evidence body | "N guarantees, N seen to fail, on <sha>" |
| 5 | Gate | `/dstack gate` | Codex at xhigh + Grok + Gemini in parallel, Claude adjudicates | verdict and three reviews, one PR comment | PASS or BLOCK, one line per major |
| 6 | See it | `/dstack see` | a real browser, Gemini judges, Claude adjudicates | screenshots and pass or fail per named flow | the screenshots |
| 7 | Ship | `/dstack ship` | the owner says merge, Claude merges | a merge, then ticket, email and deploy outcomes as separate states | one row per PR |
| 8 | Watch | `/dstack watch` | automated, then Claude | a deploy report | one line per deploy |
| 9 | Retro | `/dstack retro` | Claude | rounds per PR, time per shipped PR, infra rate | one table a week |

## Stop rules

Canonical. `references/stages.md` carries this block verbatim under the same heading and `scripts/verify.cjs` fails if the two differ by a character.

<!-- dstack-stop-rules-begin -->
- **S1 Plan.** No build starts unless BOTH are true: Codex wrote `VERDICT: APPROVED` on the plan, and the owner said yes. For a change under twenty lines the Codex review may be skipped; the owner’s yes may never be skipped.
- **S2 Prove.** A mutation that stays green is a test that proves nothing. Fix the test or drop the guarantee. A dropped guarantee is removed from the plan's Acceptance and from the PR Claim in the same commit, and if Acceptance changed, Plan runs again for the owner’s yes.
- **S3 Gate.** Compare each round's in-scope major count to the previous real round's. Infra rounds do not count as rounds. After two consecutive comparisons where the count did not fall, stop: hand over on the PR with two options and do not run a third.
- **S4 Gate.** An `infra` verdict is not a verdict. Retry once. If it is infra again, hold and say so in the state file.
- **S5 Ship.** A ticket-backed PR ships in exactly one of two ways. Closes-ticket: the marker from `ticket-directive.cjs --lookup FS-NN` is on the PR and matches the live id and customer message count. Partial-fix: no marker, and the PR body says why the ticket cannot close and what the customer must do, and the owner’s yes names it as a partial fix. Any other shape does not merge.
- **S6 Ship.** Nothing merges on a conversation. Only the owner’s explicit say-so, only a gate PASS whose `head` equals the live PR head, only `--match-head-commit <full sha>`. The gate runner is invoked with auto-merge off, and Gate refuses to run if `shop.config.json` has `autoMergeOnPass` true.
<!-- dstack-stop-rules-end -->

## What may be skipped

Exactly these, each recorded in the state file and the PR Stages block:

- Plan's Codex review, for a change under twenty lines: `codex_review: skipped` with `owner_yes`. The plan is still `done`.
- See it, when the diff touches nothing under `client/`: `not_applicable`, which needs no yes.

Nothing else may be skipped. Pre-flight refuses.

## Who builds, and when Claude may

Codex builds from the frozen plan. Claude writes code only once `/codex-build`'s two fix rounds are spent, and then the state file and the PR Stages block both record `"by": "claude", "reason": "codex fix rounds spent"`.

## Reviews land before edits begin

During Gate, read each reviewer's findings as they arrive and start the class rule on them. Edit no file until all three reviews land against the same `verdict.head`. The class rule needs every finding to name its class.

Three deliberately different lenses: Codex on correctness, Grok on the real operator, Gemini on breadth ("is this defect somewhere else too"). A verdict is adjudicated, never obeyed: **a finding about code the diff does not touch is filed, not fixed here.** `references/stages.md` carries the rest.

## The class rule

Before fixing any finding from any reviewer, read `references/class-rule.md` and answer its four questions in the PR comment.

## What each PR carries

Every Dstack PR body follows `references/pr-evidence.md`. The owner reads the body, never the diff. Pre-delivery for Prove, Gate, See it and Ship verifies every section has content.

## Tools this routes to

- Plan: `/grill-me-codex` when the design is open, `/codex-review` when it is not, with `PLAN_FILE` under `docs/superpowers/plans/`.
- Build: `/codex-build` with `SPEC_FILE` set to the plan file, invoked with `-m gpt-5.6-sol -c model_reasoning_effort="medium"` (never Astra).
- Prove: `scripts/ci/mutate.cjs` in the repo (Plan 2). Until it lands, `C:/tmp/mutate.py`, and the state records `"tool"`.
- Gate: `scripts/agent-bridge/gate-pr.cjs` via the runner (Plan 3). Until it lands, `review-loop3.sh` one PR at a time, the state records `"runner_available": false`, and the PR Gate line says `three-wide runner: not_built; review-loop3.sh, concurrency 1`.
- See it: `scripts/ci/see-it.cjs` (Plan 4). Until it lands, `not_built` with note `UI claims are on a source guard only`, which goes into the PR Stages block.
- Ship: `gh pr merge --squash --match-head-commit <full sha>` after S5 and S6 hold.
- Watch: `scripts/ci/deploy-watch.cjs` (Plan 5). Until it lands, `not_built` with note `deploy is unwatched; treat as unknown`, into the merge report. Silence means unknown, never green.
- Retro: `scripts/ci/retro.cjs` (Plan 6). Until it lands, `not_built` with note `counted by hand from review-loop.log`, and the table cites the log lines.

## Pre-flight

Before routing, load `.dstack/state.json`. If it does not exist and the stage is not Intake, refuse. Then check the stage's `Needs` in `references/stages.md`: the predecessor's recorded state, and the named artifact sections present and non-empty. Refuse and print this if anything is missing:

    Dstack cannot run <stage>: <what is missing>.
    <stage> needs: <the predecessor state and the artifact sections named in stages.md>.
    Run /dstack <previous stage> first. Only Plan's Codex review (under twenty lines) and See it (no client/ change) may be skipped, and a skip is recorded with the owner’s yes.

This checks presence and non-emptiness only; the plan review and the owner's yes judge quality.

## Pre-delivery check

Before reporting a stage done, print and verify:

    Dstack <stage> check
    - state written: .dstack/state.json, stages.<stage>.state = <value>
    - produced: <artifact path, or "not_built: <note>">
    - owner reads: <the sentence they will see>
    - PR body sections present and non-empty: <list, or "not applicable before Prove">
    - stop rules checked: <S-ids that apply and their result>
    - em dashes in anything written: 0

If any line is wrong, fix it before delivering. Not after.

## Style

No em dashes anywhere: not in code, comments, tests, PR bodies, or this file. Periods, commas, colons, parentheses. Every commit and PR ends with the attribution the session specifies.
