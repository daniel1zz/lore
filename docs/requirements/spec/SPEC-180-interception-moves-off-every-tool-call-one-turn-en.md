---
id: SPEC-180
type: spec
role: spec
title: "Interception moves off every tool call: one turn-end review replaces per-edit checks, and the gate hooks retire in favour of the service-layer gates"
status: approved
priority: high
created: 2026-10-15
updated: 2026-10-28
tags: [hooks, gates, distribution]
---
# Spec: Interception moves off every tool call — one turn-end review replaces per-edit checks, and the gate hooks retire in favour of the service-layer gates

Governing decision: `adr-rule-delivery-tiers-gate-hook-skill-and-optimistic` §2 (optimistic interception: per tool call only record or block irreversible actions; behavioural checks once per turn at Stop; result quality at milestones). Resolves #22, #146, #184, #190 (#142 was already fixed by 1d09f4b4; the hook it concerned is retired here).

## Overview/Goal

Measured 2026-10-15 (`~/.claude/settings.json`, this repo's `.claude/settings.json`, `packages/core/src/distribution-hooks.ts`):

- Every Bash call starts 6 lore hook processes at user level and 10 in this repo: `pre-bash-git-safety-gate`, the four checkpoint hooks `lore-gate-g1..g4` (registered a second time from this repo's `hooks/g*.sh`, #22) and `pre-tool-harness-run`. The g1–g4 hooks only pre-run `lore gate <checkpoint>`; the same checkpoints already refuse the write itself in the service layer for CLI, MCP and HTTP (AS-8).
- Every Edit in this repo runs `pre-subagent-gate.mjs`, which never refuses — its notice reaches the model as additionalContext (1d09f4b4 fixed #142) — and consults `read-files.jsonl`, which no shipped hook writes, so it flags every edit (#184).
- Every Edit|Write runs `claude-md-guard.sh` (acts only on files named CLAUDE.md).
- Every turn with any edit is blocked by `stop-doc-sync.mjs` asking the model to justify doc sync, and edits made inside helper agents are charged to the main turn (#190).
- `pre-tool-harness-run.mjs` is routed every `mcp__.*lore_.*` call but rewrites only names starting `mcp__lore__` (#146), so a consumer that registers the server under another name gets no run attribution.

Goal: per tool call, only recording and irreversible-action blocks remain; one Stop hook reviews the turn once and is silent when nothing is wrong; checkpoint gates are enforced only where they already are, in the write.

## Scope

1. **Retire the checkpoint hooks.** Remove `lore-gate-g1..g4` from the shipped roster and from `assets/hooks`, this repo's `hooks/g1..g4*.sh` and their `.claude/settings.json` entries. `lore setup` converge removes installed copies and entries (BR-823). Before removal, a parity test proves every refusal those hooks produced is produced by the write itself on CLI and MCP.
2. **Turn record knows who edited.** `post-edit-mark.mjs` records `agent_id` / `agent_type` from the hook payload (present when the tool call runs inside a helper agent, code.claude.com/docs/en/hooks common input fields); main-session consumers ignore entries carrying an `agent_id`.
3. **Turn-start snapshot.** `user-prompt-turn-start.mjs` (already shipped, runs once per user prompt) also records the working tree as a git tree id built through a temporary index (`GIT_INDEX_FILE=<tmp> git add -A && git write-tree`): no ref, no change to the real index. Every turn-end finding below diffs the working tree against THIS snapshot, so uncommitted changes from earlier turns are never re-reported. No snapshot (not a git repo, command failed) → the turn is unmeasured (#156 policy).
4. **One turn-end review.** New shipped Stop hook `stop-turn-review.mjs` replaces `stop-doc-sync.mjs` and the per-edit `claude-md-guard.sh` registration. Over the main session's edits of this turn it reports, in one block, every finding of:
   - (a) **source edits by the main session** — off by default; when a project or user setting turns it on, a source file changed by the main session beyond the exemptions (settings/config file types, `hooks/`, `.claude/`, `.github/`, `.vscode/`, `.lore/`, and at most 3 changed lines in total across the main session's source changes since the turn-start snapshot) is listed with the instruction to hand the change to an implementer agent or get the user's explicit go-ahead;
   - (b) **anchor drift** — a declared code anchor of a live spec that the working tree deletes or renames relative to the turn-start snapshot (so `rm`, `mv` and `git mv` through Bash count, not only Edit/Write); an anchor already missing at the snapshot is pre-existing drift for `lore status --check-drift`, not a turn finding;
   - (c) **CLAUDE.md budget** — an edited CLAUDE.md that `lore status --check-claude-md` finds over its ceiling.
   No finding → exit 0, no output. `stop_hook_active` → silent. Unmeasured turn state keeps the #156 policy (exit 0 + one stderr line).
5. **Remove** `assets/hooks/pre-subagent-gate.mjs` and its repo settings entry; remove `stop-doc-sync.mjs` and `claude-md-guard.sh` from the roster (converge removes installed copies).
6. **Harness-run prefix (#146):** rewrite every call whose tool name matches the hook's own matcher (`mcp__<any server>__lore_*`), not only `mcp__lore__`.

Out of scope: `pre-bash-git-safety-gate` (irreversible actions; stays per call), `stop-handoff-coverage` (already rare), this repo's orchestration-policy hooks `pre-dispatch-isolation-gate` / `pre-no-general-agent-gate` (PreToolUse on Agent|Task; deliberately NOT shipped — `packages/core/src/distribution-hooks.ts:15,149` — so BR-1092, which speaks of the shipped set, does not cover them; per dispatch, and a worktree collision is expensive to repair).

## Design notes

- Doc-staleness judgment ("did this turn make a README or ADR stale?") is no longer a blocking question at every turn: it has no deterministic oracle, so per the ADR it belongs to L3 (the implement/close skills) and to the `lore done` / assess milestone. Only the deterministic findings (b) and (c) block.
- Setting for (a): `workflow.turn_end.main_session_source_edits: off | block` in `.lore/config.yaml` (project) or the user's lore config, default `off`. This repo's discipline (main agent dispatches all code) turns it on.
- Target after this spec: a plain Bash call starts 2 lore hook processes (git safety, harness run), and no lore hook can refuse an Edit or Write.

- BR-1089's reserved text says "at most 3 lines across such files"; the authoritative reading is Scope 4(a): the main session's source edits this turn total at most 3 changed lines (exempt files are exempt regardless of size). A proposed rule cannot be restated before it lands (#198), so the landing task restates BR-1089 with `lore rule set` right after `lore rule apply`; AC-TE-3 already tests this reading. BR-1090 likewise says "edited or deleted this turn"; its authoritative reading is Scope 4(b) (working tree vs the turn-start snapshot, Bash deletions included) and it is restated the same way; AC-TE-4 tests that reading.

## Acceptance Criteria

Structured criteria are declared with `lore ac add` (AC-TE-*). Hook tests run the hook scripts as child processes with constructed payloads in throwaway directories; distribution tests construct both ends (an install that shipped the retired hooks → converge) plus a control.


## Acceptance Criteria (structured)

- [⚑] [script] AC-TE-1: In a throwaway corpus, every refusal the retired g1-g4 hooks produced is produced by the write itself: a spec created with any parent (a spec takes no parent, BR-2), a spec approved with no structured criterion, a plan approved over an unapproved spec, and a claim on a task whose upstream spec is unapproved each exit 4 through the CLI, naming the checkpoint, and write no document or version; and neither distribution-hooks.ts, assets/hooks, hooks/ nor .claude/settings.json names lore-gate-g1..g4 or g1..g4 any more.
  script: test — out=$(mktemp) && bunx --bun vitest run packages/lore/tests/integration/gates/gate-hook-retirement-parity.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 5 ] && echo 'AC-TE-1 PASS: four checkpoint refusals hold on CLI writes with no hook; no g1-g4 hook remains shipped or registered'
  other_command=4
- [⚑] [script] AC-TE-2: post-edit-mark.mjs fed an Edit payload carrying agent_id and agent_type records the entry with that agent id, and stop-turn-review.mjs over a turn whose only edits carry an agent_id produces no output and exit 0; the same edit without agent_id is counted as the main session's (control).
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/turn-record-agent-id.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 3 ] && echo 'AC-TE-2 PASS: helper-agent edits are recorded with their agent id and never counted as the main turn edits; control counted'
  other_command=3
- [⚑] [script] AC-TE-3: stop-turn-review.mjs in a throwaway git repo: a turn with no edits -> exit 0, empty stdout; stop_hook_active true -> silent; setting absent and a 50-line main-session edit to a .ts file -> silent; setting block and the same edit -> one block naming the file and 'implementer'; setting block and a 2-line edit -> silent; setting block and a 50-line edit under .claude/ or to a .json file -> silent; two findings in one turn -> one block listing both; unreadable turn state -> exit 0 with one stderr line containing 'not measured'.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/stop-turn-review.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 8 ] && echo 'AC-TE-3 PASS: turn-end review is silent when compliant, off by default, blocks once listing every finding, honours exemptions and the 3-line allowance'
  other_command=2
- [⚑] [script] AC-TE-4: stop-turn-review.mjs in a throwaway lore git project: a live spec's code-anchor file removed with a Bash rm (no Edit payload) -> block naming the spec slug and the path; the same file renamed with git mv -> block; an anchored file edited and still present -> silent; an anchor already missing at the turn-start snapshot (deleted by an earlier uncommitted turn) -> no turn finding; a CLAUDE.md edited past its ceiling -> block carrying the check-claude-md report, while a CLAUDE.md within budget -> silent.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/stop-turn-review-drift-budget.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-TE-4 PASS: turn-end review blocks on an anchor deleted or renamed in the working tree (Bash included) and an over-budget CLAUDE.md; silent on present anchors, pre-existing drift and in-budget CLAUDE.md'
  other_command=2
- [⚑] [script] AC-TE-5: The shipped roster registers stop-turn-review.mjs on Stop and no longer lists stop-doc-sync.mjs, claude-md-guard.sh or any lore-gate-g* hook; no shipped PreToolUse or PostToolUse hook other than pre-bash-git-safety-gate.mjs can emit a deny or block decision; in a throwaway claude dir installed by a build that shipped the retired hooks, lore setup removes their files and settings entries, adds stop-turn-review, and keeps a user-owned Stop entry pointing elsewhere; this repo's .claude/settings.json no longer references pre-subagent-gate.mjs.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/setup-turn-end-review-roster.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 4 ] && echo 'AC-TE-5 PASS: roster swaps the retired per-call and stop hooks for stop-turn-review; converge removes them and keeps user entries; no per-call deny hook besides git safety'
  other_command=2
- [⊖] [script] AC-TE-6: pre-tool-harness-run.mjs, run against the REAL built dist/lore on PATH (no stub) in a throwaway corpus with a run registered via lore run register: mcp__lore__lore_get and mcp__lore-dev__lore_get both come back with updatedInput carrying that run id; mcp__github__get_issue and mcp__mylore__get_issue come back with no updatedInput.
  script: test — bun run build >/dev/null 2>&1 && out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/harness-run-any-server-name.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 4 ] && grep -q REAL_BINARY_NO_STUB packages/lore/tests/integration/hooks/harness-run-any-server-name.test.ts && echo 'AC-TE-6 PASS: the real lore binary attributes the run for lore tools under any server name and never for other servers'
  other_command=4
- [⚑] [script] AC-TE-7: In a throwaway git repo with a 50-line uncommitted .ts change left by an earlier turn and the main-session source-edit setting on: user-prompt-turn-start.mjs records a tree id, the real index is byte-identical before and after, and a following turn that edits nothing produces no finding (exit 0, empty stdout), while a following turn that adds 50 more lines to another .ts file produces exactly one finding naming only that file.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/turn-start-snapshot.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 3 ] && echo 'AC-TE-7 PASS: findings are measured against the turn-start snapshot; earlier uncommitted changes are never re-reported; the real index is untouched'
  other_command=2

## Code anchors

- assets/hooks/stop-turn-review.mjs
- assets/hooks/post-edit-mark.mjs
- assets/hooks/user-prompt-turn-start.mjs
