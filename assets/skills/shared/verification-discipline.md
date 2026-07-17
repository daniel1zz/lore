# Failure-First Verification Discipline

Shared, mandatory discipline for every verification-family skill (test / lore-review / iterative-review / bug-hunt / dogfood / lore-uat / biz-review / product-lens, plus the harness built-in `verify`). A verification pass that only demonstrates success is not verification — it is decoration. Every rule below was earned from a real incident (2026-07-17 full-lifecycle dogfood, `knowledge-dogfood-retro-full-lifecycle-fresh-corpus-run-snip-dem`): the first pass tested only success paths and missed four defect classes that ten minutes of failure-path probing then surfaced.

## The core inversion

Plan verification by asking **"what SHOULD fail, and does it fail correctly?"** before asking "does it work?". A target's failure behavior is part of its contract: rejections, exit codes, error messages, loud aborts. If you cannot name the scenarios where the target must refuse/abort/error, you do not understand the contract well enough to verify it.

## The eight rules

1. **Enumerate mandated failures first.** Before executing anything, list every scenario where the target MUST fail (invalid input → usage error; missing permission → denial; corrupt state → loud abort; gate violation → rejection with recovery guidance). Each listed scenario gets exercised and its observed behavior (exit code, message, side-effect absence) compared to the contract. An unexercised mandated-failure scenario is an uncovered requirement.

2. **Prove the oracle can fail before trusting its pass.** An oracle that has never been seen red proves nothing (always-green oracle). For a new test: watch it fail first (break the input or revert the fix). For an inherited suite: mutate one guarded behavior and confirm detection, or find its most recent legitimate red. Incident: a 940ms "suspiciously fast" attested pass was re-run manually before being believed — it was real, but only the re-check made it evidence.

3. **Negative controls travel in pairs.** Every "X is now allowed/fixed" claim ships with its sibling "Y is still rejected" probe. Fixing a false deny? Prove the true deny still fires. Loosening a matcher? Prove the true positives still match. A fix verified only in the direction it relaxed is how regressions hide.

4. **Hunt silent fallbacks on purpose.** Feed the target things it should reject loudly: unknown flags, out-of-range config values, undeclared fields, unparseable files. Silence-plus-defaults is a defect, not a convenience (incidents: unknown `--kind` silently created a wrong-typed link; `claim_ttl_minutes: 0` silently became 120). Anywhere the answer to "what happens on bad input?" is "nothing visible", file a finding.

5. **Boundaries are failure scenarios.** Zero, empty, duplicate, expired, concurrent, over-limit, already-deleted, already-approved. Exercise the state machine's illegal transitions, not just its happy walk.

6. **Measure without lying to yourself.** Exit codes are read UNPIPED (`cmd > out.txt 2>&1; echo $?` — never `cmd | head; echo $?`, which reports the pipe's tail). Assertions read actual bytes/observed state, not summaries of it. Two false bug reports in one session came from piped `$?` alone. Before reporting any anomaly, reproduce it with clean measurement.

7. **Name what you did NOT cover.** Every report carries an explicit uncovered list (surfaces skipped, scenarios not exercised, environments unavailable) — silent scope caps read as full coverage. Declaring a gap honestly beats faking breadth; an uncovered P0 requirement blocks a clean ACCEPT.

8. **Verdicts come from external oracles.** Pass/fail derives from exit codes, rendered output, persisted state, or an independent judge — never from the implementer's own assessment of their work (self-verification paradox). When the finding matters, verify it adversarially: attempt to REFUTE it before reporting it.

## Routing map (who verifies what)

| Need | Skill |
|---|---|
| A single change actually works end-to-end | `verify` (harness built-in) |
| Author/audit an automated test suite (six-dimension) | `test` |
| Test-first development methodology | `tdd` |
| One-shot code/PR review vs spec & ACs | `lore-review` |
| Review→fix loop until clean | `iterative-review` (drives `lore-review`) |
| Proactive static defect scan, no execution | `bug-hunt` |
| Runtime exploratory QA of a running app | `dogfood` |
| Requirement-driven product acceptance (delivery gate) | `lore-uat` |
| Business-domain role/scenario review | `biz-review` |
| Product-strategy multi-lens review | `product-lens` |

One lane per skill: a skill receiving a request from another lane routes it instead of absorbing it.
