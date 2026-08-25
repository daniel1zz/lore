---
id: KN-554
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-144
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 7 next steps = 12 items to account for

## Plan

plan-make-the-phase-write-version-row-audit-entry-pairing

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | PLAN-144 CLOSED. AC-PHASEVER-4 landed: 24-test suite, attested red recorded BY the implementer at the moment observed (12 failed, 3 misses, chain.checked flat 5,5,5,5), then attested green. Task+plan archived through plan-close. Assess 72/85/95, evidence trust 3 runner / 0 self-report@0.95 | — |
| KD2 | I wrote that 'bun run mirror:export fixes drift permanently' and DISPROVED IT 30 min later. Write mode exits 0 printing OK while leaving every drifted BODY — its own output says 'file CONTENT is not compared'. Only 'lore export-docs --force' reconciles bodies@0.95 | — |
| KD3 | 'bun run test' cannot return a verdict here: a 4-link && chain ending in check:spec-mirror, which reddens on ANY corpus doc creation anywhere. Measured: vitest exited 1, so test:bun and check:spec-mirror NEVER RAN. Root CLAUDE.md called it 'both runners' — corrected@0.95 | — |
| KD4 | The pairing SPEC-148 just made oracle-enforced holds at 1 of 18 writer sites: 3 files call store.updateWithProvenance, 15 services still do update+insertVersion+appendAuditEntry separately. Not severed in the happy path, but a failure between calls reproduces C5 exactly@0.85 | — |
| KD5 | assess's three MAJORs (AC-PHASEVER-1/2/3 at 0 pass / 0 fail) are BACKWARDS. Machine-checked: lore ac list reports (2/0, 2 attested) for all four; the runs sit under the PREVIOUS plan and coverage counts by plan lineage. The standing 'assess MAJOR can be backwards' lesson reproduced@0.9 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: main is RED and NOT mine. bun scripts/check-anchor-coverage.ts exits 1 on 3 live specs with no ledger disposition: spec-a-conclusion-with-no-currency-signal-and-no-falsifier, spec-a-github-filed-defect-must-be-claimable-one-ingest-seam, spec-governance-weight-must-scale-with-measured-blast-radius-a (created 2026-08-24, measured cohort debt). I deliberately wrote NO dispositions — the second is the spec a concurrent session is actively implementing, and a ledger row is a judgment about that spec's anchorability
- NS2: NS2: FIX THE FALSE LABEL at scripts/tests/spec-mirror-export.test.ts:117 — 'exitCode: result.status ?? 1' turns a maxBuffer kill (status null) into 'the CLI exited 1'. Measured: lore list --type knowledge --json --include-invalid emits 22,797,488 bytes against the helper's explicit 20 MB maxBuffer, so 3 tests report a CLI failure that never happened (by hand it exits 0). Raising the ceiling buys time; fail loud on status === null. Trigger is corpus GROWTH, so it worsens silently
- NS3: NS3: PRD-001 section 5 states the OPPOSITE of measured behaviour — it says the export snapshot shows the raw ChildrenOf tag; the mirror carries a 594-line expansion (corpus body 15311 bytes vs mirror body 94043). Editing the root PRD was outside this ticket's scope. Recorded as F1 of knowledge-prd-001-s-prose-contradicts-the-exporter-it-describes
- NS4: NS4: test:bun HAS NO VERDICT this session. It was SIGTERMed at 10 minutes inside libsql-compat.bun.test.ts with no summary line, three concurrent peer worktrees running. Do NOT read my green vitest results as 'the suite passes'. The new file is a vitest .test.ts and never enters the bun runner, and the merge changed no source — low risk, but UNMEASURED, not passing
- NS5: NS5: GIT — main is 23 commits ahead of origin/main and worktrees are built from origin/main, so any dispatch MUST write 'git rebase main' into the bundle and verify the agent's reported HEAD, or push first (outward-facing, needs the user). It worked this session: the implementer rebased and reported the exact expected SHA before measuring anything
- NS6: NS6: THREE peer worktrees are live and NOT mine — agent-a735890a65628bd1e (locked), agent-aa7c378ac76ed5407 (locked), agent-a9bbc13b613329470 (merged, unlocked). Do not remove any. A concurrent session merged on top of mine mid-session and swept my untracked mirror files into its own commit 5d9a6ce3
- NS7: NS7: root CLAUDE.md is at 23761/24576 bytes, 815 free, and the 0.97 eviction floor is 23838 — it sat 24 bytes UNDER the floor before I touched it, so ANY addition trips exit 3. Budget an eviction into the SAME slice as any new standing lesson. Both evictions here were free because the Standing-lessons section declares its own shape rule and two entries were plainly violating it
