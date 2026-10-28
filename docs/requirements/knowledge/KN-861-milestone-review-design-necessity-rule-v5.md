---
id: KN-861
type: knowledge
role: knowledge
title: "Milestone review: Design-necessity rule v5"
status: approved
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-210
links:
  - {id: PLAN-210, type: informs}
---
# Milestone review: FAIL

Fingerprint: f97dd194f67aa043e83d24bfff44e0d44bf408649506906dd4d4c3edd2614cc0
Diff: derived from 4 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | fail | Two of the three criteria have trusted evidence. AC-DN5-1 has attested passes of review-template-v5.test.ts, and AC-DN5-3 has an attested pass of rule-propose-amend.test.ts. AC-DN5-2 does not: it is the real-judge criterion (two runs per fixture; the patch-shaped spec rejected for the ledger/ratchet, the seam and the transitional bridge; the end-state spec with no design_necessity finding). Its only evidence is two self-reported 'manual pass' entries from `dist/lore review <fixture> --json`, with no runner output and no transcripts. The plan's Risk Register promised to report every transcript. The second self-report also cites fixtures at commit 8aded5f2, 'end-state without echoed class labels'. The landed end-state-spec.md still carries class labels ('This is product semantics the user relies on', 'Owned-only prune (product semantics)', 'Rooted write port (interface contract and outside-input validation)'), so it is unclear which fixture bytes were validated. With no attested run, AC-DN5-2 is unverified. There are no milestone decisions. | Evidence list for task DN5-1 (AC-DN5-2 self-reported only); packages/lore/tests/fixtures/design-necessity/end-state-spec.md; Plan Risk Register 'reports every transcript' |
| spec_conformance | pass | D1/D2: DESIGN_NECESSITY_RULE_V5 lists the non-findings (i)-(iv) and the findings (a)-(d), and it requires listing and classifying every candidate before deciding. It also requires naming each item, its class and the end-state alternative, and it forbids raising an item justified under (i)-(iv) unless the justification is false. v5 is v3 plus this block only, without v4's block. It is registered and is REVIEW_PROMPT_VERSION. v1-v4 are unchanged and pinned by snapshots. The control fixture no longer has legacy_skip/foreign_skip, and its prune and test-HOME justifications are rewritten as product semantics and acceptance-test safety. D3: `amend` rewrites this spec's own unlanded `add` in place and keeps its id and leaf. On a locked spec it goes through resolveLockExit, so `--correction` is required and status is kept, giving one audited version. It refuses a live id, another spec's id, an unknown id and this spec's modify/retire, each naming the id with exit 4. The 'must change something' refusal is a small, consistent addition that mirrors modify. The Landing order is post-merge orchestrator work and was correctly not done here. INV-1 holds: no new check or ledger, and ledger entries were only removed. | packages/lore/src/ai/review-template.ts DESIGN_NECESSITY_RULE_V5 / buildReviewPromptV5; packages/lore/src/service/rule-change-service.ts proposeAmendOfProposal / findOwnProposedAdd |
| regression | fail | Full suite on main at db5480615339aebdde0cd35245b88cc9cbbd6dd9 fails in packages/lore/tests/integration/write-path-everywhere.bun.test.ts, which this plan's diff touched or imports directly (judge said: The full-suite run on main at db548061 has `bun run test` exiting 1, and the section attributes packages/lore/tests/integration/write-path-everywhere.bun.test.ts to this plan. The behaviour at risk is the write-path invariant that test enforces. This plan adds a new spec write path: amend → writeChangeSet, refactored out of the modify/retire persist path. The other eight failing files are attributed elsewhere and are not counted. Prompt-version regressions are covered: the v1-v4 byte snapshots and the v2/v4/standard STATE tests were updated and attested.) | Full-suite section: write-path-everywhere.bun.test.ts attributed to plan-design-necessity-rule-v5 |
| design_necessity | pass | 1. Each prompt version is a new immutable registry key with v1-v4 frozen: immutable versioned artifacts, so recorded judgments' prompt_version stays meaningful. 2. Frozen JSON snapshots of the v4 output: golden-master / approval testing. 3. Classify every candidate before deciding: a structured rubric for an LLM judge (G-Eval / rubric-first evaluation, chain-of-thought before verdict). 4. Prompt text rather than a deterministic detector: this is what the spec scopes and what INV-1 requires. 5. The amend CAS loop that re-reads on STALE_VERSION: optimistic concurrency control. 6. A locked-record correction as one audited version: an append-only audit log. 7. Reusing ruleChangeSchema in shapeAmend: one schema shared by add, modify and amend. 8. Refusal by id class, with live rules kept on modify: the separation between draft and published records. No stopgap, fallback or transitional state is introduced, and two ledger entries are removed. | Immutable versioned artifacts / semantic versioning; approval (golden-master) testing; G-Eval rubric-based LLM-as-judge (Liu et al. 2023); optimistic concurrency control (Kung & Robinson 1981, HTTP If-Match/ETag); append-only audit log |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-263 (unknown: no-code-anchors), BR-1237 (unknown: no-code-anchors), BR-1238 (unknown: no-code-anchors) (All cited rules (BR-263, BR-1237, BR-1238) are 'unknown (no-code-anchors)'. None is contradicted by a failing run of its citing criterion, so per the rule they are na.) | Cited rule state section |
| concurrency_safety | pass | proposeAmendOfProposal re-reads the spec and re-runs findOwnProposedAdd on every attempt. The single version-bumping write goes through writeChangeSet's CAS, retried on STALE_VERSION up to MAX_CAS_REAPPLIES and then returning staleExhausted. Two concurrent amends, or an amend racing a modify/add, therefore cannot lose a write. Residual concern: the lock exit (resolveLockExit) is computed once before the loop. If the spec were approved between that call and a retry, keepStatus could be stale. This matches the existing BR-1069 correction pattern the service already uses and is not a lost write, but it is worth keeping in mind. | packages/lore/src/service/rule-change-service.ts proposeAmendOfProposal CAS loop; optimistic concurrency control |
| security | pass | Input is a local CLI argument, and it is validated with the stored-shape ruleChangeSchema (statement ≤500 characters, 1-3 examples, enforced_by enum), covered by the BOUNDARY tests. Privilege is checked through writeAuthority.authorize on the target leaf, the same 'rule-propose' check as the other ops. A spec cannot rewrite another spec's proposal or a live rule, since both are refused by id class. A locked record cannot change without an audited correction. The new code adds no credential handling, network or path input. | rule-change-service.ts shapeAmend / findOwnProposedAdd / writeAuthority.authorize; rule-propose-amend.test.ts NEGATIVE/BOUNDARY cases |

## Retired ACs

- spec-a-retro-lesson-names-the-mechanism-that-stops-it-recurring:AC-RM-1 (spec deprecated): spec deprecated
- spec-a-retro-lesson-names-the-mechanism-that-stops-it-recurring:AC-RM-2 (spec deprecated): spec deprecated
- spec-a-retro-lesson-names-the-mechanism-that-stops-it-recurring:AC-RM-3 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-1 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-2 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-3 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-5 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-6 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-7 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-8 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-9 (spec deprecated): spec deprecated
- spec-ambient-state-is-read-once-at-the-entry-owned-only-prune:AC-IV-4 (spec deprecated): spec deprecated
