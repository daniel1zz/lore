---
id: SPEC-210
type: spec
role: spec
title: "Prose about code is bound to what it describes: one resolver, one reverse index, told at edit time"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
---
## Overview/Goal

Prose that describes code goes stale silently. In one session on 2026-10-19 three incidents shipped or nearly shipped:
(a) root CLAUDE.md and the subagent-injected fragment `.lore/context/test-runner-split.md` said `.bun.test.ts` files run under `bun test` long after `test:bun` was retired (task-skill-implement-tg-23);
(b) root and core CLAUDE.md said `VALID_TRANSITIONS` lives in `schemas.ts` after it moved to `lifecycle.ts`;
(c) the managed module index's "N folders have no memory file" line conflicted in nearly every parallel `lore integrate`, because every branch that adds a folder changes it.
None was caught by an existing mechanism: CLAUDE.md reference checking drops the `#Symbol` part (claude-md-admission.ts:368-370) and only tests file existence; drift checking (spec-spec-045…, BR-410..416) covers spec/knowledge anchors only; nothing answers "which prose describes the file I just changed"; fragments cannot carry anchors; the command table has no descriptions; the module-index count lives in the committed body.

Goal, as properties of the finished system:
1. Whatever can be derived from code is generated, never hand-written, so it cannot drift.
2. A prose statement about code names what it describes (a path, a `path#Symbol`, or a script), and that binding is checked with the same resolver the corpus uses for code anchors.
3. When an agent edits a file, it is told, at that moment, which prose describes that file — so it can update or confirm it — without being forced to edit prose that is still true.
4. Generated sections hold nothing that changes merely because unrelated folders were added, so parallel branches do not conflict on them.

## Scope

In scope: memory files (root and module CLAUDE.md, the generated `.claude/rules/*.md`) and context fragments (`.lore/context/*.md`, `assets/context/*.md`); the reference checker in `packages/lore/src/service/claude-md-admission.ts`; the code-anchor resolver in `packages/core/src/code-anchors.ts`; the managed `command-table` and `module-index` sections (`flows/context-flow.ts`, `service/context-facts.ts`); a PostToolUse delivery in `assets/hooks/` (alongside `post-edit-mark.mjs`); a read verb `lore refs <path>`.

Out of scope: judging whether a sentence is semantically true (no AI judge on prose here); spec/knowledge anchors (already governed by spec-045 and the code-anchor baselines; they join the reverse index unchanged); `co_change` (stays a hard requirement for derived-artifact pairs, BR-1152).

## Design

- D1 One resolver for every code reference. A reference in a memory file or fragment — a backticked repo path, `path#Symbol`, or `bun run <script>` / `` `<script>` `` naming a package.json script — is resolved by the same core function that resolves spec code anchors (`computeDrift`), extended with one kind for scripts (script name exists in the governing package.json). `checkReferenceExistence` stops keeping its own existence check and stops dropping `#Symbol`. A missing path, a missing exported symbol, or a missing script is a deterministic finding on `lore status --check-claude-md` / `check:memory-files`, refusing like the other deterministic memory-file findings. Catches (b).
- D2 One reverse index. A single core query answers "which documents bind to this path": spec/knowledge `code_anchors` and the D1 references of every memory file and fragment, each entry naming the document, the line, and the bound path/symbol/script. Exposed as `lore refs <path> [--json]`. No second index: the drift check, D1 and D3 all read this one.
- D3 Told at edit time, not forced. A shipped PostToolUse hook on Write/Edit/NotebookEdit queries D2 for the edited path and, when any prose binds to it, returns additional context to the agent: "these statements describe the file you changed: <doc>:<line> <reference>; update any that are no longer true". For a script binding the trigger is a change to that script's command text in package.json, not any package.json edit. It never blocks and never requires an edit — a still-true statement needs no action, so no acknowledgement step exists. Catches (a): the fragment and CLAUDE.md lines naming `test:bun` / `test:vitest` bind to those scripts, and retiring `test:bun` changed its command.
- D4 Script descriptions live with the script. `package.json` `lore.documentedScripts` becomes a map from script name to a one-line description; the managed `command-table` renders name, command and description. The hand-written Commands block in root CLAUDE.md is replaced by the generated table plus rules that are not derivable from package.json. A description edited next to its command is visible to whoever edits the command; D3 still points at any other prose naming the script.
- D5 No counts of unrelated things in committed generated text. The module-index section lists folders that have a memory file and nothing else; the "N folders have no memory file and are not listed" count moves to `lore context refresh` / `--check` output. This changes spec-module-index-lists-only-folders-with-a-memory-file-managed AC-MI-1's count clause; the implementing task records that change on AC-MI-1 per the AC-change rules. Catches (c).
- Not chosen: a `co_change` rule "package.json changes require CLAUDE.md changes" (forces edits to prose that is still true; whole-file granularity); an AI judge re-reading CLAUDE.md on every change (non-deterministic, costly, and no binding to point at); an acknowledgement ledger for D3 (a check of a check).

## Acceptance Criteria

Structured criteria via `lore ac add` (AC-BIND-1..5), each a script-mode test written red first:
- AC-BIND-1: a memory file referencing `packages/core/src/x.ts#Gone` where `x.ts` exists but does not export `Gone` yields the deterministic finding from `lore status --check-claude-md` (exact exit code and finding kind asserted); the same reference resolves identically through the spec code-anchor path.
- AC-BIND-2: a fragment naming `bun run no-such-script` yields the missing-script finding; naming an existing script yields none.
- AC-BIND-3: `lore refs <path> --json` in a throwaway corpus returns exactly the spec anchor, the CLAUDE.md line and the fragment line that bind to the path, and nothing for an unbound path.
- AC-BIND-4: feeding the installed PostToolUse hook an Edit of a bound file returns additional context naming each binding document and line and does not block; an Edit of an unbound file returns nothing; a package.json edit that changes only an unrelated script's command returns nothing for prose bound to another script.
- AC-BIND-5: in a throwaway repo, adding a folder without a memory file leaves the committed CLAUDE.md byte-identical after `lore context refresh`, and `refresh --check` output reports the count; the command table renders each documented script's description from package.json.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BIND-1: A memory-file reference to path#Symbol whose file exists but does not export Symbol is a deterministic lore status --check-claude-md finding (exact exit code and kind), resolved by the same core resolver as spec code anchors.
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/bind-symbol-reference.test.ts && echo 'AC-BIND-1 PASS'
  other_command=7
- [⚑] [script] AC-BIND-2: A memory file or fragment naming a package.json script that does not exist (bun run form) yields the missing-script finding; an existing script yields none.
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/bind-script-reference.test.ts && echo 'AC-BIND-2 PASS'
  other_command=1
- [⚑] [script] AC-BIND-3: lore refs <path> --json returns exactly the spec code anchor, CLAUDE.md line and fragment line bound to the path in a throwaway corpus, and nothing for an unbound path.
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/lore-refs.test.ts && echo 'AC-BIND-3 PASS'
  other_command=1
- [⚑] [script] AC-BIND-4: The installed PostToolUse hook, fed an Edit of a bound file, returns additional context naming each binding document and line without blocking; an unbound file returns nothing; a package.json edit changing only an unrelated script returns nothing for prose bound to another script.
  script: test — bunx --bun vitest run packages/lore/tests/integration/hooks/post-edit-bindings.test.ts && echo 'AC-BIND-4 PASS'
- [⚑] [script] AC-BIND-5: Adding a folder without a memory file leaves committed CLAUDE.md byte-identical after lore context refresh while refresh --check reports the count; the command table renders each documented script's description from package.json.
  script: test — bunx --bun vitest run packages/lore/tests/integration/context/generated-sections-stable.test.ts && echo 'AC-BIND-5 PASS'
