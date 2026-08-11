---
id: KN-249
type: knowledge
role: knowledge
title: "Close-out findings: assess must be the last step, and an evidence tail can fail to witness its own AC"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-123
---
# Close-out findings: assess must be the LAST step, and an evidence tail can fail to witness its own AC

## 1. `lore assess` belongs after ALL evidence, not before — otherwise it loops

Observed sequence on `plan-implementation-resume-ticket-coverage-floor-blocking`:

1. `lore assess` → gap: "the plan mandates a clean-tree full-suite run but no evidence record exists for it".
2. Acting on that advice, recorded the isolated full-suite run via `lore evidence` (04:11:54).
3. `lore set <plan> --status archived` → **plan-close DENIED: ASSESSMENT_STALE** — the stored assessment (04:04:53) now predates task evidence activity, so it "describes an intermediate state".
4. Re-ran `lore assess`, then the close succeeded.

Both gates are individually right, and together they form a loop that costs one full judge run per iteration: assess names a missing evidence record → recording it invalidates that very assessment. The ordering rule is therefore not stylistic. **Land every evidence record first — including the plan-level full-suite run — and only then assess.** Treat any assess recommendation of the form "record X as evidence" as a signal that assess was run too early, not as a task to do after it.

## 2. An evidence `output_tail` can fail to witness the criterion it is filed under

`AC-RCH-7`'s attested run passed (exit 0) and its command was correct, but the captured `output_tail` showed test lines from `AC-RC-4` — a *different* criterion living in the same 15-test file — with no matched-file count and no AC-RCH-7 result. Two successive judges flagged it; the first rated it MAJOR ("the pass verdict is carried by the recorder's claim rather than by legible output"), downgraded to minor only once the test source became visible via `--diff-file`.

Root cause: the AC's declared command runs a whole file, and the tail keeps the END of the output. Any AC whose command runs a multi-test file can therefore produce a pass record that does not contain its own evidence.

Directions: have the AC command narrow to the criterion (`-t "<AC id>"`) so the tail necessarily contains it; or have the evidence recorder prefer the tail slice matching the AC id over the literal end of the stream. The second is the mechanism fix — it holds even when an author writes a whole-file command.

## 3. A thorough task document degrades the judge that reads it

Every one of three `lore assess` runs reported `truncated: task:task-t1-…`, and the two with a diff also truncated the unit-test diff. Overall confidence was reported **low (degraded by truncation)** each time, even as the dimension scores rose to 88/78/94.

The T1 task doc was written deliberately thorough (four numbered change descriptions, a context digest, oracle instructions). That thoroughness consumed the judge's input budget and cost confidence on the whole plan. There is a real tension here — the same detail is what let the implementer land all three changes in one pass with no re-dispatch — so the lesson is not "write less": it is that **task-doc verbosity has a downstream price at assess time**, and a plan whose assessment confidence matters should keep the implementation detail in the spec (which assess reads as the contract) rather than duplicated into the task body.

## 4. `lore evidence` and `lore verify` disagree about the same command string

`lore evidence --command "bun run build && cd packages/lore && bun test tests/e2e/…"` was REJECTED by an oracle-file precheck that resolves paths from the repo root and does not account for the `cd`. The identical string, declared on the AC, ran fine under `lore verify` and recorded attested evidence. So one surface rejects what the other executes. The implementer worked around it by recording a root-relative form — a silent divergence between the declared AC command and the recorded evidence command.

## 5. Two open arming boundaries (candidates for the next slice)

- **MCP namespace collision.** H4's MCP shape matches when the last `__`-separated segment of the tool name equals `lore_feed`. A tool from a DIFFERENT server named `mcp__other__lore_feed` carrying a `session-resume` checkpoint would arm the coverage floor. No fixture pins this. (Found by the assess judge, not by any AC.)
- **Sidechain entries** remain undefined — see `knowledge-two-gaps-t1-surfaced-a-change-selector-blind-to-spawn` §2 for the three candidate rules.

## 6. A shipped rule the verb does not enforce (SPEC-112 debt, not introduced here)

Measured against the merged binary: `**[RESUME_DISPOSITION]** KD1: deferred:` — an EMPTY reason — closes the item. The check is `disposition.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX)`, and `"deferred:"` satisfies its own prefix. But SPEC-112 D5 requires a reason rather than a bare deferral, and the verb's OWN block reason instructs that a deferral must carry its reason after the colon. The verb ships a rule it does not enforce. The adjacent case IS correct and is now pinned green: a bare `deferred` with no colon is rejected. No AC-RCH criterion covers the empty-reason case, so T2 correctly left no RED assertion for it.

## 7. Unconfirmed: a last-task advisory fired one task early

`lore done` on T2 printed `⚠ "<plan>" has no more non-terminal tasks` while T3 was still `draft` (T3's own version log shows `v6 lore done: draft → approved` timestamped 109ms LATER). `computePlanNowFullyTerminal` requires `siblings.every(isTerminalStatus)` with terminal = `{archived, deprecated}`; all three tasks share the plan as `parent_id`; and `findMany` applies no default status filter. Those three hypotheses are excluded, and the observation still contradicts the code. NOT confirmed as a defect — confirming it needs a throwaway-corpus reproduction (plan + one archived task + one draft task, then `lore done` the first). Harm is bounded: the advisory only suggests running the close, and plan-close is an independent gate that evaluates on its own.
