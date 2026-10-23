---
id: PLAN-223
type: plan
role: plan
title: "Main-ref guard owns checkout of main; integrate requires the guard"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [integrate, main-guard]
parent: SPEC-222
phases:
  - {name: "P1-code", description: "Hook refuses checkout of main; integrate requires the guard; setup detaches on install"}
  - {name: "P2-corpus", description: "Retire superseded integrate criteria, verify, apply rules, reinstall the hook here"}
---
# Main-ref guard owns checkout of main; integrate requires the guard

## Goal

Implement `spec-no-working-copy-can-check-out-main-the-main-ref-guard`: the shipped `reference-transaction` hook refuses any HEAD pointing at main (BR-1342); integrate requires the current hook and git >= 2.46 and drops its worktree scan and shared-checkout detach (BR-1273); setup refuses git < 2.46 and an unborn main, and detaches every working copy on main when installing (BR-1343).

## Phases

- **P1 code**: T1 hook + integrate precondition + setup detach (AC-MG-1..4), one task: the three surfaces form one acceptance unit (the hook is useless without integrate requiring it and setup installing it).
- **P2 corpus**: reword or retire AC-INT-2 part (4) of `spec-main-advances-only-through-lore-integrate-per-session` and any criterion pinning the removed integrate steps; `lore verify`; `lore rule apply`; re-run `lore setup --project` in this repository (the installed hook must match the shipped one); archive `task-checking-out-main-in-a-nested-worktree-blocks-every`.

## Risks

- Landing T1 makes every session's integrate require the new hook: this repository's `hooks/reference-transaction` is the installed copy (core.hooksPath = hooks), so it must change in the same commit as the asset (AC-MG-4), or the floor's own integrate refuses.
- Existing integration tests that check out main in throwaway repos break by design; they are rewritten in T1.
