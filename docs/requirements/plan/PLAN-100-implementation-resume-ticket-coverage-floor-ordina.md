---
id: PLAN-100
type: plan
role: plan
title: "Implementation — resume-ticket coverage floor (ordinal render + Stop-time enforcement)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: SPEC-112
phases:
  - {name: "render"}
  - {name: "enforce"}
  - {name: "ship"}
---
## Goal

Give the resume ticket a lower bound to match the upper bound `spec-context-provenance-injected-corpus-global-state-and-a` already shipped: render items as ordinal-tagged lines with a cardinality line derived from the structured SSOT, and enforce per-item disposition externally at Stop time rather than by consumer self-report.

Success is the measured failure becoming impossible to reproduce silently: a session that consumes a 10-item ticket and accounts for 7 must be blocked and told which 3 are missing.

## Approach

**Six tasks across three phases** (amended 2026-07-31 — see §Scope amendments). The render half and the enforcement half touch disjoint files and run concurrently.

- **render** — T1 lands the exported constants and the pure cardinality renderer in `@lore/core`; T2 consumes them in `renderResumeRecord` and on the MCP surface. T2 depends on T1.
- **enforce** — T3 lands the `lore handoff coverage-check` verb as the SOLE owner of the item-id and disposition grammar. T5 lands the Stop hook as a blind pipe to that verb (no grammar of its own). T5 depends on T3.
- **ship** — T4 lands the governance rule, regenerates the assets manifest, and proves fresh-install distribution against the compiled binary. T6 wires the hook into `lore setup`'s `settings.json` auto-registration and declares the new asset in every hardcoded roster. T4 depends on T5 (the hook file must exist before it can be embedded); T6 depends on T4.

## Scope amendments (2026-07-31)

The plan as promoted declared four tasks and the spec's eight ACs. Execution delivered **six tasks and fourteen ACs**. Both expansions closed gaps the original decomposition could not see, and are recorded here so this plan stays the scope SSOT rather than forcing reconstruction from task bodies:

- **T3's named deliverable was retired, not dropped.** The plan's T3 was "turn-state recording plus the new Stop hook". Spec D8 removed all cross-process state after measuring that `assets/hooks/lib/turn-state.mjs` is unbuildable as specified here — `resolveSessionId()` reads `CLAUDE_SESSION_ID`, which is UNSET in this harness (the field actually provided is `CLAUDE_CODE_SESSION_ID`), so every caller falls through to a `ppid-$PPID` branch, and a Stop hook and a Bash-tool `lore` resolve DIFFERENT ppids. T3 therefore became the coverage-check verb alone, and the hook moved to **T5** as a blind pipe. AC-RC-9/AC-RC-12 were added for the verb's round-trip and multi-actor halves; AC-RC-10 for the hook's grammar-absence and relay behaviour.
- **T6 exists because "installed" was mistaken for "wired".** T4 proved the hook lands byte-identically in a fresh install (AC-RC-8) — but `HOOK_REGISTRATIONS` (`packages/core/src/distribution-hooks.ts`) never listed it, so `lore setup` copied the file and wrote no `Stop` entry: the hook installed and could never fire. That is the silent-inertness class spec D6 forbids, and it defeated this spec's own Delivery constraint (a fresh `lore init` + `lore setup` project must be unable to reach the original defect). Found independently by the orchestrator and by T4's consumer audit. **AC-RC-13** (registration derived from `HOOK_REGISTRATIONS`, with a `stop-doc-sync` control) and **AC-RC-14** (the asset declared in every roster, exactly 2 matched files) were added, and T6 delivered them.

## Risks

- **Anchor overlap on the manifest.** `packages/lore/src/generated/assets-manifest.ts` is a build byproduct that any task running `bun run build` will dirty. Only T4 declares it as an anchor; T1-T3 and T5 must commit path-scoped and must not commit incidental manifest churn.
- **Single-surface regression.** SPEC-CP D3 measured that a CLI-only assertion leaves MCP consumers on old behaviour. AC-RC-4 asserts per surface; T2 is not done until both pass.
- **Detector liveness.** A Stop hook that exits 0 because it crashed early is indistinguishable from one that exits 0 because coverage was complete. AC-RC-7 requires all three runs (incomplete → non-zero, complete → zero, no-ticket → zero) in one test.
- **Branch base.** `RESUME_SCOPE_CLOSURE` existed only on `fix/governance-never-discard-lore-output`, not on `main`, for the whole execution window. Every worktree had to branch from that tip or the target code is absent — and a dispatch that correctly passes `isolation: 'worktree'` still lands on the WRONG BASE, because the harness cuts the worktree from the shared checkout's current HEAD. Isolation and base-correctness are independent axes; only the first had a mechanism (`knowledge-worktree-isolation-delivers-a-worktree-not-a-base-and`). Resolved for this plan by making base correction a deterministic `git merge --ff-only <tip>` plus a `git log --oneline -1` assertion in every dispatch bundle.
- **Rosters are anti-cheat tripwires, and a green oracle cannot prove they were respected.** AC-RC-14 and AC-RC-6 both encode negative constraints (declare-don't-derive; zero-hit searches) that a passing run is equally consistent with the cheat. The working diff is required evidence for these, not optional — recorded in the assessment's process recommendation.

## Acceptance

The governing spec's **fourteen** ACs (AC-RC-1 … AC-RC-14), all script-mode, verified by `lore verify` (attested: 14 passed / 0 failed, runner-issued).
