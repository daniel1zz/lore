---
id: TASK-2047
type: task
role: plan
title: "lore rule propose amend refuses flags its op does not take instead of ignoring them"
status: archived
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PRD-001
---
## Objective

`lore rule propose <spec> amend <BR-n> --leaf <leaf>` exits 0 and prints the unchanged leaf: `--leaf` is silently dropped (packages/lore/src/adapters/cli/commands/rule.ts:257-265 builds the amend/modify input from statement, examples and enforced-by only). Observed 2026-10-26 on spec-write-provenance-every-record-names-the-build-that-wrote BR-1434: output 'Reserved BR-1434 ... for baseline-query-the-audit-trail' after --leaf baseline-verify-the-audit-trail.

## Fix

Per op, a flag the op does not take is a usage error (exit 2) naming the flag and the op: --leaf only with add; --note only with retire; --statement/--example/--enforced-by not with retire or withdraw. If moving a proposed add to another leaf is wanted, amend takes --leaf and the service rewrites the entry's leaf (choose by reading rule-change-service.ts::proposeAmendOfProposal; record the choice in the task evidence).

## Oracle

Unit test: amend with --leaf either moves the leaf (and `lore rule changes` shows it) or exits 2 naming --leaf; retire with --statement exits 2; withdraw with --example exits 2. Each red before the fix.
