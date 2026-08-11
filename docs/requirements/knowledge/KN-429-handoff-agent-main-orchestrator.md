---
id: KN-429
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-122
---
# Handoff — agent:main-orchestrator

SCOPE: 8 decisions + 10 next steps = 18 items to account for

## Plan

01KZRA6287

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | GAP-25 RETRACTS my own earlier report: mirror:export exits 0, reports parity OK, but does NOT rewrite an existing file's content — identical before/after md5 across a 65-token rename. It writes NEW files only. check:spec-mirror says outright CONTENT is not compared | 98 |
| KD2 | Corollary of GAP-25: SPEC-137 lacks D6, PLAN-122 lacks D4a, SPEC-138 holds an intermediate state. The ONLY path that ever synced mirror content is the FORBIDDEN one — export from a worktree. Existence oracle, no content oracle | 98 |
| KD3 | ⛔ .lore/config.yaml is NOT git-tracked. An implementer refuted the spec, the task AND my bundle, and was right: .gitignore:9 .lore/*, ls-files shows only export-index+audit-anchor, log --all empty, show main: fatals | 98 |
| KD4 | That makes it MORE dangerous than git-tracked: sharing is by filesystem (findLoreDbPath walk-up), so an edit appears in no diff, gets no review, cannot raise a merge conflict. Orchestrator-only by MECHANISM, not policy | 97 |
| KD5 | S4's D4 predicate was self-contradictory; seven rounds found FIFTEEN clauses that would go green while the goal failed. Eleven arrived as NON-BLOCKING advisories on an already-approve verdict | 95 |
| KD6 | One of those fifteen was a deadlock I authored: pinning lore status --json (which does not surface those keys) while refusing the alternative left an AC with NO runnable oracle. Tightening an oracle can destroy it | 96 |
| KD7 | Fifth capability-without-wiring instance: diffSource is resolved but no adapter passes it, so every live lore assess is paths_verified.unchecked. ⛔ Anchor-and-scope defect in MY spec — the implementer reported it unprompted from outside its anchors | 95 |
| KD8 | My AC-GD-3 bundle ordered pre-push wiring; the implementer refused and was right. hooks/pre-push is cmp-identical to assets/project/pre-push, which lore setup installs into EVERY consumer repo. I machine-checked all three cited precedents | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-MIRROR-CONTENT: fix GAP-25 as TWO separable things, ⛔ not just the first — (1) exportDocs must rewrite an existing file whose rendered content differs, (2) runCheck must gain a content-hash comparison so a stale mirror is RED. Without (2) the next skip is invisible again. Until then treat every docs/requirements/*.md as possibly superseded
- NS2: NS-INFLIGHT-2: two agents were still running at handoff — AC-GD-1 (branch worktree-agent-a400a2eee13db17b8) and AC-JV-5 (branch worktree-agent-ac947e937999d702c). ⛔ Run git branch -a and git log --oneline main..<branch> for EVERY branch unconditionally, not only ones a report named
- NS3: NS-GD1-SWEEP: AC-GD-1's bundle requires the back-catalogue sweep to land INSIDE its own merge (the gate arms on merge). Verify the enumeration is present and non-silent — an empty sweep reported silently is indistinguishable from a skipped one
- NS4: NS-GD4: task-replace-the-false-git-tracked-mechanism-in-the is ready and undispatched. ⛔ AC-GD-2 keeps its attested pass against the pin it actually had — do NOT retro-edit it or its evidence; AC-GD-4 supersedes the wording forward
- NS5: NS-CONFIG-CLEANUP: after AC-GD-1 merges, remove the redundant capture_timeout_ms / max_diff_chars overrides from .lore/config.yaml and flip GAP-11 to half-closed with this spec owning its VALUE half only, leaving open_half_carried_by ABSENT so the 8-member unowned set still holds
- NS6: NS-QUIET-PERIOD: S2's task-make-the-ac-fr-10-mirror-oracle-drive-the-read-only-check needs a genuine quiet period — AC-OX-1 asserts git status --short .lore docs/requirements is EMPTY after its run, so any concurrent corpus write reddens it. It is also the root-cause fix for KD7
- NS7: NS-FULL-SUITE-2: still not run. Needs bun run build, unsafe all session (global lore symlinks into main's dist/, agents live). Covers ~132 binary-consumer tests plus TWO pre-existing reds I never verified myself: migrate-ordinals-compiled.bun.test.ts pins SPEC-1/SPEC-99 that commit 63164c20 re-baselined only in the sibling unit test
- NS8: NS-ASSESS-2: S1 assessed 74/100, all four findings machine-checked (one major stood — AC-MIS-3 had only capture=runner, now attested; one half-refutable). S3/S4 not yet assessable. ⛔ GAP-24: lore review can return approve on a TRUNCATED spec, say so, and the verdict still counts
- NS9: NS-CLEANUP: worktrees and merged branches from this session were never removed. Confirm each branch's changes reached main BEFORE deleting anything
- NS10: NS-UNOWNED: GAP-20…GAP-25 have no owning spec and are NOT folded into the ledger's structured entries — ⛔ whoever folds them in must update AC-GD-3(f)'s pinned 8-member set in the SAME change or set equality reddens
