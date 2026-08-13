---
id: KN-038
type: knowledge
role: knowledge
title: "Retro — SPEC-040 instrument-first bootstrap (PRD v0.8 + 3-lens spec review + T1-T3 worktree delivery + v6 first live run)"
status: approved
priority: medium
created: 2026-07-10
updated: 2026-07-14
tags: [retro, spec-040, instrument, autonomy, worktree]
parent: PLAN-020
---
## Context

Single session (2026-07-10): owner directive "full Lore self-hosting + score-gated autonomy + instrument-first". Delivered PRD v0.8 (§14.7/§15/§16), SPEC-040 (3-lens adversarial review, 1 CRITICAL + 4 HIGH fixed pre-approve), and the full SPEC-040 implementation (T1/T2/T3, serial worktree agents), closing with the v6 instrument assessing its own delivery plan.

## What shipped
- PRD v0.8: §14.7 assessment dimension framework v2, §15 session layer (G10), §16 memory hygiene (G11).
- SPEC-040 approved (13 ACs) + implemented: deterministic facts (computeAssessmentFacts), 3 grounded judge dimensions with based_on declarations, typed_gaps/typed_recommendations + legacy derivation, ac_scope, ASSESS_TEMPLATES registry (v5 frozen, v6 active), review truncation notice, golden harness (6 synthetic fixtures) + pure aggregation (3-run majority, non-inferiority), extended clip.
- Oracle trail: 12/13 ACs runner-attested on the plan + re-attested per-task; full suites green at each merge (final: vitest 3141, bun 757, typecheck 5/5).

## Learnings (durable)
1. **The review surface reproduced assess's truncation failure mode** — PRD v0.8 review escalated 0.60 purely on truncation artifacts (E6). Fixed in-scope (D8). Instrument defects cluster by family: when one judge surface gets a transparency fix, audit the siblings.
2. **Ungrounded judge dimensions are fabrication invitations** — 2 of 5 planned dimensions (knowledge_capture, regression_risk) could not be grounded in bundle-visible material and were demoted to deterministic facts BEFORE shipping, on adversarial-review evidence. Rule: no judge score without visible grounding material; compute what code can compute.
3. **Worktree bun install trap** — a fresh worktree silently resolves @lore/* through the PARENT repo's node_modules symlinks (edits invisible, phantom module-not-found). Run `bun install` inside the worktree first. (Bit T2; pre-warned T3.)
4. **bun test HTTP-server flake** — ephemeral-port bun:sqlite HTTP tests can fail in bulk (19) then pass clean twice; attribute via clean-baseline rerun before debugging "your" failures.
5. **v6 first live run validated the design goal**: the judge consumed deterministic facts (attested ratio 0.71 cited verbatim), used based_on correctly, and its typed recommendations were immediately actionable — one (re-attest T1/T2 oracle claims) was executed the same session via lore verify --task. The instrument now criticizes the process that runs it — the feedback loop's consumer side has its first native producer.
6. **Curated source-only diffs make tests_touched=false** — the regression signal reads the diff you provide; when curating for budget, the facts reflect the curation. Feed the full file list (or a pre-classified DiffMeta) even when content is curated.

## Open items
- AC-ADF-9 (human): owner side-by-side v5↔v6 comparison — the only unevidenced AC; plan stays active until recorded.
- Golden scored-mode live run (`--candidate 6 --incumbent 5`) deferred until a few real v6 assessments accrue via source_versions.
