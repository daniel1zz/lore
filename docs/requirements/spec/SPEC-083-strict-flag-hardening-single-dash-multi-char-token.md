---
id: SPEC-92
type: spec
role: spec
title: "Strict-flag hardening: single-dash multi-char tokens fail loud (SPEC-051 follow-up)"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: [spec-073, cli, strict-flags]
parent: PRD-001
---
# SPEC-073 — strict-flag hardening: single-dash multi-char tokens must fail loud (SPEC-051 follow-up)

## Problem

Observed 2026-07-24 (corpus: `knowledge-lore-verify-yes-alias-not-honored-in-non-tty-json`): `lore list -json` exits 0 and silently renders the human table — the token is neither applied as `--json` nor rejected. This violates SPEC-051's core promise (undeclared flags → exit 2). Root cause of the earlier `lore verify -yes` confusion: the alias is declared as `yes` (i.e. `--yes`), but (a) single-dash multi-char tokens are silently dropped by the parse/strict-check seam, and (b) citty's help renderer displays multi-char aliases with a single dash (`-yes, --allow-new-commands`), actively teaching the broken form.

## Decision (user-approved 2026-07-24)

Fix both: loud rejection AND help rendering.

## Design

- **D1 — loud rejection**: at the SPEC-051 strict seam (`findUnknownFlag`/`wrapCommandStrict`, one seam covering all commands), any argv token matching a single dash followed by 2+ chars that is not (i) a declared single-char alias cluster, (ii) a negative number, or (iii) after a `--` terminator, is rejected with exit 2. The error message suggests the double-dash form when the token's body (or an unambiguous prefix) matches a declared flag or alias: `Unknown option: -yes. Did you mean --yes?`. Declared single-char aliases keep working.
- **D2 — help rendering**: usage/help output renders multi-char aliases with a double dash (`--yes, --allow-new-commands`). Root-cause where the rendering happens (citty's built-in usage renderer vs local formatting); prefer a local post-process/override at one seam over forking citty. If citty exposes no seam, a thin usage-string transform at the CLI's single help-render point is acceptable — it must be one place, not per-command.
- **D3 — alias contract test**: `--yes` on `lore verify` must actually set `allow-new-commands` (unit-test the parse seam mapping, no live verify run needed).

## Non-goals

- No new short aliases; no change to declared flag sets.
- No upstream citty fork.

## Regression stance

All existing CLI flag tests pass; every command still accepts its documented double-dash flags; `--` passthrough (if any consumer exists) unchanged. The strict seam covers all 42+ commands via the single wrapper — no per-command edits.


## Acceptance Criteria (structured)

- [✔] [script] AC-073-1: lore list -json exits 2 with a message naming -json as unknown and suggesting --json
  script: test — bunx vitest run packages/lore/tests/unit/adapters/strict-flag-single-dash.test.ts -t 'AC-073-1'
- [✔] [script] AC-073-2: lore verify -yes exits 2 suggesting --yes; --yes maps to allow-new-commands=true at the parse seam (no live verify execution needed)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/strict-flag-single-dash.test.ts -t 'AC-073-2'
- [✔] [script] AC-073-3: Declared single-char aliases and negative-number positionals still parse; tokens after -- terminator are never rejected
  script: test — bunx vitest run packages/lore/tests/unit/adapters/strict-flag-single-dash.test.ts -t 'AC-073-3'
- [✔] [script] AC-073-4: Help/usage output for verify renders the alias as --yes (double dash); no single-dash multi-char alias rendering remains in any command's usage output
  script: test — bunx vitest run packages/lore/tests/unit/adapters/strict-flag-single-dash.test.ts -t 'AC-073-4'
