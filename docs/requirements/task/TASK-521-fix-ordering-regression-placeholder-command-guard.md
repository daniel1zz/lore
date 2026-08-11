---
id: TASK-521
type: task
role: plan
title: "Fix ordering regression: placeholder-command guard preempts the doc-type error"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-07-30
tags: []
parent: PRD-001
---
REAL REGRESSION introduced by the placeholder-command guard, caught by the FULL suite (1530 pass / 1 fail) after the scoped oracle bun run test:changed missed it — a concrete case of scoped selection under-covering an integration test. Failing test: packages/lore/tests/integration/cli/phase-workflow-e2e.bun.test.ts:254 'BOUNDARY/REGRESSION: lore evidence against a PLAN doc stays Expected a task document (never retries into phase dispatch)'. It invokes lore evidence against a PLAN doc using command "x" as an arbitrary filler; it now receives the placeholder-rejection message instead of 'Expected a task document'. Root cause (located, not guessed): in _addEvidenceImpl (task-workflow-service.ts ~line 718) rejectPlaceholderEvidenceCommand runs BEFORE this.appendEvidenceEntry, while the doc-type check lives INSIDE appendEvidenceEntry via this.resolveTask(idOrSlug) at ~line 746. So a wrong-doc-type call is answered with a command-format complaint. Fix direction: the doc-type error must win — when the target is not a task, the most actionable message is 'this is not a task', not 'your command is too short'. Resolve/validate the target BEFORE the placeholder check in _addEvidenceImpl, then run the placeholder check, then append. A duplicate resolveTask call is acceptable; correctness over one extra store read. ⛔ Do NOT fix this by editing the failing test to use a longer command — that test verifies evidence never falls through into phase dispatch, and letting the placeholder check shadow it destroys a meaningful regression guard. ⛔ Do NOT let the placeholder guard leak into recordVerifiedEvidence (the runner-attested path is exempt by construction). Exit condition: cd packages/lore && bun test tests/integration/cli/phase-workflow-e2e.bun.test.ts passes, the 9 placeholder tests in tests/unit/service/task-workflow-service.test.ts still pass, and bun run test:changed is clean. Run bun run build first where compiled-binary specs are involved.
