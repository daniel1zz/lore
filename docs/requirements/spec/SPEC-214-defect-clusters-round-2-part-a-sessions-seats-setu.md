---
id: SPEC-214
type: spec
role: spec
title: "Defect clusters round 2 part A: sessions, seats, setup, init, deleted documents, links, set validation"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-20
tags: []
---
## Overview/Goal

Defect clusters round 2, part A of 4: sessions, seats, setup, init, deleted documents, links and set validation. The round closes 29 clusters (69 open GitHub issues in daniel1zz/lore plus 4 local reports) at their mechanism root; it is split in four specs so each is reviewed whole. Every root cause was read on main `f80a2933`; line numbers refer to that commit. Each Dn names its reports, the root cause and the END STATE. No group introduces a stopgap, a guard on an old design, a fallback, or a phased migration.

User decisions built in:
- D5: `lore init` seeds the write-spec rule document. This modifies BR-807.

### Closed as already fixed (not in scope)

| Report | Fixed by | Evidence on main |
|---|---|---|
| #268 (archived task stays in my_claims, counted claimed and done) | de5f686d (2026-10-19), after the 926159dd repro | `my_claims` (session-service.ts:496-499) and the plan counts (packages/core/src/task-workflow.ts:1382-1383) read claims through `extractHeldClaim`, which returns nothing for a terminal task (task-workflow.ts:1188-1191). Code reading only; AC-DC2-1 keeps a regression assertion. |

### Partly fixed on main (the open half is in scope)

- #3: the `system` author half was fixed by 32efa83c. The claimless-session half is D1.
- Local "lore ac add/set silently demotes": the `ac add` half is fixed, because `addCriterion` passes no status (ac-service.ts:14-20, :509-514). The `ac set` half is D18.
- #152 vs #84: the RunService part of #152 is fixed (run.ts:177-186 uses `app.runService`). The CLI part is D23, which lands after D22 (#84).
- #187: the spec was deprecated at v11 (2026-10-12), but `lore verify` still runs criteria of a deprecated spec, only warning (verify-runner-service.ts:1073-1077). D17 supersedes the criteria.

## Scope

### D1 — Session snapshot and resume report what the queue, the sessions and the handoffs actually say

- Reports: #3 (claimless writers are invisible in `active_sessions`), #267, #269.
- Root cause:
  - `pending_reviews` is `allDocs.filter(d => d.status === "draft")` (packages/lore/src/service/session-service.ts:488-493). That is a second, wrong copy of the review-queue predicate in `ReviewService.pending` (review-service.ts:549-590).
  - `active_sessions` is derived from claims only (`computeActiveSessionsFrom`, session-service.ts:1211-1225).
  - `resume` builds its candidate set without the archived/deprecated/invalidated filter that bootstrap applies at :561-562 (session-service.ts:1053-1062).
- End state:
  - Bootstrap and `ReviewService.pending` call one predicate, `isPendingReviewDoc` (pending-queue.ts, created by D11).
  - `active_sessions` is the union of claim holders and registered runs that wrote an audit entry inside the claim TTL window and have not ended. Each row carries `basis: ("claim" | "write")[]`.
  - Resume and bootstrap pick handoffs through one shared candidate function that drops archived, deprecated and invalidated handoffs.

### D2 — A seat is a plan's seat, and removing it removes worktree and branch

- Reports: #270, #271, #272, #301.
- Root cause:
  - `SeatService.enter` never checks `plan.type` (packages/lore/src/service/seat-service.ts:190-193).
  - Both app factories turn a `ready()` error into `{anchor_conflicts: []}` (packages/lore/src/app.ts:1024-1027, :1441-1444).
  - `wrapStepError` says "seat entry step" for every step (seat-service.ts:146-152).
  - `remove()` only removes the worktree (:333-334).
  - `isMerged` runs before `force` is considered (:312-313), against the literal branch `"main"` (:128).
  - The worktree path falls back to the branch name (:329).
- End state:
  - A non-plan target is refused with exit 4 (`gate:seat-entry:not-a-plan`).
  - Readiness errors propagate as a `Result`.
  - Step errors name their verb.
  - `remove` deletes the worktree and then the branch (`GitPort.branchDelete`).
  - `--force` skips the merge check entirely. The base branch is the main checkout's checked-out branch.
  - A seat with no registered worktree is refused with exit 4 (`gate:seat-remove:not-found`).

### D3 — Install, check and flag validation agree about retired files and unreadable ledgers

- Reports: #115, #196, #257, #258.
- Root cause:
  - `planInstall` removes every ledger path that is absent from the payload without comparing its sha (packages/core/src/setup-manifest.ts:405-409; deleted at setup-service.ts:650-653; no backup).
  - `planUpdate` never classifies such a path (packages/core/src/plan-update.ts:315-317), so `--check` reports in sync.
  - `readInstalledManifest` maps every read error to `ok(null)` (packages/lore/src/adapters/cli/setup-check.ts:301-305).
  - `validateSetupFlags` never sees `--force-diverged` (setup-args.ts:149; commands/setup.ts:1244-1249).
- End state:
  - A sixth freshness state, `retired`, counts toward `stale` and is the only source of install removals.
  - An edited retired file is treated as diverged (BR-818): kept and listed, or backed up then removed under `--force-diverged`. The receipt lists removals.
  - Only ENOENT means a fresh target; any other read error exits 1 naming the manifest.
  - `--force-diverged` with dry-run, uninstall or project exits 2.

### D4 — Project uninstall reverses everything project setup wrote

- Reports: #260, #261.
- Root cause:
  - The prior `core.hooksPath` is read only for the receipt (packages/lore/src/flows/setup-project-flow.ts:1302-1322).
  - Rules files and the `language` key are written outside the project ledger (packages/lore/src/adapters/cli/commands/setup.ts:655-679).
  - Uninstall reverses ledger entries only (BR-840).
- End state:
  - The project ledger records every write, including the prior hooksPath and the prior language value.
  - Uninstall restores or unsets each of them and removes the lore-owned rules files. Files lore did not write stay byte-identical.

### D5 — `lore init` is one atomic scaffold that seeds the config template and the write-spec rule document

- Reports: #207, #256, local "lore init does not seed the verification-profiles config", local "spec-create gate missing-rule-doc remediation points to a dev-repo script".
- Root cause:
  - `lore init` is a second, hand-rolled initialiser with no rollback and no template (packages/lore/src/adapters/cli/commands/init.ts:63-98), beside `initCorpusAt` (flows/init-corpus.ts:103-140).
  - Both hard-code a .gitignore without the check cache (init.ts:76-79; init-corpus.ts:112; cache path setup-check.ts:181).
  - The gate's missing-rule text names a dev-repo script (commands/gate.ts:323-326), and no init path seeds the rule doc.
- End state:
  - `lore init` calls `initCorpusAt`, built in a sibling temp directory and renamed into place.
  - One .gitignore constant includes `.lore-project-check.json`.
  - The shipped config template is seeded, including `workflow.verification_profiles`.
  - The approved write-spec rule document is seeded from a shipped asset (content moved out of scripts/seed-write-spec-rule.ts; the script is deleted). This is BR-807 as modified.
  - The gate names only commands a consumer has.

### D6 — A deleted document is not addressable, and deletion is reversible as promised

- Reports: #70, #83, #86, #295.
- Root cause:
  - `resolveDoc` returns deleted docs on every branch (packages/lore/src/service/resolve.ts:84-114). So approve/reject (review-service.ts:259-260, :699, :1002), set, invalidate, link and `baseline set-label` (rule-service.ts:499-501) act on them.
  - Delete writes a version-0 sentinel (corpus-service.ts:3999-4004, :4022).
  - Nothing clears `deleted_at`, although delete promises 30 days of recovery (commands/delete.ts:15, :51).
- End state:
  - `resolveDoc` returns `DOC_NOT_FOUND` (exit 3) for a deleted doc, naming the date and `lore undelete`.
  - Delete writes version N+1 with action `delete`.
  - `lore undelete` (service, CLI, MCP) clears `deleted_at` within `recoverable_until`, writing version N+1 `undelete`. After the window it exits 4.

### D7 — One parent link that always agrees with parent_id; honest link and unlink outcomes

- Reports: #249, #250, #251.
- Root cause:
  - A new parent row is inserted without removing the old one (packages/lore/src/store/sqlite-store.ts:1566-1590; same in turso-store.ts and in-memory-store.ts).
  - `unlink` is not transactional and never clears `parent_id` (corpus-service.ts:5420-5432).
  - `unlink` returns `ok` when nothing was removed (:5434-5449).
  - `link` never compares from and to (:5254-5300).
- End state:
  - A unique partial index (migration-026) allows one parent row per doc. Re-parenting replaces the old row.
  - Unlink is one composite write that clears `parent_id`, or exits 4 `PARENT_REQUIRED` when the type requires a parent.
  - Unlinking a pair with no link exits 3 (`LINK_NOT_FOUND`).
  - A self-link exits 4.

### D8 — `lore set` validates titles and protects writer-owned extra on every route

- Reports: #246, #247.
- Root cause:
  - `docPatchSchema.title` is a bare optional string (packages/core/src/schemas.ts:817), and create's title is only `min(1)` (:614).
  - `DEDICATED_EXTRA_KEYS` has no knowledge `uat` entry (packages/core/src/dedicated-extra-keys.ts:28-39), so the guard at corpus-service.ts:402-420 lets MCP `lore_set` rewrite a verdict.
- End state:
  - One trimmed, non-empty title schema for create and patch.
  - Dedicated keys can be scoped by knowledge sub_type (`uat` → `lore uat record`, `handoff` → `lore handoff`), refused with exit 4 on CLI, MCP and HTTP (BR-629's mechanism).

### Citation notes

- D15: no live rule covers per-criterion supersession, which is a new capability. BR-163 is cited because verify's selection changes. A rule is added to baseline-declare-an-acceptance-criterion after landing.
- D19 cites debt-registry rules AD-1 and AD-2, which the fix retires.
- D23 cites BR-925 as modified (reads go through the selected store).
- Help/comment text folded into D11, D18 and D20 has no rule of its own. The ACs of those groups assert it alongside their cited behaviour.

## Acceptance Criteria

Structured ACs AC-DC2-1..AC-DC2-8 (`lore ac list`).


## Acceptance Criteria (structured)

- [·] [script] AC-DC2-1: Throwaway corpus (mkdtemp + git init + lore init; HOME and XDG_CONFIG_HOME temp). Fixture: one plain draft spec, one in-review spec, one draft task, one draft retro knowledge doc, one invalidated draft knowledge doc. (a) `lore bootstrap --json` exits 0 and `.data.pending_reviews.count` equals the length of `lore pending --json` `.data` (expected 2), and is not equal to the number of draft rows (4). (b) Two handoffs on plan P, the NEWER one archived: `lore feed session-resume --plan P --json` exits 0 and returns the OLDER slug. (c) A registered run R that wrote `lore create spec` and holds no claim appears in `.data.active_sessions` with `basis` equal to ["write"]; a claiming session has basis containing "claim". (d) Regression for #268 (fixed by de5f686d): a claimed then archived task is absent from `.data.my_claims` and its plan reports claimed 0, done 1. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a fixture of plain drafts only (both counts equal 1 even with the wrong predicate); archiving the OLDER handoff (newest-wins passes without the filter); a writer that also holds a claim (claim-only derivation lists it). Each is excluded by the fixture and the count-inequality assertion in (a). Made red once by replacing the pending predicate call in session-service.ts bootstrap with `d.status === "draft"`.
  script: test — bun run test:file packages/lore/tests/integration/dc2-session-bootstrap-counts.bun.test.ts && echo 'AC-DC2-1 PASS: bootstrap pending count equals lore pending; archived handoff not resumed; claimless writer listed'
- [⚑] [script] AC-DC2-2: Throwaway git repo + corpus with a committed PRD and plan. (a) `lore seat <prd-slug>` with a clean main exits 4, stderr contains `gate:seat-entry:not-a-plan` and `prd`; `git branch --list 'plan/*'` and `git worktree list` are unchanged. (b) After entering and merging seat S, `lore seat remove <plan>` exits 0 and both the worktree path and `git branch --list plan/<short>` are gone. (c) A second `lore seat remove <plan>` exits 4 with `gate:seat-remove:not-found`, and stderr does not contain `seat entry step`. (d) In a repo whose checked-out branch is `trunk` (no `main`), `lore seat remove <plan> --force` on an unmerged seat exits 0 and removes worktree and branch; without --force it exits 4 with `gate:seat-remove:unmerged`. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a target type whose ready() call succeeds (refusal never exercised) or a dirty main (refused for the wrong reason); asserting only that the worktree path is gone (true today while the branch survives). The test keeps main clean and asserts the branch list. Made red once by removing the `plan.type !== "plan"` check from SeatService.enter.
  script: test — bun run test:file packages/lore/tests/integration/dc2-seat-lifecycle.bun.test.ts && echo 'AC-DC2-2 PASS: non-plan seat refused exit 4; remove deletes worktree and branch; --force skips merge check'
- [⚑] [script] AC-DC2-3: Temp agent-settings dir; payload injected through the assets root. Ledger tracks X (sha A); the payload no longer ships X. (a) X on disk with sha B (user-edited): `lore setup --yes` exits 0, X is byte-identical afterwards and listed under skipped (diverged); with `--force-diverged` X is copied to `.lore-backups/<run>/X` before removal and the receipt lists it under `Removed:`. (b) X on disk unedited: `lore setup --check --json` exits 3, `.files.retired` equals [X], summary `stale`. (c) `lore setup --dry-run --force-diverged`, `--uninstall --force-diverged --yes` and `--project --force-diverged --yes` each exit 2 with stderr naming `--force-diverged` and the other flag. (d) Manifest chmod 000: `lore setup --check` exits 1 and stderr names the manifest path; manifest deleted: exit 3 (fresh) — the two outputs differ. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a retired file with sha equal to the ledger (removal is correct today) or a retired file already absent from disk (check is in sync either way). The fixture uses an edited, present file. Made red once by restoring planInstall's removals to `.filter((path) => !payloadPaths.has(path))` without the sha comparison.
  script: test — bun run test:file packages/lore/tests/integration/dc2-setup-install-retired-files.bun.test.ts && echo 'AC-DC2-3 PASS: edited retired file kept or backed up; retired state stale; force-diverged combos exit 2; unreadable manifest exit 1'
  other_command=2
- [⚑] [script] AC-DC2-4: Throwaway repo with `git config core.hooksPath .husky`, a user file `.claude/rules/mine.md`, and project `context.language: zh` with a prior `language: en` in `.claude/settings.local.json`. `lore setup --project --yes` then `lore setup --project --uninstall --yes`, both exit 0. Afterwards: `git config --get core.hooksPath` prints `.husky`; no `.claude/rules/lore-*.md` remains; `mine.md` is byte-identical; `settings.local.json` `language` is `en`. Control repo with no prior hooksPath: after uninstall `git config --get core.hooksPath` exits 1 (unset). SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a repo without a prior hooksPath and without user rules files (an uninstall that only unsets looks right). The fixture has a prior value and a user file. Made red once by dropping the hooksPath prior-value entry from the project ledger write in setup-project-flow.ts.
  script: test — bun run test:file packages/lore/tests/integration/dc2-setup-project-uninstall-reversal.bun.test.ts && echo 'AC-DC2-4 PASS: project uninstall restores prior hooksPath and language and removes lore rules files only'
- [⊖] [script] AC-DC2-5: Plain `lore init` (never setup --project) in a temp git repo. (a) Run under `sh -c 'ulimit -f 0; lore init'`: exit 1 and `.lore` does not exist; a second plain `lore init` exits 0. (b) `.lore/.gitignore` lines equal the set {lore.db, lore.db-wal, lore.db-shm, .lore-project-check.json}; after `lore setup --project --yes && lore setup --project --check`, `git status --porcelain` lists no `.lore/.lore-project-check.json`. (c) `.lore/config.yaml` contains `workflow.verification_profiles` and `lore status` does not print `Verification profiles: not configured`. (d) Right after init, `lore list --type knowledge --json` holds exactly one approved doc with extra.sub_type `skill` and extra.skill.applies_to `spec`, with one version and one audit entry (rule BR-807 as modified); a refused `lore gate spec-create` pack contains a non-empty `## Rule` section and no `bun scripts/`. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): exercising `lore setup --project` (which already seeds the template) instead of plain `lore init`; a failure injected after the db exists (self-heals today). The test uses plain init and fails the first write. Made red once by removing `.lore-project-check.json` from the shared gitignore constant.
  script: test — bun run test:file packages/lore/tests/integration/dc2-init-scaffold.bun.test.ts && echo 'AC-DC2-5 PASS: failed init leaves no .lore; gitignore covers check cache; template and write-spec rule doc seeded'
  other_command=1
- [⚑] [script] AC-DC2-6: Throwaway corpus. Draft knowledge doc D (v1) and baseline leaf B; `lore delete D --confirm` and `lore delete B --confirm` exit 0. Addressing D BY SLUG: `lore approve D`, `lore reject D`, `lore set D --title x`, `lore invalidate D ...`, `lore link X D`, `lore get D` and `lore baseline set-label B Y` each exit 3 and stderr contains `deleted` and `lore undelete`; `lore audit D --json` entry count is unchanged by those calls. `lore log D --json` shows the delete row as version 2, action `delete` (no version 0). `lore undelete D` exits 0, D appears in `lore list`, and the log gains version 3 action `undelete`; then `lore approve D` behaves as for any draft. Undelete after `recoverable_until` (time seam) exits 4. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): approving an already-approved deleted doc (refused for a different reason) or testing only approve (set-label goes through rule-service). The fixture deletes a DRAFT and runs every verb, addressing by slug. Made red once by removing the deleted_at check from resolveDoc's slug branch only.
  script: test — bun run test:file packages/lore/tests/integration/dc2-soft-delete-lifecycle.bun.test.ts && echo 'AC-DC2-6 PASS: every verb refuses a deleted doc exit 3; delete writes N+1; undelete restores'
  other_command=3
- [·] [script] AC-DC2-7: Throwaway corpus, docs K, A, B. (a) `lore link K A --type parent` then `lore link K B --type parent`: both exit 0; `lore get K --json` shows exactly one outgoing parent link (to B) and parent_id B. (b) `lore unlink K B`: either exit 0 with parent_id null, or exit 4 with `PARENT_REQUIRED` and parent_id still B; which branch is pinned by the core schema's parent requiredness for K's type, and in no case does exit 0 leave parent_id equal to B. (c) `lore unlink A B` with no link between them exits 3 with `LINK_NOT_FOUND`; `--json` has ok:false. (d) `lore link K K` exits 4 and `lore get K --json` lists no self-link. Each case is run against SQLiteStore and InMemoryStore. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): checking only parent_id after re-parenting (updated today) or only the tree view; an unlink test on a pair that HAS a link. The test counts parent link rows. Made red once by deleting the old-parent-row removal from addLinkWithProvenance in sqlite-store.ts.
  script: test — bun run test:file packages/lore/tests/integration/dc2-link-integrity.bun.test.ts && echo 'AC-DC2-7 PASS: one parent row agrees with parent_id; no-op unlink exit 3; self-link exit 4'
- [⚑] [script] AC-DC2-8: Throwaway corpus. (a) `lore set D --title "   "` and `--title ""` exit 4 naming `title`; D's version is unchanged; `lore create knowledge --title "   " ...` also exits 4. (b) After `lore uat record P --json-file accept.json`, an MCP `lore_set` on the uat doc with a changed `extra.uat.verdict` returns isError with a message naming `lore uat record`, and `lore uat show P` still prints the accept verdict; the same patch through CLI `lore set --extra` and HTTP PATCH is refused identically; resending the unchanged `extra.uat` is accepted. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a test that sends only an empty string (min(1) already refuses on create) or that goes through CLI only (MCP is the reported route). The test sends whitespace and uses MCP. Made red once by removing the knowledge/uat entry from DEDICATED_EXTRA_KEYS.
  script: test — bun run test:file packages/lore/tests/integration/dc2-set-validation.bun.test.ts && echo 'AC-DC2-8 PASS: blank title refused exit 4; extra.uat rewrite refused on MCP CLI HTTP'
  other_command=2
