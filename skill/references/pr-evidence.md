# What every Dstack PR body carries

The owner reads this and never the diff. Every section is present and non-empty, in this order, or the PR is not ready for `/dstack ship`. A section that does not apply says so in one line; it is never omitted. Prove writes the first version, with every later stage `pending`; Gate, See it and Ship overwrite their own lines.

    ## Claim
    One paragraph, in the customer's or the owner’s words: what they will observe that they cannot today. If Prove dropped a guarantee, this paragraph no longer promises it.

    ## Evidence is about
    Commit: <full 40-char sha>
    Environment: node <version>, test database <host:port/name>, run by <claude | codex-build>
    Plan: <link to docs/superpowers/plans/<file>.md at the commit it was approved in>
    Review log: <link to <file>.review-log.md at that commit>
    Proof output: <link or attachment of the proof command's output at the commit above>

    ## Stages
    intake:  done, <ticket or "the owner’s ask">
    plan:    done, Codex APPROVED <date>, the owner yes <date>   | done, Codex review skipped (under twenty lines), the owner yes <date>
    build:   done, by codex, <n> fix rounds   | done, by claude, because codex fix rounds spent
    prove:   done, <n> guarantees, <n> seen to fail, proof command green, on <short sha>
    gate:    pending   | pass at <short sha>, round <n>, Codex <verdict>(<findings>), Grok <verdict>(<findings>), three-wide runner: <built | not_built; review-loop3.sh, concurrency 1>   | block, <majors> majors, see comment
    see:     pending   | pass at <short sha>, <n> flows, 0 fail   | fail, <n> of <m> flows   | not_applicable, no client/ change   | not_built, UI claims on a source guard only   | waived by the owner <date>: "<their words>"
    ship:    pending   | merged <short squash sha>, containment verified file by file; ticket <state>; email <state>; deploy <state>
    watch:   pending   | not_built, deploy is unwatched, treat as unknown   | green   | broke: <what>
    retro:   pending   | counted in the week of <date>   | not_built, counted by hand from review-loop.log lines <a>-<b>
    ticket:  FS-<n>, closes-ticket, marker verified against live id and message count   | FS-<n>, partial-fix, no marker, because <reason>, the owner yes <date>   | none

    ## Routing
    | Stage | Ran at | Why |
    |---|---|---|
    | plan  | <tier, or "review skipped"> | <the one sentence from the router> |
    | build | <tier> | <the one sentence> |
    | gate  | <tier> | <the one sentence> |
    | see   | <applies, or not applicable> | <the one sentence> |
    Router: <model> | off, <reason>. Cost: <input tokens> in, output free.

    ## Baseline proof
    Command: <the exact proof command from the plan>
    Result: <vitest's own summary line, verbatim>

    ## Proof ledger
    | Guarantee | Mutation | Result |
    |---|---|---|
    | <what the fix guarantees, in one line> | <what was removed> | seen to fail |
    Dropped from the set: <guard>, because <nothing can observe it>; Claim and Acceptance updated in <short sha>.   (or: none)

    ## Acceptance
    | Criterion from the plan | Observed | Evidence |
    |---|---|---|
    | <line from the plan's Acceptance> | <what was actually seen> | <link to the test output, the query and its rows, or the screenshot> |

    ## Class
    <the class of defect, and every path it runs through, from the plan, with the grep that found them>

    ## Out of scope
    <named, from the plan>

    ## Deviations from the plan
    <what the diff does that the plan did not say, and why>   (or: none)

    ## Not verified
    <anything the Claim implies that no row above demonstrates, said plainly>   (or: none)

    ## Risks and prerequisites
    <from the plan: downtime, irreversible data changes, configuration that must exist first>   (or: none identified)

    ## Rollback
    <from the plan: how to undo this, and for a migration whether it reverses and what data it touches>

Rules:
- The ticket marker itself, `<!-- support-ticket-autoresolve: ... -->`, is emitted by `ticket-directive.cjs --lookup FS-NN` and pasted verbatim below Rollback. Never typed by hand. Absent on a partial-fix PR, with the reason in the Stages block.
- No em dashes.
- The attribution line the session specifies ends the body.
