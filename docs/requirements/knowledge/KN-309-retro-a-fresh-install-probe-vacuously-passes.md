---
id: KN-309
type: knowledge
role: knowledge
title: "Retro: a FRESH-install probe vacuously passes convergence-shaped defects (setup removal)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: [false-oracle, verification-discipline, setup, dogfood]
parent: PRD-001
---
# Retro: a FRESH-install probe vacuously passes convergence-shaped defects

**Date**: 2026-07-31 · **Trigger**: independently verifying `e0d83b8 fix(setup): removal never resolves through a dev symlink`

## Why this matters

CLAUDE.md's fix discipline asks: *"would a project that just ran `lore init` + `lore setup` still hit this? — if yes, it is not fixed."* For this defect class that question **cannot be answered by a fresh install at all** — and the fresh-install probe answers "fixed" whether or not it is. Measured three times in a row before a control group caught it.

## What was measured

The defect: `lore setup`'s removal phase resolved through a dev symlink, deleting the LINK TARGET's file (a 336-line `SKILL.md` out of the repo, twice) and then aborting on `rmdir` ENOTDIR — irreversible deletion committed BEFORE the abort, while `lore setup --check` still reported in-sync.

Three probe rounds against the fixed binary, all with a planted sentinel file behind a symlinked retired path:

| round | probe shape | sentinel | verdict |
|---|---|---|---|
| 1 | fresh `--claude-dir`, one `setup` run | SURVIVED, exit 0 | **vacuous** — control (real non-link retired file) also survived |
| 2 | fresh install, then plant, then second `setup` | SURVIVED, exit 0 | **vacuous** — control still survived |
| 3 | fresh install → **inject stale manifest entries** → plant → `setup` | SURVIVED, exit 1 + named refusal, `committedRemovals: []` | **live** — control removed in the no-symlink variant |

## The precondition chain nobody states

`setup`'s removal phase fires only on the **diff** between two sets: paths the setup manifest records as previously installed, and paths the current asset payload still declares. A fresh install builds its manifest with the CURRENT binary, so already-retired paths were never recorded — the diff is EMPTY and the entire removal phase is skipped. No removal phase → the symlink code path is never reached → the sentinel survives for the wrong reason.

Reproducing the real incident requires reproducing the real trajectory: **an OLD binary installed the path, a NEW binary converges**. Mechanically: inject the retired entries into `.lore-setup-manifest.json` between the two runs.

## Generalized rule

**Any convergence / diff-shaped mechanism (removal, retirement, pruning, migration, reconciliation) needs a probe that constructs BOTH ends of the diff.** Building only the current end yields an empty diff, and an empty diff is indistinguishable from a correct pass — same failure signature as the contiguous-substring and under-match vectors: absence of work reads as success.

Corollary for control groups: `passed` on the tested case is worthless without a **live control** proving the code path executed. Here the control was a real (non-symlink) retired file that MUST be deleted. Note the control's own subtlety — once the fix is live, a refusal aborts the whole removal phase, so the real file survives TOO; distinguishing "phase never ran" from "phase ran and refused" needs the exit code and the named refusal message, not the file state alone. A third variant (stale entry, no symlink present) was required to confirm removal still works at all — i.e. that the refusal is a precise interception, not a dead removal phase.

## Fix-verification checklist for this class

1. Name the diff's two ends; construct both.
2. Add a control that MUST be mutated, and check it in the same run.
3. When the fix's behaviour is "abort the phase", the control alone is ambiguous — pin exit code + message text too.
4. Add a third variant that exercises the mechanism with the hazard absent, proving it still functions.

## Residual gaps (deferred in the governing spec, no ACs)

- **D7 `setup`/`--check` exit coherence** — a failed `setup` can still be followed by `--check` reporting in-sync. In the original incident this pairing is what masked the data loss. Removal is no longer destructive, so the harm degrades from "hides destruction" to "misleads", but the incoherence stands.
- **D5** — removals are not backed up.

## Verification evidence

- Author's regression suite `packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts` — 15/15 pass (unit-level, calls `remove()` directly; does not cover the e2e manifest-diff precondition documented here).
- Independent black-box probe, round 3: `committedRemovals: []`, sentinel intact, refusal names the ancestor symlink and prescribes `unlink <path>`.
- Post-fix real-machine run: `setup` exit 0, repo tree clean, 336-line source intact, 40 dev symlinks intact, 3 stale manifest entries cleared, `--check` in-sync.
