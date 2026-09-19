# The state file

`.dstack/state.json` at the lane root. Intake creates it; every stage reads and writes it. Nothing about where a change is lives in memory.

Read this when you are writing the file. Routing a stage does not need the field shape, only the vocabulary, which is in `SKILL.md`.

    {
      "pr": 1265,
      "head": "<full sha the evidence is about>",
      "plan_file": "docs/superpowers/plans/2026-09-12-fs58.md",
      "runner_available": false,
      "stages": {
        "intake":  { "state": "done", "at": "<iso>", "artifact": ".dstack/work-order.json" },
        "plan":    { "state": "done", "at": "<iso>", "codex_review": "APPROVED", "owner_yes": "<iso>", "tier": "deep", "model": "<id>" },
        "build":   { "state": "done", "at": "<iso>", "by": "codex", "fix_rounds": 1, "tier": "standard", "model": "<id>" },
        "prove":   { "state": "done", "at": "<iso>", "head": "<full sha>", "guarantees": 6, "seen_to_fail": 6, "tool": "scripts/ci/mutate.cjs" },
        "gate":    { "state": "pass", "at": "<iso>", "head": "<full sha>", "round": 2, "majors": 0, "distinct": 2, "unread": 0, "runner": "review-loop3.sh", "concurrency": 1, "tier": "max", "model": "<id>" },
        "see":     { "state": "not_built", "note": "UI claims are on a source guard only" },
        "ship":    { "state": "pending" },
        "watch":   { "state": "not_built", "note": "deploy is unwatched; treat as unknown" },
        "retro":   { "state": "not_built", "note": "counted by hand from review-loop.log" }
      }
    }

## The rules on it

- Allowed `state` values: `pending`, `done`, `pass`, `block`, `skipped`, `not_applicable`, `not_built`, `unknown`, `stale`.
- A `skipped` entry carries `"owner_yes": "<iso>"` or it is invalid.
- Whenever the plan file or the branch head changes, every stage after the one that changed it is set to `stale` and must run again.
- `codex_review` on the plan entry is `APPROVED` or `skipped`. The plan itself is `done` only with `owner_yes`.
- A routed stage records the `tier` it ran at and the `model` it ran on. A stage that ran unrouted records the tier and why, so a default is never mistaken for a measurement.
- Gate records `majors` and, when Triage compared the round to the previous one, `distinct` and `unread`. S3 compares `distinct`, not `majors`.

`/dstack` with no argument prints this file as a table and names the next stage.
