# The class rule

Run this before fixing any finding from any reviewer, once both reviews have landed against the same head. Answer all four in the PR comment before the first edit.

On 12 September 2026 one identity-collision defect was found four times on PR #1265, once per code path: the card save, then the v1 PATCH, then the two synchronous import branches, then bulk across requests. Four gate rounds, forty minutes, one idea. Every round fixed the path the reviewer named and left the siblings. This rule exists so that does not happen again.

1. **What class is this finding?** Not "the PATCH identity collides" but "an observation identity that does not include a per-request component collides whenever two requests land in one millisecond".
2. **Where else does that class run?** List every code path with the same shape. `grep` for the pattern and paste the grep; do not recall it. If the answer is "only here", say what was grepped.
3. **What is the one change that closes the class on every path?** If it is one change in one place, make it there. If it is the same change in N places, make all N in this round.
4. **What would make this finding come back with a different name?** That is the mutation Prove must add.

Signals that the rule was skipped:
- the same reviewer finds the same shape on a different path next round
- the major count does not fall after a fix
- a fix comment says "also" more than once

The stop rule this feeds is S3: two consecutive real rounds where the major count did not fall, and the change is the wrong shape. Hand over.
