---
id: KN-508
type: knowledge
role: knowledge
title: "lore feed's readiness line counts retracted tasks while lore ready excludes them — two unfiltered call sites in session-service"
status: draft
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [governance, readiness, session-service, invalidated, north-star-property-1]
parent: PRD-001
links:
  - {id: KN-510, type: relates-to}
---
Measured 2026-08-23 while resuming `knowledge-handoff-agent-main-orchestrator-116`. The eleventh gap of the plan-A wave-1 series (ten prior: `knowledge-ten-measured-gaps-from-landing-plan-a-wave-1-and-the`, none of them fixed). Recorded separately rather than appended, because that doc's title pins the count "Ten" and editing the count into it would turn its own title into the stale assertion this corpus keeps measuring.

## The observation

`lore feed session-resume --handoff knowledge-handoff-agent-main-orchestrator-116` closed with:

    plan-land-corpus-truthfulness-part-a-the-two-axis-type: 10/15 ready, 0 claimed, 0 done

`lore ready plan-land-corpus-truthfulness-part-a-the-two-axis-type --json`, in the same session seconds later, reported **8 records, 3 ready**. Both numerator and denominator disagree. Neither surface flags the other.

## Root cause — two unfiltered call sites, one authoritative filtered one

The readiness ARITHMETIC is genuinely shared: both paths call `evaluateReadiness` (`@lore/core`) via `SessionService.computeTaskCounts` / `TaskWorkflowService.ready`. The divergence is entirely in the **input task set**.

Authoritative, FILTERED — `packages/lore/src/service/task-workflow-service.ts:3441-3443`:

    const tasks = allTasksResult.value.filter(
      (t) => isPlanMember(t, plan.id) && !isInvalidated(t, nowIso),
    );

Its own reason comment cites `task-a-task-cannot-be-retracted-supersedes-emits-a-repair` AC3 and states it mirrors `CorpusService.list()`/`search()`'s D3 default exclusion.

Unfiltered site 1 — `packages/lore/src/service/session-service.ts:1117-1119`, `computeReadinessPointer`, which feeds the `lore feed session-resume` readiness line:

    const tasks = allDocsResult.value.filter(
      (d) => d.type === "task" && isPlanMember(d, planDoc.id),
    );

Unfiltered site 2 — `packages/lore/src/service/session-service.ts:332`, which feeds `lore bootstrap`'s `active_plans[].task_counts` (the SESSION-START INJECTION every session reads first):

    const tasks = allDocs.filter((d) => d.type === "task" && isPlanMember(d, plan.id));

Neither calls `isInvalidated`. SPEC-043's `isInvalidated` is a type-agnostic pure predicate that reads false for every never-invalidated doc, so adding it is a byte-identical no-op on every plan that has never retracted a task — which is why the divergence stayed invisible until a plan actually retracted some.

## Reproducible arithmetic

Plan A retracted 7 `[Skill:implement]` tasks via `lore invalidate --superseded-by` when decision D-A8 collapsed each RED/impl pair into one archival unit. Their `status` stayed `draft` — `draft → deprecated` is not a legal transition (`packages/core/src/schemas.ts:798-803`), so "deprecated with rationale" was unavailable and validity is the only marker.

- `15 = 8 live + 7 retracted`
- `10 = 3 genuinely ready + 7 retracted` (a retracted task carries no blocker, so `evaluateReadiness` reads every one of them as ready)

The 7 retracted tasks are counted as READY AND AVAILABLE TO CLAIM.

## Why this one outranks the other ten

The other ten gaps corrupt evidence for a reader who goes looking. This one corrupts the FIRST SCREEN of every session, and it does so specifically to agents that are following the rules:

- The root discipline doc states, verbatim: handoffs must never write a self-inferred "N/M complete", only `lore ready`'s raw counts. An agent obeying that reads the number `lore feed` prints — and that number is the wrong one.
- A resuming agent sees "10 ready" on a plan with 3 ready tasks, 7 of the 10 being work the corpus has explicitly retracted.
- It is the North Star's property 1 verbatim: a verdict that does not carry the state it describes. The count is self-consistent and wrong, exactly the shape of the `lore list` census that came out wrong by 21x.

`computeTaskCounts`'s own JSDoc (`session-service.ts:1036-1038`) says it is "the same computation `lore ready` uses". That sentence is true of the arithmetic and false of the result, which is the most expensive kind of comment: it tells the next reader not to look.

## Fix, and the oracle that would refuse a regression

Mechanism, not diligence — add the predicate at both call sites:

    isPlanMember(d, planDoc.id) && !isInvalidated(d, nowIso)

and rewrite `computeTaskCounts`'s JSDoc to name the input-set requirement rather than claiming sameness with `lore ready`.

Oracle: over a throwaway corpus (`mkdtemp` + `lore init`) holding one plan with N live tasks and M invalidated ones, assert that `lore feed session-resume`'s readiness line and `lore bootstrap`'s `active_plans[].task_counts` are FIELD-BY-FIELD EQUAL to `lore ready --json`'s counts computed over `record.ready === true`. Equality across three surfaces, not a hardcoded expectation.

Smallest mutation that turns it red: delete `!isInvalidated(...)` from either site — the counts diverge by exactly M. The oracle is vacuous unless the fixture actually invalidates a task, so the fixture MUST construct both ends: without at least one retracted task, all three surfaces agree trivially and the test passes while measuring nothing.

## A second, smaller finding from the same investigation

Reading these rows back, my first `jq` filter used `.ac_refs // []` — a field name that does not exist (the real field is `ac_ref`, singular, and absent rather than empty when unset). The `// []` fallback rendered every row as having NO AC reference, and I stated that as a finding before re-checking. The rows were fine: T1 carried `ac_ref=AC-CT-2`, T2 carried `AC-CT-1` and `AC-CT-7`.

This is the "no silent fallback" rule applied to the INSPECTION side, which the discipline docs only ever state for production code. A `//` default in a read-only query fabricates a clean-looking negative result, and a governance finding derived from it is indistinguishable from a real one. When querying corpus rows for an absence, distinguish "key absent" from "value empty" explicitly (`if has("k") then .k else "«ABSENT»" end`) — never let a default stand in for either.
