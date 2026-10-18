---
id: SPEC-179
type: spec
role: spec
title: "One upgrade reminder at session start covers the global and the project install; the session-start fragment hook is retired"
status: approved
priority: high
created: 2026-10-15
updated: 2026-10-17
tags: [hooks, setup, fragments, distribution]
links:
  - {id: TASK-1049, type: resolves}
  - {id: TASK-1048, type: resolves}
---
# Spec: One upgrade reminder at session start covers the global and the project install; the session-start fragment hook is retired

Governing decision: `adr-rule-delivery-tiers-gate-hook-skill-and-optimistic` (L2 = state the model must see at a fixed moment; a hook with nothing to say stays silent). Resolves #143, #144.

## Overview/Goal

Two mechanisms check "does what is installed match this lore binary", with different scope, wording and remedy:

| | Global install (`~/.claude`) | Project install (`.claude/rules`, project hooks, settings entries) |
|---|---|---|
| Checker | `session-start-resume.mjs` Phase F reads the `lore setup --check` cache (`assets/hooks/session-start-resume.mjs:443-452`) | `session-start-fragments.mjs` → `lore fragments render --outlet hook:session-start`, which diffs the rules files against a fresh render (`packages/lore/src/flows/fragments-flow.ts:347-349`) |
| Scope | every managed file | rules files only |
| Output | one line: `lore assets outdated — run lore setup` | "rules files differ — run lore context refresh" plus the full changed rule text (#144: the model then holds two versions of the same rule) |

`lore setup --project --check` is refused today (exit 2, "project-scaffold freshness checking is deferred"; BR-849). The fragment hook's outlet `hook:session-start` has zero fragments in every layer (measured 2026-10-15 with `lore fragments check --json`; none of the three consumer projects configures any), so on every session it prints the false banner "render emitted no additionalContext" (#143).

Goal: one directive upgrade reminder at session start, for both installs, from one hook; the fragment hook and its empty outlet are removed.

## Scope

In scope:
1. `lore setup --project --check`: classifies every project-managed file (lore rules files, project-scope hooks, lore entries in the project's settings file) as in sync / outdated / diverged / missing / orphaned, same exit contract as the global check (0 in sync, 3 otherwise), writes only its own project check cache.
2. `session-start-resume.mjs`: one advisory line built from the global and the project check caches. It names which side is not in sync, why (binary version changed, project settings changed, file edited by hand), and the command to run before any other work (`lore setup`, `lore setup --project`). Hand-edited (diverged) files are named, never advised to be overwritten. In sync → no output. Same cache-first, detached-refresh behaviour as today's Phase F.
3. Retire `session-start-fragments.mjs` from the shipped hook roster (`packages/core/src/distribution-hooks.ts`), so `lore setup` converge removes it from installs; retire the `hook:session-start` outlet (`packages/core/src/context-fragments.ts`, `service/context-fragments/select.ts`, `flows/fragments-flow.ts` stale-notice assembly, `adapters/cli/commands/fragments.ts`, `adapters/cli/commands/run.ts` main-run composition).
4. A fragment declaring `mode: dynamic` for the main session is refused by `lore fragments check` (exit 4, naming the fragment and that its start target is retired) — never silently dropped.

Out of scope: hook interception points (Spec B), re-tiering rules into skills (Spec C), the `lore setup --check` orphan-reporting gap filed separately.

## Design

- The two check caches share one shape so the hook renders both with one function; the cache records the binary version that wrote it, which is how "binary version changed" is told apart from "settings changed".
- The advisory is an instruction, not a notice: `⚠ lore <version> installed files are behind: project (3 outdated, 1 diverged: .claude/rules/lore-ac-design.md) — run \`lore setup --project\` before other work; diverged files are kept, review them by hand.` Exact text is the implementer's, the three facts are not.
- No rule text is injected at session start. The current session runs on the old rules until the agent runs the command; that is accepted (ADR: two copies of one rule are worse than one turn of delay).

## Acceptance Criteria

Structured criteria are declared with `lore ac add` (AC-UR-*). Every script criterion runs against a throwaway install (`mkdtemp` + `lore init` + `lore setup --claude-dir <tmp>` / `lore setup --project`), never this repo's `.lore` or `~/.claude`, and constructs BOTH ends of each diff (old install → new binary; hand-edited file) plus an in-sync control.


## Acceptance Criteria (structured)

- [⊘] [script] AC-UR-1: In a throwaway project, lore setup --project --check exits 0 right after lore setup --project; exits 3 and lists each state on its own: a rules file replaced by an older render as outdated, a hand-edited rules file as diverged (bytes left unchanged), a deleted project-scope hook as missing, a ledger-listed file no longer shipped as orphaned, and a removed lore entry in the project settings file as missing; writes no file except the project check cache (tree hash otherwise identical); and --project --check --uninstall exits 2 naming --uninstall.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/setup-project-check.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 8 ] && echo 'AC-UR-1 PASS: project check classifies in-sync / outdated / diverged / missing / orphaned across rules files, project hooks and settings entries with exit 0/3, writes only its cache, refuses --uninstall with exit 2'
  other_command=2
- [⚑] [script] AC-UR-2: Running assets/hooks/session-start-resume.mjs against throwaway check caches: both caches in sync -> stdout carries no advisory line; project cache outdated and written by a different binary version -> exactly one advisory line naming the project side, the binary-version reason and 'lore setup --project'; project cache outdated under the same binary version after a project settings change -> the line names the settings reason instead; global and project both behind -> still exactly one line naming both commands; a diverged file -> the line names the file and the hand-edit reason and contains neither '--force-diverged' nor 'overwrite'; in every case the output contains no fragment body text and no FRAGMENTS_STALE_MARKER.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/hooks/session-start-upgrade-advisory.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-UR-2 PASS: one directive advisory line naming side, reason (binary version / settings / hand edit) and command; none when in sync; no overwrite advice; no rule text injected'
  other_command=3
- [⚑] [script] AC-UR-3: lore fragments render --outlet hook:session-start exits 2 and its stderr names the target as retired; render --outlet hook:subagent-start --agent-type lore-implementer still exits 0 with SubagentStart JSON; helper-start text exactly at its limit passes and one character over is reported over the limit.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/fragments-session-start-retired.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 3 ] && echo 'AC-UR-3 PASS: session-start render target refused exit 2 as retired; helper-start render and its exact limit unchanged'
  other_command=2
- [⚑] [script] AC-UR-4: In a throwaway project, a project fragment declaring mode: dynamic with audience main makes lore fragments check exit 4 with the fragment id on stderr and in the JSON report; removing that fragment returns check to exit 0 (control).
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/integration/cli/fragments-check-dynamic-refused.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 2 ] && echo 'AC-UR-4 PASS: a dynamic main-session fragment is refused by fragments check with exit 4 naming it; control exits 0'
  other_command=2
- [·] [script] AC-UR-5: session-start-fragments.mjs is absent from the shipped hook roster and assets/hooks; in a throwaway claude dir installed by a build that shipped it (file + SessionStart and compact settings entries recorded in the ledger), lore setup removes the file and both settings entries, keeps session-start-resume.mjs and its entry, and leaves a user-owned SessionStart entry pointing elsewhere untouched.
  script: test — out=$(mktemp); bunx --bun vitest run --testTimeout=30000 --hookTimeout=30000 packages/lore/tests/integration/retirement-registry.bun.test.ts -t 'session-start-fragments|deleted hook files are absent' > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 3 ] && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' "$out" && echo 'AC-UR-5 PASS: converge removes the retired session-start-fragments hook file and both settings entries, keeps the resume hook and the user entry, and the hook is absent from the shipped roster'
  other_command=5

## Code anchors

- assets/hooks/session-start-resume.mjs
