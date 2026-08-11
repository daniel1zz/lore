---
id: TASK-500
type: task
role: plan
title: "T1 argument-aware probes in git-safety-gate (D1-D5, AC-GS-1..7)"
status: archived
priority: medium
phase: "Fix"
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-098
plan: PLAN-098
---
# T1 — argument-aware probes in pre-bash-git-safety-gate.mjs (D1-D5, AC-GS-1..7)

## Task Objective

Make the gate's evidence proportionate to the command it blocks. Two probes compute their assessment without reading the command's arguments; one preprocessing step blanks quoted strings for everyone including the probes that need them.

## Spec Reference

`spec-git-safety-gate-probes-report-the-wrong-blast-radius` (approved). Read it in full — the `## Argument extraction (normative)` section is binding, not advisory: it exists because under-specifying that exact step produced the defect.

Upstream context: SPEC-066 (`spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c`) introduced the quote-blanking whose single-consumer assumption this task splits. Its guarantees must survive.

## Acceptance Criteria

AC-GS-1 … AC-GS-7 on the governing spec — declared as this task's `ac_scope`. `lore verify` scores them; do not paraphrase them, read them with `lore ac list`.

## Context Digest — what was already measured, do not re-derive

Reproduced 2026-07-31 on `main` by piping a `PreToolUse` payload into the SSOT hook, live repo with 8 stash entries:

- `git stash drop 'stash@{0}'` → `Segment : git stash drop ''`, assessment lists **all 8** entries.
- `git stash drop stash@{0}` (unquoted) → assessment lists **all 8**. This is the control that isolates cause from confound: quoting is NOT the root cause.
- `git stash clear` → all 8, which is correct for that verb.

Root cause, line-exact on `assets/hooks/pre-bash-git-safety-gate.mjs`:

| Line | Fact |
|---|---|
| 110 | `function probeStash(_inner, cwd = CWD)` — the parameter name states that the argument is never read; runs a bare `git stash list` for every verb and every revision |
| 90 | `function probePathArg(inner, cwd = CWD)` — declares `inner`, never reads it; reports whole-tree `git status --porcelain` for a single-path `checkout`/`restore`. Its own comment records the intent that was never implemented |
| 297-298 | `preprocessForInspection` blanks `"…"` → `""` and `'…'` → `''`. Correct for trigger matching, destructive for probes |
| 341-342 | the dispatch loop passes the sanitized `inner` to `rule.probe` — this is where the two consumers must be separated |

**Do NOT touch `probeDirtyTree` (line 83).** It is argument-blind and CORRECT: `git reset --hard` discards the whole working tree, so whole-tree status is its exact blast radius. D2 exists to stop precisely this "fix". AC-GS-5 pins it.

`probeClean` and the quoted-path degradation in `probeWorktreeForce` / `probeBranchForceDelete` are explicitly OUT of scope — they err in the safe (over-reporting) direction and have no measured incident.

## File Anchors

- `assets/hooks/pre-bash-git-safety-gate.mjs` — the SSOT. There is exactly one editable copy; `dist-npm/` and `.claude/worktrees/` copies are build/worktree artifacts, never edit them.
- `packages/lore/tests/unit/hooks/git-safety-gate.test.ts` — existing suite, extend it.
- `packages/lore/src/generated/assets-manifest.ts` — the sha256 at the `hooks/pre-bash-git-safety-gate.mjs` entry MUST be regenerated, or the fix never reaches a consumer running `lore setup` (AC-GS-6). Commit ONLY this file's manifest change; a concurrent task is live in this repo and unrelated manifest drift must not ride along.

## Test discipline (binding)

- **Never touch the repo's own stash.** Every stash assertion runs in a `mkdtemp` throwaway git repo with stashes the test itself creates. The repo's real stash list is shared mutable state and holds other sessions' work.
- **Red first.** Each new assertion must be shown failing against the current gate before the fix lands. A test that passes before the change is measuring nothing.
- **Negative halves are load-bearing.** "names stash@{1}" passes against today's all-8 output. The assertion that the OTHER entries are absent is the one that has content.
- `-t` title filters exit 0 on zero match (`lore verify` guards matched-case count, a bare `bunx vitest` run does not). Copy `describe`/`it` titles literally into the AC commands; never retype them from memory.
