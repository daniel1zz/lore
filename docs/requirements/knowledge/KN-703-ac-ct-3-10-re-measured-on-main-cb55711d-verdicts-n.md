---
id: KN-703
type: knowledge
role: knowledge
title: "AC-CT-3..10 re-measured on main cb55711d: verdicts, nine spec corrections, and a stamp-before-arming task order"
status: draft
priority: medium
created: 2026-10-17
updated: 2026-10-17
tags: [spec-143, corpus-truthfulness, research, arming-rev]
links:
  - {id: SPEC-143, type: informs}
  - {id: TASK-1531, type: informs}
---
# AC-CT-3..10 re-measured against main cb55711d (2026-10-17)

Research for `task-skill-research-ct-r1-re-measure-ac-ct-3-10-against-current` (plan `plan-corpus-truthfulness-finish-ac-ct-3-10-never-implemented`). Subject: `spec-corpus-truthfulness-a-verdict-must-carry-the-state-it` (SPEC-143), statements read in full via `lore get … --json` (`extra.acceptance_criteria`). All measurements were taken on `main` at `cb55711d`. Probes ran in mkdtemp directories under the session scratchpad, and the live `.lore/lore.db` was opened only with `sqlite3 -readonly`.

## 0. Corrections to the task's own premises

| Premise in the task | Measured | Evidence |
|---|---|---|
| "stampCurrency exists in gate-predicates.ts" | **False.** Only the TYPES (`StampClass`, `RadiusMeasurement`, `StampCurrency`, `StampVerdict`) and `readStampVerdict` exist. No function named `stampCurrency` is defined anywhere. | `git grep -n stampCurrency -- packages scripts` returns 2 hits, both prose: `gate-predicates.ts:1710` (JSDoc: "what `stampCurrency` … landing in this module") and `stamp-types.test.ts:175` (a comment). Commit `006045f2` (2026-08-23) landed the types only. |
| "blastRadiusChanged and probeOccupancy are absent" | True under those names. But a **functionally identical** blast-radius diff has shipped since 2026-10-07 under another name (see AC-CT-4). | `git grep -n -E "blastRadius|probeOccupancy" -- packages scripts` returns only an unrelated local in `commands/ac.ts:1127` |
| "command paths never existed" | True for all 7. | `git log --all --oneline -- <path> \| wc -l` = 0 for all six test paths and `scripts/check-capture-source-buckets.ts`. `bun scripts/check-ac-oracle-ownership.ts` reports `rule=missing-owner-file` for AC-CT-3, 4, 5, 6, 8 and 9. |

**What the deprecated plan absorbed, and where it went.** Per `plan-land-corpus-truthfulness-part-a-the-two-axis-type` D-A8, each `[Skill:implement]` task was invalidated and absorbed into its `[Skill:test] … RED test scenarios` task (two claims, one archival unit). Only T0, `task-skill-test-two-axis-type-foundation-red-test-scenarios`, archived; it carries 5 evidence rows and produced the types above. The four P2 tasks (CT-3, CT-4, CT-5, CT-8) and the P3 gate were set to `deprecated` on 2026-10-10 02:52 (`lore log`, v6/v7) with no RED stage ever run. Nothing was absorbed into any other live plan. Their anchors are reused below.

## 1. Per-criterion verdicts

| AC | Verdict | What holds | What is missing | Is the criterion still right? |
|---|---|---|---|---|
| AC-CT-3 | **missing** (types only) | `StampClass` 3-valued; `ARMING_REV = 14992` exists as a constant (`packages/core/src/task-workflow.ts:388`); `state_stamp` is an optional schema field (`:607`) | No `stampCurrency` classifier. `attestationFloor` (`gate-predicates.ts:1345`) reads no stamp. No row carries `recordedAuditId`. Nothing writes `state_stamp` (0 rows). | Needs correction: half (3), the arming value, and how a row's audit id is resolved (§3 C1–C3) |
| AC-CT-4 | **partly** (mechanism exists elsewhere) | `SpawnGitPort.changedSince` (`packages/lore/src/service/rule-state-git-port.ts:71`) is exactly `git diff --quiet <sha> HEAD -- <paths>` with exit 0/1/other mapped to false/true/err. `extractTestFileTokens` (`packages/core/src/oracle-file-existence.ts:152`) already pulls test-file pathspecs out of an AC command. The R8 premise was re-measured and still holds. | No resolver returning `RadiusMeasurement` from the AC command plus task `file_anchors`. No `blastRadiusChanged`. The `stale`/`bound` reading feeds no floor. | Direction is right. Echo text is stale (§3 C6). RuleStateService pairs the diff with an ancestry pre-check (`not-ancestor` reads as unknown), which AC-CT-4's falsifier (a) forbids as the decision itself. Keep the diff as the decision. |
| AC-CT-5 | **missing**, and current behaviour IS the falsifier | Runner attestations carry `head_sha` + `worktree_dirty` (since 2026-10-07) | `probeGitState` runs ONCE, AFTER the command (`verify-runner-service.ts:1269`, comment at `:1314`: "git state AFTER the command ran"). There is no pre-run read and no comparison. | Right, and more urgent than when written: the post-run-only recording it forbids is now in production for `head_sha` |
| AC-CT-6 | **missing** | A read-only full mirror parity check exists (`scripts/export-spec-mirror.ts --check`, wired into `bun run test`, not pre-push). It took 15.49 s real and exits 2 on today's drift. | No `corpus_rev` in `.lore/export-index.json` (top keys: `version`, `mappings`). No pre-push step (`hooks/pre-push` == `assets/project/pre-push`, `cmp` identical, no corpus_rev). | Needs correction: `MAX(audit.id)` moves on writes that never touch the mirror, and the advisory's own audit row moves it too (§3 C7) |
| AC-CT-8 | **missing** | `scripts/oracle-lock.ts` provides the checkout-level lock (`git rev-parse --git-common-dir`/`lore-oracle-test.lock`, pid file, `isPidAlive`), wired as the outer layer of `bun run test` | No `probeOccupancy`. No "state-binding check". No `SKIPPED`/`state-binding` token in `lore status`. | Needs correction: the check's host is undeclared, and a shipped binary cannot import `scripts/` (§3 C8) |
| AC-CT-9 | **partly** | Half (c) holds: `readStampVerdict` is total, with a `never` gate and a compile-failure fixture (`bunx --bun vitest run packages/lore/tests/unit/service/stamp-types.test.ts`: 16 passed, exit 0). An `R(1)` red is on record. The capture_source axis now has ONE exported classifier, `classifyCaptureSource` (`packages/core/src/task-workflow.ts:188`, commit `c1d03e73`, 2026-10-12), called by both `assess-render.ts:85` and `status.ts:599`. | (a)/(b): the floor reads no stamp or radius axis. (d): there is no stamp-verdict distribution on any surface. The owner test file is absent, and (c)'s oracle sits in a non-owner file (ownership check: `unowned-ac-reference … AC-CT-9 path=…/stamp-types.test.ts`). | Mostly right. The capture_source half of (d) was satisfied by other work, and its wording ("runner/self-report", "private duplicate DELETED") is stale (§3 C5) |
| AC-CT-10 | **missing** | — | No `scripts/check-capture-source-buckets.ts`, so nothing is wired into `bun run test` | Needs correction: its 2026-08-21 measurement no longer describes the code (§3 C5) |

## 2. Measurements behind the verdicts

**Stamps on stored rows** (live corpus, read-only):
```
sqlite3 -readonly .lore/lore.db "with ev as (select … json_each(verification_evidence) …) select count(*), sum(attestation not null), sum(head_sha not null), sum(head_sha not null and worktree_dirty=0), sum(state_stamp not null), …"
-> total 7091 | attested 3953 | with head_sha 609 | head_sha+clean 232 | with state_stamp 0 | runner 2777 | runner w/o attestation 442
```
- All 442 runner rows without attestation predate 2026-08-23T12:46Z, so AC-CT-2's fix holds forward.
- **377 of 609 (62%) head_sha rows were recorded on a dirty worktree.** SPEC-143 C1 says nothing about a dirty tree (§3 C4).

**Arming hazard (AC-CT-3).**
- `select max(id) from audit` = **45789** today, against `ARMING_REV = 14992`.
- 2084 attested rows were recorded after audit 14992's timestamp (2026-08-23T06:21:01Z). Arming with the shipped constant would turn every one of them `unbound` and refused. That is the mass-wedge N2/G5 forbid. The constant's own JSDoc names this as an unenforced "RE-CAPTURE DUTY".
- Prior finding #5 in `knowledge-five-gaps-from-landing-plan-a-s-type-foundation-two` adds a second problem. A shipped literal never arms in a consumer corpus, and in a fresh one it arms at an arbitrary id. No spec revision followed that finding.

**A row's audit id is not stored (AC-CT-3).**
- `evidenceEntrySchema` has `recorded_at`/`recorded_by`, but no audit id.
- `audit` rows with `action='evidence'` carry `details.version`. Join coverage per doc: 1073 of 1109 evidence-bearing docs have equal counts. 36 docs have no evidence audit rows. That is 7092 entries against 6994 audit rows.
- So `recordedAuditId` from C2's signature has no defined source today.

**Radius re-measure (AC-CT-4).** Throwaway repo, base commit B, then a peer commit that creates `created.txt`, deletes `del.txt` and adds `other.txt`:
```
git diff --quiet B HEAD -- created.txt  -> 1
git diff --quiet B HEAD -- del.txt      -> 1
git diff --quiet B HEAD -- never.txt    -> 0
git diff --quiet B HEAD -- keep.txt     -> 0
git diff --quiet B HEAD -- 'nomatch/*.ts' -> 0
git merge-base --is-ancestor B HEAD     -> 0   (ancestry reads "fine" while two radius paths changed)
```
Re-check trigger: 54 of 1170 live script-mode ACs have no path-shaped token, a **4.6%** share (regex heuristic over `verify.command`). That is below the 15% re-open threshold, so the direction stands.

**C7 noise (AC-CT-6).**
- Throwaway corpus with `dist/lore`: `create knowledge` moved `MAX(audit.id)` 0→1. `export-docs`, `status --check-tree --check-drift`, `get`, `list`, `audit --verify`, `status --check-prd-budget` and `--check-claude-md` left it at 1, so reads are clean.
- Live action mix for `id > 45000`, 812 rows: corpus-scope-write 309, update 246, gate_passed 122, claim 53, link 24, judge 20, evidence 12, create 10, approve 7, release 4, worktree-cleanup 3.
- The task mirror renders neither claim nor evidence: `grep -c -i "claim|evidence"` on a task mirror file = 0.
- So at least ~26% of rows (claim, evidence, gate_passed, judge, release, worktree-cleanup) advance `MAX(audit.id)` without touching a mirrored byte.

**AC command runtime.**
- Since tg-23 (`90c2b081`), the suite runs every test under `bunx --bun vitest run`. The only exceptions are the files listed in `vitest.node-files.ts`.
- All seven CT commands use `bunx vitest run`, which is the Node invocation. Live split across all script ACs: 748 `bunx vitest run` against 292 `bunx --bun vitest run`.
- A new CT test that opens a store (`bun:sqlite`) cannot run under Node, and an attested run on a runtime the suite does not use certifies something else.

## 3. Proposed spec corrections (each needs `lore ac set --correction` or a content edit, then re-approval)

- **C1 — arming_rev becomes per-corpus and is written by an audit row (G3, C1/C2, AC-CT-3).** Replace the shipped literal `ARMING_REV` with the id of a single `state-binding-armed` audit row, written once per corpus by the arming step (and by `lore init` for a fresh corpus).
  - The audit table is append-only and hash-chain-verified (`lore audit --verify`), so the cutoff keeps the non-forgeability G3 requires.
  - It also arms in consumer corpora, and it lands in the same transaction that first consumes it, so no "re-capture duty" is left.
  - Reason: measured 45789 vs 14992, which leaves 2084 rows exposed to retro-refusal, plus prior finding #5.
  - Falsifier (b) becomes "delete or ignore the armed row, so every legacy row reads `unbound`".
- **C2 — define how a row's audit id is resolved (C2's `recordedAuditId`).** Proposed: every evidence write after arming stores its own write-time `corpus_rev` on the row, server-side and never caller-suppliable, the same terms as `attestation`. A stamp-less row is then pre-arming iff that field is absent AND an `audit(action='evidence', doc_id, details.version)` row with id ≤ arming_rev exists.
  - The alternative, joining audit by `(doc_id, details.version)` alone, was measured: it misses 36 docs and 98 rows.
- **C3 — AC-CT-3 half (3) must name the stamp-verdict distribution, not `capture_source`.** R12 split the two axes, but half (3) still says "both appear … in the capture_source distribution". The same applies to QA-6 and G3's "Both are counted" sentence.
- **C4 — dirty-worktree runs need a declared stamp reading.** 62% of head_sha rows are dirty, and HEAD does not name the state such a run measured. RuleStateService reads `dirty` as `unknown`.
  - Options:
    - (a) `stamped` + `radius: unmeasured`, reason `dirty`, which the floor accepts. This is weak.
    - (b) Treat dirty as `unbound`, which the floor refuses. This would wedge many runs.
    - (c) Stamp the tree including uncommitted changes, `git stash create` or a write-tree digest. This needs a measurement first.
  - Recommendation: (c) if its cost per verify is ≤ the existing 2 git spawns. Otherwise (a), with `dirty` counted as its own sub-reason, so the share is visible and the 15% re-check applies to it too.
  - Also decide whether StateStamp's code coordinate reuses `head_sha` (+`worktree_dirty`) or adds `tree_digest`. Two stamps on one attestation is the "second derivation" this spec forbids.
- **C5 — AC-CT-9(d) and AC-CT-10 re-measured.** The capture_source axis predicate is now `classifyCaptureSource` in `packages/core/src/task-workflow.ts`, with THREE buckets (runner / self-report / runner-unattested), not "runner/self-report" in `assess-render.ts`.
  - The remaining `capture_source === "runner"` literal in non-test source is `task-workflow-service.ts:1122` (`isRunnerCaptured`, the tail-guard; it was `:795`).
  - The two distribution sites no longer read the raw field: they `switch` on the classifier's output and each keep their own accumulation loop (`assess-render.ts:77`, counters; `status.ts:584`, member lists).
  - AC-CT-10's discriminator ("a `capture_source` read whose enclosing function writes ≥2 accumulation targets") must say whether a `switch` over `classifyCaptureSource(...)`/`readStampVerdict(...)` output with ≥2 accumulators counts as the sanctioned consumer or as a duplicate. Proposed: a raw-field read or a literal comparison against `CAPTURE_SOURCES`/`StampVerdict` values outside the classifier's file is the violation, and a switch over the classifier's return is the consumer. The allowlist and the "4 sites" figure must be re-measured.
- **C6 — AC-CT-4's echo text contradicts its statement.** The echo still says "an unresolvable radius member (deleted anchor or non-path command target) classifies the whole radius unmeasured", which R8 removed. AC-CT-10's echo says "capture_source" only, while its statement covers both axes.
- **C7 — AC-CT-6/C7 compare semantics.** A bare `index.corpus_rev == MAX(audit.id)` reports drift after any claim, evidence, gate or judge row, and after its own advisory audit row (Migration step 7 "warn + audit row"), which makes it self-invalidating.
  - Proposed: `corpus_rev` = MAX(id) over mirror-affecting actions at export time (create/update/link/unlink/approve/reject/invalidate/delete/restore/…). The compare stays 2 store calls, the second becoming an indexed MAX over an action set.
  - Alternative: keep MAX(audit.id), but define mismatch as "some audit row above the recorded rev names a mirrored doc with a mirror-affecting action". That is an O(new rows) read, which breaks the "constant 2" (a2) assertion.
  - This is a design choice, so ask the user. Also confirm C7 is still wanted, since `check:spec-mirror` now gives a full parity verdict at test time (15.5 s).
- **C8 — AC-CT-8 host and layering.**
  - (i) Pin the host. C6's data flow and Migration step 5 put the occupancy probe in `VerifyRunnerService`, but AC-CT-8(a)'s rationale talks about "other pre-push checks". R11 established that the pre-push C7 step can never be contended. Proposed: the host is `lore verify`'s stamp step, and the exit-code control compares `lore verify` with and without the check.
  - (ii) `probeOccupancy` cannot live in `scripts/oracle-lock.ts`. The consumer ships in the binary, `packages/*/src` imports nothing from `scripts/` (`git grep` count = 0), and consumer repos have no `scripts/`. Proposed: a read-only reader of the same lock protocol in `packages/lore/src/adapters/`, keeping `scripts/oracle-lock.ts` as the writer, plus a shared-constant test pinning both to one lock path/name.
  - (iii) Every SKIPPED audit row advances `MAX(audit.id)`, which interacts with C7.
- **C9 — runtime of every CT command.** Change `bunx vitest run` to `bunx --bun vitest run` for AC-CT-3, 4, 5, 6, 8 and 9. The one-runner rule (tg-23) runs these files under the Bun runtime, and the new tests touch `bun:sqlite`.

## 4. Proposed task breakdown

Order is forced by one measured dependency: **arming (T3) must not land before the runner writes stamps (T2)**. Otherwise every post-arming row is stamp-less and refused. Each implementation task is a single archival unit with a RED claim then a GREEN claim (D-A8 shape), and its red is recorded by the RED agent.

| # | Title | Est | Anchors | Red-first oracle (AC command, corrected) |
|---|---|---|---|---|
| T1 | Spec correction round C1–C9 on SPEC-143 + re-approval | M | corpus only (`lore ac set --correction`, spec content) | n/a. Exit: `lore ac list` shows the corrected statements; spec `approved` before any T2+ claim (INV-3 of the old plan) |
| T2 | AC-CT-5: `VerifyRunnerService` reads the stamp pre and post (state_stamp + head_sha); a mismatch demotes the row | L | `packages/lore/src/service/verify-runner-service.ts`, `packages/core/src/task-workflow.ts`, `packages/lore/tests/unit/service/stamp-pre-post-demotion.test.ts` | `bunx --bun vitest run packages/lore/tests/unit/service/stamp-pre-post-demotion.test.ts`. Seam: the AC command run by the runner itself makes a REAL `git commit` in the throwaway repo, so the commit lands between the two reads with no fake port |
| T3 | AC-CT-3: `stampCurrency` stamp axis, per-corpus arming row, row audit-id resolution, attested counting excludes `unbound` | L | `packages/lore/src/service/gate-predicates.ts`, `packages/core/src/evidence-panel.ts`, `packages/core/src/task-workflow.ts`, `packages/lore/src/service/checkpoint-registry.ts`, `packages/lore/tests/unit/service/stamp-currency-floor.test.ts` | `bunx --bun vitest run packages/lore/tests/unit/service/stamp-currency-floor.test.ts`. Blocked by T1, T2 |
| T4 | AC-CT-4: radius resolver (command `extractTestFileTokens` ∪ task `file_anchors`) + `blastRadiusChanged` reusing `SpawnGitPort.changedSince`'s diff (BUY over BUILD: lift it to a shared port, not a second copy) | M | `packages/lore/src/adapters/real-git-port.ts`, `packages/lore/src/service/rule-state-git-port.ts`, `packages/lore/src/service/gate-predicates.ts`, `packages/lore/tests/unit/adapters/blast-radius-staleness.test.ts` | `bunx --bun vitest run packages/lore/tests/unit/adapters/blast-radius-staleness.test.ts`. Parallel to T2/T3 |
| T5 | AC-CT-9 (a)(b)(d): floor reads stamp then radius; parallel stamp-verdict distribution in `lore assess` + `lore status` through one exported predicate | M | `packages/core/src/evidence-panel.ts`, `packages/lore/src/adapters/cli/assess-render.ts`, `packages/lore/src/adapters/cli/commands/status.ts`, `packages/lore/tests/unit/service/unmeasured-floor-consequence.test.ts` (and spec-qualify the AC-CT-9 references in `stamp-types.test.ts`) | `bunx --bun vitest run packages/lore/tests/unit/service/unmeasured-floor-consequence.test.ts packages/lore/tests/unit/service/stamp-types.test.ts`. Blocked by T3, T4 |
| T6 | AC-CT-10: `scripts/check-capture-source-buckets.ts` site scan (both axes), wired into `bun run test` | M | `scripts/check-capture-source-buckets.ts`, `package.json`, `packages/lore/tests/unit/scripts/check-capture-source-buckets.test.ts` | Red: a test spawning the scan over fixtures (falsifiers a/b). AC command unchanged: `bun scripts/check-capture-source-buckets.ts`. Blocked by T5 |
| T7 | AC-CT-8: occupancy reader in `adapters/`, SKIPPED-and-continue in `lore verify`'s stamp step, `state-binding … SKIPPED` line in `lore status` | L | `packages/lore/src/adapters/oracle-occupancy.ts` (new), `scripts/oracle-lock.ts`, `packages/lore/src/service/verify-runner-service.ts`, `packages/lore/src/adapters/cli/commands/status.ts`, `packages/lore/tests/unit/service/occupancy-skip-continuity.test.ts` | `bunx --bun vitest run packages/lore/tests/unit/service/occupancy-skip-continuity.test.ts`. Blocked by T1 (host pin), T2 |
| T8 | AC-CT-6: `corpus_rev` in the export index + pre-push compare, advisory-first (Phase 3) | M | `packages/lore/src/service/export-docs-service.ts`, `hooks/pre-push`, `assets/project/pre-push` (+ manifest regen), `packages/lore/tests/unit/hooks/pre-push-mirror-rev.test.ts` | `bunx --bun vitest run packages/lore/tests/unit/hooks/pre-push-mirror-rev.test.ts`. Blocked by the T1 decision on C7. If the user drops C7, the criterion is retired by correction, never silently |
| T9 | Plan gate on merged main: `bun run test`, `bun run typecheck`, `lore verify` for AC-CT-3..10, `check:ac-oracle-ownership` shows no AC-CT row | S | `package.json` | the plan's exit criterion |

Critical path: T1 → T2 → T3 → T5 → T6 = M+L+L+M+M.

## 5. Unknowns (stated, not guessed)

- Cost of a dirty-tree digest (C4 option c) has not been measured.
- Whether `lore done`'s per-task attested-pass floor (not only plan-close `attestationFloor`) must also refuse `unbound`. G3 says "can never satisfy a floor", but AC-CT-3 asserts only `attestationFloor`.
- Whether the user still wants C7 (AC-CT-6) on the push path, given `check:spec-mirror` at test time.

[EVIDENCE] S-tier: repository source, git and sqlite reads, and throwaway-repo probes, cited inline. [CONFIDENCE] 0.85 on the verdicts; 0.7 on corrections C4/C7, which are design choices that need the user.
