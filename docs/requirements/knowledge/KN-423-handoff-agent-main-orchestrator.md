---
id: KN-423
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: PLAN-122
---
# Handoff — agent:main-orchestrator

SCOPE: 9 decisions + 9 next steps = 18 items to account for

## Plan

plan-land-governance-distribution-shipped-defaults-that

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/CLAUDE.md
- packages/lore/src/service/ordinal-migration-service.ts
- packages/lore/src/repo-pollution-guard.ts
- scripts/oracle-lock.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | The ticket's three un-owned clusters became FOUR approved tech-specs (C split into a judgment surface and a distribution surface sharing no code): S1 mirror-identifier-SSOT, S2 oracle-exclusivity, S3 judgment-verification, S4 governance-distribution. 12 tasks, 4 archived | 95 |
| KD2 | 8 attested passes (AC-MIS-1/2/4/5, AC-OX-2/3/4) plus 1 runner-attested RED (AC-MIS-2 via lore verify --falsify, exit 1 = declared value). 8 merges on main, tree clean | 95 |
| KD3 | ⛔ I WAS WRONG ABOUT tsc EXIT CODES; an implementer refuted me. bunx tsc downloads its OWN TypeScript. Under --noEmit both TS2322 and TS18003 exit 2 — discriminate by ERROR CODE, never exit code. KD3's recorded exit 2 was right all along. Retro s1 | 98 |
| KD4 | ⛔ RETRACTING a gap I reported: approve exiting 0 on a reject review is DESIGNED (SPEC-103 M2, service/CLAUDE.md:15) — judgment_required_types scopes reject only, one escalate blocks every type. I reported it without reading the owning module doc. Retro s2 | 95 |
| KD5 | S3's attestationFloor falsifier clause is DEFERRED, not neglected: the corpus records NO per-criterion authorship timestamp, so no arming-window exemption predicate is decidable. Three blockers recorded in that spec's Deferred section. Retro s3 | 92 |
| KD6 | KD7's ordinal reversion loop is FIXED AND MERGED — composition via formatMirrorHumanId, round-trip byte-identical, AC-084-4 re-baselined with a record the suite self-asserts. The compile-time MirrorHumanId brand is NOT merged, see NS-BRAND | 95 |
| KD7 | ⛔ THREE independent live reproductions of KD4 from three worktrees: the mirror oracle writes the production corpus and .lore/lore.db resolves UP to the main checkout. One agent could not isolate the culprit among 333 files. Retro s6 | 95 |
| KD8 | Two tooling gaps cost real work: SPEC-061's completeness guard counts every test-file-shaped argv token, and the D8 path check is cd-blind so a cd-prefixed escape can never be redeemed. Retro s5 | 92 |
| KD9 | packages/lore/src/service/CLAUDE.md was OVER its byte ceiling on main (15350 vs 14746, eviction-floor red). Cause: a line documenting the very gap this session fixed. Repaired by eviction per that file's own rule; 14723, 19/19 green, committed | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-BRAND: worktree-agent-a482d6762957282f0 has 3 commits, NOT merged. AC-MIS-3 green; AC-MIS-6 honestly recorded --result fail because branding breaks tsc in 5 pre-existing test files. Agent resumed with anchor extended. Do NOT merge a red typecheck; its fail row MUST survive as the audit trail
- NS2: NS-INFLIGHT: a8677ad43818c68ec (AC-JV-1/AC-JV-2) and a681879576106adaf (AC-JV-3) still running. Merge, verify with --task and --ac filtering, lore done, remove worktree and branch. Run git branch -a plus git log main..<branch> for EVERY branch unconditionally, not only ones an agent named
- NS3: NS-MIRROR-THEN-READONLY: the mirror is STALE (4 specs, 4 plans, 12 tasks, 1 retro written). Run bun run mirror:export on main and commit, and only THEN dispatch S2's task-make-the-ac-fr-10-mirror-oracle-drive-the-read-only-check — AC-OX-1 asserts the live tree is clean. Never export from a worktree
- NS4: NS-S4-PLAN: plan-land-governance-distribution-shipped-defaults-that is DRAFT, blocked by JUDGMENT_ESCALATED. The answer is already in the spec (a PROJECT_SPECIFIC_KEYS allowlist with per-entry rationale; the checker fails on a rationale-less entry). Needs one more review round. Its 3 tasks are ready, none dispatched
- NS5: NS-ORCH-LEDGER: orchestrator-owned S4 corpus edits — rename gap-ledger G<n> to GAP-<n> and cite BOTH forms at the ledger head or references dangle, add id/status/owning_spec, fix GAP-19's scope line which names a non-existent branch, mark GAP-11 closed ONLY after the defaults phase merges, then drop the two redundant .lore/config.yaml overrides
- NS6: NS-FULL-SUITE: no full-suite run on the merged tree yet. Run on main AFTER the mirror re-export and all merges, clean tree at a named commit, per-stage exit codes persisted. Also cover the ~132 binary-consumer test files every agent skipped: they need bun run build, which no agent was permitted to run
- NS7: NS-ASSESS: lore assess each of the four plans once its tasks are archived. Machine-verify every finding that names a path before scoring it — the incoming ticket carried an assess MAJOR that was exactly backwards
- NS8: NS-STILL-UNOWNED: gap-ledger GAP-7, GAP-8, GAP-15, GAP-16, GAP-18 and KD6's G17 (7 of 8 lore feed checkpoints return 43-48 bytes at exit 0 — the silent exit 0 is the dangerous half) still have NO owning spec, plus the deferred attestationFloor clause. S4 only makes them referenceable and visibly unowned
- NS9: NS-TOOLING-GAPS: unfixed, worth a spec — lore ac set refuses --mode even when unchanged; ac set overwrites the D8 escape reason on a statement-only edit (gap G8); --falsifier-exit-code cannot assert failure IDENTITY; lore verify --falsify takes the AC id as its VALUE; the review prompt truncates the parent spec so a bare D<n> is unresolvable
