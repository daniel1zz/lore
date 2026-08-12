---
id: TASK-701
type: task
role: plan
title: "The mirror export silently skips a changed knowledge doc and every parity check reports OK"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Measured 2026-08-12 on `main` at 44d3ada7, with a discriminating control.

## The defect

`bun run mirror:export` does not rewrite an existing mirror file when the corpus doc's CONTENT changes, at least for `knowledge` docs. Every available check reports OK, so the divergence is invisible.

Measured on `knowledge-eight-findings-from-landing-corpus-resolution` (`status: approved`, `sub_type: retro`, corpus version 9):

| | mirror file | corpus |
|---|---|---|
| bytes | 10521 | 17989 |
| occurrences of `## 9.` | 0 | 1 |
| occurrences of `## 10.` | 0 | 1 |
| occurrences of `## 11.` | 0 | 1 |
| occurrences of `SECOND CORRECTION` | 0 | 1 |

The mirror is frozen at the doc's v1 content while the corpus is at v9 — the body grew 71% and none of it landed.

Reproducibility: `md5` of `docs/requirements/knowledge/KN-441-eight-findings-from-landing-corpus-resolution.md` is byte-identical before and after a fresh `bun run mirror:export` (`1acbde2a2c329a2a80ba797a305a6e70` both times), and the export exits 0 reporting OK.

## CONTROL — the export is not globally broken

`spec-corpus-resolution-carries-provenance-and-a-foreign-write` was edited in the same session, is also `approved`, and its mirror file `SPEC-141-...md` DOES carry the new `Post-landing corrections` section. So specs are re-rendered and this knowledge doc is not. Without this control the report would be indistinguishable from "the export never rewrites anything", which is false.

## Why nothing caught it

Three independent checks all pass over the divergence:

1. `bun run mirror:export` exits 0 and prints OK.
2. `bun run check:spec-mirror` exits 0 and states outright: "count and slug parity; file CONTENT is not compared."
3. `git status --short .lore docs/requirements` is CLEAN — the stale file matches its last commit, so the repo-pollution guard in `spec-loop-e2e.bun.test.ts` sees nothing either.

A stale mirror is therefore not "dirty"; it is quietly wrong, and the pre-push corpus gate cannot distinguish it from a correct one. This is the failure shape this repo already names: an outcome the tool renders identically whether or not it is sound.

## What must land

1. Find why this doc is skipped and fix it at that root. Candidate hypotheses to measure, NOT to assume: content-digest tracking in `.lore/export-index.json`; a type/sub-type filter that treats ledger knowledge sub-types (`assessment | retro | handoff | uat`) differently; an incremental write path keyed on something other than the content.
2. Extend `check:spec-mirror` to compare CONTENT, not just count and slug parity. The current message is honest about the limit, which is exactly why the limit needs closing rather than documenting.
3. The oracle must go red on a constructed divergence: edit a corpus doc's body, export, and assert the mirror file changed. A test that only exports and checks counts passes over this defect today.
4. Re-export the whole mirror once the fix lands — this defect means an unknown number of back-catalogue mirror files may already be stale in content while reporting parity.
