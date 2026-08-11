---
id: KN-203
type: knowledge
role: knowledge
title: "lore get's human view hides extra.issue_report, so a reporter's measured refutation is invisible to the spec author"
status: approved
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Retro — `lore get`'s human view HIDES `extra.issue_report`, and that is where the reporter's measured evidence lives

## What happened

While turning three raw bug reports into dispatchable specs (2026-08-03, wave 2 prep), I wrote a
full 5.6 KB spec for `task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict` on a
**wrong mechanism assumption**: that `lore uat record` writes `extra.uat` onto the plan, and that
the plan-close gate reads that field.

The actual mechanism, read afterwards from `packages/lore/src/service/uat-service.ts`:

1. validate the payload,
2. `createUatDoc(...)` — create a `knowledge` doc with `sub_type: "uat"`,
3. `addLink({ link_type: "informs", ... })` to the target.

No `extra.uat` is ever written to a plan. Three of the spec's acceptance criteria (AC-1, AC-5,
AC-6 in the first draft) asserted against a field that does not exist. The whole spec was rewritten.

## Mechanism root — the refutation was already in the corpus, in a field the read command does not print

The task doc carried `extra.issue_report` with the reporter's own measurements:

```
actual: 对任意 doc 类型静默成功。实测两例：(1) 传 ADR slug → 创建 knowledge-uat-adr-… 并 informs 该 ADR；
        (2) 传一条无关的 knowledge 笔记 slug → 创建 knowledge-uat-knowledge-agent-browser-… 这种嵌套 slug
repro_command: lore uat record <任意 knowledge-slug> --json-file <uatVerdictSchema-valid.json>
```

"创建 … 并 informs 该 ADR" refutes the `extra.uat` assumption outright. **`lore get <slug>`
renders the doc's `content` and a Navigation block, and prints none of `extra.issue_report`.** I
read the human view, saw a title plus a paragraph of prose, and wrote the spec from it. The
evidence that would have stopped me was one flag away (`lore get <slug> --json`) and invisible in
the default read.

This is not "I forgot to investigate" — I DID read the doc, with the command intended for reading
docs. The command showed me a strict subset of the doc and gave no indication a subset was shown.

## The rule this produces

⛔ **Before authoring a spec from a task whose `extra` carries an `issue_report`, read
`lore get <slug> --json` and consume `expected` / `actual` / `repro_command`, THEN read the
accused source. The rendered view is not the document.**

Generalised: for any lore doc type with structured `extra`, the human render is a projection.
Treat "I read the doc" as satisfied only when the read included the structured fields — the
projection is exactly where a reporter's measurement goes to die.

## Cost if undetected

The spec would have shipped to an implementer with three ACs pointing at a non-existent field.
The most likely outcome is not a loud failure: an implementer trying to satisfy "assert
`extra.uat` is written" against a service that writes a linked doc would either invent the field
(a real regression, adding a second storage location for verdicts) or quietly reinterpret the AC
and report success — the self-report vector, one layer up in the authoring chain.

## Candidate lore defect this exposes (NOT fixed here)

`lore get`'s default render drops `extra.issue_report` — the single most information-dense part
of an issue-reported task — with no marker that structured fields were omitted. A reader cannot
tell a doc with no `extra` from a doc whose `extra` was not shown. Silent projection, same family
as the defects this wave is closing. Worth reporting as its own task rather than smuggling into
one of wave 2's slices.
