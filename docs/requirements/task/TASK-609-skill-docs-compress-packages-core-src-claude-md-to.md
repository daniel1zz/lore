---
id: TASK-609
type: task
role: plan
title: "[Skill:docs] compress packages/core/src/CLAUDE.md to module ceiling (contract remediation)"
status: archived
priority: high
phase: "Phase 3: Convergence & Verification"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-606, type: blocks}
---
Estimate: S
Approach: apply the landed content contract (read it: lore governance claude-md via 'bun run dev governance claude-md' or the asset assets/governance/claude-md-contract.md) to packages/core/src/CLAUDE.md (currently 18247 bytes, module ceiling 16384B / 200 lines). Same method as the root-file compression (see knowledge-retro-claude-md-spec-index-re-bloat-boundary-adr): (1) snapshot the CURRENT file verbatim into corpus: lore create knowledge --sub-type reference --title "Module CLAUDE.md snapshot — packages/core/src (frozen 2026-07-27, pre-compression)" --content-file <file> --by $LORE_ACTOR; (2) rewrite the module file per module taxonomy: Purpose / Key Invariants / operational conventions / commands stay; narratives, per-spec histories, long mechanism walkthroughs become one-line pointers into the corpus (lore search terms or doc slugs) or are deleted when code-derivable; (3) verify.
Source: contract asset + module taxonomy; root-compression precedent 2026-07-26
Dimensions: D-DOC
Scope-Alt: none — ceiling is the plan invariant enabler for CLOSE's push AC
Covers: AC-CMC-3 (repo-conformance half, enables CLOSE integration AC)

AC:
- Given the rewritten file, When 'wc -c' and 'wc -l' run, Then bytes <= 16384 AND lines <= 200
- Given 'bun run dev status --check-claude-md --json' from the worktree repo root, When findings are filtered to path == "packages/core/src/CLAUDE.md", Then zero entries (other modules' findings may remain — assert absence of YOUR path only)
- Given the corpus snapshot doc, When 'lore get <snapshot-slug>' runs, Then it contains the pre-compression content verbatim (byte count matches the original within the doc body)
- Integration: every operational invariant/command that survives is verbatim-preserved or tightened, never paraphrased into vagueness; nothing in the file references the snapshot as if still inline
