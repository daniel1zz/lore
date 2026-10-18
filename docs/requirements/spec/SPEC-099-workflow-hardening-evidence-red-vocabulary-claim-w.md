---
id: SPEC-099
type: spec
role: spec
title: "Workflow hardening — evidence red vocabulary, claim worktree validation, task done verb, worktree corpus resolution"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-10-17
tags: []
---
## Overview/Goal

Four mechanizations arising from the 2026-07-27 session process review
(`knowledge-session-process-review-2026-07-27-context-refresh`, findings V1/V2/V4/V5).
Each closes a workflow gap that currently forces prose discipline or undocumented
workarounds where a deterministic mechanism should exist.

- **M1 (V1) — evidence red vocabulary.** `lore evidence --result` only knows
  `pass|fail`, so RED-phase suites (fail-by-design before an implementation lands)
  get recorded as a semantically-laundered `pass` or a dishonest `fail`. Add an
  explicit `expected-fail` result value: structurally distinct from `pass` in the
  audit trail, never counted as green by verify/assess/AC-coverage aggregation.
- **M2 (V2) — claim worktree validation.** `lore claim --worktree ""` persists an
  empty string that satisfies the "explicit declaration" letter while defeating
  session derivation and `noAnchorOverlap` grouping (`(by, machine, worktree)`).
  Empty/whitespace-only `--worktree` must fail loud (`VALIDATION_ERROR`), never
  persist blank.
- **M3 (V4) — task done verb.** The EXECUTE loop (claim → evidence → release)
  produces no state that `blocks`-link readiness recognizes as met (readiness
  "done" = terminal status `archived|deprecated`; released tasks stay `draft`;
  `lore archive --sweep` has no mid-plan candidate rule). Sessions are forced into
  hand-rolled `lore set --status` choreography (three writes per task).
  Decision: add `lore done <task>` — validates the task holds at least one
  `result: pass` evidence entry and no fresh foreign claim, then performs the
  sanctioned lifecycle walk to `archived` atomically (one command, each transition
  audited). Alternatives considered and rejected: (b) readiness treating
  released+passing-evidence as blocker-met — makes done implicit and dual-sources
  the readiness notion; (c) an archive-sweep mid-plan rule — batch timing, cannot
  unblock a dependent task at the moment work completes.
- **M4 (V5) — worktree corpus resolution.** `findLoreDbPath` walks up from cwd
  only, so a fresh `git worktree add` tree has no corpus access (`.lore/` is
  gitignored and not materialized) — yet SPEC-042's own protocol requires claims
  from inside the worktree. Sessions currently symlink `lore.db`/`config.yaml`/
  `local-key` by hand. Add a fallback: when the walk-up finds no `.lore/lore.db`
  and cwd is inside a linked git worktree, resolve the main checkout root via
  `git rev-parse --git-common-dir` and use ITS `.lore/`. Still absent → the
  existing loud failure. No behavior change in a primary checkout.
  Root derivation is `dirname(<absolute common dir>)` — an assumption that holds
  for standard linked worktrees only. Non-standard shapes (`--separate-git-dir`
  main repos, bare main repositories) make that dirname NOT a checkout root; the
  probe then finds no `.lore/lore.db` there and deliberately falls through to
  the existing loud failure — never a wrong-corpus resolution. This is the
  specified behavior for those shapes, not an oversight (assess 2026-07-27
  recommendation: state it explicitly).

## Scope

- `packages/core/src/schemas.ts` (evidence result enum) + evidence write path in
  `packages/lore/src/service/task-workflow-service.ts` / `phase-workflow-service.ts`
  (shared `appendEvidenceEntry`), CLI `evidence.ts`, MCP tool schema (M1).
- Claim validation in `task-workflow-service.ts` claim path + CLI `claim.ts` (M2).
- New CLI verb `done` + `TaskWorkflowService`/`PhaseWorkflowService` done
  orchestration (M3); readiness computation itself is UNCHANGED.
- `packages/lore/src/adapters/cli/utils.ts#findLoreDbPath` (+ `findLoreDbPathQuiet`
  in `gate-bypass-audit.ts`) (M4).
- Out of scope: any change to gate predicates, readiness semantics, or the
  archive sweep rules; dashboards/HTTP surfaces beyond schema pass-through.

## Acceptance Criteria

Structured ACs are authored via `lore ac add` (AC-WH-1..4, one per mechanization);
prose summary:

- AC-WH-1: `--result expected-fail` accepted end-to-end (schema, CLI, MCP), stored
  verbatim, rendered distinctly, and NEVER counted as green by `lore verify`
  summaries, `lore assess` evidence facts, or AC-coverage aggregation.
- AC-WH-2: `lore claim --worktree ""` (and whitespace-only) exits non-zero with
  `VALIDATION_ERROR` naming the flag; omission and non-empty values unchanged.
- AC-WH-3: `lore done <task>` on a released task with passing evidence transitions
  it to `archived` (audited per step) and flips dependent `blocks`-link readiness
  to `ready: true` in the same corpus state; refuses (VALIDATION_ERROR) when no
  passing evidence exists or a fresh foreign claim holds; idempotent second call
  is a no-op with a clear message.
- AC-WH-4: from inside a linked git worktree with no local `.lore/`, lore CLI
  commands (get/claim/evidence/release) operate on the main checkout's corpus
  without symlinks; a repo with neither local nor common-dir `.lore/` still fails
  loud exactly as today; primary-checkout resolution byte-identical.


## Acceptance Criteria (structured)

- [⚑] [script] AC-WH-2: lore claim --worktree with empty or whitespace-only value exits non-zero with VALIDATION_ERROR naming the flag and persists nothing; omitted and non-empty values behave byte-identically to today (REGRESSION-pinned)
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-service.test.ts
- [⚑] [script] AC-WH-3: lore done <task> on a released task holding at least one result:pass evidence entry transitions it to archived with one audit row per lifecycle step, and a dependent blocks-linked task flips to ready:true in the same corpus state; refuses with VALIDATION_ERROR when no passing evidence exists or a fresh foreign claim holds; second invocation is an idempotent no-op naming the current terminal state
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-service.test.ts packages/lore/tests/unit/cli/done-command.test.ts
- [·] [script] AC-WH-4: compiled-binary e2e in a temp git repo: lore get/claim/evidence/release executed from inside a linked worktree with no local .lore/ operate on the main checkout corpus without symlinks (git-common-dir fallback); a repo with neither local nor common-dir .lore/ fails loud with the existing error; primary-checkout resolution unchanged (REGRESSION)
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/worktree-corpus-resolution.bun.test.ts
  other_command=7
- [⚑] [script] AC-WH-1: expected-fail evidence result accepted end-to-end (Zod schema, CLI --result, MCP tool), stored verbatim, and never counted as green: verify summaries, assess evidence facts, AC-coverage aggregation, adjudication-bar math, and the list/tree workflow badge all classify expected-fail as non-passing (vitest suites assert acceptance and classification at every enumerated read site)
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-service.test.ts packages/lore/tests/unit/service/ac-service.test.ts packages/core/src/evidence-panel.test.ts packages/lore/tests/unit/adapters/tree-claim-badge.test.ts
  other_command=6
- [⚑] [script] AC-WH-1B: expected-fail DISTINCT rendering at the CLI surfaces: ac coverage badge renders expected-fail-only as its own glyph distinct from never-verified and inconclusive, and the evidence success line prints the value verbatim (bun-runner suites)
  script: test — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts packages/lore/tests/unit/adapters/cli-evidence-result-rendering.bun.test.ts
  other_command=2

## Code anchors

- packages/lore/src/adapters/cli/utils.ts#findLoreDbPath
- packages/lore/src/adapters/cli/gate-bypass-audit.ts#findLoreDbPathQuiet
- packages/core/src/task-workflow.ts
- packages/lore/src/adapters/cli/commands/evidence.ts
- packages/lore/src/service/task-workflow-service.ts#rejectBlankClaimWorktree
- packages/lore/src/service/task-workflow-service.ts#computeArchiveWalk
- packages/lore/src/adapters/cli/commands/done.ts
