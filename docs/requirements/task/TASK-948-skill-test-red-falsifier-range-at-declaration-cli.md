---
id: TASK-948
type: task
role: plan
title: "[Skill:test] RED - falsifier range at declaration, CLI surface and verify --falsify (#43)"
status: archived
priority: high
phase: "falsifier-range"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-947, type: blocks}
---
Estimate: M
Source: spec-evidence-labels-and-reds-are-honest AC-EH-3, AC-EH-4, AC-EH-5 (statements are the contract: `lore ac list <spec>`)
TDD-Role: red | Paired-Impl: task-skill-implement-falsifier-expected-exit-code-1-255-at
Scenarios:
- NEW packages/lore/tests/unit/service/falsifier-exit-code-range.test.ts (AC-EH-3 a-f): InMemoryStore + write spy; (d)/(e) plant a stored 0 straight into the store; (f) the CorpusService.create path.
- NEW packages/lore/tests/e2e/ac-falsifier-range-compiled.bun.test.ts (AC-EH-4 a-c): compiled binary (`bun run build` first), mkdtemp + lore init.
- NEW packages/lore/tests/unit/service/falsify-stored-exit-range.test.ts (AC-EH-5 a-e): VerifyRunnerService with a recording executor and recorder (pattern tests/unit/service/attested-red.test.ts).
- NEW packages/lore/tests/integration/cli/verify-falsify-stored-exit-range-cli.test.ts (AC-EH-5 f): subprocess 'bun run src/index.ts' (pattern integration/cli/verify-falsify-green-control.test.ts); plant the stored 0 by a direct SQLite update of the throwaway corpus.
Dimensions: HAPPY (1, 255), NEGATIVE (0), BOUNDARY (-1, 256), STATE (stored value unchanged), ERROR (nothing run), REGRESSION (stored 0 still readable/editable).
AC:
- Run every listed file against current main; each new case must fail on an ASSERTION (wrong label / missing refusal / row written), not a harness error. A red that is a call to a not-yet-existing export the paired task adds (TypeError / undefined is not a function) is acceptable only for that export; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit plus every merged predecessor; never merge red to main alone.
