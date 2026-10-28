---
id: PLAN-266
type: plan
role: plan
title: "Known defects on the plan"
status: archived
priority: high
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: SPEC-243
phases:
  - {name: "K", description: "Known defects record on land-gs"}
---
# Known defects on the plan

## Goal

Land spec-a-plan-s-known-defects-are-its-own-record-of-github-issues together with GS: replace land-gs's interim carrier port of known defects with the plan's own `extra.known_defects` record, convert the 46 live known-defect links in a schema migration, retire the link type.

## Preconditions

- Spec approved.
- Built on branch land-gs (task-land-gs-integration-plan-github-owns-issue-report-state), not on main: main still has mirror tasks; GS and this spec land together in one `lore integrate land-gs`.

## Tasks

- K1: schema, filing, coverage, display, schema migration, link type removal; revert land-gs's interim ad-hoc draft carrier in assess-file-issues.ts and carrier-ref coverage. AC-KD-1..5.

## Before landing (main agent)

1. Run K1's migration check against a COPY of the live corpus (`cp .lore/lore.db <scratch>`; never the live file): it must report 46 convertible, 0 unconvertible.
2. Supersede AC-PCR-4's "linked to both" wording by AC-KD-2 if its test changed.
3. `lore integrate land-gs`; then `lore rule apply` for this spec and GS; then NS4 (`lore issues migrate` dry run shown to the owner; --apply only with approval).

## Decisions Log

- 2026-10-25 owner: known defects are the plan's own record (not carrier tasks).
- 2026-10-25 AI: conversion is a corpus schema migration (no window between models); dimension source = findings, else the filer's own body lines held in the mirror content; all-or-nothing.
