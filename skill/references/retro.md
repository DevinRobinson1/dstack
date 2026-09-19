# Retro: the ledger that corrects the guesses

Every number in this process is a guess. Five routing weights, four bands, eight surface floors, six triage thresholds, three token shapes, and three claims about what a model is trusted to do. Each is stated as a guess in the contract that carries it, and three of those contracts name this file as the fix.

Nothing observed any of them. A change routed to `skim` and a change routed to `max` produced exactly the same record: none.

## The refusal

**A finding that does not carry its sample count is not a finding.**

That is stop rule S9, and it is most of the value here. Five rows will always produce a difference that looks like signal, and the damage is not a wrong number on a screen: it is someone editing a safety floor because of one. So the minimums live in the pure function rather than in this document, and there is deliberately no flag that relaxes them. The only reason anyone reaches for such a flag is to get an answer they had already decided on.

A comparison is reported only when every group has at least `minPerGroup` rows **and** the spread exceeds `minDifference`. Below either, the output is "not enough evidence yet" and the number of rows still needed.

## What the arithmetic is, and is not

Rates and differences with sample counts beside them. **It is not a significance test.** It does not compute a p value, a confidence interval, or a correlation coefficient, and it should not be read as if it had. It is a tripwire: it tells you when a gap has become too large and too well sampled to keep ignoring, and it stays quiet otherwise.

For a shop shipping a few pull requests a week, question 2 takes months to answer properly. That is a real limit of the approach and no amount of further arithmetic fixes it. The report says how far off it is rather than pretending.

## The five questions

1. **Does the tier predict a block?** Group by the tier a change was built at, compare block rates. If `skim` blocks as often as `deep`, the risk index is not measuring risk and the weights are wrong.
2. **Does the model matter at a fixed tier?** Group by stage, tier and model. If one model's work blocks materially more often than another's at the same tier, its `serves` line is wrong. This is the question that judges every capability claim, including the one that says a cheap model can write but not judge.
3. **Do the triage labels hold?** Of findings labelled `questioned`, how many survived adjudication against source, against those labelled `major`? Similar rates mean the readings are noise.
4. **Are the token shapes right?** Measured tokens per stage against the configured `typical`. Those shapes decide the entire cost ranking, and they were guessed.
5. **Does risk predict rounds?** The risk index against the number of real gate rounds. Infra rounds are not rounds, per S4, and are excluded here too.

## The ledger

`.dstack/retro/ledger.jsonl`, append only, one JSON object per line. Five row types: `decision`, `outcome`, `usage`, `adjudication`, `ship`.

Append only is load bearing. History that can be rewritten to make a threshold look good is not evidence. `record()` never reads, rewrites or truncates the file, and a fixture holds that every existing byte survives an append.

A line that cannot be parsed is **counted and reported**, never dropped and never fatal. A ledger that quietly discards what it cannot read is a ledger that reports on a subset while looking complete.

A decision with no observed outcome is left out of every rate. It is not counted as a pass: not yet judged and judged fine are different things, and only one of them is evidence.

## What Retro does not do

**It never edits a threshold.** It reports; a person changes the config. A process that tunes its own safety thresholds from its own small sample will eventually talk itself into anything, and the thresholds it would reach for first are the floors that exist precisely because measurement is not trusted there.

## The one coupling

Outcome rows need gate round detail, and this repository has no gate runner: `gate-pr.cjs` is Plan 3 and unwritten. `adaptGateRounds()` is the single function that reads a runner's verdict shape, and it is alone on purpose. When Plan 3 lands, replacing it is one edit.

## Reading the report

    !  a finding: the evidence disagrees with a number in your config
    .  enough evidence, and nothing worth acting on
    ?  not enough evidence yet, and how many more rows it needs

A run where every line is `?` is the expected first result, and it is the correct one. It means the ledger is young, which is a fact about the ledger rather than a failure of the analysis.
