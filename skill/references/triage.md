# Triage: reading the review, not the code

Gate is the most expensive stage and the one that wastes the most. Three things go wrong there and none of them was detected.

A round that died on a network timeout is read as a round. It costs a full review at the top rung, and S4 said an infra verdict is not a verdict without saying how anyone recognizes one.

Every finding is adjudicated against source at the same weight. On the sample this repository publishes, a cross model gate produced two real blockers and thirteen findings that did not survive adjudication, two of them rated blocker and guarded on the very next line. Fifteen read at equal depth to find two.

S3 asked whether the major count fell, comparing two lists that may not describe the same ideas. A round that renamed four findings looked like progress. A round that found the same defect on a fifth path looked like regression.

Triage answers the questions those rules assumed someone could answer.

## The invariant

**A triage reading may only ever add work or add caution.**

That sentence is the entire safety argument, and it is the reason this is safe to point at a gate. A model that ranks findings is one step from a model that hides them, and that step makes a gate worse than no gate. So the invariant is enforced in `triage.cjs` and held by six fixtures, not asserted here.

| It may | It may never |
|---|---|
| label and order findings | remove a finding from the list the adjudicator reads |
| raise a severity | lower one a reviewer assigned |
| hold a plan back from a review | approve a plan, or permit skipping a review |
| hold a round as infra and spend a retry | turn an infra hold into a round, or a BLOCK into a PASS |
| lower the count of distinct ideas, which makes S3 stop sooner | raise it |

Every failure returns the input unchanged and says so. No reading is not a reason to demote anything.

## The five judgements

**infra.** Reads the runner's own output. Was this failure about the code, or about the network, a credential, a quota, a timeout, a crashed tool, or a broken environment. An unsure reading resolves to infra, which costs one retry. S4 caps the retry at one and then holds, so the expensive direction is also the safe one.

**findings.** Per finding: a severity on a four level scale, whether it is in scope for this diff, whether the code it quotes already guards the condition, whether it names an action, and whether it describes a class or a single site. Produces a label of `major`, `minor` or `questioned`, and an order. A finding the reviewer called a blocker is a major whatever the reading says.

**progress.** Per finding, which of the previous round's findings it is the same idea as, or new. Two findings are the same idea when fixing one properly resolves the other. This is what S3 compares, so the rule is about ideas rather than counts.

**classHits.** Per grep hit, whether that location has the same shape as the defect. The class rule's second question, "where else does that class run", becomes a ranked list instead of a pile. A hit below the threshold is ordered last and a hit triage could not read is ordered **first**, because the one thing worse than an unranked list is a list that buries what the machine skipped.

**plan.** Five readings over a plan's own sections: is the Claim observable, is the Acceptance checkable without reading code, does the Class section name paths and show its search, is the Proof command an invocation, is the Rollback real. Returns `not_ready` with the reasons, or `no_objection`. There is deliberately no verdict that means approved: S1 already says who decides that, and the owner's yes is untouched either way.

## Cost, and the first place it scales

Routing costs one call per stage. Findings and class hits cost one call per item, so a hundred grep hits is a hundred calls. At the published price that is a fraction of a cent and a few seconds at the configured concurrency, but it is the first place in Dstack where cost scales with the size of the input.

Every cap is therefore loud. A cap does not shorten the list: it pads the readings with nothing, so an item past the cap arrives marked unread and carrying whatever the reviewer said, and the count of unread items is in the result and on the gate comment. A truncated list reads exactly like a complete one, which is why silence is the one thing a cap may not do.

## Calibration

The thresholds are a guess, as the routing weights are. Retro is where they get corrected: if findings labelled `questioned` are being confirmed against source as often as findings labelled `major`, the readings are not measuring anything. Until Retro exists, this paragraph is the honest statement of what these numbers are.

## What is not built

Judging the See it screenshots, Watch triage, and the Retro distribution all need Plans 4, 5 and 6, which do not exist. Building triage for a stage that does not exist would be building on nothing. They stay named in `references/routing.md` as follow on work.
