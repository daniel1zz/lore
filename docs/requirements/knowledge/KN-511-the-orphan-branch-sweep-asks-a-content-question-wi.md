---
id: KN-511
type: knowledge
role: knowledge
title: "The orphan-branch sweep asks a content question with a SHA predicate, and a red-first test task has no legal terminal state"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: [git-workflow, worktree, lore-done, attestation, red-first]
parent: PRD-001
links:
  - {id: KN-514, type: relates-to}
---
## 1 — the orphan-branch sweep uses a SHA predicate to answer a CONTENT question

The root CLAUDE.md mandates, after every merge wave:

> ⛔ merge 协议只消费父 agent 返回的分支名是结构性盲区 … 故每轮 merge 后**无条件**跑 `git branch -a` + 逐个 `git log --oneline main..<branch>`

The sweep itself is right and it earned its place — 726 lines / 38 regression tests once sat on a branch nobody merged. What is wrong is the **predicate**.

Measured 2026-08-23. The sweep reported **9 unmerged branches**, one carrying 28 commits including a nested merge of another worktree branch — exactly the "a subagent's own subagent opened a branch the parent never names" shape the rule warns about. Every alarm was false:

```
stamp-types.test.ts (578 lines)          → on main, byte-identical
receipt-log-v2.test.ts (298 lines)       → on main, byte-identical
issue-body-redaction.test.ts (318 lines) → on main, byte-identical
transport-config-compat.test.ts          → on main, byte-identical
stamp-types-compile-fail.fixture.ts      → on main, byte-identical
check-ac-state-renderers.ts (909 lines)  → on main, byte-identical
```

Cause: that work reached main through the remote, and the session's own `git pull --rebase` rewrote the commit SHAs. `git log main..<branch>` and `git branch --merged` both answer *"is this SHA an ancestor of main"*. After a rebase the answer is no while the content is already there, verbatim.

⛔ So the sweep's output is not evidence of unlanded work — under any rebase workflow it produces a standing population of false alarms, and a false alarm that recurs every wave is one an agent learns to wave through. That is the failure mode: not a missed branch, but a signal degraded until nobody reads it.

**The predicate that actually answers the question**: for each branch, diff its own merge-base against main for the files it touches, or `git cat-file -e main:<path>` plus a content diff per deliverable. Content, never ancestry.

⛔ And the diff direction matters too: `git diff main..<branch>` on a branch cut before a 24-commit main advance reported *"85 files changed, 8363 deletions"* for a commit that added three files and deleted nothing — two-dot diff compares endpoint snapshots, so everything main gained reads as something the branch deleted. `git show --stat <sha>` is what answers "what did this commit do".

## 2 — a red-first test task has no legal terminal state

`lore done` refused a red-first test task twice, on two independent checks:

1. no `result:"pass"` row carrying `attestation` — `expected-fail` never counts, however many exist;
2. even under `--override-attestation`, each declared test-file anchor needs an **unfiltered** `oracle:test result:pass` row.

Both refusals are structurally unsatisfiable for a task whose deliverable IS a failing oracle. The three routes out are all bad: fake a pass (fabrication), fold the tests into the implementation task (violating "complexity ≥ medium → tests written by an independent subagent"), or leave the task in the ready set forever (the inflated-readiness cost the root CLAUDE.md already names).

**On reflection the gate is RIGHT and the standing rule is what needs adjusting.** An oracle that has never been observed going green is not known to be satisfiable — a red-first task is genuinely not finished until its own oracle passes. The gate forces "write the failing test" and "make it pass" into one acceptance unit, which is the correct coupling.

The rule that needs a carve-out is the dispatch protocol's: *"主 agent merge 验证通过后补 `lore done <task>`"*. For a red-first test task that timing is wrong — it can only be archived after the IMPLEMENTATION task merges and its oracle flips green. Until then it correctly sits in the ready set, and its presence there is not an orchestration lapse.

⛔ What is still unmechanized: nothing distinguishes "a task legitimately awaiting its sibling's green run" from "a task the orchestrator forgot to close". Both read as `ready`. A `blocked-on: <task>` edge would make the difference machine-visible; today it lives only in prose like this.

## 3 — why neither lesson was written into the root CLAUDE.md

The root file sits at 23802 / 24576 bytes. Its eviction floor is `0.97 × 24576 = 23838.7`, so it has **37 bytes** before any addition trips a deterministic `eviction_required` finding and demands an eviction in the same change.

Recording that here rather than spending those 37 bytes is itself the contract's prescribed behaviour — but it is worth noting that the two lessons above are timeless discipline, not events, and the only reason they are not in the memory file is that the memory file has no room. That is the budget manufacturing a placement decision, which is the exact dynamic `evict_threshold_fraction` was introduced to expose.

## 4 — a plan whose phases are EMPTY reports as fully done

Archiving the last task of Phase 1 printed:

> "plan-...-split" has no more non-terminal tasks — every child task is now archived/deprecated. The plan itself is still open; the plan-close gate will evaluate it once you run: `lore set <plan> --status archived`

Measured immediately after, per phase:

```
P1-split-and-wire            2 tasks
P2-slug-and-emphasis         0 tasks
P3-grammar-rules-and-prose   0 tasks
P4-always-on-advisories      0 tasks
```

Three quarters of the plan had no tasks authored yet. The statement is TRUE and useless: "every child task is archived" is vacuously satisfied by a phase with no children. Pasting the suggested command would have closed a plan with 3 of its 4 phases untouched, and every readiness report afterwards would have said the work was complete.

This is the root CLAUDE.md North Star property 2 verbatim — *"Vacuously true" must be distinguishable from "true" — an empty phase satisfies "every child task archived"* — observed live rather than reasoned about. Worth recording because a hazard that is already written down and still fires is evidence about the WRITING, not about the reader.

⛔ It also reproduces the standing rule against pasting a governance tool's own suggested write command: that suggestion is emitted by a predicate which cannot see the difference between "finished" and "never started".

**The predicate that would answer it**: a phase with zero authored tasks is UNSTARTED, not complete, and the two must render differently. Same shape as section 1 — a mechanism answering a question with a predicate that cannot distinguish the case it matters most for.

## 5 — this document was itself corrupted by the defect class it documents

Writing section 4 the first time used `python3 -c "..."` with double quotes. The section text contained backticks. Shell command substitution fired inside them, so `lore set <plan> --status archived` — quoted as an EXAMPLE of a command not to paste — was actually EXECUTED, and the phase-count code block was replaced by the shell's error output.

The executed command failed only because the slug in the quoted text was elided to `plan-...`, which resolves to nothing. Had the example been quoted verbatim with the real slug, this document's own act of warning against pasting that command would have run it, closing a plan with three untouched phases.

⛔ Any writer that puts a shell command into prose must treat quoting as load-bearing: quoted heredoc (`<<'EOF'`) or a file written by a tool, never a double-quoted `-c` string. The root CLAUDE.md already carries this lesson from an earlier incident; it recurred here inside the very paragraph documenting a related hazard.

## 6 — overlap with a same-day sibling, and where this document disagrees with it

`knowledge-three-mechanism-gaps-measured-while-dispatching-the` was written the same day by a concurrent session and covers section 2 here in more depth: it names all three stacking `lore done` gates, and shows they DEADLOCK rather than merely annoy, because the plan skill wires `test blocks impl` and readiness requires every blocker archived — so the test task cannot archive until impl exists, and impl cannot become ready until test archives. Read that one first for the mechanism.

⛔ Two things this document adds rather than repeats:

**A disagreement.** That retro treats the un-archivable red-first task as a defect needing an `extra.red_first` exemption from gates 1 and 3. Measured here, the test-anchor floor looks CORRECT: an oracle never observed going green is not known to be satisfiable, so a red-first task genuinely is not finished until its paired implementation proves it can pass. Archiving it earlier would certify an oracle that might be unsatisfiable. What needs adjusting is the DISPATCH PROTOCOL's timing rule — "主 agent merge 验证通过后补 lore done" — which for a red-first task must read "after the SIBLING implementation merges and the oracle flips green". This session archived both tasks in that order with no exemption and no unlink, so the deadlock is avoidable by ordering alone when the two tasks are dispatched sequentially rather than wired with a blocking edge.

**The other end of the pincer.** That retro documents the gates refusing the TEST task. The IMPLEMENTATION task is refused too, from the opposite side: `lore done` demanded an `expected-fail` row on the impl task, which by construction has none when the red oracles were authored by a separate task per the "tests written by an independent subagent" rule. `--declare-no-new-tests` is the audited route, and its reason must name the sibling task and commit so the pairing stays machine-traceable. So the split-task shape needs an escape hatch at BOTH ends, and neither end's need is visible from the other.

⛔ Also from that sibling, not independently re-measured here: `lore ac set --falsifier-*` demotes an approved spec to draft. Two falsifier edits were made in this session and the spec was re-approved after each, so no dispatch was hit — but that was the standing "re-approve after touching an AC" habit doing the work, not awareness of this specific trigger.

## 7 — a worktree agent cannot perform the contract's own eviction procedure

`lore governance claude-md`'s Eviction Rule is four steps, and step 2 is *"Move it, verbatim, into a corpus doc (`lore create knowledge --sub-type reference`)"*.

Measured 2026-08-23: an agent dispatched into an isolated worktree to evict from `packages/lore/src/service/CLAUDE.md` was blocked at exactly that step by `gate:corpus-write:foreign-provenance`. It reported the block rather than working around it, and capped its result at 482 bytes of runway instead of the larger margin a real move-out would have bought.

⛔ The mandated dispatch shape and the mandated eviction procedure are in direct conflict:

- Implementation MUST run in an isolated worktree (root CLAUDE.md, worktree-mandatory for `lore-implementer`).
- Eviction MUST move the block into a corpus doc.
- Corpus writes from a foreign worktree are refused by a gate.

So any eviction whose content genuinely belongs in the corpus — a mechanism walkthrough, a rejected alternative, an incident measurement — is not performable by the agent shape the project mandates for it.

**Why it did not bite this time**: what actually needed to leave that file was code-derivable detail (a line number `:1031`, port filenames like `../adapters/real-git-port.js`), and the contract's own What-Goes-In table routes those to *the code itself — read / grep it*, not to the corpus. Step 2 was inapplicable, so compression-in-place was the correct procedure and the rule was followed, not bypassed. That is luck about this file's contents, not a property of the design.

**Mechanism fix (needed)**: either the eviction procedure names a two-actor split (worktree agent proposes the extraction, main checkout performs the `lore create` and hands back the slug), or corpus writes from a claimed worktree are permitted for the task's own declared anchors. Until one exists, dispatching "evict from a memory file" into a worktree is only safe when the content is code-derivable — and nothing checks that precondition before dispatch.
