---
id: SPEC-050
type: spec
role: spec
title: "Gate hooks cross-corpus false-deny fix (cd-prefix TARGET_CWD + g1 lookup-anomaly fail-open)"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-10-10
tags: []
---
# SPEC-050 — Gate hooks: cross-corpus false-deny fix (cd-prefix TARGET_CWD + g1 lookup-anomaly fail-open)

## Overview

All four PreToolUse gate hooks (g1-spec-create / g2-spec-promote / g3-plan-promote / g4-task-claim) derive `TARGET_CWD` solely from the harness stdin `.cwd`. A Bash command of the form `cd <other-project> && lore create spec …`, issued from a session whose harness cwd is a DIFFERENT lore-governed repo, is therefore gate-checked against the WRONG corpus. Empirically observed (2026-07-17, snip-demo dogfood): a fully valid spec-create against a demo corpus was FALSE-DENIED with `PARENT_REQUIRED` because the parent slug only exists in the demo corpus, and the pack quoted THIS repo's feeding source. A false deny is strictly worse than fail-open here: the service-layer GateEnforcer (SPEC-049) re-runs the same predicates against the REAL resolved corpus, so a hook that steps aside on uncertainty loses nothing. Source finding: `knowledge-dogfood-retro-full-lifecycle-fresh-corpus-run-snip-dem` (F3).

## Goal

A gate hook never denies a command based on state read from a corpus other than the one the command will actually execute against. When the hook cannot confidently identify that corpus, it fails OPEN (logged), never closed.

## Design

### D1 — leading `cd` prefix parsing (all four hooks)

After reading `HOOK_CWD` from stdin, each hook inspects the raw Bash command string for a LEADING `cd <path> &&` (or `cd <path> ;`) prefix — optionally preceded by simple `VAR=value` env assignments and whitespace. Accepted `<path>` forms: bare token, single-quoted, double-quoted (no command substitution / no variables — a `$` anywhere in the path token disqualifies it). If the extracted path is an existing directory, `TARGET_CWD=<that path>`; otherwise fall back to the current derivation (`HOOK_CWD` → `REPO_ROOT`). Only the FIRST leading `cd` is honored — `cd a && cd b && lore …` uses `a`'s resolution result only if it parses; chained cds beyond the first are out of scope (fail-open covers them via D2). The parser is duplicated per hook file (hooks are standalone scripts by design); byte-consistency across the four is enforced by the existing hook conformance tests where applicable.

### D2 — g1 lookup-anomaly fail-open (align with g4's philosophy)

g1 currently denies on `PARENT_REQUIRED` even when the COMMAND declared a `--parent` — meaning the gate simply could not RESOLVE that parent in `TARGET_CWD`'s corpus (wrong corpus, or transient). New rule: if the command string declared a non-empty `--parent` AND the gate verdict includes `PARENT_REQUIRED`, treat it as a lookup anomaly → log one stderr line (`UNRESOLVED_PARENT: …`) and ALLOW (service-layer still gates the real write). A command that declared NO parent keeps the deny (a real violation, resolvable without any corpus read). g2/g3/g4 already fail open when their doc lookup fails — covered by regression tests, not new code.

### D3 — sync surface

The fix lands identically in: repo `hooks/g{1..4}-*.sh` (project-vendored), `assets/hooks/lore-gate-g{1..4}-*.sh` (install SSOT), and installed `~/.claude/hooks/lore-gate-g{1..4}-*.sh`. The assets-ssot conformance test must stay green.

## Scope

- 4 hook scripts × 3 copies; hook regression tests (existing suite + new cases: cd-prefix honored, quoted paths, env-assignment prefix, `$`-bearing path disqualified, g1 declared-parent anomaly → allow, no-parent → still deny).

## Out of scope

- GateEnforcer/service layer (SPEC-049, landed). MCP-shape hook inputs (`tool_input` carries no shell string — unaffected). A full shell parser.

## Acceptance criteria

Structured ACs: typecheck; hook regression suite green; full dual-runner suite green; live repro — from a session cwd'd at this repo, a `cd <scratch-corpus> && lore create spec …` with a valid in-scratch parent passes the hook (no false deny), and the same command with NO --parent is still denied.
### D4 — command-position matching (new finding F14, 2026-07-17)

The trigger-phrase regex currently matches ANYWHERE in the raw command string — including inside quoted string literals. Observed false deny: a lore ac add invocation whose --statement text mentioned the spec-creation phrase was gated with an EMPTY payload (all predicates failing). Fix: the match must sit at a command position — start of string, or immediately after `&&`, `||`, `;`, `|`, `$(` or a backtick — never inside a quoted argument. Applies to all four hooks' matchers.


## Acceptance Criteria (structured)

- [⚑] [script] AC-050-1: Typecheck clean
  script: tsc — bun run typecheck
- [⚑] [script] AC-050-2: Hook regression suite green incl. new cd-prefix + g1 anomaly cases
  script: test — bunx vitest run packages/lore/tests/unit/hooks
- [⚑] [script] AC-050-3: Full dual-runner suite green
  script: test — bun run test
- [○] [human] AC-050-4: Live repro: from repo-cwd session, spec creation against a scratch corpus with a valid in-scratch parent passes the hook; the no-parent variant is still denied; a quoted-text mention of the trigger phrase no longer trips the matcher
  human: Scratch corpus only, never the repo corpus

## Code anchors

- hooks/
- assets/hooks/
- packages/lore/tests/unit/hooks/gate-cross-corpus-fix.test.ts
