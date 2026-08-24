---
id: SPEC-117
type: spec
role: spec
title: "lore setup deletes repo source through dev symlinks — removal must never resolve through a link"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Overview

`lore setup` deletes source files out of a developer's own repository. Measured twice in one session (a 336-line `assets/skills/lore-init-context/SKILL.md` destroyed, restored, destroyed again), and reproduced from first principles here.

The mechanism, every step measured 2026-07-31 with Node against a synthetic link tree:

| Step | Code | Measured |
|---|---|---|
| 1 | `RealSetupFsWriter.remove` guards with `existsSync(path)` (`real-setup-fs.ts:190`) | `existsSync` FOLLOWS symlinks → `true` for a path that only exists on the far side of a dev link |
| 2 | `rmSync(path, { recursive: true, force: true })` (`real-setup-fs.ts:191`) | with `path` = `<claude-dir>/skills/lore-init-context/SKILL.md` and the parent being a symlink into the repo, **the repo's own SKILL.md is deleted** |
| 3 | `removeDirIfEmpty` then calls `rmdirSync` on the symlink (`real-setup-fs.ts:196`) | throws `ENOTDIR`, which is NOT in the swallow list (`ENOTEMPTY`/`ENOENT`) |

The ordering is what makes it maximally harmful: the **irreversible** deletion (step 2) commits, then step 3 throws, so the run reports itself as failed/non-authoritative while the data is already gone. Meanwhile `lore setup --check` reports exit 0 / in-sync, because it does not measure this.

Both preconditions are ordinary, not exotic:
- `RETIRED_FROM_INSTALL_PATHS` (`real-asset-source.ts:148`) is **file-level**: it contains `skills/lore-init-context/SKILL.md`, so the removal path is a FILE nested under a directory that a developer may legitimately have replaced with a symlink.
- Editing `assets/` live through symlinks from `~/.claude/` is the intended dev workflow — 41 such links exist on this machine and the owner's decision (2026-07-30) is to KEEP them and fix the tool.

## Scope

**In scope** — the data-loss path only

- `RealSetupFsWriter.remove` must never resolve through a symlink.
- `RealSetupFsWriter.removeDirIfEmpty` must not throw on a symlink at the directory position.
- Every removal call site must pass its root as the boundary (the protection is opt-in per call site by construction, so this is part of the fix, not a detail of it) — both `SetupService`'s six and `uninstallProject`'s three.
- `removeProjectPath`, the SYNC twin used by `lore setup --project --uninstall`, gets the identical treatment. Found during review of the first fix, not during planning: it sits in the same file and shipped the same `existsSync` + `rmSync` shape, so fixing only the machine-install writer left half the defect live. Lower probability (it needs a scaffolded path such as `.claude/hooks` to be symlinked away) but an identical failure mode.

**Deferred to a follow-up, with reasons in D5/D7** — these were in the original scope and are deliberately NOT delivered here, so this spec's deliverable is exactly the three bullets above:

- Backing removals up before they happen (D5). Superseded in urgency once removal became a refusal rather than a deletion.
- Reconciling `lore setup` exit 1 with `lore setup --check` exit 0 (D7). A property of `setup-check.ts`'s comparison judgement, not of the removal path.

**Out of scope**

- Removing or rewriting the 41 dev symlinks (owner decision: keep them).
- The retirement list itself — `skills/lore-init-context/SKILL.md` stays retired.

## Decisions

**D1 — `lstat`, never `exists`.** The absent-target no-op check uses `lstatSync` (link-aware) instead of `existsSync` (link-following). A dangling link is "present" for removal purposes: the LINK exists even when its target does not.

**D2 — a target that IS a symlink is unlinked, not recursed into.** `unlinkSync(path)` removes the link; the target is never touched. This is the owner's stated rule ("unlink the LINK for symlinks — never resolve through it").

**D3 — a target whose ANCESTOR is a symlink is REFUSED, loudly, not unlinked.** This case is the one that actually caused the damage, and it is deliberately NOT handled by unlinking the ancestor. An ancestor link may carry other, non-retired assets; silently unlinking it to delete one retired file would remove the whole subtree — trading data loss for a different data loss. The removal is refused with an error naming the offending ancestor and the path it would have deleted, so a human decides. Refusing is safe because the file on the far side is BY CONSTRUCTION not an installed copy: `write()` only ever `mkdirSync` + `rename`s real files, so it never creates the link.

Known consequence, named rather than hidden: a refusal propagates into `install`/`uninstall`'s pre-existing outer `try/catch`, which aborts the whole run and reports which paths committed before the failure without writing the manifest. So one stale removal through a symlink aborts the entire run instead of skipping just that removal. That non-atomicity is inherited, not introduced — the old code reached the SAME catch-and-abort path one step later via `removeDirIfEmpty`'s uncaught `ENOTDIR`, except the data was already destroyed by then. The new behaviour strictly dominates for the measured incident (same "run failed" outcome, zero data loss), and making removals independently skippable is a separate change to `install`'s transactionality, not part of this fix.

**D4 — the ancestor scan is bounded by `targetDir`.** `remove` takes the install root as an explicit boundary and scans only `path`'s ancestors strictly inside it. Scanning to the filesystem root would refuse every removal for anyone whose `~/.claude` is itself a symlink — a legitimate setup that has nothing to do with this defect.

**D5 (DEFERRED, not implemented) — back removals up before they happen.** Originally scoped alongside D1-D4. Deferred once D3 landed: a reach-through removal is now REFUSED rather than performed, so the data-loss path this decision insured against no longer executes. Backing up genuine installed-copy removals remains worthwhile defence-in-depth, but it needs a `backupDir` threaded through the writer port and interacts with `pruneBackupRuns`' retention sweep — a separate change with its own failure modes, not a rider on this fix.

**D6 — `removeDirIfEmpty` swallows `ENOTDIR`** in addition to `ENOTEMPTY`/`ENOENT`, and treats a symlink at the directory position as a **no-op — it is left exactly as the developer created it**, never `rmdirSync`'d and never unlinked. Rationale: the sweep's contract is "clean up directories our removals emptied"; a symlink is not such a directory, its presence must not abort the run, and lore has no business removing a link it did not create (the same reasoning as D3). Corrected 2026-07-31 after review: this decision previously read "unlinks a symlink found at the directory position", which the shipped code never did — an SSOT drift between the decision log and the code, in the direction of describing a MORE destructive behaviour than exists. The behaviour is now pinned by an assertion that the link still exists after the sweep, so neither side can drift again unobserved.

**D7 (DEFERRED, not implemented) — exit-code coherence.** `lore setup` failing while `lore setup --check` reports in-sync is a self-contradiction that helped hide this bug, and it is still true. Deferred because it is a property of `setup-check.ts`'s comparison judgement rather than of the removal path, so fixing it here would mean changing what `--check` measures while also changing what `setup` deletes — two independently risky edits in one step.

**D8 (AMENDMENT 2026-07-31) — `boundary` is a REQUIRED parameter, not an option.** D4 made the ancestor scan opt-in per call site (`opts?: { boundary?: string }`, skipped when absent). AC-SL-2 tried to close that hole with a source scan that enumerates removal calls lacking the argument — but that scan is written from a remembered list of the files the fix touched, so it inherits precisely the blind spot it exists to remove. That is not a hypothetical: the retro filed as this spec's child (`Grepping the defect's shape finds it in the callee and misses every caller — one class, three escapes`) measured the SAME defect class escaping three times, because grepping the shape searches the callee — already correct — while the omission sits in a caller carrying no distinctive token.

The mechanization is to move enumeration from a regex to the type checker: `remove` and `removeProjectPath` take `opts: { boundary: string }`. A forgotten argument then fails `tsc`, at every call site, including ones nobody remembered to list. Measured cost at amendment time: 9 production call sites (6 in `setup-service.ts`, 3 across `setup-project-flow.ts` / `setup-project-uninstall.ts`) already pass it, so no production caller changes behaviour; the work is in the port declarations and in the test doubles, which must now supply a boundary.

This SUPERSEDES the "opt-in by construction" property stated below under Acceptance. AC-SL-2's source scan is retained rather than deleted — it keeps its evidence, and it still catches a call site added in a `.mjs` or otherwise untyped surface that `tsc` does not reach — but it is demoted from the primary guarantee to a backstop.

Not changed by this amendment: the runtime tolerance of an absent boundary. `remove` keeps its `boundary === undefined` branch, because the type checker constrains TypeScript callers only and a runtime that silently reinterprets a missing boundary as "scan to the filesystem root" would refuse every removal for anyone whose install root is itself a symlink (the exact case D4 exists to avoid). The type is the enforcement surface; the runtime branch stays reachable and stays tested.

## The write side, for symmetry (measured, no change needed)

Recorded because a reader who sees only D1-D4 will reasonably wonder whether the WRITE path has the same hole, and the answer is a deliberate asymmetry rather than an oversight.

`RealSetupFsWriter.write` is tmp-file + `renameSync` onto the target. Measured 2026-07-31: renaming onto a path that is currently a symlink **replaces the link with a real file**; the link target's content and the file itself are untouched.

That is the correct behaviour and must not be "fixed" to match the removal side. If `write` preserved the link and wrote through it, `lore setup` would edit the DEVELOPER'S OWN REPO SOURCE — strictly worse than the removal defect, because it would corrupt content rather than delete an installed copy. Both sides therefore obey the same invariant, *never act through a link*, and it simply looks different per operation:

| | through the link | what lore does instead |
|---|---|---|
| remove | would DELETE the dev's file | unlink the link (target) / refuse (ancestor) |
| write | would OVERWRITE the dev's file | replace the link with a real installed file |

The visible consequence of the write side is that a dev symlink is silently consumed by an install and must be recreated. That is a workflow cost, not data loss, and it is the price of `install` owning its own paths.

## Acceptance

Script-mode ACs (AC-SL-1 … AC-SL-4), verified by `lore verify`, covering D1-D4 and D6. The load-bearing one is a real-filesystem regression test that builds the exact link topology of the incident and asserts the far-side file SURVIVES — the only assertion that would have caught the original defect.

A second, non-behavioural AC (AC-SL-2) pins every `SetupService` removal call site to passing its `boundary` by scanning the source. It was written when the protection was opt-in per call site by construction, so a forgotten argument silently reinstated the deletion and no behavioural test of the writer could observe it — the omission lives in the caller.

**Amended by D8**: `boundary` is now a REQUIRED parameter, so the primary enforcement is `tsc`, and AC-SL-2's source scan is a backstop for untyped surfaces rather than the guarantee. AC-SL-7 pins the type-level enforcement itself.

D5 and D7 are explicitly deferred above and carry no ACs.


## Acceptance Criteria (structured)

- [⚑] [script] AC-SL-1: Given the exact link topology of the measured incident — an install subdirectory symlinked into a developer's repo and the retired path being a FILE nested inside it — removal is refused rather than performed, the far-side repo file survives with byte-identical content, and the link itself is left in place; the refusal message names both the offending ancestor link and the path it declined to delete, so a human can act on it
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts -t "the measured incident"
- [⚑] [script] AC-SL-2: Every writer.remove call site in setup-service.ts passes the boundary option, asserted by scanning the source for removal calls lacking it, paired with a control assertion that at least one removal call was found so a moved or renamed call site cannot let the check pass vacuously — the ancestor scan is skipped when boundary is absent, so a forgotten argument silently reinstates the reach-through deletion and no behavioural test of the writer can observe it
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts -t "declares its boundary"
- [⚑] [script] AC-SL-3: removeDirIfEmpty resolves without throwing when a symlink occupies the directory position (previously ENOTDIR escaped the swallow list and aborted the run AFTER an irreversible removal had committed) and does not reach through the link, while still swallowing ENOTEMPTY and ENOENT and still removing a genuinely empty directory
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts -t "removeDirIfEmpty must not abort"
- [⚑] [script] AC-SL-5: removeProjectPath — the sync twin used by lore setup --project --uninstall — refuses an ancestor-symlink removal leaving the far-side file byte-intact and the link in place, unlinks a link target rather than following it, still removes ordinary scaffolded paths, and treats a missing target as a no-op with no boundary supplied; paired with the call-site scan asserting all three uninstallProject removal calls pass their boundary
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts -t "removeProjectPath carries the same protection"
- [⚑] [script] AC-SL-4: The whole symlink-removal suite passes on a real filesystem with zero failures (a MapFs-style fake models paths as string keys and cannot represent a link, so this defect class is unreachable by fakes). No total is asserted here on purpose: an earlier revision hardcoded a count that silently drifted as the suite grew, and lore verify checks exit code and under-match rather than a numeral in prose. Post-conditions covered: a target that IS a link is unlinked while its target survives unchanged; a dangling link no longer lstats; a link above the boundary is removed through without refusal; a missing target resolves undefined; real nested files and directory trees are removed as before; a call omitting boundary still removes a plain file
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts
- [⚑] [script] AC-SL-6: A path that does not resolve inside its declared boundary throws and removes nothing, instead of silently skipping the ancestor scan — including the case-only boundary mismatch that review proved reachable on a case-insensitive filesystem, where the far-side file must survive byte-intact; a target EQUAL to the boundary is still allowed, since it has no ancestors inside the boundary to scan
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts -t "outside its boundary fails loud"
- [⚑] [script] AC-SL-7: D8 type-level enforcement: boundary is a required property on the removal ports, so omitting it is a compile error at every call site rather than a silent skip of the ancestor scan. Verified by a full typecheck passing with the required signature in place, paired with a negative control — a fixture that omits boundary must be rejected by tsc, so a signature quietly reverted to optional cannot let this AC pass vacuously.
  script: tsc — bun run typecheck
- [⚑] [script] AC-SL-8: Suite-membership floor closing the shrink hole an independent review found in AC-SL-4: that AC asserts zero failures without pinning membership, so deleting the ancestor-refusal case leaves zero failures and exit 0 — a passing oracle over an empty guarantee. The symlink suite asserts a monotonic floor on its own executed-case count (never fewer than the cases present at this amendment) rather than an exact total, so the suite may grow freely but a silently deleted case turns it red.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts -t 'suite membership floor'

## Code anchors

- packages/lore/src/adapters/real-setup-fs.ts#RealSetupFsWriter
