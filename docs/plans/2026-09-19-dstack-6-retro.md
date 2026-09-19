# Plan 6: Retro, the ledger that corrects the guesses

## Claim

Every number in this process is a guess, and each one is stated as a guess in the contract that carries it. Five routing weights. Four bands. Eight surface floors. Six triage thresholds. Three `typical` token shapes. And now three capability claims about what DeepSeek is trusted to do, argued from the structure of the process rather than from any evidence that it holds.

Nothing observes whether any of them is right. A change routed to `skim` and a change routed to `max` produce exactly the same record today: none.

After this plan, every routed decision and every gate round leaves a row, and one command reads those rows back and says which guesses the evidence disagrees with. The owner will see a short report: the questions, what the data says, and for each one either a finding or the sentence "not enough evidence yet, this needs N more rows".

That second half is most of the value. Retro's first job is to say "I do not know yet" precisely.

## Class

The class is **a threshold with no feedback path**. It is the same defect as a proxy that is never measured, one step later: a proxy stands in for a measurement, while an unobserved threshold *is* a measurement that nobody ever checks against an outcome.

Grepped for the places that already admit it:

    $ grep -rn "guess\|calibration\|until then\|unvalidated" skill/references/*.md
    routing.md:  The weights and the bands are a stated guess.
    routing.md:  They were set by hand on the day routing was written, and no round has corrected them.
    routing.md:  Retro is where they get fixed.
    triage.md:  The thresholds are a guess, as the routing weights are.
    triage.md:  Retro is where they get corrected.
    triage.md:  Until Retro exists, this paragraph is the honest statement of what these numbers are.

Three places, one idea, and all three name this plan as the fix. That is the strongest possible signal that the class is real: the process already knows where its own blind spot is and has been writing it down.

## Change

**New: `skill/scripts/retro.cjs`.** A ledger and an analysis, split the way everything else here is split.

`record()` appends one observation to `.dstack/retro/ledger.jsonl`. Append only, one JSON object per line. Five record types: a `decision` (what routing chose and why), an `outcome` (what a gate round did), a `usage` (tokens actually spent), an `adjudication` (whether a triaged finding survived contact with source), and a `ship`.

`fit()` is pure. Records and config in, findings out. No file system, no clock, no network. This is the half the fixtures test.

`collect()` reads what the process already writes: the routing artifacts at `.dstack/routing/*.json` and the stage states in `.dstack/state.json`. Gate round detail comes through one adapter function, because `gate-pr.cjs` does not exist in this repository and coupling the whole plan to one project's runner would be worse than coupling one function to it.

**New: `skill/scripts/retro.test.cjs`.** Fixtures, most of them about refusing to conclude.

**New: `skill/references/retro.md`.** The contract, the five questions, and an honest statement of what the arithmetic is and is not.

**Edited: the canonical stop rules.** S9 states the refusal.

**Edited: config and verifier.** A `retro` block with the minimums, and the same data level checks the other two blocks get.

## The five questions

1. **Does the tier predict a block?** Group by the tier a change was built at, compare block rates. If `skim` blocks as often as `deep`, the risk index is not measuring risk and the weights are wrong.
2. **Does the model matter at a fixed tier?** Group by (stage, tier, model). If one model's work blocks materially more often than another's at the same tier, its `serves` line is wrong. This is the question that judges the DeepSeek assignment.
3. **Do the triage labels hold?** Of findings labelled `questioned`, how many were confirmed against source? Compare to `major`. If they are confirmed at similar rates, the readings are noise and the thresholds are wrong.
4. **Are the token shapes right?** Compare measured tokens per stage to the configured `typical`. Those shapes decide the cost ranking, and they were guessed.
5. **Does risk predict rounds?** Compare the risk index to the number of real gate rounds a change took.

## What the arithmetic is, and is not

It is rates and differences with sample counts beside them. It is not a significance test, and `references/retro.md` says so in those words.

A finding is reported only when every group it compares has at least `minPerGroup` rows **and** the difference exceeds `minDifference`. Below either, the output is the sentence "not enough evidence yet" with the number of additional rows needed. There is deliberately no flag that relaxes this, because the only reason anyone would reach for one is to get the answer they already wanted.

## Proof command

    cd skill && node scripts/verify.cjs && node scripts/route.test.cjs && node scripts/triage.test.cjs && node scripts/retro.test.cjs

Guarantees this plan asks Prove to mutate:

1. A comparison with any group under `minPerGroup` reports "not enough evidence" and never a finding.
2. A difference under `minDifference` reports no finding even when both groups are large.
3. Every finding carries its sample count; a finding without one is not emitted.
4. The ledger is append only: `record()` never rewrites or removes an existing line.
5. A malformed ledger line is skipped and counted, never crashes the analysis and never silently vanishes.
6. `fit()` touches no file, no clock and no network, so the same records always give the same findings.

## Flows

Flows: none, no client/ change.

## Out of scope

- Changing any weight, band, floor or threshold automatically. Retro reports what the evidence says. A person edits the config. A process that tunes its own safety thresholds from its own small sample is a process that will talk itself into anything.
- The weekly table of rounds per PR and time per shipped PR. It is in the original Plan 6 scope and it is worth having, but it is a presentation over the same ledger and it is worth nothing until the ledger has rows. It lands after.
- Wiring `record()` into the stages. This plan builds the ledger and the analysis. Making Prove and Gate call it is the wiring plan, which is still unwritten.

## Acceptance

1. The proof command passes with no API key and no network.
2. A fixture proves a comparison with four rows in a group reports "not enough evidence" and names how many more it needs.
3. A fixture proves two large groups differing by less than the margin produce no finding.
4. A fixture proves appending to the ledger leaves every existing line byte identical.
5. A fixture proves a corrupt ledger line is counted and reported rather than dropped or fatal.
6. Running `--fit` against an empty ledger says what it needs, and exits zero rather than erroring.

## Risks and prerequisites

**The obvious misuse is believing it too early.** Five rows will produce differences that look like signal. The minimums are the mitigation, they are enforced in the pure function rather than in documentation, and there is no override.

**Outcome data has to come from somewhere.** The decision half already exists as routing artifacts. The outcome half needs gate round detail, and this repository has no gate runner. Until Plan 3, that is one adapter function reading the Foresight runner's output, named and isolated so replacing it is a single edit.

**Small samples on a slow process.** A shop that ships a few PRs a week needs months to answer question 2 properly. That is a real limitation of the approach and not something more arithmetic fixes. The report says how far off it is rather than pretending.

## Rollback

Set `retro.enabled` to false: `record()` becomes a no op and `--fit` says retro is off. The ledger is a plain file that nothing else reads, so deleting it loses history and breaks nothing. Revert the branch to remove the three new files; the edits are restored with it.
