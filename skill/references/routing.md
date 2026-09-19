# Routing: what a stage costs, and why

Dstack used to pay the same price for every change. The builder ran at medium effort and the gate ran at the top rung, whether the diff was a copy fix or a rewrite of the billing path. Two of its decisions were made on proxies that measure nothing: a plan review was skipped when the change was "under twenty lines", and See it was "not applicable" when no path under `client/` was touched.

A twelve line change to session handling is skippable under the first rule. A server side change that alters what a customer sees on screen is invisible to the second. Both are the same defect: a decision made on something that correlates with risk instead of on a measurement of risk.

Routing replaces both with one question set, asked once per stage, answered in a single round trip, and written down.

## What the router is, and what it is not

The router is a System One model. It does not write, plan, review, or reason in prose. It takes state and returns typed values: a `choice` with a probability per option, a `score` that is a probability weighted mean over ordered levels, or a `noul`, which is a single probability that the answer is yes. Every question is answered in one query, so the whole set costs one round trip.

It is a measuring instrument. It never decides whether a change ships, never writes code, and never votes at a gate.

## The separation that keeps this from going stale

**Jev measures. The config prices. They are different files.**

No model name, no effort level, and no price appears in a question. The questions ask about the work: how far it reaches, how hard it is to undo, how much it leaves to judgment, whether it touches authentication or money, whether it follows a pattern already in the codebase. Those questions will still be the right questions when the model lineup has turned over twice.

`dstack.config.json` holds the ladder, the weights, the bands and the floors. Changing which model runs a deep review is a config edit. The question set does not move.

## Two ways to reach it, and they are not the same wire format

`provider: "vercel"` goes through the Vercel AI Gateway as `typesafe-ai/jev` on an `AI_GATEWAY_API_KEY`. `provider: "typesafe"` goes to TypeSafe directly on a `TYPESAFE_API_KEY`. Same model, different envelope, and the differences are not cosmetic:

| | TypeSafe direct | Vercel gateway |
|---|---|---|
| model id | in the body | in an `ai-model-id` header, with a protocol version and a spec version beside it |
| a yes or no question | `type: "noul"`, answered on `.noul` | `type: "boolean"`, answered on `.probability` |
| confidence | on the answer | on `providerMetadata.typesafe.confidence`, keyed by question |
| usage | `input_tokens` | `inputTokens` |
| cost | not reported | `providerMetadata.gateway.marketCost` |

The third row is the dangerous one. Read confidence off the answer on a gateway response and it is `undefined`, which normalizes to zero, which reads as total uncertainty, which escalates every routed decision to the top tier forever and looks like caution rather than a bug. That is why `jev.cjs` normalizes both providers into one canonical answer shape and no caller ever touches a raw response.

The gateway caps a request at 64,000 tokens and the state at 32,000. The client caps sit far under both.

**Finding the key.** `apiKeyEnv` names the variable. If it is unset, and `apiKeyFile` names a file, the key is read from there: a `KEY=value` line, `export` prefix and quotes tolerated. That exists because the usual reason a key does not work is that it was exported in a terminal and never reached a tool shell, while it sits in a gitignored env file the project already keeps.

## How a tier is chosen

1. **Read.** Every answer is normalized to a number between 0 and 1, so a score and a probability are comparable. A score becomes its level divided by the top level. A noul is its probability as it stands. A choice carries no number; it acts through the floors instead.

2. **Index.** The risk index is the weighted sum of those readings. Only `mechanical` carries a negative weight: following a pattern that is already in the codebase is the one thing that makes a change cheaper to get right.

3. **Band.** The index falls into a band, and the band names a tier. This is the measurement, recorded as `measured`.

4. **Floor.** The stage declares a floor. The surface declares a floor. The higher of the two wins, and nothing below it is reachable, whatever the index computed. A floor only ever raises.

   A surface floor says how hard a change must be **scrutinized**, so it applies to the stages that scrutinize. Build is not one of them: the plan already did the thinking, and a stage sets `surfaceFloorsApply` to false to say so. Build is the only stage that does. A money change is reviewed at the top rung at Plan and at Gate, and built at whatever the measurement says.

5. **Escalate.** The decision rests on its least certain reading. If that confidence is under `escalateBelowConfidence`, the tier goes up one rung. Uncertainty costs money, never safety. A noul has no confidence field of its own, so its certainty is its distance from a coin flip, doubled.

6. **Cap.** A ceiling may lower a tier, but it may never reach below a floor. If a ceiling and a floor disagree, the floor wins and the ceiling is ignored.

There are deliberately **no surface ceilings**. A documentation change that measures as high risk is a misclassification, and capping it would be exactly the silent downgrade this process exists to remove.

## Choosing the model, and what cheapest means

A tier is a class of work, not a model. Which model serves a tier is the catalog's job, and the catalog is yours:

    "claude-sonnet-5": { "in": 3.00, "out": 15.00, "serves": ["skim", "standard", "deep"] }

That `serves` line is a statement about what you trust a model with, and the router never writes it or second guesses it. All the router does is pick the cheapest model you already said could do the job. That is the whole reason this can lower a bill without lowering a standard: it is choosing inside a set you drew.

**Cheapest is per stage, because the shape of the work decides it.** A gate reads eighty thousand tokens and writes six thousand. A build writes twenty thousand. A model with cheap input and dear output wins one of those and loses the other, so each stage declares its shape in `typical` and the estimate uses it. A wrong shape changes the ranking; it never changes the tier.

Run `node scripts/route.cjs --explain` to see the whole comparison: every model, every tier a stage can reach, what each would cost, and which one wins.

Three rules on the catalog:

- **An unpriced model never outranks a priced one.** A subscription CLI has no per token price and cannot be compared on cost, so it wins a tier only when pinned or when nothing priced serves that tier.
- **A pin skips the ranking but not the catalog.** Pinning a stage to a model that the catalog does not say serves that stage's floor is a config error the verifier rejects, not a silent fallback.
- **A disabled model leaves the catalog entirely** rather than being chosen and then failing at the point of use.

## The four things routing may never do

1. **It may never turn a gate into a pass.** Routing sets what a review costs. It has no opinion on the verdict, and a router that is down cannot produce one.
2. **It may never fail cheap.** No key, a timeout, a rate limit, a bad response: every one of them routes to the stage default, which is the tier Dstack used before routing existed. A failure buys exactly what you had before, never less.
3. **It may never fail quietly.** Every failure carries a sentence naming what happened, and that sentence reaches the pull request body where the owner reads it.
4. **It may never send the diff.** The client sends paths, counts, and the plan's own prose. The contents of source files do not leave the machine, and there is no setting that turns that on. Anyone who considers a file path sensitive sets `routing.enabled` to false, which is one key.

## What the stages route

| Stage | Kind | Decides | Floor exists because |
|---|---|---|---|
| Plan | ladder | whether the adversarial plan review is worth running, and at what depth | the owner's yes is never skippable, whatever the measurement says |
| Build | ladder | the builder's effort, capped below the top rung, surface floors not applied | if a build needs the top rung, the plan was not finished |
| Gate | ladder | the reviewer's effort, uncapped | a cheap measurement must never be able to buy a shallow review |
| See it | binary | whether a customer would notice, at all | an unknown runs the browser, because silence is not a pass |

Prove, Ship, Watch and Retro do not route. Prove costs what the test suite costs. Ship is a merge. The other two are unbuilt.

## What the verifier holds

`scripts/verify.cjs` reads the policy as data, not as prose, and fails on a config that cannot mean what it says:

- a tier named by any rule, band or surface floor that the ladder does not define
- a stage default below its own floor, which would make a router failure cheaper than a success, the one thing routing must never be
- a ceiling below its own floor (equal is legal: it pins a stage to one tier)
- bands that do not climb
- a weight, or a binary stage's question, naming something no question asks, which would contribute nothing while looking like it contributed

`scripts/route.test.cjs` holds the behavior, offline, with no key. Both run on `npm run verify`.

## The artifact

Every routed stage writes `.dstack/routing/<stage>-<short sha>.json`: the tier, the risk index, every reading with its contribution, the floor that applied, whether it escalated, the deciding confidence, the token usage, and the sentence. The artifact names the head it is about, so a routing decision made against an older commit is visibly stale rather than quietly reused.

The pull request carries one line per stage in its Routing section. That is what the owner reads. They never read this file.

## Calibration

The weights and the bands are a stated guess. They were set by hand on the day routing was written, and no round has corrected them yet.

Retro is where they get fixed. Once it exists, the question is whether tiers correlate with rounds: if changes routed to `skim` are blocking at the gate as often as changes routed to `max`, the index is not measuring anything and the weights are wrong. Until then, this paragraph is the honest statement of what these numbers are.

## Named follow on work

Routing was the first use and the smallest. The first five below are built, in `references/triage.md` and `scripts/triage.cjs`, under stop rule S8. The last three wait on stages that do not exist yet.

**Built:**

1. **Infrastructure verdicts (S4).** A gate round that died on a network timeout currently costs a full round at the top rung before anyone notices. A noul over the runner's own output separates "the reviewer failed" from "the reviewer found nothing", in a fraction of a second, before the retry is spent.

2. **Finding triage before adjudication.** On a measured sample, a cross model gate produced two real blockers and thirteen rejected findings, two of them rated blocker and guarded on the very next line. Adjudicating all fifteen against source is the expensive part of a gate. A score for severity, a noul for in scope, and a noul for already guarded, per finding, gives the adjudication a ranked order and gives the round a major count that was calibrated rather than self declared.

3. **A major count that compares across rounds (S3).** The stop rule asks whether the major count fell. Today that compares two lists that may not describe the same ideas. A choice, per finding, over the previous round's findings plus "new", makes the comparison about ideas rather than counts, so the rule fires when it should.

4. **The class rule, question two.** "Where else does that class run" is a grep whose hits a person reads. A noul per hit, asking whether that site has the same shape as the finding, turns a manual read of a hundred hits into a ranked list. This is the workload the price per million was built for.

5. **Plan quality before the reviewer is paid.** A plan whose Claim is not observable, whose Acceptance cannot be checked without reading code, or whose Class section names no paths will waste a full adversarial review. Three nouls over the plan's own text reject it locally first.

**Not built, because the stage is not built:**

6. **Judging the judge at See it.** The screenshot judge returns a paragraph. A noul over that paragraph, asking whether it actually states the flow succeeded, and a second asking whether it hedged, catches the judge that wrote three sentences of description and never answered the question.

7. **Watch triage.** Deploy output into green, broke, or unknown, with a probability on each, and a choice over the pull requests in the deploy for which one is implicated. Silence stays unknown; the probability is what makes unknown explicit instead of assumed.

8. **Retro as a distribution.** Scoring every shipped change into a fixed defect taxonomy turns the weekly table from a hand count into a distribution, and that distribution is the number that says whether the Plan stage is working.
