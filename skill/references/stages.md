# Dstack stages: the full contract

Read the section for the stage you are running. Each has: who does it, what it needs (this is the pre-flight, exactly), what it produces, what the owner reads, and the stop rule that applies. The stop rules themselves are the canonical block at the end of this file, identical to SKILL.md's; the verifier fails if they differ.

## 1. Intake

**Who:** the shop intake script, or the owner by hand.
**Needs:** a support ticket, or the owner’s written ask. Nothing else; this is the first stage and creates the state file.
**Produces:** `.dstack/state.json` at the lane root with every stage `pending`; `.dstack/` appended to the file `git rev-parse --git-path info/exclude` names (a linked worktree's `.git` is a file, and this resolves it correctly to the main repository's git directory, so the exclusion is repository-wide); and the work order at `.dstack/work-order.json` carrying the ticket block: `{ "ticket": { "number": N, "id": "<uuid>", "customer_msgs": M } }`, or for an ask with no ticket, `{ "ticket": null, "ask": "<the owner’s words>" }`. Writes `stages.intake` to `done`.
**Owner reads:** nothing yet.
**Stop:** none. Pre-flight refuses a work order naming a ticket number with no id; `ticket-directive.cjs --lookup FS-NN` fetches it.

## 2. Plan

**Who:** Claude writes. Codex reviews read-only. the owner says yes.
**Needs:** `stages.intake.state = done` and `.dstack/work-order.json`.
**Produces:** the plan at `docs/superpowers/plans/<YYYY-MM-DD>-<name>.md` and its review log at `<same>.review-log.md`, both committed on the lane branch in a commit whose message starts `plan:`, so Build's clean-tree check passes; `stages.plan` with `codex_review` (`APPROVED` or `skipped`) and `owner_yes`; and `plan_file` at the top of the state file. The plan contains, in this order, each non-empty: Claim, Class, Change, Proof command (with the guarantee list), Flows (or the line `Flows: none, no client/ change`), Out of scope, Acceptance, Risks and prerequisites (or `none identified`), Rollback.
**Owner reads:** Claim, Flows, Acceptance, and Risks and prerequisites. They say yes or no, and the yes is stamped into the state file.
**Stop:** S1, S7.

**Routing:** before the review is commissioned, `route.cjs --stage plan` measures the change. At or below `skipAtOrBelow` the adversarial review is skipped and `codex_review: skipped` is recorded with the reason; above it, the review runs at the tier named. The owner’s yes is required either way and is never routed.

Detail on the sections:
1. **Claim**, one paragraph, in the words the customer or the owner would use: what they will observe that they cannot observe today.
2. **Class**, one paragraph: what kind of defect this is, not which instance, and every code path that class runs through, found by grep, with the grep pasted.
3. **Change**, the concrete edits per file.
4. **Proof command**, the exact test invocation, and the list of guarantees Prove will mutate, one line each.
5. **Flows**, when the change will touch `client/`: each user-visible flow See it must walk, as "start at <route>, do <steps>, expect <what is on screen>".
6. **Out of scope**, named.
7. **Acceptance**, three to six lines the owner can check without reading code, each of which Prove or See it will report an observed result against.
8. **Risks and prerequisites**, in plain language: downtime, irreversible data changes, configuration or environment that must exist first, or `none identified`.
9. **Rollback**, one paragraph: how to undo this if Watch reports it broke something. For a migration, whether it reverses and what data it touches.

Route: `/grill-me-codex` when any design question is open; `/codex-review` when the plan is already settled. Either ends with `VERDICT: APPROVED` in the log, or a recorded skip for a change under twenty lines.

## 3. Build

**Who:** Codex, with write access, from the frozen plan.
**Needs:** `stages.plan.state = done` with `codex_review` set and `owner_yes` set; a clean tree (`git status -sb` shows nothing modified; the plan commit from stage 2 is what makes that true).
**Produces:** a diff in the working tree, Codex's report appended to the review log under `## Act 3 - Build`, and `stages.build` with `by` and `fix_rounds`.
**Owner reads:** nothing. Prove is what makes this safe.
**Stop:** S1. A dirty tree also stops it before it starts. Codex never commits, and nothing is committed in this stage at all.

**Routing:** `route.cjs --stage build` chooses the effort, capped below the top rung: if a build needs the top rung, the plan was not finished.

How: `/codex-build` with `SPEC_FILE` set to `plan_file` from the state, `PROOF_CMD` from the plan, and the build invocation carrying `-c model_reasoning_effort="<the routed effort>"`. Up to two fix rounds in the same Codex session. If both are spent, Claude finishes the build and the state records `"by": "claude", "reason": "codex fix rounds spent"`.

## 4. Prove

**Who:** Claude, before the gate or anyone else sees the diff.
**Needs:** `stages.plan.state = done` with `owner_yes`, `stages.build.state = done`, the diff, and the plan's guarantee list and Acceptance. Prove refuses without the recorded plan and build states; a diff alone is not an input.
**Produces:** in this order, all owned by this stage: the proof ledger; the baseline proof (the plan's proof command run by Claude, with its verbatim summary line); observed results against each Acceptance line; the commit on the lane branch with the attribution line; the push; the PR, created or updated, with its body per `references/pr-evidence.md` (stages after Prove are written as `pending` at creation); and `stages.prove` with `head`, `guarantees`, `seen_to_fail`, `tool`.
**Owner reads:** "6 guarantees, 6 seen to fail, on <short sha>, proof command green." If it is 5 of 6, the ledger names the sixth and why, and the Claim no longer promises it.
**Stop:** S2.

**Retro:** after the PR exists, `node scripts/retro.cjs --collect --pr N --head <full sha>` reads the routing artifacts and appends one `retro.cjs --record decision` row and one `retro.cjs --record usage` row per routed stage. These are what questions 1, 2 and 4 are computed from, and they are free: the router already wrote them.

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
**Stop:** S3, S4, S6, S7.

**Retro:** every round ends with `node scripts/retro.cjs --record outcome pr=N head=<sha> round=<n> majors=<n> distinct=<n> blocked=<true|false> infra=<true|false>`. An infra round is recorded with `infra=true` and is excluded from every rate, per S4. After adjudicating, one row per finding: `node scripts/retro.cjs --record adjudication pr=N label=<major|minor|questioned> confirmed=<true|false>`, where `confirmed` means it survived contact with source. Those rows are the only thing that can ever answer whether a tier, a model, or a triage label is doing anything.

**Triage:** `triage.cjs` classifies a failed run as infra before the round is counted (S4), labels and orders every finding without removing any (S8), and counts distinct ideas for S3's comparison. The gate comment prints findings in, distinct ideas, and how many triage did not read.

**Routing:** `route.cjs --stage gate` chooses the reviewer's effort. The gate floor means a cheap measurement can never buy a shallow review, and no measurement can lower a verdict.

How: the runner (Plan 3) dispatches up to three PRs at once, each lane with its own `DATABASE_URL_TEST`, with auto-merge off. Until it lands, `review-loop3.sh` one at a time, which never merges. Read the reviews at the paths in `verdict.json`'s `codex.reviewFile` and `grok.reviewFile`, never a `.md` by name: a round directory is reused. Compare `verdict.head` to the live PR head before acting on any finding; if they differ, the round is about a different commit and does not count.

On BLOCK: read Codex's findings as they land and begin the class rule on them. Edit nothing until both reviews are in against the same head. Then answer the four class-rule questions in the PR comment, fix every finding in the round (majors and minors), then Prove again (which marks Gate `stale` and re-runs), then Gate again.

## 6. See it

**Who:** a real browser drives the app on the lane. Gemini judges the screenshots against the plan's Flows. Claude adjudicates Gemini the way it adjudicates Codex and Grok.
**Needs:** `stages.gate.state = pass` at the current head, and the plan's Flows section. Routing decides whether this stage applies: `route.cjs --stage see` asks whether a customer would notice, and below the configured mark this stage writes `not_applicable` with the probability as its reason and returns; that needs no yes. With routing off, the fallback is the old test, a diff that touches nothing under `client/`. An unknown always runs.
**Produces:** per named flow: a before screenshot, an after screenshot, Gemini's one-paragraph read, and pass or fail, attached to the PR under the See it section; and `stages.see` with `head`, `flows`, `passed`, `failed`.
**Owner reads:** the screenshots. The one stage where they judge the work directly.
**Stop:** see "What Ship accepts" below, enforced by Ship's pre-flight.

How: `scripts/ci/see-it.cjs` (Plan 4) using the repo's installed `@playwright/test`. Until it lands, this stage writes `not_built` with note `UI claims are on a source guard only`, and the PR Stages block carries that line. Gemini is not a code reviewer here and gets no vote on code.

What Ship accepts from See it, exhaustively: `pass` at the current head with `flows >= 1` and `failed = 0`; or `not_applicable` with its reason; or a recorded waiver, where the owner’s yes at Ship names the missing evidence in their own words and the PR Stages block records it. Every other state (`pending`, `unknown`, `not_built`, `stale`, missing, a pass at an older head, or zero flows executed) blocks Ship.

## 7. Ship

**Who:** the owner says merge. Claude merges.
**Needs:** `stages.gate.state = pass` with `stages.gate.head` equal to the live PR head; See it in a state Ship accepts; the PR body complete per `references/pr-evidence.md`, every section non-empty; and S5 satisfied in exactly one of its two shapes.
**Produces:** the merge, then four outcomes reported as separate states in the merge report and in `stages.ship`: `merge` (with the squash sha and per-file containment), `ticket` (`resolved`, `pending`, `not-applicable`, `partial-fix`, or `unknown`), `email` (`sent`, `queued`, `failed`, `not-applicable`, or `unknown`), and `deploy` (`unknown` until Watch exists).
**Owner reads:** the merge list page, one row per PR: claim, proof line, verdict, ticket outcome, email outcome, deploy state.
**Stop:** S5, S6.

**Retro:** after the merge, `node scripts/retro.cjs --record ship pr=N rounds=<real rounds, infra excluded> minutes=<intake to merge>`. This is the row question 5 pairs against the risk index.

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
**Needs:** the outcome ledger at `.dstack/retro/ledger.jsonl`, written by Prove, Gate and Ship as their contracts above say. Retro reads; it never backfills a row it was not given, because a row invented after the fact is not evidence.
**Produces:** one table: rounds per PR, time per shipped PR, infra rate, PRs handed over and why, and the log line ranges the numbers came from; and `stages.retro`.
**Owner reads:** the table. If rounds per PR are not falling within ten PRs of adopting Plan, the Plan stage is not working and the process changes.
**Stop:** none.

How: `node scripts/retro.cjs --fit` prints, per question, a finding, a "nothing worth acting on", or how many more rows it needs. Per S9 it never reports below the configured minimum and never edits a threshold: a person changes the config.

Also at Retro, check the prices the whole cost ranking rests on: `node scripts/catalog.cjs --config dstack.config.json` reports any drift between the catalog and what the gateway actually charges, and `--write` applies it. Prices are facts and go stale silently; `serves` is a claim and is never touched. `--suggest --stage <stage>` ranks every model the gateway offers against that stage's real read and write shape.

## Stop rules

Canonical. Identical to SKILL.md's block; the verifier fails if they differ.

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
