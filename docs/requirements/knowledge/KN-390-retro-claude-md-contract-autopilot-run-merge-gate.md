---
id: KN-390
type: knowledge
role: knowledge
title: "Retro — claude-md-contract autopilot run: merge-gate chain violations, main-checkout build leaks, parentless corpus writes, triple-roster assets"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: [autopilot, orchestration, retro]
parent: PLAN-116
---
# Retro — claude-md-contract autopilot run (2026-07-27): orchestration-discipline findings

Plan plan-implementation-project-claude-md-content-contract executed end-to-end by autopilot (19 tasks, 4 waves, 0 blocked). Findings each with root cause + fix:

1. **Unconditional post-merge chains violated the merge-gate twice.** GOV-RED's archive ran after `git merge` FAILED (working-tree collision), and CLOSE's e2e evidence was recorded BEFORE its oracle ran (which then failed on an orphan doc). Root cause: multi-step bash blocks where corpus writes are not gated on the oracle/merge exit code — the exact 2026-07-19 incident shape, recurring because the discipline lives in prose. Fix applied in-run: recovery + corrective evidence entry. Mechanization candidate: an orchestration helper (or hook) that refuses `lore evidence --result pass` / archive transitions when the immediately preceding command in the same block exited non-zero — or simply the standing rule that evidence/archive commands NEVER share a bash block with their oracle.
2. **Subagent builds in the main checkout leak byproducts.** GOV-RED's initial `cd`-scoped build regenerated the MAIN checkout's assets-manifest (uncommitted), colliding with its own branch merge. Root cause: `bun run build`'s manifest self-check writes in-place wherever it runs. The worktree Write-guard caught the agent's file writes but not spawned-process writes. Recovered via stash (`autopilot-byproduct` entry; safe to drop post-HOOK).
3. **Corpus writers must parent their docs.** 5 snapshot docs + the UAT verdict doc landed parentless → tree-check orphans → self pre-push failed. Root cause: dispatch prompts specified `lore create knowledge` without `--parent`, and `lore uat record` does not parent its doc (only informs-links it). Fix: parented all six; prompt templates should carry `--parent`; consider UatService parenting to the plan.
4. **New asset ⇒ three rosters.** assets/governance/claude-md-contract.md required updates in RETIRED_FROM_INSTALL_PATHS (caught by GOV's baseline comparison), assets-ssot DECLARED_FILES (caught by full suite on main), and the embedded manifest (regen). Only the manifest is generated; the two hand-rosters fail one-by-one at different stages. Mechanization candidate: assets-ssot roster could derive from the embedded manifest + explicit exclusions, collapsing three declarations to one-plus-policy.
5. **Fixture realism is load-bearing for hook oracles.** HOOK-RED's probe disproved the "bare .lore dir suffices" assumption (three prior checks each fail wrong-reason in bare fixtures); UAT journey J3 hit the same wall twice (missing `version: 1`, template min-1-spec). The knowledge is now encoded in pre-push-claude-md-trip fixtures — reuse them for any future pre-push step.
6. **Gate feeding packs drove every recovery correctly** (requires_uat, attestation-floor plan-level exemption shape `attestation_exempt: true` + `attestation_exempt_reason` sibling, prd_sync_exempt dedicated-writer byte-equality). One paper cut: my first exemption guess used an object shape; the pack names the verb but not the field shape — packs could quote the exact fields.

Assess doc: knowledge-assessment-implementation-project-claude-md-content (4 non-blocking recommendations, incl. per-AC evidence granularity for docs tasks and diff-range cross-session pollution).
