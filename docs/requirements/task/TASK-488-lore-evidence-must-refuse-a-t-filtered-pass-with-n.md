---
id: TASK-488
type: task
role: plan
title: "lore evidence must refuse a -t-filtered pass with no matched-count proof (the self-report path has no completeness guard)"
status: archived
priority: critical
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Task

`lore evidence --result pass` accepts a `-t`/`--testNamePattern`-filtered command
with no proof that the filter matched anything. A zero-match filter **exits 0**
with every test reported `skipped`, so a drifted or mistyped test title produces
a corpus row indistinguishable from a real pass.

## Why this is the highest-value guard available

`lore verify`'s trusted runner ALREADY owns this guard — `hasCaseFilter` plus the
`zero_match`/`under_match` completeness downgrade in
`packages/lore/src/service/verify-runner-service.ts`. But every dispatched
implementer subagent reports through `lore evidence`, which stores what the caller
asserts. The guard therefore sits on the path nobody takes.

Measured this session: 21 of 21 script ACs across four plans were recorded via
`lore evidence`, `attested_evidence_ratio = 0.00` on every plan. The only thing
standing between a fabricated pass and the SSOT was the orchestrator manually
re-running all 21 and reading matched counts — a control that does not survive
across sessions.

Detail: `knowledge-a-zero-match-vitest-t-title-filter-exits-0-the-sixth`.

## Mechanism required

1. ~~Extract the verify runner's completeness classifier into a pure,
   vitest-reachable module (it currently lives inside the runner).~~
   **CORRECTED 2026-07-31 (measured, not remembered): already done — this step
   does not exist.** The classifier is a pure vitest-reachable module at
   `packages/core/src/attestation-completeness.ts`, exporting
   `countExplicitPathArgs`, `commandHasCaseFilter`, and `judgeCompleteness`;
   `verify-runner-service.ts:739-790` is merely a consumer of it. Acting on the
   original wording would produce a no-op refactor of already-correct code.
   What survives from this step is only its constraint: **do not duplicate the
   rule** — one definition site, two consumers.
2. `lore evidence` consults it: a `--result pass` whose `--command` carries a
   name filter must be accompanied by a matched-count assertion, or the write is
   refused (`VALIDATION_ERROR`, exit 4) naming the missing proof.
3. Decide and document how the count reaches the CLI: an explicit
   `--matched <n>` flag the caller must supply, or a required `output_tail`
   containing the runner's own summary line. Prefer whichever cannot be satisfied
   without having actually read the runner's output.

⛔ Not a warning. A warning on the self-report path is read by the same agent that
wrote the self-report.

## Oracle

Failure-first, and the control matters more than the happy path:
- a `pass` recorded for a `-t` filter that matches ZERO tests must be REFUSED
  (this is the case that silently passes today — prove it now fails);
- a `pass` recorded for a filter matching N>0 with the count supplied must succeed;
- an UNfiltered command must be unaffected (no new friction on whole-file runs);
- the extracted classifier keeps `lore verify`'s existing behaviour byte-identical
  — the verify runner's own tests must stay green without modification.
