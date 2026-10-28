---
id: KN-834
type: knowledge
role: knowledge
title: "Milestone review: The approval judge rejects patch-shaped designs"
status: approved
priority: medium
created: 2026-10-24
updated: 2026-10-24
tags: []
parent: PLAN-209
links:
  - {id: PLAN-209, type: informs}
---
# Milestone review: FAIL

Fingerprint: 9bdd6fc5988ad0e7f35120255a6617cebfa5fb3ee707a5162f3377df2104d069
Diff: derived from 6 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | fail | AC-DN-1 and AC-DN-2 have attested passes from a trusted runner: review-template-v4.test.ts and plan-approval-judged-by-default.test.ts, plus the typecheck. AC-DN-3 is a criterion the spec claims (the patch-shaped fixture is rejected on design_necessity and the end-state control is not, two runs each). Its only evidence is two [self-reported] manual runs. No trusted runner produced a pass. One of those runs says it used 'prompt v5', but the landed registry holds exactly v1..v4 and the v4 test asserts REVIEW_TEMPLATES['v5'] is undefined. So that run did not exercise the code that landed. The second run says the end-state fixture was edited at 8aded5f2 ('without echoed class labels'), which means the control input was changed between runs and nothing attests the result on the final fixture. No milestone decisions were applied. | Task evidence list (AC-DN-3 manual entries); packages/lore/src/ai/review-template.ts REVIEW_TEMPLATES; review-template-v4.test.ts 'ERROR: an unknown version key is not registered' |
| spec_conformance | pass | D1: DESIGN_NECESSITY_RULE is added to the end of the v3 output, covering items (a)-(d), the end-state test, a mandatory reject with dimension design_necessity, and the exemption for checks the end state itself requires. It applies to every doc type, v4 is registered and current, and v1-v3 are untouched. D2: the judgment_required_types default is now [spec, adr, plan]. D3: one sentence was added to the produce fragment (fixture and manifest hash updated). No scanner or ledger was added (INV-1). One change goes beyond the stated scope: review-service.ts now always skips the judgment gate on the post-write plan re-check. Without it, D2 cannot work, because the re-check measures the just-written version N+1, which no judgment can cover, so every judged plan would be refused. The judgment is still enforced before the write against the version being approved. The test-fixture config overrides are scaffolding for existing suites, not product behaviour. | spec D1-D3, Scope; review-service.ts approve() post-gate hunk; config.ts WorkflowConfigSchema |
| regression | pass | Behaviours at risk: (1) the v1-v3 prompt bytes, covered by the frozen-snapshot test for spec, plan and adr, plus the v2 and standard-rule freeze tests; (2) plan-promote, archive, plan-close and lifecycle flows that approve plans, now gated by default and kept working by an explicit judgment_required_types: [] or a seeded judgment in each suite; (3) types outside the default list, covered by the REGRESSION case for a knowledge reference doc; (4) the plan-promote ancestor check after the write, still run with only the judgment part skipped. The set-approval parity test changed from auditUnchanged true to false because the passing judgment gate now writes its own gate_passed row; the parity assertion between set and approve is kept. The full-suite run attributes no failing file to this plan. The two failures (done-worktree-cleanup and ric-site-map-gone-live) belong to other work. | Full-suite section; review-template-v4.test.ts REGRESSION; plan-approval-judged-by-default.test.ts REGRESSION; set-approval-gate-parity.bun.test.ts |
| design_necessity | pass | Each choice:
- New prompt version added to the registry rather than editing v3, so historical judgments stay reproducible. This follows append-only versioned migrations.
- v4 built as the v3 output plus one appended rule, the smallest change that adds one dimension.
- v1-v3 pinned by a JSON fixture snapshotted before v4 existed. This is golden-master testing, and it is the behavioural test of INV-2, not a guard on a design constraint.
- Config default changed instead of adding a new flag. This follows convention-over-configuration defaults.
- Post-write re-check skips only the judgment gate, because the check-then-act validation already ran against the exact version being approved.
- Test suites opt out through config rather than a bypass, which is per-test fixture isolation.
No detector, scanner or phased rollout was introduced. | Flyway/Liquibase append-only versioned migrations; Michael Feathers golden-master / Jest snapshot testing; Rails convention over configuration; OWASP TOCTOU guidance (validate the object you act on); xUnit Test Patterns fresh fixture |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-263 (unknown: no-code-anchors), BR-281 (unknown: no-code-anchors), BR-1237 (unknown: no-code-anchors) (All cited rules (BR-263, BR-281, BR-1237) are unknown (no-code-anchors). None is contradicted by a failing run of its citing criterion. The config.ts JSDoc defaults and the review-template registry comment were updated to match the code.) | Cited rule state section |
| concurrency_safety | pass | Prompt builders are pure functions over their inputs. The config default is read-only. The review-service change removes a check that could never pass, the judgment gate on version N+1. It adds no new shared state or write path. The judgment is still read before the write, as it was for specs and ADRs before this change, and the existing rollback on post-gate failure is kept. Test helpers use separate mkdtemp corpora per test. | review-service.ts approve() pre/post gate and rollbackApproval; review-template.ts buildReviewPromptV4 |
| security | pass | No new input surface, credential handling or privilege path. The change adds static prompt text and a stricter default: more doc types are gated, not fewer. The post-write skip cannot bypass the judgment requirement, because it is enforced before the write against the approved version. The raw SQL inserts are confined to throwaway test corpora with bound parameters. | OWASP secure defaults (fail closed); review-service.ts enforceApprovalGate; plan-approval-judged-by-default.test.ts insertRawJudgment |
