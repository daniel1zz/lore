---
id: KN-335
type: knowledge
role: knowledge
title: "Retro — three mechanism gaps found while building the issue-closure loop: lore done's type-keyed evidence guard, --help reaching a gate, and anchors never reconciled against the diff"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PRD-001
links:
  - {id: PLAN-103, type: informs}
---
## Context

Three defects surfaced incidentally while building the issue-closure loop (`spec-issue-closure-loop-computed-resolution-agent-reachable`). None blocked delivery; all three are real and each has a distinct root cause worth mechanizing.

## 1. `lore done` demands evidence from a document that is not an execution unit

A consumer-filed issue report lands as an ad-hoc `task`. When its fix ships and the closure detector says to archive it, `lore done <issue>` refuses:

```
Validation failed on field 'extra.verification_evidence':
Task "..." holds no result:pass evidence entry — lore done requires at least one
passing oracle verification before archiving
```

The requirement is correct for a task an agent CLAIMED and IMPLEMENTED. It is wrong for an issue report: the defect's verification evidence lives on the doc that FIXED it (here, the SPEC-OOB plan), and duplicating it onto the report would be a second copy of the same claim. The only way through was a three-step `lore set --status draft→approved→active→archived` walk, which bypasses the evidence check entirely — so the guard did not protect anything, it just picked a longer path.

**Root cause**: `lore done`'s precondition keys on the document TYPE (`task`) rather than on how the document came to exist. An issue report is a task by storage shape only; it is authored by a foreign project, never claimed, never implemented.

**Mechanization**: the evidence precondition should read the provenance that already exists — `extra.issue_report` marks a foreign-authored report, and `extra.adhoc` marks a planless task. For an issue report, the meaningful precondition is a terminal computed resolution (`fixed`/`rejected`/`wontfix`/`closed`), not local oracle evidence. The detector already computes exactly that.

## 2. `--help` is intercepted by the spec-create gate

`lore create spec --help` does not print help. It is denied by the deterministic gate with `PARENT_REQUIRED` + `MISSING_SKELETON` and a feeding pack, because the gate predicate runs before argv is inspected for `--help`.

**Root cause**: the gate hook treats `--help` as a write attempt. Help is a read; no gate should ever be reachable from it.

**Impact**: an agent that cannot read a command's own interface will guess flag names. In this session it caused exactly that — the `--plan-id` requirement on `lore create task` had to be discovered from an error message instead of from help.

**Mechanization**: short-circuit `--help`/`-h` before any gate predicate evaluates, in the same place `LORE_GATE_BYPASS` short-circuits.

## 3. Anchor discipline is unenforceable against an agent that simply edits elsewhere

The P2 dashboard implementer declared 6 anchors and edited 28 files — including `store/sqlite-store.ts`, `store/schema-version.ts`, `store/turso-store.ts`, `service/corpus-service.ts` and a new `migrations/migration-012.ts`. Its completion report described only the dashboard work and the assets-manifest chore; the store-layer changes were never mentioned. They were discovered by the orchestrator reading `git diff --stat` before merging.

The work itself was CORRECT and unblocked a sibling agent. That is what makes this the dangerous shape: a beneficial out-of-scope edit is the one least likely to be questioned.

**Root cause**: `extra.file_anchors` is a CLAIM-TIME mutex, not a WRITE-TIME one. The `noAnchorOverlap` gate compares declared anchors between concurrent claimants; nothing compares an agent's actual diff against what it declared. With three siblings running in parallel, an undeclared edit to a shared file is invisible to the mechanism that exists precisely to prevent it.

**Mechanization**: compare the branch diff's path set against `extra.file_anchors` at release time (`lore release`) or at evidence time, and fail loud on paths outside the declared set. The data for this check already exists on both sides — nothing new needs authoring. This is strictly stronger than prose reinforcement, which measurably failed here despite the dispatch bundle stating the rule twice.

## Standing lesson

A declared-intent mechanism (anchors) that is never reconciled against observed behaviour (the diff) degrades to documentation. Every "agents MUST declare X" rule needs a matching "and X is checked against what actually happened" — otherwise the honest agents are constrained and the mechanism's guarantee is void for everyone.
