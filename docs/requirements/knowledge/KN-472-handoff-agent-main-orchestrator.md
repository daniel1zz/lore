---
id: KN-472
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-18
updated: 2026-10-10
tags: []
parent: PLAN-124
links:
  - {id: KN-466, type: supersedes}
---
# Handoff — agent:main-orchestrator

SCOPE: 9 decisions + 8 next steps = 17 items to account for

## Plan

plan-land-oracle-exclusivity-a-mirror-check-that-can-fail-a

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SPEC-143 corpus-truthfulness is APPROVED with 7 script-mode ACs, plus ADR-034 (stamp-less rows classified by an immutable arming cutoff) and ADR-035 (staleness by blast radius, never ancestry). Full architecture-mode run: 6 parallel role evaluations, 8 trade-offs, 3 review rounds | 96 |
| KD2 | plan-land-oracle-exclusivity is CLOSED (archived): 6 tasks archived, all 7 ACs attested, every phase non-empty. AC-OX-7 was split out of AC-OX-4 and I ran its falsifier MYSELF — git-common-dir to git-dir exited 1, the red hitting the discriminating test, not the semantics-free one | 97 |
| KD3 | The review judge caught TWO real errors of mine. First, an ADR escalate: my G3 (unbound satisfies no floor) contradicted N2 (no retro-fail) — the outcome I had used to reject hard refusal. Fixed with an arming_rev cutoff on append-only hash-chained audit.id, which a timestamp cutoff cannot do | 97 |
| KD4 | Second judge catch: the spec went approve to REJECT because I changed 4 ACs without updating the body — G3/C2/QA-6/title still said unbound satisfies no floor while AC-CT-3 now requires accepting the legacy half. An implementer following the body would build the rejected design. Fixed 11 places | 96 |
| KD5 | The falsifier facility CANNOT be declared for unbuilt capability: falsifier-find requires the literal string already on disk. That deadlocks with red-first, which requires the AC before the code. All 7 SPEC-143 falsifiers are PROSE and nothing forces redemption | 97 |
| KD6 | The AC coverage badge is broken and now visible on a CLOSED spec: SPEC-136 renders AC-OX-1 and AC-OX-6 as failed while BOTH hold attested passes. acCoveragePrefix reads fact.fail above zero, never consults fail_superseded, and fact.fail never decrements, so the mark is permanent | 98 |
| KD7 | A spec approved BEFORE an ac add can never have that AC reviewed: ac add does not demote, and approved to in-review is not a legal transition, so the only path is ac set, which demotes to draft and hard-blocks every descendant claim. Unreachable by design, not an author oversight | 96 |
| KD8 | My own measurement error: I queried a phase distribution with a plan id whose suffix I had invented. It returned EMPTY and I nearly read that as no tasks. Empty output and clean output are the same shape. Re-ran with the real id and the two empty phases were confirmed | 95 |
| KD9 | CLAUDE.md now carries a North Star section at line 11 plus a 10-line eviction: 9 lessons had NO enforcing mechanism and moved to a dedicated ledger doc. That count is the honest distance to unattended operation. Budget went from 809 to 1735 spare bytes | 96 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: Cut the plan for SPEC-143 — it has ZERO plans today. Phase 1 touches no schema: (a) evidence-capture writes a real attestation from data it already measures, about 10 lines; (b) acCoveragePrefix delegates to deriveAcCoverageState AND SPEC-038 AC-ACODE-9 is amended in the SAME commit, because that JSDoc cites the AC and fixing one alone makes the other a falsehood; (c) the renderer site-scan ratchet. Run /lore-plan.
- NS2: NS2: UNCHANGED and re-confirmed with the CORRECT id 01KZN4F66XA0S1E7N61EZ3M3S8 — do NOT close plan-land-oracle-executability. Its tasks sit in mechanism (4) and (none) (1), while declared phases corpus-cleanup and backlog-and-arm hold ZERO each. Decompose those two first.
- NS3: NS3: Redeem the three non-blocking advisories on SPEC-143, all recorded in knowledge-a-declared-property-with-no-measuring-oracle-and-the: AC-CT-6 size-independence names a property with no measuring oracle; AC-CT-1 global-uniqueness may be asserted by nothing, since the AC-CT-7 scan covers fail/pass reads and not duplicate glyph projections; AC-CT-4 has no classification for an UNRESOLVABLE radius, where bound and unmeasured carry opposite safety consequences.
- NS4: NS4: Build the falsifier-debt mechanism, which needs its own spec: either lore status --check-falsifier-debt, reporting any script-mode AC whose command path now EXISTS on disk but carries no structured falsifier, or a --falsifier-deferred flag storing the intended mutation unvalidated. Option 2 is better because it captures intent while it is clearest.
- NS5: NS5: Two worktrees remain and are NOT mine — agent-a12a6a61151ccde06 and agent-afbb01d374cc33e89. Both have 0 unmerged commits and are merged into main, last reflog 2026-08-17 14:11 and 14:29. A concurrent session owns them, so confirm ownership before removing. Mine, agent-adc3194ed5fab9ce2, is already removed.
- NS6: NS6: PRD-001 body drift is STRUCTURAL, not neglect — it embeds a ModuleTree MDX placeholder, so its rendered body re-drifts on EVERY corpus write. Zero body drift is unreachable by construction for placeholder-bearing docs. Stop force-repairing it expecting convergence.
- NS7: NS7: Raw readiness, never inferred — exclusivity 01KZR6QS8H records 6 ready 0 archived 6 (plan ARCHIVED); executability 01KZN4F66X records 5 ready 0 archived 5 (approved); multi-session-p1 01KZV0A0KC records 9 ready 0 archived 9 (active); peer plan 01KZQF85CB records 6 ready 0 archived 6 (approved, all children terminal but the plan unclosed) and is NOT mine. Pending review queue holds 26 docs.
- NS8: NS8: README.md is modified in the working tree by a PEER session and deliberately untouched, so a full-suite verdict requiring a clean tree at a named commit remains unobtainable. Last compliant coverage: full suite green at 08091dfd, plus the peer session 19 new tests and check-anchor-coverage green on the merged tree.
