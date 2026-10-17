---
id: SPEC-178
type: spec
role: spec
title: "Two helper agent types: lore-reader and lore-implementer"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-17
tags: [agents, subagent, dispatch]
---
## Overview/Goal

Implement `adr-helper-agent-types-split-only-on-mechanism-enforced`: lore ships exactly two helper agent types, split on what a mechanism enforces.

- `lore-reader` — Write/Edit/NotebookEdit removed, no worktree. Replaces `lore-explorer` and `lore-reviewer`.
- `lore-implementer` — full tools, worktree enforced by the dispatch-isolation gate (BR-1023). Also the type for test-writing work, replacing the user-local `tester` type.

Role (explore, review, implement, test) is chosen per dispatch and carried by the role's skill (`lore-review`, `lore-test`, ...) and by fragments, not by a type. Model is a dispatch parameter.

## Scope

In scope (every consumer named by the 2026-10-15 census):

1. Agent definitions: add `assets/agents/lore-reader.md`; delete `assets/agents/lore-explorer.md` and `assets/agents/lore-reviewer.md`. `lore-reader`'s body covers both entry points — locating code/corpus facts, and reviewing a change (pointing at the `lore-review` skill references instead of restating them). `lore-implementer.md` drops "route to tester subagent".
2. Hooks: `pre-dispatch-isolation-gate.mjs` `WRITING_AGENTS` becomes `{lore-implementer}`; its comments and denial text name `lore-reader` as the read-only alternative. `pre-no-general-agent-gate.mjs` roster text lists `lore-reader` and `lore-implementer` only.
3. Fragment audiences: every `subagent:lore-explorer` / `subagent:lore-reviewer` becomes `subagent:lore-reader`; every `subagent:tester` is dropped (the content already reaches `subagent:lore-implementer`). Shipped (`assets/context/`) and repo-local (`.lore/context/`).
4. Skills and skill references under `assets/skills/`: every dispatch or mention of `lore-explorer` / `lore-reviewer` / `tester` as an agent type is rewritten to `lore-reader` or `lore-implementer` with the role named in the bundle. Every `Agent(subagent_type="lore-implementer", ...)` example carries `isolation="worktree"` (fixes `lore-test/SKILL.md:341` and `lore-test/references/six-dim-coverage.md:137`, which the isolation gate would refuse as written).
5. Tests that pin the shipped agent file list or the type strings (`assets-ssot.test.ts`, `real-setup-ports.test.ts`, hook tests, fragment fixtures, setup fixtures, e2e catalog renders) follow the new names. Run-record fixtures that merely use `lore-implementer` as an example agent type are unchanged.
6. Installed copies: `lore setup` converge already removes files the shipped payload no longer carries and prints them. This spec pins that behaviour for the two retired agent files.
7. Docs: the BASE-030 baseline body sentence naming `(lore-implementer, tester)`.

Out of scope:

- Making `lore-reader` fully read-only: Bash stays available, so a reader run can still write through Bash. Counted as NOT ENFORCED in the ADR; needs its own spec (a hook refusing mutating commands from a reader run).
- Recording the dispatched role per run (blocked on #167; handoff NS4 / D8).
- Renaming `lore-implementer`.
- `packages/*/src` runtime code: the census found no hard-coded agent type list there (`fragments-flow.ts` `enumerateAgentTypes` reads the agents directory).

## Acceptance Criteria

Structured criteria are declared with `lore ac add` (AC-AT-1 .. AC-AT-6). Each script command prints `AC-AT-n PASS: <fact>` on success.

## Risks

- A consumer project that dispatches `subagent_type: "lore-reviewer"` or `"lore-explorer"` loses that type on its next `lore setup` converge. The removal is printed by setup; the release note must name `lore-reader`.
- `lore fragments check` reports one fewer agent type (the count follows the agents directory). Tests asserting a count must use the directory, not a literal.


## Acceptance Criteria (structured)

- [⚑] [script] AC-AT-2: The dispatch-isolation hook refuses a lore-implementer dispatch without isolation (exit 2, stderr naming lore-implementer), passes the same dispatch with isolation=worktree and a lore-reader dispatch (exit 0), and its source names lore-reader and none of lore-explorer, lore-reviewer or 'tester'.
  script: other — cd /Users/apple/Projects/zz/lore && h=assets/hooks/pre-dispatch-isolation-gate.mjs; e=$(mktemp); printf '{"tool_name":"Agent","tool_input":{"subagent_type":"lore-implementer","prompt":"x"}}' | node $h >/dev/null 2>"$e"; r1=$?; printf '{"tool_name":"Agent","tool_input":{"subagent_type":"lore-implementer","isolation":"worktree","prompt":"x"}}' | node $h >/dev/null 2>&1; r2=$?; printf '{"tool_name":"Agent","tool_input":{"subagent_type":"lore-reader","prompt":"x"}}' | node $h >/dev/null 2>&1; r3=$?; echo "implementer-bare=$r1 implementer-worktree=$r2 reader=$r3"; [ $r1 -eq 2 ] && grep -q "lore-implementer" "$e" && [ $r2 -eq 0 ] && [ $r3 -eq 0 ] && grep -q "lore-reader" $h && ! grep -qE "lore-explorer|lore-reviewer|'tester'" $h && echo "AC-AT-2 PASS: isolation gate refuses a bare lore-implementer dispatch (exit 2), passes worktree and lore-reader, names only current types"
- [⚑] [script] AC-AT-4: No fragment audience under assets/context or .lore/context names subagent:lore-explorer, subagent:lore-reviewer or subagent:tester; agent-rules.md reaches subagent:lore-reader; evidence-attestation.md reaches subagent:lore-implementer; lore fragments check exits 0.
  script: other — cd /Users/apple/Projects/zz/lore && ! grep -rnE 'subagent:(lore-explorer|lore-reviewer|tester)' assets/context .lore/context && grep -q 'subagent:lore-reader' assets/context/agent-rules.md && grep -q 'subagent:lore-implementer' assets/context/evidence-attestation.md && lore fragments check && echo "AC-AT-4 PASS: no fragment audience names a retired type; agent-rules reaches lore-reader; fragments check exits 0"
- [⚑] [script] AC-AT-1: assets/agents/ lists exactly 'lore-implementer.md lore-reader.md'; the frontmatter of lore-reader.md has the lines '  - Write', '  - Edit' and '  - NotebookEdit'; lore-implementer.md contains no word 'tester' (case-insensitive); lore-reader.md contains the string 'lore-review'.
  script: other — cd /Users/apple/Projects/zz/lore && test "$(ls assets/agents | sort | tr '\n' ' ')" = "lore-implementer.md lore-reader.md " && for t in Write Edit NotebookEdit; do awk '/^---$/{c++;next} c==1' assets/agents/lore-reader.md | grep -qx "  - $t" || exit 1; done && ! grep -qiw tester assets/agents/lore-implementer.md && grep -q "lore-review" assets/agents/lore-reader.md && echo "AC-AT-1 PASS: assets/agents holds exactly lore-implementer and lore-reader; lore-reader removes Write/Edit/NotebookEdit and points review work at lore-review"
- [⚑] [script] AC-AT-3: The no-general-agent hook refuses subagent_type general-purpose with exit 2 and its stderr roster names lore-reader and lore-implementer and none of lore-explorer, lore-reviewer, tester.
  script: other — cd /Users/apple/Projects/zz/lore && h=assets/hooks/pre-no-general-agent-gate.mjs; e=$(mktemp); printf '{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","prompt":"x"}}' | node $h >/dev/null 2>"$e"; r=$?; echo "general-purpose exit=$r"; [ $r -eq 2 ] && grep -q "lore-reader" "$e" && grep -q "lore-implementer" "$e" && ! grep -qE "lore-explorer|lore-reviewer|tester" "$e" && echo "AC-AT-3 PASS: no-general gate refuses general-purpose (exit 2) and its roster names exactly lore-reader and lore-implementer"
- [⚑] [script] AC-AT-5: grep finds no 'lore-explorer' or 'lore-reviewer' under assets/skills, assets/agents, assets/hooks, assets/context, assets/project; no match of 'tester agent', 'tester subagent' or 'subagent_type="tester' / 'subagent_type=tester' (case-insensitive) under assets; every line under assets/skills containing 'subagent_type="lore-implementer"' also contains 'isolation="worktree"'; assets/skills/lore-review contains 'lore-reader'.
  script: other — cd /Users/apple/Projects/zz/lore && ! grep -rnE 'lore-explorer|lore-reviewer' assets/skills assets/agents assets/hooks assets/context assets/project && ! grep -rniE 'tester (sub)?agent|subagent_type="?tester' assets && ! (grep -rnE 'subagent_type="lore-implementer"' assets/skills | grep -v 'isolation="worktree"' | grep -q .) && grep -rq 'lore-reader' assets/skills/lore-review && echo "AC-AT-5 PASS: no shipped asset names lore-explorer/lore-reviewer/tester as a type; every lore-implementer dispatch example carries isolation=worktree"
- [⊘] [script] AC-AT-6: The retirement registry test (packages/lore/tests/integration/retirement-registry.bun.test.ts, rows install-agent-lore-explorer and install-agent-lore-reviewer plus the shared converge cases) passes (N pass, 0 fail): an install whose manifest tracks agents/lore-explorer.md and agents/lore-reviewer.md, converged with the current payload, no longer has either file, reports both as removals, has agents/lore-reader.md, and keeps an untracked user agent file untouched.
  script: test — o=$(mktemp); bunx --bun vitest run --testTimeout=30000 --hookTimeout=30000 packages/lore/tests/integration/retirement-registry.bun.test.ts -t 'install-agent-lore-explorer|install-agent-lore-reviewer|not a blanket wipe|second converge has nothing' > "$o" 2>&1; rc=$?; tail -5 "$o"; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' "$o" && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' "$o" && echo 'AC-AT-6 PASS: setup converge removes the retired agent files from an install that tracked them, prints them as removals, lands lore-reader and leaves an untracked user agent untouched'

## Code anchors

- assets/agents/lore-reader.md
- assets/agents/lore-implementer.md
- assets/hooks/pre-dispatch-isolation-gate.mjs
- assets/hooks/pre-no-general-agent-gate.mjs
- packages/lore/tests/integration/retirement-registry.bun.test.ts
