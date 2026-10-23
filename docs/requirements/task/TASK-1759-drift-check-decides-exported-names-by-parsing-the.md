---
id: TASK-1759
type: task
role: plan
title: "Drift check decides exported names by parsing the file, not by a text scan"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Source: review of baseline-detect-code-anchor-drift, 2026-10-19 (design_necessity, class b, stopgap). BR-417: whether an anchored symbol is exported is decided by regular expressions over the file's text (packages/core/src/code-anchors.ts, the export-statement, default-export and brace-export patterns), which misses valid export forms (for example re-exports such as `export * from`, `export { x as y } from`, multi-line or decorated declarations) and reports them as missing; the output carries a note admitting the false findings.

End state: export detection uses a language-aware parse (the TypeScript compiler API or an equivalent parser already available to the product) for the languages it claims to check, so a valid export is never reported missing and the disclaimer note is removed. A file in a language the check cannot parse is reported as not measured for symbol anchors, never guessed. Restate BR-417 and close Q3 of the leaf (owner decision: the text scan is not the intended contract).

AC: red-first. A fixture file exporting a symbol only through `export { a as b } from './x'` and through `export * from`: a symbol anchor on it reports no drift. Falsifier: today's missing-symbol finding with the note.
