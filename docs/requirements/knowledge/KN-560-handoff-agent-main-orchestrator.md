---
id: KN-560
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-25
updated: 2026-10-10
tags: []
parent: PLAN-148
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 7 next steps = 12 items to account for

## Plan

plan-land-the-two-mirror-command-surfaces-one-row-contract-for

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | PLAN-148 CLOSED. Six ACs, four tasks, all archived through plan-close. assess 89 outcome / 80 evidence_integrity / 88 scope_fidelity. Both runners green on main: vitest 9484 tests, bun 2122 tests, each re-measured after I fixed the two reds I had introduced myself@0.9 | — |
| KD2 | The lore list --json root fix landed: 23,180,068 bytes -> 334,199 over 556 rows, ten canonical keys, no content/extra. The consumer's own 20MB spawnSync probe went status:null/SIGTERM/ENOBUFS -> status:0. --check --type adr is 0.26s vs ~16s full@0.95 | — |
| KD3 | ONE raw NUL byte at offset 15160 made BSD grep suppress every match SILENTLY, exit 1, byte-identical to 'pattern absent'. I concluded a live false-green from it, rewrote a spec twice and opened a whole spurious task. The coverage had been there all along@0.95 | — |
| KD4 | I steered three agents into SELF-REPORTED reds by prescribing --output-tail-file in every bundle. --capture satisfies the same tail requirement AND attests. 8 of 9 expected-fail rows are self-report; the one attested red came from the agent that ignored my template@0.95 | — |
| KD5 | Machine-checking assess paid again: of four findings, the MAJOR was right and one minor was exactly BACKWARDS (AC-MOS-1's label set IS asserted by equality, list-json-row-contract.test.ts:628). Two of four survive contact with a decidable check@0.9 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1: THE PLAN DID NOT MEET ITS OWN STANDARD. It required an attested expected-fail per criterion and got one of nine; the other eight are capture_source:self-report because my bundles said --output-tail-file. The reds are real and each names its observed failure, but none is runner-attested. Decide: re-run the eight mutations with --capture against the archived tasks, or accept and record the shortfall. ⛔ Do not let the next bundle repeat it — a red probe records with --capture, mutation IN PLACE; --capture and --output-tail* are mutually exclusive so this is a choice, not an oversight
- NS2: NS2: check:no-nul-bytes is BLIND to untracked files — measured paired: a NUL file untracked gives exit 0 and 'considered 3410 tracked file(s)'; the SAME file staged gives exit 1. So an agent authoring a NEW file and checking before commit gets a vacuous green. That is exactly how the NUL reached main. NOT BUILT: the checker should count and report SKIPPED-because-untracked candidates, or scan them
- NS3: NS3: lore evidence --output-tail keeps the LAST 4000 chars while vitest prints its compact failure list FIRST, so a multi-conjunct red's attribution falls outside the window BY CONSTRUCTION. --reporter=dot still expands; --reporter=github-actions has no summary line and violates the tail-must-carry-a-summary rule. NOT BUILT: a head+tail window, or per-assertion structured results
- NS4: NS4: the mirror exit-code SSOT is split — MIRROR_DRIFT_EXIT_CODE and its neighbour live in scripts/export-spec-mirror-core.ts, MIRROR_USAGE_EXIT_CODE=3 in scripts/export-spec-mirror.ts. The implementer mechanized the non-collision (AC-MOS-3 asserts 3 differs from both core codes, so a future core code taking 3 turns it red) but the clean fix is moving all three to core
- NS5: NS5: I declared a code anchor to a NON-EXPORTED symbol (list.ts#toListJsonRows) after verifying only that the symbol EXISTS. lore status --check-drift caught it as symbol_missing and turned bun test red; retargeted to the file. ⛔ Verify EXPORTEDNESS, not existence, before declaring a #Symbol anchor — the lexical scanner needs an export
- NS6: NS6: STILL FILED, not done — task-the-mirror-check-absorbed-the-content-probe-in-90951390 owns splitting --check's parity half from its content probe (27.9s per pass, of which 0.41s is the corpus read). This plan deliberately scoped that OUT and closed only the argv half. Its two options and its falsifier design are already written
- NS7: NS7: GIT — main is 70 commits ahead of origin/main, tree clean, dist/lore rebuilt from HEAD ac6774da, all worktrees removed. Any dispatch MUST write 'git rebase main' into the bundle and verify 'git rev-list --count HEAD..main' == 0, or push first (outward-facing, needs the user)
