---
id: SPEC-202
type: spec
role: spec
title: "A retro lesson names the mechanism that stops it recurring, or says why none fits"
status: deprecated
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: [governance, retro, mechanism]
---
## Overview/Goal

A lesson written down is not yet a lesson learned. Today a retro (`lore create knowledge --sub-type retro`) is free text: nothing asks what mechanism changes because of it, so lessons repeat. On 2026-10-18 one session produced, in a single day, a patch-shaped plan that three reviews approved, a commit that concluded another session's in-progress merge, and an uncommitted edit in the shared checkout that turned a peer's test run red. Each was "noted" and none changed a mechanism until the user asked for one.

Goal: every lesson in a retro carries a disposition: either the mechanism that makes it not recur (a spec, ADR, plan, task, or baseline rule that changes the system) or the stated reason it can only stay a lesson. The retro document type refuses to exist without it.

## Scope

In scope: the knowledge `retro` sub-type contract in the service layer (so CLI, MCP and HTTP creation are refused identically), the `lore create` flags that supply lessons, one bullet in the shipped CLOSE rule fragment (`assets/context/corpus-workflow-4-close.md`) stating the principle, and the shipped session-capture skill's retro instructions.

Out of scope: existing retros (records are history; the contract applies when a retro is created); other knowledge sub-types; judging the quality of a mechanism (that is the approval judge's job for the linked spec or plan).

## Design

**D1 — Lesson disposition is part of the retro contract.** A retro carries `extra.lessons`: a non-empty list; each entry has `lesson` (non-empty text) and exactly one of `mechanism` (the id or slug of an existing spec, ADR, plan or task, or a live baseline rule id `BR-n`/`AS-n`) or `stays_lesson` (non-empty text saying why no mechanism fits). Creation refuses (exit 4, naming the field and entry index) a retro without `extra.lessons`, an entry with neither or both, an empty text, or a `mechanism` that does not resolve. For each document `mechanism`, creation writes an `informs` link from the retro to it, so the mechanism shows the lesson that motivated it. The contract is a property of the document type: it holds on every write that sets or changes a retro's `extra.lessons` (create, `lore set`, MCP, HTTP). Such a write is refused the same way when any lesson lacks a valid disposition, and on success the retro's `informs` links to mechanisms are made equal to the set of document mechanisms in its lessons (links added for new ones, removed for dropped ones). A write to a retro that does not touch `extra.lessons` is not affected, so a retro created before this contract stays editable in its other fields; adding lessons to it must satisfy the contract.

**D2 — Author surface.** `lore create knowledge --sub-type retro` takes repeatable `--lesson "<text>"`, each followed by exactly one `--mechanism <id|slug|BR-n|AS-n>` or `--stays-lesson "<why>"` (pairing by order), or `--lessons-file <json>` with the same shape. The MCP create tool accepts the same `extra.lessons`.

**D3 — The principle, stated where authors read.** The shipped CLOSE rule gains one bullet: a lesson is finished only when it changes a mechanism — ask what end-state design makes it impossible to recur (not a guard on the old design), record that as a spec, plan, task or rule, and name it as the lesson's mechanism; only when none fits does the retro say why. The session-capture skill's retro steps produce `extra.lessons` in this shape. D3 has no acceptance criterion on purpose: a test that pins a sentence in a rules file would be a guard on our own text; enforcement is D1.

## Acceptance Criteria

Structured criteria via `lore ac add`: AC-RM-1 (refusals and acceptance at the service layer through the CLI), AC-RM-2 (the `informs` link is written for each document mechanism and a BR/AS mechanism must be live), AC-RM-3 (MCP creation is refused and accepted identically).


## Acceptance Criteria (structured)

- [·] [script] AC-RM-1: lore create knowledge --sub-type retro exits 4 naming extra.lessons when no lesson is given, and naming the entry index when a lesson has neither or both of --mechanism/--stays-lesson, an empty text, or a mechanism that does not resolve; it exits 0 and stores extra.lessons for a lesson with a resolving mechanism and for one with a non-empty --stays-lesson; --lessons-file with the same shape behaves identically; a later lore set that would leave a retro's lessons invalid exits 4 the same way.
  script: test — bunx --bun vitest run packages/lore/tests/integration/retro-lesson-disposition.test.ts -t 'refuse and accept' && echo 'AC-RM-1 PASS: retro lesson disposition enforced at create'
- [·] [script] AC-RM-2: For each lesson whose mechanism is a document, creation writes exactly one informs link from the retro to it; a later lore set that adds or drops a document mechanism adds or removes the matching link so the links equal the lessons' document mechanisms; a BR-n or AS-n mechanism must be a live rule (a proposed or retired id exits 4 naming it) and writes no document link; a lore set on a retro that does not touch extra.lessons succeeds even when the retro predates the contract.
  script: test — bunx --bun vitest run packages/lore/tests/integration/retro-lesson-disposition.test.ts -t 'mechanism link' && echo 'AC-RM-2 PASS: mechanism linked; rule ids must be live'
- [·] [script] AC-RM-3: The MCP lore_create tool refuses a retro without valid extra.lessons with the same error code and field as the CLI, and accepts the same valid shape, because the contract is enforced in the service layer.
  script: test — bunx --bun vitest run packages/lore/tests/integration/retro-lesson-disposition.test.ts -t 'mcp parity' && echo 'AC-RM-3 PASS: MCP and CLI identical'
