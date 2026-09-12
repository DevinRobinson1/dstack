# Plan Review Log: Dstack Plan 1, the skill shell
Started 2026-09-12 (session). MAX_ROUNDS=2. Reviewer: codex, model per ~/.codex/config.toml (gpt-6-astra, effort high).

## Round 1 - Codex (thread 01a0953c-b3f8-7900-b62f-6a73df02083f)

The plan has material gaps. I read the requested house rules and ran the proposed verifier against the embedded files in memory. No files were changed.

References below are to the [implementation plan](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/docs/superpowers/plans/2026-09-12-dstack-1-skill-shell.md>).

1. **Stage routing: complete today, incompletely represented in evidence.**

   All nine commands have matching contracts, including `/dstack see` mapping to “See it.” “Eight stages plus intake” is consistent with that structure.

   However, Task 3’s Stages block omits Intake, Ship, Watch, and Retro. The self-review at line 527 incorrectly claims all nine names appear there. Missing post-merge stages can disappear without any recorded status.

   **Fix:** Include all nine canonical stage IDs in the evidence record, with explicit pending, passed, blocked, skipped, or not-applicable states and reasons.

2. **Stop rules conflict, and the verifier does not prevent drift.**

   - Task 1 requires approval **and** Devin’s yes; Task 2 says “no approval **and** no yes means no build,” which only clearly refuses when both are absent. The generic “skip previous stage” escape hatch also fails to distinguish optional steps from mandatory approval.  
     **Fix:** Refuse when either required approval is absent, and enumerate exactly which steps may be skipped.

   - Ship prohibits every ticket-backed PR without a marker, then explicitly permits such PRs when they cannot close the ticket.  
     **Fix:** Define separate “closes ticket” and “partial fix” branches, with explicit marker requirements and recorded owner approval for each.

   - Gate stops after two rounds with a nondecreasing major count, while class-rule.md describes two rounds with a rising count; a flat count satisfies only the former.  
     **Fix:** Use one canonical rule defining comparisons, the initial baseline, and treatment of infrastructure rounds.

   - Task 5 checks substrings anywhere in files, not table rows, section contents, matching contracts, or equivalent rules. After shortening the description in memory, the verifier still passed when I removed the Ship routing row, removed owner approval from the contract, or emptied both verification sections.  
     **Fix:** Validate structured stage IDs and required fields, compare canonical stop-rule blocks, and add negative cases for deleted routes, missing approval, empty sections, and changed exceptions.

   **The Step 3 mutation does fail:** `/dstack prove` occurs once, so replacing it triggers the intended missing-route error. But the original description already fails verification, meaning the prescribed restored run never turns green.

3. **Unbuilt stages do not consistently fail loudly.**

   See it and Watch have explicit unavailable text. Retro and the three-wide runner only name manual fallbacks; neither requires a “not built” disclosure in the PR or merge report. Watch additionally says “silence is green,” making an unrun stage indistinguishable from success.

   **Fix:** Require an explicit unavailable/fallback status for every deferred capability, including the tool actually used and resulting evidence; silence must mean unknown.

   See it’s Ship prerequisite checks only that a section exists. A section reporting failed flows, zero flows, or unavailable tooling can satisfy it.

   **Fix:** Define which See it outcomes block Ship and require an explicit owner waiver, with the missing evidence stated, for any permitted exception.

4. **The PR template does not yet support an informed merge decision.**

   “N guarantees, N seen to fail” records mutation results but omits the ordinary proof command’s successful result, evidence links, execution environment, and tested commit. It also omits the plan’s acceptance criteria, observed results per criterion, material risks, and recovery steps. The owner cannot distinguish demonstrated customer behavior from a passing source assertion.

   **Fix:** Add acceptance/results, baseline proof command and outcome, linked evidence tied to the full SHA and environment, unverified claims, and practical rollback or recovery instructions.

   Prove may “drop the claim,” but nothing requires updating the approved plan, acceptance criteria, or PR Claim. The headline can continue promising something removed from the ledger.

   **Fix:** Require every dropped guarantee to update all corresponding claims and obtain renewed approval when acceptance changes.

5. **House-rule compliance fails despite zero em dashes in the proposed plan.**

   - The proposed Dstack description is **357 characters**, so Task 1 Step 2 and Task 5 fail immediately. Both checks also permit exactly 300 characters, contrary to “under 300.”  
     **Fix:** Shorten the description below 300 characters and reject lengths greater than or equal to 300.

   - The triad has headings and templates, but pre-flight only rejects missing artifacts, not vague or inadequate inputs; pre-delivery does not check every claimed structural requirement. An empty `PLAN.md` or incomplete evidence body is insufficiently distinguished from valid input.  
     **Fix:** Put stage-specific input validation before routing and make pre-delivery verify the required artifact contents, approvals, evidence sections, and applicable stop rules.

   - Task 6 retains a multiline 4-brain description containing existing em dashes and exceeding the description limit. These are pre-existing violations, but the edited field remains noncompliant.  
     **Fix:** Replace the description with a compliant single line and move its long behavioral instructions into the body; explicitly address existing punctuation violations in the touched skill.

6. **Task 6 preserves YAML only when followed exactly; its check does not parse YAML.**

   I tested both forms with the installed YAML parser. The prescribed two-space indentation is valid. Removing that indentation produces invalid YAML, yet Task 6 Step 2 still prints success because it only finds `name: 4-brain` and `use /dstack` between delimiter substrings.

   **Fix:** Parse the frontmatter as YAML, assert the exact name and string description, and verify that the pointer belongs to that description and satisfies its formatting rules.

7. **Additional paths produce false process assurance.**

   - **Gate can perform Ship’s action.** The routed [gate script](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/scripts/agent-bridge/gate-pr.cjs:618>) supports `autoMergeOnPass` and executes `gh pr merge --merge`. The plan supplies no invocation constraint preventing that path before the owner’s Ship approval.  
     **Fix:** Require and verify a non-merging Gate invocation, refusing if the selected runner can auto-merge.

   - **The review artifact instruction names the wrong field.** The actual verdict stores review pointers under `codex.reviewFile` and `grok.reviewFile`, not a top-level `reviewFile`; see [verdict construction](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/scripts/agent-bridge/gate-pr.cjs:976>).  
     **Fix:** Name both actual fields and require both referenced reports to exist and belong to the reviewed head.

   - **Build and review ownership conflict.** Task 1 says “Claude never” builds; Task 2 permits takeover. Gate starts fixing before Grok finishes, while 4-brain instructs Claude to wait and consolidate findings.  
     **Fix:** State the permitted takeover explicitly and require both reviews to finish against one immutable snapshot before editing.

   - **Several handoffs depend on memory.** `/dstack` has no authoritative current-stage record, See it requires named flows that Plan never explicitly produces, and no step owns committing/pushing the Build diff or creating the PR required by Prove/Gate.  
     **Fix:** Specify persistent artifact locations, require named flows in Plan, and assign each missing handoff to a stage that later stages verify.

   - **Ship claims outcomes its checks cannot prove.** Distinctive strings on main do not prove the complete change landed; a merge does not prove deployment. A webhook HTTP 200 does not prove ticket resolution or email delivery: the [handler](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/server/routes/support-tickets.ts:311>) returns successful responses for ignored events and reports notifications as queued.  
     **Fix:** Verify the actual merged change, deployment status, ticket outcome, and notification outcome separately, reporting pending or unknown states explicitly.

VERDICT: REVISE

### Claude's response to round 1

Accepted, all of it, with one narrowing:

1. PR Stages block now carries all nine stages, each with an explicit state vocabulary (pending, done, pass, block, skipped, not_applicable, not_built, unknown). Intake, Ship, Watch and Retro were missing; the self-review line claiming otherwise was wrong and is gone.
2. Stop rules are now one canonical block, S1 to S6, wrapped in begin/end markers, present verbatim in both SKILL.md and stages.md; the verifier compares the two byte for byte. S1 says BOTH. S3 says "did not fall" against the previous REAL round, infra rounds excluded; class-rule.md now says the same words. S5 defines the two Ship shapes, closes-ticket and partial-fix, and refuses any other. The skip escape hatch is now an enumerated list of two (Plan's Codex review under twenty lines; See it when no client/ change, which is not_applicable rather than skipped), and everything else is refused.
3. The verifier is structural: it parses routing-table rows, contract headings in order with five required non-empty fields each, the state example, the PR template's stage lines, and the canonical stop-rule block. Task 5 Step 3 breaks it four ways (deleted Ship row, S1 altered in one file, emptied pre-flight, description padded to exactly 300) and each must print the named failure with exit 1 before the restored run passes.
4. Description shortened to 262 characters; both checks now reject >= 300.
5. Every unbuilt capability (runner, See it, Watch, Retro) writes not_built with a specific note to the state file, and that note reaches the PR Stages block or the merge report. Watch reports unknown, never green, until it exists. See it defines what blocks Ship (any failed flow, or not_built on a client/ change) and requires Devin's yes to name the missing evidence for a waiver.
6. PR template gained: Evidence is about (full sha, environment, plan link), Baseline proof (command and verbatim summary), Acceptance with observed results and how, Not verified, Rollback. S2 requires a dropped guarantee to edit Claim and Acceptance in the same commit and re-run Plan if Acceptance changed.
7. Pre-flight now names, per stage, which artifact sections must be present and non-empty. Narrowing: a skill cannot mechanically judge vagueness, so the check is presence and non-emptiness of the named sections, and the plan says so.
8. 4-brain's description becomes one compliant single line; the no-self-review law moves into the body under its own heading; the check parses the frontmatter as YAML from the PFP repo's node_modules and a negative case reproduces the unindented form Codex tested.
9. Gate cannot merge: S6 requires the runner be invoked with auto-merge off and Gate refuses if shop.config.json has autoMergeOnPass true; the verifier asserts S6 names it.
10. Review file pointers corrected to codex.reviewFile and grok.reviewFile, both required to exist for the reviewed head.
11. Build ownership: Codex builds; Claude only after codex-build's two fix rounds are spent, recorded in the state file and the PR. Gate: read Codex's findings early, edit nothing until both reviews are in against one head.
12. Handoffs are now files: .dstack/state.json is the authoritative current-stage record, read by /dstack and by pre-flight; Plan produces a Flows section See it consumes; Prove owns commit, push and PR creation with the evidence body.
13. Ship reports ticket outcome (from ticket-directive.cjs --lookup status), email outcome (from the merge events and notification rows), and deploy state (unknown until Watch) as separate states; a webhook 200 is not used as evidence; squash containment is per-file with a hunk fallback.

Rejected: nothing outright.

## Round 2 - Codex (resumed thread)

The revision addresses many round 1 findings, but it still has implementation blockers. I read the response log first and evaluated the embedded verifier in memory without modifying files.

Line references below refer to the [revised plan](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/docs/superpowers/plans/2026-09-12-dstack-1-skill-shell.md>).

1. **Routing: all nine routes and contracts exist.**

   The names match, including `see` → “See it,” and all nine stages now appear in the PR template. Those findings are addressed.

   The verifier still accepts swapped Plan and Build command cells: it checks the set of commands, not each command’s relationship to its row number and stage name. I confirmed this against an otherwise passing in-memory baseline.

   **Fix:** Validate each routing row against its expected `(number, display name, command)` tuple.

2. **The canonical stop-rule comparison works, but the baseline does not pass.**

   The unchanged embedded files produce four failures:

   - SKILL.md has **1,642 words**, exceeding 1,600.
   - Ship lacks `**Produces:**`.
   - Intake’s Stop field does not use the required `S<n>`, `none`, or `see` prefix.
   - Build’s Stop field has the same problem.

   **Fix:** Shorten SKILL.md, add Ship’s output and state update, and make Intake/Build’s Stop syntax agree with the verifier while preserving their refusal rules.

   The four negative cases behave as follows:

   | Case | Intended failure occurs? | Actual qualification |
   |---|---|---|
   | Delete Ship row | Yes | Reports missing route and eight rows, plus baseline failures. |
   | Alter S1 in stages.md | Yes | Reports different canonical blocks, plus baseline failures. |
   | Empty pre-flight | Yes, with LF | Reports the intended short-section error, plus remaining baseline failures. |
   | Pad description to 300 | Yes | Reports exactly 300 characters, plus baseline failures. |
   | Restore originals | **No pass** | Returns exit 1 with the four baseline failures above. |

   Break 3 is also newline-sensitive: with CRLF, `indexOf("## Pre-flight\n")` returns `-1`, and the mutation damages frontmatter instead of emptying pre-flight. It exits 1 for the wrong reason.

   **Fix:** Normalize line endings inside the mutation and assert both section boundaries exist before constructing the modified text.

   Another structural hole remains at line 569: `\s*(\S)` crosses newlines, so an empty `**Who:**` consumes the next field’s first asterisk and passes. I confirmed that independently.

   **Fix:** Bound each field’s value to its own line or explicitly delimited content, then add an empty-field negative case.

   Identical canonical blocks now prevent divergence **inside those blocks**. They do not prevent contradictory stage prose, changed field mappings, or identical weakening of both copies. The readiness claim should reflect that boundary.

3. **Unavailable-stage reporting is mostly fixed; the runner remains underreported.**

   See it, Watch, and Retro now have explicit unavailable reporting. Watch no longer treats silence as success.

   The runner’s actual instructions only record `runner: review-loop3.sh` and concurrency in state. The PR Gate line still has no runner/capability disclosure. The architecture’s promise that every unavailable capability reaches the PR is therefore not implemented by its output contract.

   **Fix:** Add a separate runner availability field and require the PR Gate line to say `three-wide runner: not_built; review-loop3.sh, concurrency 1`.

   See it also lacks an exhaustive completion rule. Its blocking clause names failed flows and `not_built`, but does not explicitly reject missing state, `pending`, `unknown`, zero executed flows, or results from an older head.

   **Fix:** Permit Ship only with a complete See it pass at the current head, justified `not_applicable`, or an explicit recorded waiver; reject every other state.

4. **The owner-facing evidence is substantially improved, with two remaining gaps.**

   Acceptance observations, baseline results, commit, environment, unverified claims, and rollback address most of the previous finding.

   The template still points to `docs/superpowers/plans/<file>.md`, while Plan produces root-level `PLAN.md` and `PLAN-REVIEW-LOG.md`. Its evidence references are test names, queries, or screenshot labels rather than required accessible artifacts.

   **Fix:** Link the actual approved plan/review log and attach or link the corresponding proof output and screenshots at the recorded commit.

   Rollback explains recovery but does not disclose material merge risks, such as downtime, irreversible data changes, or configuration prerequisites.

   **Fix:** Add a plain-language “Risks and prerequisites” section, allowing an explicit “none identified.”

5. **Dstack’s description and punctuation are fixed; Task 6’s punctuation cleanup is incomplete.**

   The Dstack description is **270 characters**, under the limit, and the proposed plan contains no U+2014 characters. Its triad now has meaningful refusal and verification content.

   However, applying Task 6’s exact description replacement and law insertion leaves **24 em dashes** in the existing 4-brain body. Task 6 Step 3 consequently cannot produce its expected success output.

   **Fix:** Add an explicit step replacing existing U+2014 punctuation throughout 4-brain’s body before running its whole-file check.

6. **Task 6’s YAML verification is addressed.**

   The new single-line description parses successfully and is 270 characters. The negative mutation produces invalid YAML and is caught as claimed.

   Its remaining failure is the untouched punctuation described above, not YAML parsing.

7. **The new state mechanism still has incomplete lifecycle rules.**

   - **Fresh-lane startup is undefined.** Pre-flight must load `.dstack/state.json`, but Intake has no initialization procedure. Intake also edits `.gitignore`, and Plan creates two files; Build then requires a clean tree without any stage owning preparation commits.  
     **Fix:** Define fresh-state initialization and explicitly commit or locally exclude preparation artifacts before Build’s clean-tree check.

   - **Prove can bypass recorded approvals.** Its input contract requires only the diff and plan guarantees/Acceptance, unlike Gate’s explicit predecessor-state check. Directly invoking Prove can create a PR from work without completed Plan/Build records.  
     **Fix:** Require Prove to validate approved Plan and completed Build state, and define which downstream records become stale after every plan or head change.

   - **The initial PR cannot truthfully follow the supplied status choices.** Prove creates it before Gate, but the template offers Gate only `pass` or `block`; it similarly labels the whole Plan `skipped` when only Codex review is exempted.  
     **Fix:** Allow pending stage entries during PR creation and record the review exemption separately while keeping Plan completed with owner approval.

   The corrected review-file pointers, explicit auto-merge refusal, coordinated review edits, and separate ticket/email/deployment reporting address those round 1 findings.

VERDICT: REVISE

### Claude's response to round 2

MAX_ROUNDS=2 is reached with REVISE, so by the codex-review rules this is a deadlock handed to Devin. It is not a deadlock of positions: every round-2 finding is a real defect and all are accepted. The plan is revised so that whichever way Devin decides, it is ready.

1. Verifier checks each routing row as its (number, name, command) tuple; swapped cells now fail. Break 1 in Task 5 Step 3 is exactly that swap.
2. Baseline now passes on the embedded files: SKILL.md trimmed under 1,600 words by moving the per-stage pre-flight detail into stages.md's Needs lines (which is where it belongs and was duplicated); Ship gained a Produces line; Intake and Build Stop fields now begin with "none." and "S1." respectively; every field value is on the same line as its label, and the verifier reads line by line instead of with \s*(\S) across newlines. Break 5 empties Gate's Who to prove that.
3. Break 3 normalizes CRLF and asserts both boundaries exist before mutating. Every break asserts its anchor.
4. The runner's absence now reaches the PR: state carries runner_available, and the Gate line reads "three-wide runner: not_built; review-loop3.sh, concurrency 1" until Plan 3.
5. See it's accepted states at Ship are exhaustive: pass at the current head with flows >= 1 and failed = 0, or not_applicable with reason, or a recorded waiver naming the missing evidence. pending, unknown, not_built, stale, missing, an older head, or zero flows all block.
6. PR template: links the plan and review log at the approved commit and the proof output at the evidence commit; Acceptance rows carry an evidence link; a Risks and prerequisites section is added (from the plan, or "none identified"); stages after Prove may be pending at PR creation; the plan line records the Codex-review skip separately with the plan still done.
7. Task 6 gains a step that replaces the 24 body em dashes mechanically and then requires a human read of the diff; the whole-file check now genuinely can pass.
8. State lifecycle: Intake creates .dstack/state.json with every stage pending and adds .dstack/ to .git/info/exclude (never a repo .gitignore edit); Plan writes to docs/superpowers/plans/ per the house convention and commits plan and log in a "plan:" commit, so Build's clean-tree check is honest; Prove's Needs require recorded plan (with owner_yes) and build states, so a bare diff is refused; "stale" joins the vocabulary and any plan or head change marks downstream stages stale.
9. The verifier's guarantee is stated in the plan header: identical blocks prevent drift inside the blocks, not identical weakening of both or contradictory prose; that is what plan review and the owner's yes are for.

Rejected: nothing.

Handed to Devin: run a round 3 with the same session (recommended, ten minutes, because round 2's findings were the kind a third read catches cheaply), or accept the round-2 revision on Claude's judgment and proceed to build, or stop.

### Dry run of the round-2 revision, before any decision

The four skill files and the verifier were extracted verbatim from the plan's fenced blocks into a scratch directory (nothing written under ~/.claude) and the verifier was run against them.

First run: FAILED, "SKILL.md: 1617 words, limit 1600". Codex's round-2 prediction that the baseline would not pass was correct in kind. Three sentences were trimmed in the plan (21 words); no rule, table, field or stop text changed.

Second run: OK, description 270 chars, SKILL.md 1594 words, 9 stages routed and contracted, stop rules identical.

Five breaks from Task 5 Step 3, each applied to the extracted copies, verifier run, files restored:
- Break 1 swapped plan/build cells: FAILED-AS-EXPECTED ("row 2 routes to `/dstack build`, expected `/dstack plan`")
- Break 2 S1 altered in stages.md: FAILED-AS-EXPECTED ("stop-rule block differs")
- Break 3 emptied pre-flight: FAILED-AS-EXPECTED ("too short to be real")
- Break 4 description padded to 300: FAILED-AS-EXPECTED ("description is 300 chars")
- Break 5 emptied Gate Who: FAILED-AS-EXPECTED ("## 5. Gate **Who:** is empty")
- Restored baseline: PASS

Task 6 (the 4-brain edit and its YAML check) was not dry-run; it modifies an existing skill and waits for Devin's yes.

## Round 3 - Codex (resumed thread, authorized by Devin)

**I confirm the dry-run result.** The revised embedded verifier passes unchanged: **270 description characters, 1,594 words, nine stages, identical stop-rule blocks**. All five mutations fail for their named reasons, and restoration passes.

Two lifecycle defects remain outside that verifier’s coverage.

1. **Routing:** Addressed. All nine commands match their routing rows, contracts, state entries, and PR stage lines.

2. **Stop rules and verifier:** The earlier structural defects are addressed, and the verifier’s limitations are now accurately stated.

   | Task 5 negative case | Confirmed result |
   |---|---|
   | Swap Plan/Build commands | Exit 1: both row mappings rejected |
   | Alter S1 in stages.md | Exit 1: canonical blocks differ |
   | Empty pre-flight | Exit 1: section too short |
   | Pad description to 300 | Exit 1: description length rejected |
   | Empty Gate’s Who field | Exit 1: field is empty |
   | Restore originals | Exit 0 |

3. **Unavailable stages:** Addressed. Runner availability reaches the PR; See it requires a valid result or explicit waiver; Watch reports unknown; Retro discloses manual processing.

4. **Owner-readable evidence:** Addressed. The template now includes approved-plan links, proof output, acceptance evidence, unverified claims, risks, prerequisites, and rollback.

5. **House rules:** The proposed Dstack files comply with the requested description, punctuation, and triad requirements. Task 6 now explicitly removes the remaining body em dashes.

6. **Task 6 YAML:** Addressed. Applying its edits in memory produces valid YAML, a 270-character description, zero em dashes, and the relocated law. Its malformed-description negative case is caught.

7. **Two remaining first-run failures:**

   - **The exclusion path is wrong for linked worktrees.** [Intake’s contract](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/docs/superpowers/plans/2026-09-12-dstack-1-skill-shell.md:239>) writes to the lane’s `.git/info/exclude`. In a linked worktree, `.git` is a file. I verified that on `C:/tmp/b-fs58`; Git resolves `info/exclude` into the main repository’s Git directory. Following the prescribed path fails before Intake finishes.  
     **Fix:** Resolve the exclusion file with `git rev-parse --git-path info/exclude`, append `.dstack/` there, and describe its repository-wide scope accurately.

   - **The work order still leaves Build’s tree dirty.** The [state example](</C:/Users/Owner/Desktop/Claude Code Projects/PFP-Forsight-CRm/docs/superpowers/plans/2026-09-12-dstack-1-skill-shell.md:77>) places Intake’s artifact at root-level `work-order.json`. Intake excludes only `.dstack/`, while Plan commits only the plan and review log. Following that example leaves a new untracked work order, so Build’s clean-tree gate still refuses.  
     **Fix:** Store the work order at `.dstack/work-order.json` and update the state example and Intake contract to that exact path.

No files were modified.

VERDICT: REVISE

### Claude's response to round 3

Codex confirmed the dry run (270 chars, 1,594 words, nine stages, identical blocks, all five breaks fail, restore passes) and cleared questions 1 to 6. Two first-run breakers accepted:
1. The exclusion file is now the one `git rev-parse --git-path info/exclude` names, with the note that in a linked worktree this resolves into the main repository's git directory and the exclusion is repository-wide. Codex verified `.git` is a file on C:/tmp/b-fs58.
2. The work order lives at `.dstack/work-order.json`, so Intake leaves nothing untracked outside the excluded directory and Build's clean-tree check holds. The state example, Intake's Produces and Plan's Needs all name that exact path.

Rejected: nothing. Baseline re-verified after the edits: OK.

Devin raised a shape question during this round: Dstack should be its own GitHub repository so his team and others can install it. That is addressed in a separate revision note below, since it changes where Task 1 to 5 land and requires the PFP-specific hooks to become configuration.

