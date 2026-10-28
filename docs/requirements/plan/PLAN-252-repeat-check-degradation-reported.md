---
id: PLAN-252
type: plan
role: plan
title: "Repeat-check degradation reported"
status: archived
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: SPEC-259
phases:
  - {name: "T", description: "Degradation reported"}
---
# Repeat-check degradation reported

## Goal

Land spec-a-filing-whose-repeat-check-could-not-read-the-filing-log (BR-500 modify).

## Tasks

- T1: everything in the spec's Scope, as one task (four source and test files):
  - an injected receipt-log reader for `fileGithubIssue` (default `ReceiptLogV2`);
  - `repeat_check_degraded: { reason: "unreadable" | "corrupt_lines", detail, skipped_lines }` on both the filed and the early "already filed" results; the repeat check runs over the readable entries when lines are corrupt;
  - the CLI prints one stdout line in the duplicate-check style: `Warning: repeat check degraded (<detail>) — filed anyway.` or `... — recognised from the readable entries.`;
  - MCP `lore_report_issue` returns the field;
  - tests in `github-filing-split-write.test.ts` (AC-RL-1) and `mcp-github-filing.test.ts` (AC-RL-2).

## After landing (main agent)

lore verify; lore done; lore rule apply (lands the BR-500 rewrite); lore assess.
