# Dstack

Nine stages, one command, and readable evidence at every gate. A delivery process for an owner who ships software they do not personally read.

Dstack is the successor to [4-brain](https://github.com/DevinRobinson1/4-brain). 4-brain answered one question: who reviews the code, given that Claude reviewing Claude's own work is the same architecture checking its own blind spots. Dstack answers the larger one: what has to be true, and shown, before a change is allowed to reach customers.

## The premise

Most AI coding processes optimize for producing a diff. That is the cheap half. The expensive half is the decision to merge it, and that decision is usually made on a feeling: the tests are green, the agent sounded confident, the diff looked reasonable.

Dstack is built on the opposite assumption. Every stage must leave behind something a non-engineer can read and judge. If a stage cannot produce that, the stage failed, no matter what the code does.

Two rules carry most of the weight:

**A test does not count until it has been seen to fail.** Every regression proof mutates the fix back out, watches the test go red for the stated reason, and restores it. A green suite proves the suite ran. It does not prove the suite is watching anything.

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

Plans and their full review logs live in [docs/plans](docs/plans). The argument is the artifact; it is kept whole on purpose.

## Install

Requires [Claude Code](https://claude.com/claude-code) and [Node.js](https://nodejs.org/). Stages route to external model CLIs when they are present on `PATH`:
[`codex`](https://github.com/openai/codex) for planning review and gating, [`grok`](https://x.ai) for the product and operations lens, [`gemini`](https://github.com/google-gemini/gemini-cli) for breadth and screenshots.

A missing CLI is announced once and that route is skipped. A missing CLI never silently downgrades a gate to a pass.

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
