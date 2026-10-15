---
id: KN-198
type: knowledge
role: knowledge
title: "Retired from root CLAUDE.md — the Implementation Status section, verbatim"
status: archived
priority: medium
created: 2026-08-04
updated: 2026-10-10
tags: []
parent: PRD-001
links:
  - {id: ADR-013, type: relates-to}
---
# Retired from root CLAUDE.md — the "Implementation Status" section, verbatim

Retired 2026-08-04 by `agent:main-orchestrator` during the contract-conformance slim-down
(`lore governance claude-md`: a root CLAUDE.md is organized under EXACTLY five headings —
What This Is / Commands / Architecture / Module Index / Finding Live Project State;
"Implementation Status" is not one of them, and the contract's own table routes
`Status narratives → OUT — corpus`).

Measured at retirement: this section was **3986 bytes / 13 lines = 16.6%** of a file that stood
at 24526 bytes / 207 lines, against an official target of 200 lines.

**Why it had to go, with evidence rather than principle**: this section produced a MEASURED
false instruction. Its SPEC-043 bullet asserted that "list/search reads filter invalidated docs
by default (`--include-invalid` restores, badged)". Measured 2026-08-04 on `main`: `lore list`
excludes nothing on either surface, `--include-invalid` is silently inert (604 rows both ways,
identical slug sets), and no `--json` record carries a validity field. The claim was corrected
in-place the same day, and the underlying defect filed as
`task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in`. A second bullet (SPEC-042's
`active_sessions`) went stale the same week and was likewise rewritten. Two drifted statements
in one section in one week is the contract's "if it stopped being true yesterday, it is an
event, not discipline" arriving on schedule.

**Where the surviving content lives now**:
- Per-spec mechanism detail — the governing spec doc (`lore get SPEC-0NN`, or
  `lore search "<topic>"`). That was already declared the SSOT by this section's own opening
  line, which makes the section a second copy by construction.
- Cross-cutting ⛔ prohibitions extracted from it — kept in root CLAUDE.md under Architecture,
  as one-line disciplines with no mechanism narrative.
- Full pre-2026-07-22 mechanism subsections — `docs/claude-md-archive/spec-implementation-notes.md`
  (§Implementation Status), FROZEN.
- The verbatim text below, plus git history.

---

## Verbatim text as retired

Phase 1 (core + CLI + service layer) and Phase 2 (MCP, HTTP, Turso sync, telemetry, tree
conformance, eval) are landed; active work is incremental hardening. Full mechanism subsections
are archived verbatim in `docs/claude-md-archive/spec-implementation-notes.md`
(§Implementation Status); per-spec SSOT via `lore get <spec-slug>`. Operational essentials:

- **Service-layer gate enforcement is ON by default** — `GateEnforcer` runs the same
  `checkpointRegistry` predicates as `lore gate` inside `CorpusService.create`/`set`,
  `ReviewService.approve`, `TaskWorkflowService.claim` — so CLI, MCP, and HTTP dashboard writes
  are gated identically. Per-checkpoint knob: `workflow.gates.<checkpoint>.enabled: false`.
  Optional DI: bare `new CorpusService(store)` test constructions stay ungated.
- **Plan phases (SPEC-023)**: `lore phase add/list/rm/rename <plan>`, `lore create task --phase`,
  `lore tree` groups by phase; `extra.phase` is validated against the MEMBER plan's
  `extra.phases[]` (`extra.plan_id` via `isPlanMember`, never the `parent_id` proxy) at write
  time (unknown → `VALIDATION_ERROR`).
- **Task workflow (SPEC-025)**: `extra.verification_evidence` (append-only, max 50 entries,
  `output_tail` ≤ 4000) + `extra.claim` advisory lease (expiry computed read-side vs
  `workflow.claim_ttl_minutes`, default 120; no daemon) — both owned exclusively by
  `TaskWorkflowService`, never `CorpusService`. `lore claim` (foreign fresh claim → exit 5
  `CLAIM_CONFLICT` unless `--steal`; `--worktree` ALWAYS explicit) / `lore release` (non-holder
  needs `--force`) / `lore evidence` / `lore ready` (computed over `blocks` links, never stored) /
  `lore done` (needs a RUNNER-ATTESTED pass — a self-reported `lore evidence` row no longer
  archives; audited `--override-attestation "<reason>"` escape —
  spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3). Actor resolution:
  `--by` > `$LORE_ACTOR` > OS username; MCP tools require `by` explicitly.
- **Sessions + file anchors (SPEC-042)**: a "session" is DERIVED, never stored — claims grouped
  by `(by, machine, worktree, session_id)`; `lore ready` (`sessions[]`/`anchor_conflicts[]`) is
  plan-scoped/fresh-only, `lore bootstrap` (`active_sessions`) is corpus-wide and FLAGS `stale`
  (⛔ ≠ death). `extra.file_anchors` authored via `lore create task --anchor` /
  `lore anchor add|rm|list` — deliberately NO `lore set --anchor` (`set` replaces `extra`
  wholesale). **`by` answers WHO, `extra.claim.session_id` answers WHICH RUN** —
  `TaskWorkflowService.claim` captures it from the env for every caller, no flag, because actor
  resolution structurally cannot carry session distinctness. `noAnchorOverlap` runs
  UNCONDITIONALLY and exempts a same-`by` sibling ONLY on a PROVEN same `session_id`; a
  different one is FOREIGN, an ABSENT one refuses with `ANCHOR_OVERLAP_SESSION_UNMEASURED`.
  ⛔ A session-collapse report is NEVER fixed by prescribing a more unique `LORE_ACTOR`;
  distinct `LORE_ACTOR=agent:<branch-or-slug>` still matters for AUDIT attribution, and claims
  are made BY THE IMPLEMENTER from inside its own worktree. Undeclared anchors are invisible to
  the gate — manual queueing stays defense-in-depth. `PhaseWorkflowService.claim` +
  `lore gate phase-claim` thread it identically (`phase-wiring.ts`).
- **Invalidation (SPEC-043)**: `ValidityService.invalidate` is the SOLE validity writer
  (`CorpusService.set` rejects validity patches, naming `lore invalidate`); direct-address reads
  (get/feed/tree/export) ALWAYS show the banner; `--supersedes` half-failure is LOUD with the
  exact repair command. ⛔ A listed doc is NOT proven live — validity is authoritative only by
  direct address.
- **Staleness probes (SPEC-044)** are on-demand, report-only (never auto-invalidate);
  **`lore assess` (SPEC-026)** has no non-AI mode and one corrective JSON retry — details in the
  archive.

The v1 predecessor at `/Users/apple/.claude/docman-mcp` remains frozen. Do not carry over its
schema or API shape — v2 is greenfield.
