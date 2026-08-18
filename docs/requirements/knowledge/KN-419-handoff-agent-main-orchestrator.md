---
id: KN-419
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-11
updated: 2026-08-18
tags: []
parent: PLAN-076
---
# Handoff — agent:main-orchestrator

SCOPE: 8 decisions + 8 next steps = 16 items to account for

## Plan

plan-land-falsifiability-reachability-the-attested-red-runner-a

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/ordinal-migration-service.ts
- packages/lore/src/service/export-docs-service.ts
- packages/core/src/ordinal.ts
- scripts/tests/spec-mirror-export.test.ts
- .lore/export-index.json

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS1 COMPLETE: merge cedb29db + mirror catch-up 01f056d9. Exclusive verdict on clean tree 01f056d9, per-stage exit codes = 10/10 zero (typecheck 7/7, vitest 494f/8698, bun test 1873 pass 0 fail, check:spec-mirror). AC-FR-10 attested pass 19498ms. Task archived v15. First assess partially_met 74/100. | 95 |
| KD2 | The NS1 blocker cleared itself: the peer committed CLAUDE.md path-scoped as 8bfdfe8f; three hunks auto-merged. No cross-session intervention was needed or performed. | 95 |
| KD3 | Measured TWO concurrent full-suite runs in one checkout: peer pid 39206 (ppid 39174 = a different Claude Code session) at 15:32:06 vs mine 58812 at 15:32:42. The peer NON-gitignored broken probe fixture made my typecheck exit 2. That red was FALSE; the solo re-run is 7/7 = 0. | 95 |
| KD4 | Suite and corpus are mutually exclusive when the mirror is stale: the AC-FR-10 oracle exports into the LIVE tree by AC mandate while spec-loop-e2e:341 asserts .lore/ is clean. Any corpus write reddens the next full run until an export is committed. | 95 |
| KD5 | The assess MAJOR on AC-FR-10 is REFUTED, do not action it: the named file exists at neither HEAD nor worktree and an independent scan finds 0 filename-vs-id mismatches. The judge read the SOURCE side of rename R099 in b791d657 as the result, i.e. the very name this merge fixed. | 95 |
| KD6 | G17 re-measured on all 8 registered checkpoints: only spec-create feeds (900 bytes); the other 7 return 43-48 bytes of no-approved-governing-skill at exit 0. An unregistered name exits 2. G1 stays HALF-CLOSED and the silent exit 0 is the dangerous half. | 95 |
| KD7 | The ordinal seam is now a REVERSION LOOP armed by this merge: ordinal-migration-service.ts:743/754/758 writes UNPADDED ids into the export index while export-docs-service.ts:1031 self-heals to PADDED. Unpadded is pinned by the GREEN attested AC-084-4, so the fix is a spec change. | 90 |
| KD8 | Counters re-measured: capture_source runner 265 to 301, self-report 3734 to 3747, so self-report share fell 93.4 to 92.6 pct. pass_unfalsified is 29 with an enumerable member list, 11 in SPEC-038. New and not in the prior ticket: unredeemed_allow_missing_path_count = 7. | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: Do NOT close any of the four plans. This plan has zero non-terminal tasks and lore done printed the paste-able close command, which must not be copied. Its first assess is partially_met 74/100 with three typed recommendations unactioned and one MAJOR this session refuted.
- NS2: The ordinal reversion loop needs an OWNING SPEC before any fix. Scope: ordinal-migration-service.ts:743/754/758 vs export-docs-service.ts:1031 plus the AC-084-4 pin at migrate-ordinals.bun.test.ts:205-207. Oracle: after a padded export, migrate-ordinals must not change the index.
- NS3: Mechanize oracle exclusivity in a shared checkout: every test fixture path gitignored AND unique per run (pid or mkdtemp), plus a checkout-level oracle lock so a second concurrent full-suite run fails LOUD instead of interleaving.
- NS4: Split ownership of .lore/export-index.json: the AC-FR-10 oracle must export into a temp copy, or the guard whitelists the index and a separate mirror-freshness check owns it. Also widen the guard beyond .lore/ - mirror-content dirt (M SPEC-134 after the green run) is invisible to it.
- NS5: Make assess self-checking: any finding naming a path must be machine-verified against the assessed commit, then dropped or flagged unverifiable. Also exclude the generated mirror from the assess diff instead of truncating 5.3M chars to an 80k budget.
- NS6: Restore the report-issue channel: lore report-issue --list refuses (feedback.upstream unset) in lore own repo while the binary prescribes --auto-config six times per suite run, and that remedy writes the shared .lore/config.yaml. TASK-643 to 646 show it worked 2026-07-26 then lapsed.
- NS7: G11 still does not ship: the code default at config.ts:461 is 600_000 and only .lore/config.yaml:44 carries 1200000. G7/G8/G15/G16/G18/G19 plus this session findings still have no owning spec.
- NS8: Keep the three bundle additions that worked (mandatory --capture, one unfiltered whole-file run per test-file anchor, do-your-work-in-context) and add a fourth: after any full-suite run, re-export and commit the mirror.
