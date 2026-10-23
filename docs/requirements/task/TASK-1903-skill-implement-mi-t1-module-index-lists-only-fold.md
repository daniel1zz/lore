---
id: TASK-1903
type: task
role: plan
title: "[Skill:implement] MI-T1 module index lists only folders with a memory file; template headings; legacy auto blocks migrate once; refresh --check"
status: archived
priority: medium
phase: "Phase 1: module index"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-239
plan: PLAN-239
links:
  - {id: TASK-1908, type: blocks}
---
Estimate: M
Approach: per plan row MI-T1 and the spec. Code: packages/lore/src/service/context-facts.ts (discovery, entry limit at :123), packages/lore/src/flows/context-flow.ts:322-330 (rendering), packages/lore/src/service/context-projection.ts (managed-zone parse, legacy at :352), the refresh CLI (--check). Red-first per AC.
Source: spec-module-index-lists-only-folders-with-a-memory-file-managed; CL-7 reader report 2026-10-18
AC: AC-MI-1, AC-MI-2, AC-MI-3 throwaway half.
