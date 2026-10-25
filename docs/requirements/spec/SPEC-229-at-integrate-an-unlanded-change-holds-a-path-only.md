---
id: SPEC-229
type: spec
role: spec
title: "At integrate an unlanded change holds a path only while its task is claimed; a directory anchor holds only touched files"
status: approved
priority: critical
created: 2026-10-20
updated: 2026-10-20
tags: [integrate, claims]
links:
  - {id: TASK-1697, type: governs}
---
## Overview/Goal

At integrate, an unlanded change holds a path only while its task is being edited, meaning the task holds a fresh claim. A directory anchor holds only the files the holder's branch changed.

Observed 2026-10-20: BR-1346 counted every unarchived task with unlanded work as a holder. Four released, committed branches that all change packages/core/src/config.ts therefore each held the file against the others, and none could land first. The fix for the gate was itself held too. A directory anchor such as `packages/lore/tests/` held the whole directory, contradicting the `lore anchor add` contract ("holding only the files its holder touched"). The same deadlock was being fixed differently in spec-landing-does-the-bookkeeping-claims-start-from-main-parked; that approach (parking) was withdrawn on 2026-10-20 in favour of this one.

## End state

1. Integrate refuses a branch whose own change touches a path or symbol held by an anchor of another task holding a fresh claim, and names each path and task (exit 4). This is unchanged for claimed holders.
2. A task that is released or unclaimed holds nothing at integrate, whatever its branch holds. The first branch to integrate lands; the others merge main, which they must do anyway.
3. The landing output lists the released, unlanded tasks whose anchors overlapped, so their owners know to merge. This is information, not a refusal.
4. A claimed holder's directory anchor holds only the files that holder's claimed branch changed (merge-base to tip). A holder whose branch cannot be measured holds the whole directory and is named as unmeasured.
5. The claim-time gate's copy of the directory over-reach (`gate-predicates.ts`) follows in a separate task, once that file is free.

## Scope

In: `packages/lore/src/service/own-diff-judgment.ts`, plus a new integrate test.

Out: the claim-time gate (item 5).

## Acceptance Criteria

Structured criteria are recorded with `lore ac add` (AC-OWND-1).


## Acceptance Criteria (structured)

- [·] [script] AC-OWND-1: Throwaway repo + corpus: two tasks, each claimed then released, with committed branches changing the same file: integrating the first exits 0 and lists the other as an unlanded overlap; after merging main the second exits 0. A third task still claimed whose anchor covers the file makes integrate exit 4 naming it. A claimed holder with a directory anchor whose branch changed only one file in it blocks a branch touching that file (exit 4) and not one touching a sibling file (exit 0).
  script: test — bun run test:file packages/lore/tests/integration/own-diff-released-holders-do-not-block.test.ts && echo 'AC-OWND-1 PASS: released branches never deadlock; directory anchors hold touched files only'
