# Dstack

Nine stages, one command, and readable evidence at every gate. A delivery process for an owner who ships software they do not personally read.

Dstack is the successor to [4-brain](https://github.com/DevinRobinson1/4-brain). 4-brain answered one question: who reviews the code, given that Claude reviewing Claude's own work is the same architecture checking its own blind spots. Dstack answers the larger one: what has to be true, and shown, before a change is allowed to reach customers.

## The premise

Most AI coding processes optimize for producing a diff. That is the cheap half. The expensive half is the decision to merge it, and that decision is usually made on a feeling: the tests are green, the agent sounded confident, the diff looked reasonable.

Dstack is built on the opposite assumption. Every stage must leave behind something a non-engineer can read and judge. If a stage cannot produce that, the stage failed, no matter what the code does.

Two rules carry most of the weight:

**A test does not count until it has been seen to fail.** Every regression proof mutates the fix back out, watches the test go red for the stated reason, and restores it. A green suite proves the suite ran. It does not prove the suite is watching anything.

**A decision made on a proxy is not a measurement.** A plan review used to be skipped when a change was "under twenty lines", and browser verification used to be skipped when no file under `client/` was touched. A twelve line change to session handling is skippable under the first. A server side change that alters what a customer sees is invisible to the second. Both are now measured instead of guessed, and the measurement is written on the pull request.

**A blocked round is a hypothesis, not a verdict.** Findings get adjudicated against source, not accepted because a model was confident. On a measured sample, a cross-model review produced two blockers that would genuinely have shipped and thirteen rejected findings, two of them rated blocker and guarded on the very next line.

## The nine stages

| # | Stage | What it settles |
|---|---|---|
| 1 | Intake | What was actually asked, and which ticket it answers |
| 2 | Plan | The approach, argued against a second model before any file is touched |
| 3 | Build | The change, written to a frozen plan |
| 4 | Prove | Every claim mutated out and seen to fail |
| 5 | Gate | Cross-model adversarial review, findings adjudicated |
| 6 | See it | A real browser doing the thing a customer would do |
| 7 | Ship | Merge, on an explicit say-so and a matching head commit |
| 8 | Watch | What the deploy actually did, including what it interrupted |
| 9 | Retro | What class of defect this was, so the next one is caught earlier |

Each stage declares who runs it, what it needs, what it produces, what the owner reads, and the one condition that stops the line. The stop rules are canonical text held byte-identical in two files, and a verifier fails if they ever drift apart.

## What each stage costs

Every stage used to cost the same. The builder ran at medium effort and the gate ran at the top rung, whether the change was a typo fix or a rewrite of the billing path.

Stages that spend now measure the change first, in a single call to a [System One model](https://typesafe.ai/blog/introducing-system-one-models-and-jev): how far it reaches, how hard it is to undo, how much it leaves to judgment, whether it touches authentication or money, and whether it follows a pattern already in the codebase. Those readings become a risk index, the index falls into a band, and the band names a tier.

The split that matters is that **the model measures and the config prices, and they are different files**. No model name, effort level or price appears in a question, so the question set does not go stale when the lineup turns over. Which model runs a deep review is a line in `dstack.config.json`.

Four rules bound it, and the fixtures in `skill/scripts/route.test.cjs` prove each one with no network and no API key:

- **It never turns a gate into a pass.** Routing sets what a review costs. It has no opinion on the verdict.
- **It never fails cheap.** No key, a timeout, a rate limit, a bad response: every one routes to the stage default, which is the tier Dstack used before routing existed. A failure buys what you had before, never less.
- **It never fails quietly.** Every failure carries a sentence, and the sentence reaches the pull request body.
- **It never sends the diff.** Paths, counts and the plan's own prose leave the machine. Source contents do not, and no setting turns that on.

Uncertainty routes up, never down: a reading the model is not confident about costs a rung. Floors only ever raise, and there are deliberately no ceilings per surface, because a documentation change that measures as high risk is a misclassification and capping it would be the silent downgrade this whole process exists to remove.

A tier is a class of work, not a model. Which model serves a tier is a line in your catalog, and the router never writes it:

```json
"claude-sonnet-5": { "in": 3.00, "out": 15.00, "serves": ["skim", "standard", "deep"] }
```

`serves` is your statement of what you trust a model with. All the router does is pick the cheapest model you already said could do the job, which is why this lowers a bill and cannot lower a standard. Cheapest is computed per stage, because the shape of the work decides it: a gate reads 80k tokens and writes 6k, a build writes 20k, and a model with cheap input and dear output wins one and loses the other. `node scripts/route.cjs --explain` prints the whole comparison.

The full contract is in [skill/references/routing.md](skill/references/routing.md). Routing is optional: one key turns it off and every stage returns to a fixed effort.

## Reading the review, not the code

Gate is the most expensive stage and the one that wastes the most. A round that died on a network timeout is read as a round. Every finding is adjudicated at the same weight, including the two in fifteen that were guarded on the very next line. And S3 asked whether the major count fell while comparing two lists that may not describe the same ideas.

Triage answers the questions those rules assumed someone could answer: was this failure infra, which findings are worth reading first, which of them is the same idea the last round already raised, which grep hits share the defect's shape, and can this plan carry a review at all.

One sentence makes it safe, and it is stop rule S8:

> **A triage reading may only ever add work or add caution.**

It labels and orders findings but never removes one. It raises a severity but never lowers one a reviewer assigned. It holds a plan back but has no verdict that means approved. An unsure infra reading costs a retry. Every failure returns the input unchanged and says so. Six fixtures hold that invariant, and the verifier fails if the plan judgement ever grows a verdict that means yes.

Contract in [skill/references/triage.md](skill/references/triage.md).

## Status

Under construction, in the open. Plan 1 (the skill shell) is written, reviewed across three adversarial rounds, and dry-run proven. Plans 2 through 6 are not written yet.

| Plan | Scope | State |
|---|---|---|
| 1 | Skill shell, stage contracts, PR evidence template, self-verifier | Reviewed, ready to build |
| 2 | Mutation proof harness | Not started |
| 3 | Parallel gate runner with infrastructure retry | Not started |
| 4 | See it: real browser evidence | Not started |
| 5 | Watch: deploy observation | Not started |
| 6 | Retro: metrics that close the loop | Not started |
| 7 | Jev routing: measured tiers, model catalog, and the end of proxy heuristics | Built, proven, ungated |
| 8 | Triage: infra verdicts, finding ranking, distinct-idea progress | Built, proven, ungated |

Plans and their full review logs live in [docs/plans](docs/plans). The argument is the artifact; it is kept whole on purpose.

## Install

Requires [Claude Code](https://claude.com/claude-code) and [Node.js](https://nodejs.org/). Stages route to external model CLIs when they are present on `PATH`:
[`codex`](https://github.com/openai/codex) for planning review and gating, [`grok`](https://x.ai) for the product and operations lens, [`gemini`](https://github.com/google-gemini/gemini-cli) for breadth and screenshots.

A missing CLI is announced once and that route is skipped. A missing CLI never silently downgrades a gate to a pass.

Routing additionally needs a key for the System One model that decides what each stage costs, reached either through the Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model `typesafe-ai/jev`) or from TypeSafe directly (`TYPESAFE_API_KEY`). It is optional. Without it, every stage runs at the fixed effort it used before routing existed, and says so.

```bash
git clone https://github.com/DevinRobinson1/dstack.git
cd dstack

# macOS / Linux
./install.sh

# Windows (PowerShell)
./install.ps1
```

Both installers link `skill/` into `~/.claude/skills/dstack`, so the repo stays the source of truth and `git pull` updates the skill everywhere. Pass `--copy` (or `-Copy`) for an independent copy instead.

Then in Claude Code:

```
/dstack intake <what you want built>
```

## Configuring it for your project

Dstack ships as an engine with no project knowledge in it. Everything specific to a codebase lives in `dstack.config.json` at that project's root. Copy `dstack.config.example.json`, fill it in, and commit it so your team shares one definition of what proof means.

The engine refuses to run a stage whose configured command is missing rather than guessing one, and it says which key is unset. Silence is the failure mode this whole process exists to remove.

## Where this came from

The lineage is worth naming. [gstack](https://github.com/garrytan/gstack) established that the artifact handoff between stages is the product, and that real browser verification belongs in the loop. [pstack](https://github.com/cursor/plugins/tree/main/pstack) established that different work wants different models and that "prove it works" beats "looks right".

Dstack takes both and adds the constraint neither had to solve: the person deciding whether to merge cannot read the diff. That single constraint is why every stage here is defined by what it leaves behind rather than by what it does.

## License

MIT. See [LICENSE](LICENSE).
