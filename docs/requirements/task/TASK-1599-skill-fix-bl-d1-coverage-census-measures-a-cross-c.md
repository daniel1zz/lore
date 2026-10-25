---
id: TASK-1599
type: task
role: plan
title: "[Skill:fix] BL-D1 coverage census measures a cross-cutting baseline leaf by its guarded sites, so keep-writes-in-this-checkout drops its proxy unlink command and re-approves"
status: archived
priority: medium
phase: "P3-stale-and-draft"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Estimate: M
Approach: baseline-keep-writes-in-this-checkout-s-corpus is a cross-cutting leaf (its rule guards eight write commands). The coverage census accepts a leaf only with at least one declared command (baseline.ts:259 `ok: commands.length > 0`), so the leaf declares `unlink` alone to be measured; the review (2026-10-18, reject 0.62) rejects that as a workaround. End state: the census measures a cross-cutting leaf by the guarded sites it owns, so the leaf declares no proxy command. Then re-review and approve the leaf.
Source: leaf re-approval 2026-10-18 (scratchpad leaves/rv3-*); review finding quoted: "Either the census change lands first, or the leaf declares all eight guarded commands consistently."
AC: the leaf drops the proxy command, the census still measures it (count unchanged or explained), the leaf is approved.
