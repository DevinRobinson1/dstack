---
name: dstack
description: Run a change through the owner’s eight-stage delivery process (Plan, Build, Prove, Gate, See it, Ship, Watch, Retro) so the owner reads evidence, never code. Use when starting any fix or feature, or when asked to /dstack <stage>. For a one-off external review, use /4-brain.
---

# Dstack

the owner’s stack, after gstack, for an owner who reads evidence and not code.

**Announce at start:** "Running Dstack, stage: <stage>." Then echo the brains, one line: `codex <ver> / gemini <ver> / grok <ver>, routing <on at <tier> | off, <reason>>`.

## The principle

The owner never reads code. They read evidence. Every stage turns a change into a **claim**, a **proof** of that claim, and an **independent verdict** on it, in plain language, on the pull request itself.

A stage that cannot produce evidence they can read is not finished. A skip is recorded in the state file and in the PR Stages block, with their yes beside it.

The owner is one named person, read from `owner.name` in `dstack.config.json`. If that file or key is missing, every stage needing a yes stops and says so. Dstack never guesses who may approve a change.

## The state file

Every stage reads and writes `.dstack/state.json` at the lane root; Intake creates it. Nothing about where a change is lives in memory. `references/state.md` has the field shape; read it when you write the file.

Allowed `state` values: `pending`, `done`, `pass`, `block`, `skipped`, `not_applicable`, `not_built`, `unknown`, `stale`. A `skipped` entry carries `"owner_yes": "<iso>"` or it is invalid. Whenever the plan file or the branch head changes, every stage after the one that changed it is set to `stale` and must run again. A routed stage records its `tier` and `model`; Gate also records `distinct` for S3.

`/dstack` with no argument prints the state as a table and names the next stage.

## Routing

`/dstack <stage>` runs one stage. Read that stage's contract in `references/stages.md` first. Never run a stage from memory.

| # | Stage | Command | Who | Owner reads |
|---|---|---|---|---|
| 1 | Intake | `/dstack intake` | shop intake, or the owner | nothing yet |
| 2 | Plan | `/dstack plan` | Claude writes, Codex reviews, the owner says yes | the claim, the acceptance criteria, the named flows |
| 3 | Build | `/dstack build` | the builder, at the routed effort | nothing |
| 4 | Prove | `/dstack prove` | Claude | "N guarantees, N seen to fail, on <sha>" |
| 5 | Gate | `/dstack gate` | the reviewers in parallel at the routed effort, Claude adjudicates | PASS or BLOCK, one line per major |
| 6 | See it | `/dstack see` | a real browser, Gemini judges, Claude adjudicates | the screenshots |
| 7 | Ship | `/dstack ship` | the owner says merge, Claude merges | one row per PR |
| 8 | Watch | `/dstack watch` | automated, then Claude | one line per deploy |
| 9 | Retro | `/dstack retro` | Claude | one table a week |

## Stop rules

Canonical. `references/stages.md` carries this block verbatim under the same heading and `scripts/verify.cjs` fails if the two differ by a character.

<!-- dstack-stop-rules-begin -->
- **S1 Plan.** No build starts unless BOTH are true: Codex wrote `VERDICT: APPROVED` on the plan, and the owner said yes. For a change Routing measures as skippable, or under twenty lines with routing off, the Codex review may be skipped; the owner’s yes may never be skipped.
- **S2 Prove.** A mutation that stays green is a test that proves nothing. Fix the test or drop the guarantee. A dropped guarantee is removed from the plan's Acceptance and from the PR Claim in the same commit, and if Acceptance changed, Plan runs again for the owner’s yes.
- **S3 Gate.** Compare each round's in-scope major count to the previous real round's, counted by distinct idea and not by finding when Triage can compare them. Infra rounds do not count as rounds. After two consecutive comparisons where the count did not fall, stop: hand over on the PR with two options and do not run a third.
- **S4 Gate.** An `infra` verdict is not a verdict. Triage classifies a failed run before the round is counted, and an unsure reading is infra. Retry once. If it is infra again, hold and say so in the state file.
- **S5 Ship.** A ticket-backed PR ships in exactly one of two ways. Closes-ticket: the marker from `ticket-directive.cjs --lookup FS-NN` is on the PR and matches the live id and customer message count. Partial-fix: no marker, and the PR body says why the ticket cannot close and what the customer must do, and the owner’s yes names it as a partial fix. Any other shape does not merge.
- **S6 Ship.** Nothing merges on a conversation. Only the owner’s explicit say-so, only a gate PASS whose `head` equals the live PR head, only `--match-head-commit <full sha>`. The gate runner is invoked with auto-merge off, and Gate refuses to run if `shop.config.json` has `autoMergeOnPass` true.
- **S7 Routing.** Routing decides what a stage costs, never what it concludes. A router that is missing, slow, or unsure routes to the stage default and says so on the PR. It never routes below a floor, never turns a BLOCK into a PASS, and never skips a stage the owner’s yes is required for. Uncertainty routes up, never down.
- **S8 Triage.** A triage reading may only add work or add caution. It never removes a finding from the list the adjudicator reads, never lowers a severity a reviewer assigned, never approves a plan, and never turns an infra hold into a pass. An unsure reading resolves toward more work, and any failure returns the input unchanged and says so.
- **S9 Retro.** A finding that does not carry its sample count is not a finding. Below the configured minimum per group, or a spread under the configured margin, Retro reports how much more evidence it needs and no finding at all. Retro never edits a threshold: it reports, and a person changes the config.
<!-- dstack-stop-rules-end -->

## What may be skipped

Exactly these, and each is recorded in the state file and in the PR Stages block:

- Plan's Codex review, when Routing measures the change at or below `skipAtOrBelow`, or with routing off under twenty lines: `codex_review: skipped` with `owner_yes`. The plan is still `done`.
- See it, when Routing says a customer would not notice, or with routing off the diff touches nothing under `client/`: `not_applicable`, which needs no yes.

Nothing else may be skipped. Pre-flight refuses.

## Who builds, and when Claude may

Codex builds from the frozen plan. Claude writes code only when `/codex-build`'s two fix rounds are spent, recorded in the state file and the PR.

## The class rule

Before fixing any finding from any reviewer, read `references/class-rule.md` and answer its four questions in the PR comment.

## What each PR carries

Every Dstack PR body follows `references/pr-evidence.md`. The owner reads the body, never the diff. Pre-delivery verifies every section is present and non-empty.

## Tools this routes to

- Plan: `/grill-me-codex` when the design is open, `/codex-review` when it is not.
- Build: `/codex-build` with `SPEC_FILE` set to the plan file, at the effort Routing chose.
- Ship: `gh pr merge --squash --match-head-commit <full sha>` after S5 and S6 hold.
- Everything else: the scripts `references/stages.md` names. Each is `not_built` until it lands, carrying that file's note and fallback into the PR. Silence means unknown, never green.

## What a stage costs

Stages that spend measure the change first: `node scripts/route.cjs --stage <stage> --out .dstack/routing/<stage>-<sha>.json`. Jev measures, `dstack.config.json` prices, `references/routing.md` is the contract.

A tier is a class of work. The catalog's `serves` line says which models can do it; the router picks the cheapest one already on that line. `--explain` prints the comparison.

It retires two proxies: the plan review is skipped on a measurement, not a line count, and See it runs when a customer would notice, not on a glob. With no key or `enabled: false`, every stage runs at its default and says so.

## Reading the review

Gate and Plan also triage: `triage.cjs` judges whether a failed run was infra, ranks findings and class-rule hits, counts distinct ideas for S3, and holds back a plan that cannot carry a review. `references/triage.md` is the contract, and S8 is enforced in code: a reading may only add work or add caution.

Retro reads outcomes back: `retro.cjs --fit` says which config numbers the evidence disagrees with, and which it cannot judge yet (S9). Contract: `references/retro.md`.

## Pre-flight

Before routing, load `.dstack/state.json`. If it is absent and the stage is not Intake, refuse. Then check the stage's `Needs` in `references/stages.md`: the predecessor's recorded state, and the named artifact sections present and non-empty. Refuse and print this if anything is missing:

    Dstack cannot run <stage>: <what is missing>.
    <stage> needs: <the predecessor state and the artifact sections named in stages.md>.
    Run /dstack <previous stage> first. Only Plan's review and See it may be skipped, on the terms in What may be skipped, and a skip is recorded with the owner’s yes.

This checks presence and non-emptiness only; the plan review and the owner's yes judge quality.

## Pre-delivery check

Before reporting a stage done, print and verify:

    Dstack <stage> check
    - state written: .dstack/state.json, stages.<stage>.state = <value>
    - produced: <artifact path, or "not_built: <note>">
    - owner reads: <the sentence they will see>
    - PR body sections present and non-empty: <list, or "not applicable before Prove">
    - routing: <tier, model, about $<cost> a run, the one sentence why> | off, <reason>
    - triage: <findings in, distinct ideas, unread> | off, <reason> | not applicable
    - stop rules checked: <S-ids that apply and their result>
    - em dashes in anything written: 0

If any line is wrong, fix it before delivering. Not after.

## Style

No em dashes anywhere: not in code, comments, tests, PR bodies, or this file. Every commit and PR ends with the session's attribution line.
