---
id: KN-088
type: knowledge
role: knowledge
title: "Retro — 2026-07-20 whole-repo static bug audit + fix sweep (15 findings, all fixed)"
status: approved
priority: medium
created: 2026-07-20
updated: 2026-07-24
tags: []
parent: PRD-001
---
# Retro — 2026-07-20 whole-repo static bug audit + same-day fix sweep

## What ran

Six parallel read-only specialist scans (logic / boundary / error-handling / async-concurrency / security / type-safety) over 278 non-test source files (~72k lines: packages/core, packages/lore, packages/dashboard, scripts/, hooks/, assets/hooks/). User-directed emphasis: edge cases. Findings: 15 (0 critical / 4 high / 7 medium / 4 low). All 15 fixed the same day across 6 worktree implementer batches + orchestrator direct hook edits; final oracles green (tsc 0 errors, vitest 261 files / 4757 tests, bun test 961 tests).

## High findings (all fixed)

- **BUG-001** UTF-16 code-unit truncation split surrogate pairs; a lone surrogate does NOT round-trip through bun:sqlite (silent corruption, empirically reproduced). Fix: code-point-safe `headChars`/`tailChars` in `@lore/core` (`packages/core/src/truncate.ts`, O(1) boundary check), 4 call sites deduped (evidence/handoff/verify-executor/assessment).
- **BUG-002** `CorpusService` create/set/delete wrote doc + version + audit as three non-transactional store calls. Fix: `StoreInterface` atomic composites `insertWithProvenance`/`updateWithProvenance`/`softDeleteWithProvenance` — SQLite `BEGIN IMMEDIATE`, Turso `client.transaction("write")`, InMemory undo-on-failure.
- **BUG-003** Dashboard PATCH If-Match was advisory-only (route pre-check on a separate read; `set()` CAS'd against its own fresh read) — classic TOCTOU lost update with no 409. Fix: `CorpusService.set(id, patch, {expectedVersion})` threads the client's If-Match into the actual store CAS; STALE_VERSION → 409 ConflictPayload.
- **BUG-004** The 2026-07-18 "Phase F removed from BOTH copies" claim was false: `assets/hooks/session-start-resume.mjs` (the `lore setup` distribution SSOT) still shipped the blocking 30s session-start test run, while the installed copy conversely lacked SPEC-057 seat-branch threading — bidirectional SSOT↔installed divergence invisible to the presence-only assets manifest tests. Fix: both copies byte-identical (Phase F gone, seat-branch kept) + a content-level regression assertion in assets-ssot.

## Medium/low (all fixed)

status --check-tree --fix now always prints residual non-fixable drifts (was: bare "Tree is consistent" hiding exactly-one missing drift); `parsePositiveIntArg` guards every numeric CLI flag + HTTP routes return 422 (was: NaN → silent-empty results / raw SQLite "datatype mismatch" 500); tree depth NaN + hard `buildTreeNode` cap; staleness negative-limit fail-loud; claim-gate write-then-verify TOCTOU hardening (task+phase, both-rollback documented as loud+retriable); phase-migration mid-loop failure now reports partial progress ("N phases / M tasks / K evidence before failure — safe to re-run"); migration-006 catch restores `PRAGMA foreign_keys=ON`; provider stdin EPIPE guard; g1 `--content-file` realpath containment (TARGET_CWD, /tmp, $TMPDIR; outside → UNRESOLVED_CONTENT_FILE fail-open); fs-probe realpath symlink containment (escape → probe_error).

## Verified-clean surfaces (audit negative results, load-bearing)

SQL fully parameterized incl. IN-lists; FTS5 via escapeFtsQuery; all spawns argv-array (no shell:true), seat branch names sanitized pre-git; dashboard zero dangerouslySetInnerHTML, react-markdown without rehype-raw; auth tokens crypto.getRandomValues + SHA-256 at rest + CSRF Origin allowlist; same-doc claim/evidence RMW correctly CAS-protected; LLM JSON uniformly safeParse'd; 'phase' DocType exhaustively handled. Async coverage was PARTIAL (agent stalled): turso sync-push ordering, http/sessions, most mcp handlers, dashboard React races remain unaudited.

## Process lessons

1. **Implementer no-commit + orchestrator blind cleanup (data loss, recovered).** One implementer reported STATUS: DONE with full oracle evidence but never committed; orchestrator merged ("Already up to date" on an empty branch — the tell), then worktree-removed --force, destroying the tree. Recovery: 3 of 4 source fixes resurrected from dangling `git stash` commits (`git fsck` → "On worktree-<id>: wip-bugNNN" → `git diff sha^1 sha | git apply`); the rest rebuilt using the completion report as spec. Rules going forward: orchestrator MUST verify `git log` on the branch BEFORE merge+cleanup; an empty branch after a DONE report = protocol violation → recall the agent, never clean.
2. **SSOT↔installed asset pairs need content parity/invariant assertions, not manifest presence.** BUG-004 survived 205 green assets-ssot tests.
3. **A stalled subagent can be recalled with "converge and dump what you have"** — the async scanner stalled at 600s, was recalled via SendMessage, and returned 3 confirmed findings incl. one high (BUG-003) plus an honest not-covered list.

## Follow-up (same day) — async blind-spot sweep

Two scoped specialists re-covered the first async scan's admitted blind spots. 4 findings, all fixed same-day:

- **ASYNC2D-001 (critical, dashboard)** — If-Match built from the CURRENT render's `doc.version` while TanStack Query v5's default `refetchOnWindowFocus` (never disabled) silently adopted a concurrent writer's version mid-edit → server CAS passed → silent lost update, ConflictModal never fired. Fix: `editBaseVersion` frozen at Edit-click (alongside the existing `editorSeed` freeze, `lib/edit-session.ts` pure helper) + focus/reconnect refetch disabled while editing.
- **ASYNC2D-002 (high, dashboard)** — NewDocModal: native form submit via Enter in an enabled input bypassed the button-only `disabled` guard → duplicate doc creation. Fix: `isPending` early-return + input disabling (+ route-level `isCreating` guard).
- **ASYNC2-002 (medium)** — `ReviewService.approve` plan-promote gate read the ancestor spec before the plan's CAS write, no re-validation at commit (cross-doc TOCTOU, same class as the claim gate). Fix: write-then-verify + self-rollback (BUG-011 pattern). spec-promote analyzed: NOT affected — its gate reads only same-row fields the CAS already guards.
- **ASYNC2-001 (low)** — `ApiKeyStore.create` UNIQUE(name) race fell to raw STORE_ERROR; now mapped to the friendly VALIDATION_ERROR (same style as docs.slug handling).

Verified-clean in this sweep: turso transaction/CAS usage, sessions.ts (fully synchronous), MCP tool handlers (no floating promises, sequential lore_batch), remaining dashboard double-fire guards, doc-switch fetch races (query-key structure). Still unaudited (honest residue): setup-service internals, http/routes.ts v1-API tail, ~10 smaller dashboard components.

Incidental find: an external skill-sync process deposited the SPEC-046-excluded personal `lore-uat/evals` fixture into `assets/` mid-session (broke 3 manifest-conformance tests — removed, personal source intact) and brought a legitimate `plan/`→`lore-plan/` ref fix in lore-design-ui (kept, committed). Final oracles after everything: tsc 0 errors, vitest 263 files / 4772 pass, bun test 963 pass.
