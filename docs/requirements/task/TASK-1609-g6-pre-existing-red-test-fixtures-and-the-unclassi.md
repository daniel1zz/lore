---
id: TASK-1609
type: task
role: plan
title: "G6 pre-existing red test fixtures and the unclassified cases"
status: approved
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main green, cluster C, test fixtures, plus the unclassified cases. These were red before today. Fix each at its root, test-side unless the test shows a real product defect, in which case say so in the report.

- C2: write-unattested (12): "Run cc:ghost-session-aaaa is not a registered run". Align the test with AC-RID-8: register the run, or assert the refusal.
- C3: stop-turn-review, stop-turn-review-trail-source-edits and dc2-demotion-notice: "runs inside an agent harness but carries no attested run". In the turn-review-harness.ts:129 fixture, register a run or clear the harness env vars.
- C4: bootstrap-seat-injection-compiled (3), cli-anchor-resolution and cli-done-attestation-escape-hatch fail with "git worktree exited 128: not a git repository". The fixture must `git init`.
- C7: test-run-root picks the deleted stop-turn-review-cursor.test.ts. Use an existing file.
- C8: write-commands-take-no-by. Allowlist `ac supersede` (it has --by <spec>:<AC>, which is not an actor).
- C9: adhoc-ac-scope-floor-doc-invariants. The regex must allow an `export ` prefix.
- C10: feed-governing-rules golden gains the "Definition of done" section.
- C12: setup-baseline-adoption. Delete the regression case for the retired adoption config.
- C13: evidence-dropped-file-guard: MCP and CLI must use the same field (command vs output_tail).
- C14: issue-check, landing-record-decides-done and run-owned-done-and-overlap. Fix each fixture.
- Unclassified:
  - render-repo-rules (2) and context-refresh-check-references (1): `fragments check` reports every .claude/rules/lore-*.md as extra versus a fresh render.
  - own-diff-released-holders-do-not-block case 4: verdict.ok is true where false is expected. The test passes held:true, but the service reads heldClaim.
  - lore-actor-deprecation: done --override-attestation exits 4. Override classes are now tier milestone, so check this against B4.

Oracle: every file above passes, unfiltered.
