# Plan 7: Jev routing, and the end of proxy heuristics

## Claim

Today Dstack pays the same price for every change. Build always runs the builder at medium effort and Gate always runs the reviewer at xhigh, whether the diff is a copy fix or a rewrite of the billing path. Two of its decisions are made on proxies that do not measure anything: a plan review may be skipped when the change is "under twenty lines", and See it is "not applicable" when no path under `client/` was touched. A twelve line change to session handling is skippable under the first rule. A server side change that alters what a customer sees on screen is invisible to the second.

After this plan, every stage that spends money asks one calibrated question set first, and the answer is written down. The owner will see a new line on every pull request that says which effort each stage ran at, what it cost, and the one sentence reason. They will see a plan review skipped because the change was measured as low blast radius on an internal surface, not because someone counted lines. They will see See it run on a change that touched no client file, because the claim promised something a customer would look at.

## Class

This is a class of defect Dstack has not named yet: **a decision made on a proxy that correlates with risk instead of on a measurement of risk**. It is not one bad threshold. It is the shape of every unmeasured branch in the process, and it runs through four places today.

Grepped for the proxies in the skill:

    $ grep -rn "twenty lines\|skipUnderLines\|appliesWhenChanged\|client/" skill/ dstack.config.example.json
    skill/SKILL.md:  For a change under twenty lines the Codex review may be skipped
    skill/SKILL.md:  Plan's Codex review, for a change under twenty lines
    skill/SKILL.md:  See it, when the diff touches nothing under `client/`
    skill/references/stages.md:  For a change under twenty lines the Codex review may be skipped
    skill/references/stages.md:  If the diff touches nothing under `client/`, this stage writes `not_applicable`
    skill/references/stages.md:  See it, when the diff touches nothing under `client/`
    dstack.config.example.json:  "skipUnderLines": 20
    dstack.config.example.json:  "appliesWhenChanged": ["client/"]

Four paths, one idea. A line count and a path glob are standing in for "how much of the system can this break" and "will a person see a difference". Both are cheap to compute and neither is what the process actually wants to know. Fixing one threshold leaves the other three, which is exactly the failure the class rule exists to stop.

The same class runs through effort selection, which is worse because it is not even a proxy. It is a constant: `reasoningEffort: "medium"` for every build and xhigh for every gate, forever, regardless of the change.

## Change

**New: `skill/scripts/jev.cjs`.** A dependency free client for the System One API. `POST https://api.typesafe.ai/v1/systemone`, bearer auth from the environment variable the config names, one retry on a network error or a 5xx, a hard timeout. It never throws. It returns `{ ok: false, reason }` so that every caller can fail expensive instead of crashing. It sends the shape of a change, never its contents: paths, line counts per path, and the plan's own prose. The diff body is not sent, and `sendDiff` is not a setting.

**New: `skill/scripts/route.cjs`.** Two halves, split on purpose.

`measure()` builds one question set for the stage and makes one Jev call, because Jev answers every question in a single query. Questions describe the work, never the models. No model name appears in a Jev prompt, so the question set does not go stale when the model lineup changes.

`decide()` is pure. Answers plus config in, a tier out, with no network and no clock. This is the half that holds the policy, and it is the half the fixtures test.

**New: `skill/scripts/route.test.cjs`.** Fixture tests for `decide()`, offline, no API key required. Each fixture is a named situation with the tier it must produce and the reason it must give.

**New: `skill/references/routing.md`.** The contract: the question set per stage, the risk index, the bands, the floors, the escalation rule, and the four things routing may never do.

**Edited: `dstack.config.example.json`.** A `routing` block carrying the tier ladder, the per stage floor, default and ceiling, the surface floors, the weights and the bands. The policy is data in a file the team commits, not logic buried in a script.

**Edited: `skill/SKILL.md`.** A Routing section, the router named in the announce line, routing checked in pre-delivery, and stop rule S7 in the canonical block.

**Edited: `skill/references/stages.md`.** The routing input added to the stages that spend, the canonical block updated to match, and the two proxy rules replaced by their measured versions.

**Edited: `skill/references/pr-evidence.md`.** A `## Routing` section: one row per stage, with tier, why, and confidence.

**Edited: `skill/scripts/verify.cjs`.** Checks that the routing contract exists, that S7 is in both canonical blocks, that the PR template carries the Routing section, and that every tier named in a stage rule is a tier the ladder defines.

## Proof command

    cd skill && node scripts/verify.cjs && node scripts/route.test.cjs

Guarantees this plan asks Prove to mutate:

1. A change on a money or auth surface routes to the top tier no matter how small the measurement says it is.
2. A confidence below the configured threshold routes one rung up, never down.
3. A router failure, including a missing API key, routes to the stage default and records why.
4. A tier below the stage floor is impossible, whatever the risk index computes.
5. A ceiling never pushes a tier below the floor.
6. The stop rule block stays byte identical between `SKILL.md` and `stages.md`, including S7.
7. The router writes a routing artifact for every stage that spends, and the artifact names the head it is about.

## Flows

Flows: none, no client/ change.

## Out of scope

- Plans 2 through 6. This plan does not build the mutation harness, the gate runner, See it, Watch, or Retro. It defines the routing input those stages will read when they exist.
- Using Jev to triage gate findings, to detect an infrastructure verdict, or to rank class rule grep hits. Each is a real use and each is its own plan, listed at the end of `references/routing.md` as named follow on work.
- Any change to who merges. Routing decides what a stage costs. It never decides whether a change ships.

## Acceptance

1. Running the proof command prints an OK line from the verifier and a passing count from the routing fixtures, with no API key set in the environment.
2. `dstack.config.example.json` contains a routing block whose every referenced tier exists in its own ladder, and the verifier fails if that stops being true.
3. A fixture proves that a small change to an auth surface routes to the top tier, and naming that surface is the reason given.
4. A fixture proves that a router failure routes to the stage default, and that the recorded reason says the router failed rather than leaving it blank.
5. The pull request body template carries a Routing section that states, per stage, what ran and why, in a sentence with no model jargon in it.
6. The two proxy rules, the twenty line count and the client path glob, no longer appear as the sole basis for a skip anywhere in the skill.

## Risks and prerequisites

**Jev is in early access behind a waitlist as of mid September 2026.** The owner may not have a key. Everything here is built so that no key means the process behaves exactly as it does today, announces that once, and writes the reason into the state file. No stage is blocked by a missing router.

**This sends metadata about a private codebase to a third party.** File paths, line counts, and the plan's own prose leave the machine. The diff body does not. Anyone who considers a file path sensitive should leave routing disabled, which is a single key.

**A router that fails quietly would be the exact failure this process exists to remove.** The mitigation is that a failure is never silent and never cheap: the stage default is used and the reason is recorded on the pull request where the owner reads it.

**Calibration drift.** The weights and bands are a guess on day one. They are data, not code, so Retro can correct them from real rounds. Until Retro exists, they are a stated guess and `references/routing.md` says so.

## Rollback

Set `routing.enabled` to false in `dstack.config.json`. Every stage returns to its constant effort, the announce line says routing is off, and no Jev call is made. Nothing else in the process reads a routing artifact as a precondition, so there is no half state to clean up. No migration, no data touched. To remove it entirely, revert the branch; the four new files are additive and the six edited ones are restored by the revert.
