---
id: SPEC-066
type: spec
role: spec
title: "git-safety-gate heredoc/string-literal awareness (command-position discipline)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-27
tags: []
parent: PRD-001
links:
  - {id: SPEC-050, type: relates-to}
---
# SPEC-066 — git-safety-gate heredoc/string-literal awareness (command-position discipline)

## Overview/Goal

Verified dogfood failure P1-4 (guyin 2026-07-22, reproduced live on HEAD e9e5188):
`pre-bash-git-safety-gate.mjs` scans the whole Bash command text after only
stripping quoted strings (`preprocessForInspection`, SSOT `assets/hooks/` ~line
230-237). Heredoc bodies are NOT stripped, so writing a knowledge/handoff/runbook
document whose BODY quotes a dangerous command (`cat <<'EOF' ... git branch -D
old-feature ... EOF`) is blocked as if the command were being executed — and the
branch-probe helper then parses prose words as branch names (`Assessment: "two"
not found or unreadable — treat as UNSAFE`). SPEC-050 D4 established
command-position matching for the g1–g4 gate hooks but never reached this hook.

Impact: any attempt to WRITE dangerous-command examples into documentation — the
natural content of runbooks, retros, and handoffs — is blocked, corrupting
knowledge fidelity (authors reword commands to evade the gate).

Goal: the gate inspects only text that can actually EXECUTE — heredoc bodies and
string literals are data, not commands.

## Scope

- IN: `preprocessForInspection` heredoc stripping (all delimiter forms: `<<EOF`,
  `<<'EOF'`, `<<"EOF"`, `<<-EOF`, arbitrary delimiter words); command-position
  matching for rule triggers (segment-initial token only, after `&&`/`||`/`;`/`|`/
  newline), reusing SPEC-050 D4 semantics; regression tests in
  `git-safety-gate.test.ts`; SSOT `assets/hooks/` and installed copy updated in the
  same change (content-parity assertion already covered by `assets-ssot.test.ts`).
- OUT: weakening any existing BLOCK rule for genuinely-executing commands;
  process-substitution/eval escape analysis (out of threat model: the gate defends
  against agent mistakes, not adversarial operators); the g1–g4 gate hooks
  (already command-position aware, SPEC-050).

## Design

**D1 — strip heredoc bodies before segmentation.** Detect `<<` / `<<-` redirects,
capture the (optionally quoted) delimiter word, and blank out every line up to the
matching terminator line. Multiple heredocs per command are handled left-to-right.
Unterminated heredoc (no closing delimiter in the text) → strip to end of text:
the body still cannot execute in that invocation.

**D2 — command-position triggers.** After preprocessing, a rule only fires when its
trigger token is in command position within its segment (start of segment or right
after a command separator) — the same discipline SPEC-050 D4 applied to the gate
hooks. `echo "git branch -D x"` (already quoted-stripped) and heredoc remnants
never match; `git branch -D x && echo done` still does.

**D3 — fail-closed preserved.** Preprocessing failures (pathological input the
stripper cannot parse) fall back to inspecting the ORIGINAL text — the gate may
over-block in that rare case but never under-blocks. A stripped command that still
matches a rule blocks exactly as today.

## Acceptance Criteria

- AC-066-1: a Bash command whose heredoc body contains `git branch -D <name>`
  (each delimiter form: unquoted, single-quoted, double-quoted, `<<-`) is ALLOWED.
- AC-066-2: a directly-executing `git branch -D <name>` remains BLOCKED (exit 2),
  including as a `&&`/`;`-chained later segment.
- AC-066-3: a heredoc body containing a dangerous command FOLLOWED by a real
  dangerous command outside the heredoc is still BLOCKED (stripping does not eat
  trailing segments).
- AC-066-4: a dangerous trigger token appearing in non-command position (e.g. as
  an argument: `echo git push --force`) does not fire the rule.
- AC-066-5: unterminated heredoc → gate does not crash and does not block on body
  content (strip-to-end behavior), verified by test.
- AC-066-6: SSOT `assets/hooks/pre-bash-git-safety-gate.mjs` and the installed
  copy are byte-identical after the change (existing parity oracle stays green).


## Acceptance Criteria (structured)

- [✔] [script] AC-066-1: A Bash command whose heredoc body contains git branch -D is ALLOWED for all four delimiter forms (unquoted, single-quoted, double-quoted, dash-trimmed)
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t "AC-066-1"
- [✔] [script] AC-066-2: A directly-executing git branch -D remains BLOCKED with exit 2, including as a chained later segment
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t "AC-066-2"
- [✔] [script] AC-066-3: A dangerous command outside a heredoc that also appears inside the heredoc body is still BLOCKED (stripping does not eat trailing segments)
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t "AC-066-3"
- [✔] [script] AC-066-4: A dangerous trigger token in non-command position (argument position) does not fire the rule
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t "AC-066-4"
- [✔] [script] AC-066-5: An unterminated heredoc neither crashes the gate nor blocks on body content (strip-to-end)
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts -t "AC-066-5"
- [✔] [script] AC-066-6: SSOT assets hook and installed copy remain byte-identical after the change (parity suite green)
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts
