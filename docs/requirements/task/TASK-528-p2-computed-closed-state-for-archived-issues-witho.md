---
id: TASK-528
type: task
role: plan
title: "P2 — computed 'closed' state for archived issues without a resolves edge"
status: archived
priority: medium
phase: "P2 surfaces"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
links:
  - {id: TASK-532, type: blocks}
---
## Objective

Close the reverse proxy-failure the live corpus exposed: an issue task that an upstream maintainer already `archived` still computes `open`.

## Evidence (measured 2026-07-29 on the real corpus, after `lore issues` shipped)

`task-spec-069-adhoc-tasks-are-unclaimable-task-claim-gate` — fixed and `archived` four days ago, `extra.issue_report.resolution` absent, no `resolves` in-edge:
- `lore issues --open` → LISTED it (wrong)
- `lore issues --resolved` → `(no resolved issue reports)` (wrong)

A resolution model that reads only edges is incomplete against its own back-catalogue: every report closed before this mechanism existed has exactly this shape, and each one is currently reported to its consumer as still outstanding.

## Deliverables

- **D2 extension** — `computeIssueResolution` gains `"closed"`: the issue task's own status is `archived`, with no `resolves` in-edge and no explicit terminal state.
- **Precedence, highest first** — explicit terminal state (`rejected`/`wontfix`) → `resolves`-edge computation (`fixed`/`resolving`) → `archived` doc status (`closed`) → `open`. Assert each precedence step directly; do not infer it from one combined case.
- **Surface consistency** — `lore issues --open` must omit `closed`, `--resolved` must include it. Check whether the CLI filter hardcodes a terminal-state set and update it at the single source rather than in each call site.

## Acceptance Criteria

AC-ICL-10. Oracle: `cd packages/lore && bun test tests/e2e/issue-closed-state.bun.test.ts -t AC-ICL-10`.

Also re-run `bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts` — the existing AC-ICL-1/2 cases must stay green; extend that file with the new precedence cases rather than rewriting it.

## Constraints

- `computeIssueResolution` stays PURE and store-free — the caller supplies the docs.
- Do not touch the consumer-list path (`issue-report-service.ts`, `report-issue.ts`, `upstream-context-flow.ts`); a sibling agent holds those anchors.
- Six-dimension coverage. Red before green. `bun run build` before any oracle that spawns `dist/lore`.
- Throwaway corpora only. NEVER write to this repo's own `.lore/`.

## Extended 2026-07-29 after D6 landed — a THIRD terminal state the edge-only model misses

Merging D6 (consumer `--list` reads the computed resolution) turned `packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts:687` RED. Measured on the merged mainline: `10 pass / 1 fail`.

That failure is a real semantic gap, not a stale expectation to overwrite. Its own comment states the governing fact:

```
// reason: ReviewService.reject never transitions a doc OFF draft (SPEC-005) —
// the audit trail, not doc.status, is the sole record of "rejected".
```

So a report rejected via the review workflow is, by status alone, indistinguishable from an untouched one — and the computation currently calls it `open` WHILE the row carries a rejection reason. That self-contradicting row is exactly what §20 F3 ("Reject → rejection reason recorded") and F4 ("for rejections, the recorded reason") promise not to produce.

**Additional deliverable**

- Computed resolution reads the recorded review rejection and returns `rejected`. The upstream port already surfaces the rejection reason — use it; do not add a second read path.
- **Full precedence, highest first**: explicit terminal state (`lore issue resolve`) → `resolves`-edge computation (`fixed`/`resolving`) → recorded review rejection (`rejected`) → `archived` doc status (`closed`) → `open`. Assert EACH step directly with its own case; do not infer the ordering from one combined fixture.
- Reconcile `issue-report-cross-corpus.bun.test.ts:687` to the corrected semantics (`rejected`, not `draft` and not `open`). Fix the expectation because the SEMANTICS changed and are now right — never merely to make a red test green.

**Additional AC**: AC-ICL-11 — `cd packages/lore && bun test tests/unit/service/issue-report-cross-corpus.bun.test.ts -t AC-072-10`

Anchors added for this: `packages/lore/src/flows/upstream-context-flow.ts`, `packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts`.
