---
id: PLAN-222
type: plan
role: plan
title: "D1: refusal sites declare their rule in code"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [redesign, baseline, coverage]
parent: SPEC-221
---
## Goal

Implement `spec-refusal-sites-declare-their-rule-in-code-baseline-leaf` (D1 of `adr-facts-live-once-next-to-what-they-describe-corpus-changes`).

## Precondition

Starts only after every task of `spec-baseline-coverage-refuses-only-undeclared-commands-a-site` has landed: coverage is report-only, excuses are stripped, and site_map holds BR-n values only.

## Order

1. **D1-1, declarations, the code-only census and conversion, in ONE landing (AC-RIC-1, AC-RIC-3, AC-RIC-5, AC-RIC-6, AC-RIC-7).**
   - `LoreError` gains an optional `rule` member.
   - Each local `validationError`/`storeError` copy becomes one rule-taking helper each in `@lore/core`. The spec's "eight" undercounts: `git grep -ln "function validationError\|const validationError =\|function storeError\|const storeError =" -- packages` lists 16 files at plan time, and every one is replaced.
   - A reader for `@lore-site BR-n` tags on ports, interfaces, methods and callees.
   - Conflict reporting and retired/unknown-id reporting.
   - A declaration has no external key: it is a syntax node at the site (the `rule` argument, or the tag on the declaration it annotates). A rename or an inserted sibling moves it with the code (AC-RIC-3).
   - Delete the site_map reader, the `--site`/`--sites-file`/`--remove-site` options, `setSiteMap` and every other `site_map` reference in product source (packages/*/src, scripts/, assets/), with no exemption.
   - **Conversion on the same branch, before it lands.** A throwaway scratchpad script, never committed:
     - (a) reads every leaf's `BR-n` `extra.site_map` rows read-only;
     - (b) refuses, writing nothing, while any site is mapped by two leaves to different rules;
     - (c) applies only explicit resolutions, each a chosen rule plus a reason, recorded on the task's evidence;
     - (d) writes the declarations into the branch's code;
     - (e) prints the earlier (leaf, site, rule) triple count and the count `lore baseline coverage` on the branch reports mapped from code; the two must match;
     - (f) is deleted after it runs.

     The new readers and the converted declarations therefore land together, and main never shows a degraded mapping.
   - After the landing, the main agent removes every leaf's `extra.site_map` key in one pass, then runs AC-RIC-6.
2. **D1-2, rule-to-site index (AC-RIC-4).** After D1-1. Deliverables:
   - `lore rule show BR-n` lists each declaring site as file:line, with comments excluded.
   - `lore rule set BR-n --statement` prints the site list.
   - `lore rule apply <spec>` prints, for each rule it changes, the site list.
   - `lore baseline coverage --json` lists guaranteed rules with no declaring site under `unenforced`.
