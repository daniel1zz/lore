---
id: SPEC-070
type: spec
role: spec
title: "Deterministic task dispatch bundle: lore feed task-start"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-10-10
tags: []
links:
  - {id: ADR-005, type: relates-to}
---
# SPEC-070 — Deterministic task dispatch bundle: `lore feed task-start`

## Overview/Goal

The five-section subagent dispatch bundle (Task Objective / Spec Reference / AC /
Context Digest / File Anchors, `assets/skills/lore-autopilot/SKILL.md` Phase 3) is
today hand-assembled prose by the orchestrator. Prose discipline decays: sections
get omitted, pasted spec text is a stale snapshot by execution time (guyin P0-1
stale-binary class), and a cross-session resume cannot reconstruct the bundle the
original dispatcher wrote. The 2026-07-23 full-suite contention incident
additionally showed the bundle's oracle-scope line is load-bearing and must not
depend on memory.

Goal: make the dispatch bundle a **deterministic projection of corpus state** —
`lore feed task-start <task>` renders the full dispatch contract from the task
doc, its plan, its governing spec's structured ACs, its declared anchors, its
evidence history, and live claim/session state. Rendering moment = claim/resume
moment, so the pack is always fresh and resume ≡ first dispatch.

## Scope

- IN: pure flow `buildTaskStartPack` (render-only, thick-bundle/thin-flow);
  wiring that pre-derives all domain facts; CLI `lore feed task-start <task>`
  (fourth checkpoint dispatch, refactored table-driven); exported render module;
  `workflow.task_feed.*` config budgets (wired for real — the phase-start
  precedent's `workflow.phase_feed.*` comment was aspirational and is NOT
  repeated); shared pointer types extraction; MCP `lore_feed` `task-start`
  branch + closing the deferred SPEC-056 `phase-start` MCP gap (CLI/MCP payload
  parity by shared construction).
- OUT: auto-injection into `lore claim` output (future consumer, render module
  is exported for it); dashboard task-detail view; any change to the manual
  bundle guidance in lore-autopilot beyond pointing it at this command;
  retrofitting `workflow.phase_feed.*` budgets for phase-start (separate debt).

## Design

**D1 — checkpoint name + dispatch shape.** `TASK_START_CHECKPOINT = "task-start"`,
registered in `CHECKPOINT_PRODUCED_TYPE` (`"task-start": "task"`), dispatched in
`commands/feed.ts` BEFORE the generic `buildFeed` path — mirroring `phase-start`
(SPEC-056 D5). With this fourth special case, `feed.ts`'s dispatch is refactored
from if/else chains to a checkpoint→handler table; `spec-create`,
`session-resume`, and `phase-start` outputs are regression-pinned unchanged.

**D2 — thick-bundle / thin-flow (review synthesis).** `buildTaskStartPack(deps,
taskId, budgets?)` in NEW `packages/lore/src/flows/task-feed-flow.ts` is
RENDER-ONLY: every domain fact arrives pre-derived on the bundle, the flow never
calls `computeAcCoverage`/`extractClaim`/`isClaimStale`/`extractEvidence` itself
(the phase-feed-flow `PhaseSiblingSummary` pre-summarization precedent, applied
consistently). `deps.getTaskBundle(taskId)` (FATAL on err) returns:
- `task: DocRecord`, `planSlug`, `specSlug | null`, `phaseName | null`
- `acceptance: AcceptanceView[]` — pre-joined `{id, statement, mode, command?,
  coverage: "attested_pass" | "pass" | "fail" | "none", scoped: boolean,
  dangling: boolean}` (wiring computes via `computeAcCoverage` over the plan's
  tasks, filters/annotates by `plan.extra.ac_scope`; `criteria` absent →
  empty array + `no_declared_acs: true` flag)
- `anchors: string[]`, `priorFailures: FailureSummary[]` (wiring pre-extracts
  the LAST 3 `result: "fail"` evidence entries — `{oracle, command, tail}` with
  `tail` pre-clipped to 500 chars; entry-count clipping happens HERE, section
  char-budget clipping happens in the flow — two distinct mechanisms, only the
  latter records `truncated[]`)
- `claimView: {holder, fresh} | null` (wiring composes `extractClaim` +
  `isClaimStale` with its own clock/ttl — the flow receives a verdict, never
  computes time)
- `upstreamSpecApproved: boolean | null` (null = no spec ancestor)
Aux ports, each NON-FATAL (degrade to a one-line note, rest of pack builds):
`planStateForTask(planId)` → `{sessions, anchor_conflicts}` slice of
`TaskWorkflowService.ready`'s report; `listLinkedKnowledgePointers(docId,
limit)`; `latestHandoffForPlan(planId)`.

**D3 — eight sections, one budget + one degrade path each (cohesion split).**
`sections: {objective, acceptance, constraints, boundaries, claim, plan_state,
knowledge_pointers, handoff}` — `state`/`pointers` catch-alls from the draft were
split so task-scoped claim vs plan-scoped sessions, and knowledge vs handoff,
fail and truncate independently (phase-start's isolation property, kept).
`objective` = header (task slug/title/status + spec/plan/phase pointers) + task
content verbatim (Estimate/Approach/AC prose — the intent layer). `acceptance` =
the AcceptanceView table incl. script commands (these ARE the scoped oracle
commands). `constraints` = priorFailures as anti-pattern injection +
`upstream spec not approved` advisory when false. `boundaries` = declared
`file_anchors` + the fixed scoped-oracle discipline line (script-AC commands +
`--changed` + typecheck only; full suite is the orchestrator's post-merge job —
2026-07-23 lesson, mechanized here as pack text). Payload-vs-pointer criterion:
content whose misreading causes silent divergence is verbatim; reference
material (spec body, knowledge docs, handoff body) is slug-pointers only.

**D4 — AC selection is typed-fields-only.** The acceptance view keys on
`spec.extra.acceptance_criteria` × `plan.extra.ac_scope` exclusively — NEVER on
parsing the task content's prose `Covers:` line (contiguous-substring lesson:
prose matching silently degrades to no-match). A scoped id absent from the
declared criteria renders as a loud `(dangling scoped id)` row, never dropped.

**D5 — config wired for real.** `workflow.task_feed` joins `WorkflowConfigSchema`
(`@lore/core` config.ts): eight optional per-section char budgets with defaults
in `DEFAULT_TASK_START_BUDGETS` (flow-owned). The CLI/MCP adapters resolve
config → `Partial<TaskStartBudgets>` and pass it down; invalid values fail loud
at config parse (existing Zod path). This closes the pattern gap the phase
precedent left open rather than copying its unwired comment.

**D6 — shared pointer vocabulary.** `KnowledgePointer`/`HandoffPointer` move to
NEW `packages/lore/src/flows/feed-shared-types.ts`; `phase-feed-flow.ts`
re-exports them (import-compat preserved for existing importers), both flows
import the shared home — neither feature module owns the other's vocabulary.

**D7 — render module exported.** NEW `adapters/cli/task-feed-render.ts` exports
`renderTaskStartPack(pack): string` (assess-render.ts split precedent —
vitest-testable, reusable by a future claim-time print / dashboard without
touching `commands/feed.ts`). The CLI command is a thin pipe: resolve → build →
render (or `--json` the pack).

**D8 — MCP parity by shared construction + closing the phase-start gap.**
`LoreFeedSchema` gains optional `task` (and `phase` for the existing gap);
`lore_feed {checkpoint: "task-start", task}` calls the SAME
`buildTaskFeedFlowDeps(app)` + `buildTaskStartPack`; the deferred SPEC-056
phase-start MCP branch lands alongside via `buildPhaseFeedFlowDeps` — parity is
by-construction (one builder, two thin adapters), pinned by a determinism unit
test (`buildTaskStartPack` twice → `toEqual`) rather than a two-surface spawn
diff. Wiring for the new flow lives in NEW `adapters/cli/task-feed-wiring.ts`
(`buildTaskFeedFlowDeps(app)`), the placement mirroring `phase-wiring.ts`
(MCP already imports phase wiring from `../cli/` — placement debt acknowledged,
out of scope).

**D9 — module boundary.**
```
packages/core/src/config.ts                        (EDIT: workflow.task_feed)
packages/lore/src/flows/feed-shared-types.ts       (NEW: pointer types)
packages/lore/src/flows/task-feed-flow.ts          (NEW: pure, render-only)
packages/lore/src/flows/phase-feed-flow.ts         (EDIT: re-export shared types)
packages/lore/src/flows/feed-flow.ts               (EDIT: checkpoint map entry)
packages/lore/src/adapters/cli/task-feed-wiring.ts (NEW: buildTaskFeedFlowDeps)
packages/lore/src/adapters/cli/task-feed-render.ts (NEW: renderTaskStartPack)
packages/lore/src/adapters/cli/commands/feed.ts    (EDIT: table-driven dispatch)
packages/lore/src/adapters/mcp/tools.ts            (EDIT: task-start + phase-start branches)
```
Dependency direction: flows → @lore/core only; wiring → app (type-only) +
services; adapters → flows + wiring. No cycles. All deps injectable; flow
black-box testable with canned-string fakes (no domain semantics in fakes —
the thick-bundle property).

## Acceptance Criteria

- AC-070-1: `buildTaskStartPack` is deterministic and render-only — two calls
  with identical fake deps return deep-equal packs, and the flow module imports
  no domain-derivation functions (coverage/claim/evidence fns absent from its
  import graph).
- AC-070-2: fatal/non-fatal contract — `getTaskBundle` error propagates verbatim;
  each aux port failing degrades ONLY its own section to a one-line note while
  the other seven sections render.
- AC-070-3: acceptance view matrix — no declared ACs → explicit note; `ac_scope`
  present → non-scoped criteria marked, dangling scoped ids render a loud row;
  script-mode rows carry their commands.
- AC-070-4: constraints section — task with fail evidence renders the last ≤3
  failures with oracle+command+clipped tail; no failures → explicit "(no prior
  failures)" line; unapproved upstream spec renders the advisory.
- AC-070-5: claim + plan_state sections — foreign fresh claim renders holder,
  stale claim marked stale, no claim explicit; sessions/anchor_conflicts from
  the ready-report slice render; empty report → explicit none-lines.
- AC-070-6: per-section budgets — `workflow.task_feed.*` config overrides
  defaults, clipped sections' keys land in `truncated[]`, unclipped sections
  never do.
- AC-070-7: CLI — `lore feed task-start <task>` prints all eight sections;
  `--json` emits the pack object; unresolvable task → exit 3; missing positional
  → exit 2; `spec-create`/`session-resume`/`phase-start` CLI outputs are
  byte-regression-unchanged after the table-driven refactor.
- AC-070-8: MCP — `lore_feed {checkpoint:"task-start", task}` returns the same
  pack the CLI `--json` path emits for the same corpus state; `lore_feed
  {checkpoint:"phase-start", phase}` now returns the real phase pack (SPEC-056
  deferred gap closed).


## Acceptance Criteria (structured)

- [⚑] [script] AC-070-1: buildTaskStartPack called twice with identical fake deps returns deep-equal packs, and the flow module's import graph contains no domain-derivation functions (computeAcCoverage/extractClaim/isClaimStale/extractEvidence)
  script: test — bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts -t "AC-070-1"
- [⚑] [script] AC-070-2: getTaskBundle error propagates verbatim as the flow result; each aux port (planStateForTask, listLinkedKnowledgePointers, latestHandoffForPlan) failing degrades only its own section to a one-line note while the other 7 sections render
  script: test — bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts -t "AC-070-2"
- [⚑] [script] AC-070-3: acceptance view matrix: zero declared ACs renders an explicit no-ACs note; with ac_scope present non-scoped criteria are marked and a dangling scoped id renders a loud row; script-mode rows include their command strings
  script: test — bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts -t "AC-070-3"
- [⚑] [script] AC-070-4: constraints section renders the last <=3 fail-evidence entries with oracle+command+clipped tail; zero failures renders an explicit no-prior-failures line; upstreamSpecApproved=false renders the unapproved-spec advisory
  script: test — bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts -t "AC-070-4"
- [⚑] [script] AC-070-5: claim section renders foreign fresh holder / stale marker / explicit no-claim line; plan_state renders sessions and anchor_conflicts from the ready-report slice and explicit none-lines when empty
  script: test — bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts -t "AC-070-5"
- [⚑] [script] AC-070-6: workflow.task_feed.* config budgets override DEFAULT_TASK_START_BUDGETS per section, clipped section keys land in truncated[], unclipped sections never appear in truncated[]
  script: test — bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts -t "AC-070-6"
- [⚑] [script] AC-070-7: CLI lore feed task-start <task> prints all 8 section headers; --json emits the pack object; unresolvable task exits 3; missing positional exits 2; spec-create/session-resume/phase-start outputs unchanged after the table-driven dispatch refactor
  script: test — cd packages/lore && bun test tests/integration/cli-feed-task-start.bun.test.ts
- [⚑] [script] AC-070-8: MCP lore_feed checkpoint=task-start returns a pack deep-equal to the CLI --json pack for the same corpus state, and checkpoint=phase-start returns the real buildPhaseStartPack pack instead of the generic buildFeed note
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts
- [⚑] [script] AC-070-9: MCP lore_feed task-start resolves workflow.task_feed.* config budgets identically to the CLI path: with a non-default budget set in config, the MCP pack's truncated[] and section clipping deep-equal the CLI --json pack for the same corpus state
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts -t "AC-070-9"
- [⚑] [script] AC-070-10: prior-failure output_tail clipping is surrogate-safe: an astral-plane (emoji/CJK-B) fixture clipped at the 500-char boundary yields no unpaired UTF-16 surrogate in the pack (headChars from @lore/core, no bare String.slice in task-feed-wiring)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts -t "AC-070-10"
- [⚑] [script] AC-070-11: constraints evidence extraction is per-entry tolerant: a task with 2 parseable fail entries plus 1 malformed entry renders both failures AND an explicit degraded line naming 1 unparseable entry; a non-empty raw evidence array never silently renders the no-prior-failures line
  script: test — bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts -t "AC-070-11"
- [⚑] [script] AC-070-12: AC coverage precedence is a single shared @lore/core helper with fail-first ordering: a criterion with pass>0 AND fail>0 labels fail in the task-start pack, and lore ac list's badge consumes the same helper (no second precedence implementation in commands/ac.ts)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts -t "AC-070-12"
- [⚑] [script] AC-070-13: a present-but-schema-invalid plan.extra.ac_scope makes getTaskBundle return VALIDATION_ERROR naming plan.extra.ac_scope (never silently treated as absent scope)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts -t "AC-070-13"
- [⚑] [script] AC-070-14: aux port internal refetch failures propagate as err so the section degrades loudly: a forced pointer-refetch failure yields the knowledge-pointers unavailable note (never invalidated:false rows), and a forced handoff-doc lookup failure yields the handoff unavailable note (never title=slug rows)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts -t "AC-070-14"
- [⚑] [script] AC-070-15: MCP lore_feed task-start resolves budgets per call from a config getter: changing workflow.task_feed between two lore_feed calls on the same server instance changes the second pack's truncated[] without restart
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts -t "AC-070-15"
- [⚑] [script] AC-070-16: special-checkpoint membership and required-arg name live in ONE exported descriptor map consumed by both the CLI dispatch table and the MCP branches, and MCP lore_feed rejects contradictory field combos (task-start with phase, phase-start with task, generic checkpoint with task or phase) with VALIDATION_ERROR
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-feed-task-start.test.ts -t "AC-070-16"
- [⚑] [script] AC-070-17: pack assembly issues no duplicate store reads: the task doc is fetched exactly once (navigation threaded from the first fetch, call-count-asserted via fakes) and computeAcCoverage parses each task's evidence exactly once via single-pass bucketing with output equal to the previous implementation on mixed fixtures
  script: test — bunx vitest run packages/lore/tests/unit/adapters/task-feed-wiring.test.ts -t "AC-070-17"
- [⚑] [script] AC-070-18: phase-start CLI happy-path four-section render text is regression-pinned with a full-output assertion in the integration suite (previously only its error paths were pinned)
  script: test — cd packages/lore && bun test tests/integration/cli-feed-task-start.bun.test.ts

## Code anchors

- packages/lore/src/flows/task-feed-flow.ts#buildTaskStartPack
- packages/lore/src/flows/feed-shared-types.ts
- packages/lore/src/adapters/cli/task-feed-wiring.ts#buildTaskFeedFlowDeps
- packages/lore/src/adapters/cli/task-feed-render.ts#renderTaskStartPack
