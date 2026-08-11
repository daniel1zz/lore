---
id: KN-040
type: knowledge
role: knowledge
title: "Retro — IoC P2+P4 build under score-gated autonomy (adversarial-review findings + migration/MCP-gate learnings)"
status: approved
priority: medium
created: 2026-07-09
updated: 2026-07-14
tags: [ioc, p2, p4, retro, review, autonomy, migration, mcp-gate]
parent: PRD-001
links:
  - {id: ADR-002, type: informs}
---
## Context

Single session (2026-07-09) resuming from a handoff to build **P2** (workflow state machine) and **P4** (feed-before-produce + provenance) of the corpus-governed IoC ADR, under a mid-session user directive: **score-gated autonomy** — agent decides + executes; human intervenes only when a judgment scores below threshold. P1 was already done; P3 was covered by slice-1 + P2's hooks. Result: the whole ADR (all 4 capabilities) is now implemented.

## What shipped

- **P2** (spec `spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr`, plan + 6 tasks): `checkpointRegistry` generalizing slice-1's 2 hardcoded checkpoints; commit-time cross-tier gates `plan-promote` (parent spec approved+AC) + `task-claim` (plan's parent spec approved), upgrading SPEC-032's `upstream_unapproved` advisory to a deterministic block; `workflow.gates.*` config; hooks G3/G4.
- **P4** (spec `spec-p4-upstream-downstream-linkage-feed-before-produce-protocol`, plan + 4 tasks): `lore feed`/`lore_feed` MCP deterministic pull (SSOT with the gate's violation pack via shared `flows/feed-flow.ts`); `governs` link type + migration-004; provenance auto-write at `_createImpl` (fail-soft, idempotent); `--governed-by` reverse query.
- **Review-fix** (commit 5af9072): 4 defects the "all-green" implementation still contained, found by adversarial review.

## Learnings (durable — apply next session)

1. **"All tests green" ≠ correct. Adversarial review is not optional.** P2+P4 passed 2900+ tests and still shipped 1 critical + 3 high defects. Independent reviewers (3 parallel, distinct lenses) + independent re-verification by the main agent found every one. Budget a review pass with real skeptics for any gate/security/migration work.
2. **Migration atomicity trap (bun:sqlite).** `Database.exec()` runs a multi-statement string with **per-statement autocommit** — NOT a transaction. Additive `CREATE TABLE IF NOT EXISTS` migrations are crash-safe by construction; any migration that **mutates existing data** (table-recreate to widen a CHECK constraint) MUST wrap in `BEGIN IMMEDIATE; … COMMIT;` + `DROP TABLE IF EXISTS <temp>` + a caller-side rollback wrapper, or a mid-migration crash bricks the corpus on re-run. `@libsql/client.executeMultiple` already self-rolls-back; bun:sqlite does not.
3. **Gate hooks must cover the MCP surface, not just Bash.** A PreToolUse gate wired only to the `Bash` matcher is fully bypassable via the MCP default agent surface (SPEC-024). Every gate hook needs BOTH a `Bash` branch AND an `mcp__.*<tool>.*` matcher + an MCP-payload branch in the shim. (g2 had this gap too; fixed alongside g3.)
4. **Soft-delete ≠ status change.** `softDelete` stamps `deleted_at` and leaves `status` untouched. Any predicate reading only `status` will treat a withdrawn-but-approved doc as live. Gate/readiness logic must thread `deleted_at`.
5. **PreToolUse allow cannot carry `additionalContext`** (Tier S: code.claude.com/docs/hooks). Only UserPromptSubmit/SessionStart/PostToolUse/Stop can. So proactive "push" feeding at a PreToolUse allow is infeasible — deterministic `lore feed` **pull** is the guaranteed feed-before-produce surface.
6. **Anti-hallucination discipline paid off.** A subagent's WebFetch of sqlite.org returned a fabricated "PRAGMA user_version is not transactional" claim; the subagent distrusted it, re-fetched for a verbatim quote (found the fabrication), then verified empirically against the actual bun:sqlite runtime. Non-eyewitness facts are default-untrusted — this caught a real fabrication.
7. **The gate hook can't expand shell variables** in a `--content-file "$VAR/x.md"` path (crude regex parse) → false `MISSING_SKELETON` block. Pass literal absolute paths to `lore create spec` when the g1 gate is armed. Also: lore's 10-char display ID prefix is NOT resolvable — use the full ULID or the slug.
8. **Dogfood confirms the loop is real.** Approving the P2 plan itself passed through the newly-built G3 gate; `lore feed spec-create` returns the write-spec skill on the live corpus. The system governs its own production chain.

## Tracked follow-ups — ALL RESOLVED (2026-07-10)

All eight items below were cleared in a single follow-up session (2026-07-10), each verified against the full oracle (typecheck clean · vitest 3022 · bun 757) and landed on `main`. The `[arch]` item got an independent adversarial review that surfaced one HIGH defect (fixed) — see the resolution note after the list.

- ✅ **[med] SSOT literal dup** — RESOLVED (`4b8a588`). Deleted `SPEC_CREATE_SKILL_APPLIES_TO` from gate.ts; both sides now derive from feed-flow.ts's `CHECKPOINT_PRODUCED_TYPE` SSOT map via a fail-loud `requireCheckpointProducedType` (no silent default).
- ✅ **[med] `upstreamApproved` vs `evaluateReadiness` dual impl** — RESOLVED (`4b8a588`). Hoisted `UPSTREAM_APPROVED_STATUSES` into `@lore/core` (task-workflow.ts, the dependency-graph leaf); gate-predicates.ts imports it. Added a cross-check test pinning both sides to the same status matrix (`active` does NOT clear).
- ✅ **[low] `lore list --governed-by` silently ignores other filters** — RESOLVED (`6e62c3c`). Now fails loud (exit 2, naming the conflicting flags) instead of silently dropping `--type/--status/--author/--since/--tag/--plan-id/--phase`.
- ✅ **[low] dashboard `LinksPanel.tsx` `<select>`** — RESOLVED (`f4b8367`). Derives the option list from `linkTypeSchema.options` (Zod enum runtime array) — can never drift from the `LinkType` union again; `parent`/`governs` present, invalid `extends` gone.
- ✅ **[nit] `runTaskClaimGate` hardcodes `"gate: pass"`** — RESOLVED (`4b8a588`). The `parent_id===null` case now routes through the task-claim checkpoint (synthetic no-spec-parent context) — one `gate: pass` shape, not a second hardcoded literal.
- ✅ **[test] `p2-e2e-closed-loop.bun.test.ts` stale `dist/lore`** — RESOLVED (`bbb963a`). Shared `assertFreshBinary` helper throws loud if `dist/lore` is absent or older than `packages/{lore,core}/src` mtime; wired into p2-e2e-closed-loop AND gate-hooks (both spawn the compiled binary). Kept spawning the real binary (the point of the e2e) — just guarded freshness.
- ✅ **[test] provenance idempotency** — RESOLVED (`bbb963a`). Tightened the permissive `exitCode === 0 || undefined` assertion to `?? 0`. The `alreadyGoverns` pre-check was investigated and confirmed defensive-dead by construction (each `_createImpl` mints a fresh ULID, so a single-create flow can never already-govern its own new doc) — kept as documented defense-in-depth (Chesterton's Fence), backed by `store.addLink`'s own `DUPLICATE_LINK` dedup; observable idempotency (`governedBy.total === 1`) was already asserted.
- ✅ **[arch] defense-in-depth: service-layer gate** — RESOLVED (`ed96c41` + fix `1c0895a`). New `GateEnforcer` (reuses `checkpointRegistry`/`resolveGateEnabled` unchanged, zero duplicated predicate logic) is optional DI on CorpusService/ReviewService/TaskWorkflowService; `app.ts` wires it **default-ON** so MCP/HTTP/CLI `create`/`approve`/`claim` are all gated — closing the bypass. Bare-service unit tests stay ungated (absent-enforcer contract). Parent-spec context for plan-promote/task-claim comes via the injected `getPlanBundle` port (no cross-service import). ~35 app.ts-path integration tests reconciled (config-disable for incidental fixtures, or skeleton+AC added where the flow is under test — no assertion weakened). Breaking-change documented in root + service CLAUDE.md.

**Adversarial-review outcome for the `[arch]` item** (retro learning #1 applied — gate work gets real skeptics): 3 focus-area sweeps ran; F1/F2/F4/F6 clean. One **HIGH** defect found and fixed (`1c0895a`): `enforceClaimGate`/`enforceApprovalGate` ran `getPlanBundle` IO *before* the `resolveGateEnabled` check, so a config-disabled gate + a broken upstream lookup (e.g. a soft-deleted parent plan) still blocked the op — violating "disabled = byte-identical to pre-change." Fix adds `GateEnforcer.isEnabled(checkpoint)` as an early-out before the IO, mirroring `gate.ts`'s `isGateDisabledByConfig`-before-`runXGate` order; regression test (disabled gate + soft-deleted plan → claim succeeds) proven red-without-fix. One LOW (an unregistered-checkpoint `throw`) was judged unreachable by TypeScript's `Record<GateCheckpoint,…>` typing and left as a defensive assertion.

## Score-gated autonomy — outcome

19 scored judgments this session (①–⑱ + review⑲), all `CONF ≥ 80`. Zero human escalation during execution. The one place the agent stopped for the human was undefined-scope forks (P2/P4 scope + gate placement), exactly the intended boundary. Full log: `knowledge-p2-decision-score-log-score-gated-autonomy`.
