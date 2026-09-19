# Plan 8: Triage, and giving S3 and S4 teeth

## Claim

Gate is the most expensive stage and the one that wastes the most. Three things go wrong there today and none of them is detected.

A round that died on a network timeout is read as a round. It costs a full review at the top rung, and S4 says an infra verdict is not a verdict without saying how anyone knows one when they see it.

Every finding a reviewer returns is adjudicated against source at the same weight. On a measured sample this repository already publishes, a cross model gate produced two real blockers and thirteen findings that did not survive adjudication, two of them rated blocker and guarded on the very next line. Fifteen findings read at equal depth to find two.

S3 asks whether the major count fell. It compares two lists of findings that may not be describing the same ideas, so a round that renamed four findings looks like progress and a round that found the same defect on a fifth path looks like regression.

After this plan, a failed run is classified before it is counted, every finding arrives ranked with a calibrated severity beside the reviewer's own, and the major count S3 compares is a count of distinct ideas. The owner will see one more line on the gate comment: how many findings came back, how many were distinct ideas, how many survived, and how many the round spent on a repeat of something the previous round already named.

## Class

The class is **a rule that names a condition without naming how the condition is recognized**. S4 says an infra verdict is not a verdict, and leaves the recognizing to whoever is reading. S3 says the major count must fall, and leaves what counts as the same major to whoever is comparing. A rule nobody can apply the same way twice is not a rule, it is a suggestion.

Grepped for the unrecognized conditions:

    $ grep -rn "infra\|major count\|in-scope major" skill/SKILL.md skill/references/stages.md
    skill/SKILL.md:  **S3 Gate.** Compare each round's in-scope major count to the previous real round's.
    skill/SKILL.md:  Infra rounds do not count as rounds.
    skill/SKILL.md:  **S4 Gate.** An `infra` verdict is not a verdict. Retry once.
    skill/references/stages.md:  (the same block, canonical)
    skill/references/stages.md:  **Produces:** ... `stages.gate` with `round`, `majors`, `head`, `runner`, `concurrency`

Two paths, one idea. The same class runs through the class rule's own second question, "where else does that class run", which says to grep and read the hits and does not say how a hit is judged to be the same class. Three places, one shape.

## Change

**New: `skill/scripts/triage.cjs`.** Five judgements, each split the way the router is split: a `measure` half that calls the model, and a pure `judge` half that holds the policy and is what the fixtures test.

- `infra`: was this run's failure about the code, or about the network, a credential, a quota, a timeout, or a broken environment.
- `findings`: per finding, a calibrated severity, whether it is in scope for this diff, whether the code it quotes already guards the condition, whether it names an action, and whether it describes a class or a site.
- `progress`: per finding, which of the previous round's findings it is the same idea as, or new.
- `classHits`: per grep hit, whether that location has the same shape as the defect, so the class rule's second question returns a ranked list instead of a pile.
- `plan`: whether a plan's own sections can carry a review, before the review is paid for.

**New: `skill/scripts/triage.test.cjs`.** Fixtures for all five pure halves, offline, no key, including the safety invariants below stated as tests rather than as prose.

**New: `skill/references/triage.md`.** The contract, the question sets, the thresholds, and the invariant.

**Edited: the canonical stop rules.** S3 and S4 gain the recognizer they were missing, and S8 states the invariant that makes all of this safe to use.

**Edited: `dstack.config.example.json` and the verifier.** A `triage` block, and the same data level checks the routing block already gets.

## The invariant

This is the whole safety argument, and it is one sentence.

**A triage reading may only ever add work or add caution.**

Concretely, and each of these is a fixture:

1. `findings` labels and orders. It never removes a finding from the list the adjudicator reads. Every finding that went in comes back out.
2. `findings` never lowers a severity. Where the model and the reviewer disagree, the higher of the two is what the round carries.
3. `plan` returns `not_ready` or `no_objection`. There is no `ready`. It can cost a plan a round, never buy it one, and the owner's yes is untouched either way.
4. `infra` resolves an unsure reading toward infra, which costs a retry. S4 already caps the retry at one and then holds.
5. `progress` can only hold a round back. Two findings judged the same idea reduce the distinct count, which makes S3 more likely to stop the line, never less.
6. A triage failure of any kind returns the untriaged input unchanged, and says so.

## Proof command

    cd skill && node scripts/verify.cjs && node scripts/route.test.cjs && node scripts/triage.test.cjs

Guarantees this plan asks Prove to mutate:

1. Every finding that goes into `findings` comes back out, whatever the readings say.
2. A reviewer's severity is never lowered by a reading.
3. `plan` has no verdict that means approved.
4. An unsure infra reading resolves to infra.
5. Two findings judged the same idea count once toward S3's distinct major count.
6. A triage failure returns the input unchanged and names the failure.
7. A class hit below the rank threshold is ordered last, not dropped.

## Flows

Flows: none, no client/ change.

## Out of scope

- Judging the See it screenshots, Watch triage, and the Retro distribution. All three need Plans 4, 5 and 6, which are not built. Building triage for a stage that does not exist would be building on nothing.
- Calling any of this automatically from the gate runner. This plan lands the judgements and their contract. Wiring them into `gate-pr.cjs` is the runner's plan, not this one.
- Changing who adjudicates. Claude still reads every finding against source. Triage decides the order and the count, never the verdict.

## Acceptance

1. The proof command passes with no API key in the environment.
2. A fixture proves that fifteen findings in returns fifteen findings out, none dropped, whatever the readings.
3. A fixture proves that a reading of low severity on a finding the reviewer called a blocker leaves it a blocker.
4. A fixture proves there is no plan verdict that permits skipping the review.
5. A fixture proves an unsure infra reading resolves to infra and costs a retry.
6. The gate comment template carries a triage line the owner can read in one pass.
7. S3 and S4 in the canonical block name how their condition is recognized, and the block is still byte identical in both files.

## Risks and prerequisites

**The obvious misuse is using this to ignore findings.** A model that ranks findings is one small step from a model that hides them, and that step would make the gate worse than having no gate. The invariant above is the mitigation, it is enforced in code rather than in documentation, and six fixtures hold it.

**Calibration is unproven.** The thresholds are a guess, as the routing weights are. Retro corrects them, and `references/triage.md` says so until then.

**Cost.** Findings and class hits are one call per item rather than one per stage, so a hundred grep hits is a hundred calls. At the published price that is a fraction of a cent and a few seconds at the configured concurrency, but it is the first place in Dstack where the cost scales with the size of the input, and the caps are set accordingly.

## Rollback

Set `triage.enabled` to false. Every judgement returns its input unchanged with the reason `triage is off`, the gate comment says so, and nothing downstream requires a triage result to proceed. No migration, no data touched. To remove it, revert the branch: the three new files are additive and the edits are restored by the revert.
