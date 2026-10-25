---
id: KN-381
type: knowledge
role: knowledge
title: "Cross-corpus generalization retro 2026-07-28 — guyin qualified-with-caveats, babyai reclassified, three repeating asymmetries"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-10-23
tags: []
parent: KN-297
---
## Scope

Phase 0 of the grill-review execution run (decision 7 of `knowledge-grill-review-2026-07-28-seven-product-direction`): first systematic audit of Lore's only two non-self corpora as generalization evidence. Two read-only explorer agents audited guyin (full-chain health) and babyai (zero-task shape); this doc synthesizes their findings with the lore-corpus facts from the grill session.

## guyin — the formal promotion-gate sample: QUALIFIED WITH CAVEATS

Healthy (with numbers):
- Evidence discipline: 31/31 archived tasks carry verification_evidence (avg 4.8 entries; oracles test 113 / tsc 29 / manual 9 / build 2; >50% attested; 10 fails recorded explicitly — failure tracking is honest).
- Type chain: 5 specs all with structured ACs; plans phased; 96/96 tasks with parent + plan + file_anchors.
- Actor discipline: zero bare OS usernames; clean role-named agent:* identities; writer≠approver held in practice (writers are per-task agents, approvers orchestrator/ai:cli).
- Review queue flowing: 42 approvals vs 19 pending, all recent.
- Gates: enabled, ZERO bypass records. 13 AI judgments exist — guyin actually runs `lore review` more than the lore corpus itself does.

Caveats (friction signals):
1. **Handoff written-never-consumed**: 3 structurally rich handoff docs, zero back-references, zero session-resume consumption. Writer side runs; consumer side dead.
2. **Escalate is advisory-only**: a 0.68-confidence escalate judgment (scope mismatch between task AC and parent spec) blocked nothing; work proceeded. Judgments exist but do not gate.
3. **Anchor conflicts detected, not queued**: two concurrent sessions with overlapping file anchors were flagged by `lore ready` but nothing enforces pre-dispatch queueing.
4. AC modes are unevenly exercised: script ACs accumulate attested passes; ai/human-mode ACs sit at 0 runs (AC-OPS-1, AC-FALL-1) on an approved spec.

## babyai — RECLASSIFIED: not adoption-friction evidence (yet)

The grill session treated babyai's zero-task shape as potential execution-loop rejection. The audit refutes that framing:
- The corpus was migrated TODAY (2026-07-28, 06:01–07:34 UTC): 432 docs in one hour by `agent:docman-migration` under a user-authorized `LORE_GATE_BYPASS=1` backfill. The predecessor system (docman) had no task loop to migrate.
- 30 PRDs are genuine product docs (real commercial mother/baby health platform), not type misuse.
- Execution lives in external trackers by inertia: recent commits cite J-NNN / F-SRV-NN / Gap-N IDs, never lore slugs. H3 (loop too heavy / gates blocking) is NOT supported — zero gate refusals, zero friction traces.
- Verdict: H1 migration recency + H2 external-tracker inertia (high confidence). babyai is a Day-1 corpus, not a rejection sample. Re-audit after ~2-4 weeks of post-migration work is the honest test.

The one durable babyai signal: **50+ agent worktrees doing real work with ZERO `lore claim` operations** — the worktree→claim bridge does not exist in that project's automation. Actor auto-derivation (grill decision 5) directly addresses half of this; the other half (claim as part of worktree dispatch) is a workflow-distribution question.

## Three asymmetries repeating across ALL corpora

1. **Write-automation ≻ read-consumption** — lore: 28 system-generated pending docs, 40/40 orchestrator self-approvals, judgment:null; guyin: orphaned handoffs; babyai: 147 pending with judgment:null. The production pipelines run themselves; every consumption loop (review judgment, handoff resume, assessment reading) requires unprompted discipline and measurably does not happen. This is THE structural finding — it validates trace-first (decision 2/3) and tiered review (decision 4).
2. **Advisory-everything decays to ignored** — escalate doesn't block (guyin), judgments don't gate approve (everywhere), anchor conflicts don't queue (guyin). Mechanisms whose output is FYI-only get walked past under delivery pressure. Wiring judgment→approve for durable types (Phase 2) is the counter-move; SPEC-034/035 machinery already exists, only the wiring is missing (`ReviewService.approve` has no judgment requirement; spec-promote checks AC floors, not reviewer independence).
3. **Actor/claim discipline holds only where hand-enforced** — guyin proves the discipline CAN hold (zero bare usernames) at the cost of per-dispatch vigilance; babyai shows what happens without it (worktrees never claimed). Deterministic derivation (Phase 3) converts the cost to zero.

## Consequences for the execution run

- Phase 1 (trace) and Phase 2 (judgment wiring + tiered review) proceed as designed — both directly target asymmetries 1 and 2.
- Phase 3 (actor auto-derivation) gains the babyai worktree evidence as motivation; scope note: consider surfacing a claim-reminder when a lore-enabled repo's worktree does anchored work without a claim (needs trace data first — do not build speculatively).
- Promotion gate: guyin alone is a qualified pass on data integrity but the caveats (handoff consumption, advisory decay) are exactly what an external team would hit hardest. Distribution stays FROZEN until at least asymmetries 1-2 have mechanized counter-moves landed and re-measured via trace.
- babyai re-audit in 2-4 weeks post-migration is the real second-adoption test; schedule it after trace deployment so the re-audit has read-side data.
