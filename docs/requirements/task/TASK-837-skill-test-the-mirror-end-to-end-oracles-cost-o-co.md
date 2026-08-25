---
id: TASK-837
type: task
role: plan
title: "[Skill:test] the mirror end-to-end oracles cost O(corpus) against a fixed 30s timeout and now exceed it"
status: draft
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [oracle-design, scale, north-star]
parent: PRD-001
---
MEASURED 2026-08-25 on main, during the full-suite gate of the read-side slice.

Three cases in scripts/tests/spec-mirror-export.test.ts fail, and the failure is a TIMEOUT, not an assertion mismatch: 'Error: Test timed out in 30000ms.' The affected cases are AC-FR-10 HAPPY (a+b), and both AC-FR-7 drift-check-is-separate cases.

ARITHMETIC, measured directly: the corpus holds 1704 docs (826 task / 161 spec / 531 knowledge / 147 plan / 38 adr / 1 prd). A SINGLE 'bun scripts/export-spec-mirror.ts --check' pass takes 12s; write mode also 12s. Those cases run a baseline plus two consecutive --check passes, i.e. 24-36s against a 30s budget. The suite running them concurrently with 500+ other files makes it worse.

⛔ This is NOT a pathological complexity bug — 12s over 1704 docs is linear and reasonable per pass. It is a BUDGET that no longer fits, and it will keep not fitting: every doc added to the corpus makes it worse, permanently.

⛔ Root-cause framing, so this is not fixed by bumping the number and moving on: the project's own North Star says 'Self-checking must stay cheaper than corpus growth' and 'Prefer incremental, local, concurrency-safe checks'. An oracle whose cost is O(corpus) per pass and which is invoked 2-3 times per test case is exactly the shape that rule forbids. Raising the timeout is defensible ONLY as a stopgap and only stated as one; the real fix is an incremental check (diff the docs that changed) or a scoped fixture corpus for the end-to-end cases, keeping ONE full-corpus pass as a separate, budgeted oracle.

⛔ ATTRIBUTION, stated as reasoning and NOT as measurement: the read-side slice added roughly 15 docs to a corpus of 1704 (0.9%), so it cannot plausibly be the cause; but nobody has run these cases against a pre-slice commit, so 'it was already failing' is inference from the arithmetic, not an observation. Whoever picks this up should establish that first — it is one checkout and one 3-minute run.

## ADDENDUM 2026-08-25 — the timeouts are not self-contained: they redden an unrelated test

Measured after the six-flags task landed. A full `bun run test:vitest` reports 4 failures: the 3 timeout cases above, PLUS `scripts/tests/mirror-status-parity.test.ts`.

That 4th one is CONSEQUENCE, not an independent defect. Established by isolation:
- run alone → `mirror-status-parity.test.ts` passes (1 passed)
- `bun run check:spec-mirror` → exit 0
- `git status --porcelain docs/requirements` → clean

⛔ Mechanism: `spec-mirror-export.test.ts`'s RED cases deliberately MUTATE the real `docs/requirements` mirror (delete one exported file, rewrite one frontmatter id) to prove the checker notices. When those cases time out at 30s they never reach their restore step, so they leave the SHARED, REAL mirror dirty — and `mirror-status-parity.test.ts`, reading that same real mirror, then legitimately reports drift.

⛔ So there are TWO defects here, and fixing only the budget leaves the second one armed:
1. the O(corpus) cost against a fixed timeout (above), and
2. **two test files share a mutable REAL-corpus fixture with no isolation and no guaranteed restore.** A restore that only runs on the success path is not a restore. Any interruption — timeout, crash, Ctrl-C — leaves the repo's real mirror mutated, and the next reader blames itself.

The second is the more dangerous of the two: it makes a failure in one file present as a failure in another, which is how a red suite becomes uninterpretable. Whoever takes this should fix isolation (a temp-dir corpus for the mutation cases) or make restoration unconditional, independently of whatever is decided about the timeout budget.
