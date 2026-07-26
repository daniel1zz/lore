---
id: KN-080
type: knowledge
role: knowledge
title: "Pre-existing e2e seed/gate debt: dashboard spec-create seeds are gate-rejected"
status: draft
priority: medium
created: 2026-07-22
updated: 2026-07-24
tags: []
parent: PLAN-059
links:
  - {id: SPEC-064, type: relates-to}
  - {id: PLAN-059, type: informs}
---
# Pre-existing e2e seed/gate debt: dashboard spec-create seeds are gate-rejected

## Finding

Two dashboard e2e suites — `browse-ux.pw.ts` (SPEC-036) and `review-loop.pw.ts` (SPEC-033) — have a DETERMINISTIC pre-existing failure, proven identical at the pre-session baseline commit `1e5ac3c` (same 2 test ids, `2 failed`, exit 1, before ANY SPEC-064 code existed). They are NOT a SPEC-064 regression.

## Root cause

Both seeds create a `spec` document with NO content:
- `browse-ux.pw.ts:80` — `POST /api/dashboard/docs {type:"spec", parent_id, title}` (no content) → `response.ok()` is false.
- `review-loop.pw.ts:150` — the NewDocModal fills only `#doc-type=spec`, `#doc-title`, `#parent-id` (the modal collects no content) → Create fails → the `Created spec-` toast never renders.

The service-layer `GateEnforcer` runs the `spec-create` gate on every `CorpusService.create`, including the dashboard `POST /api/dashboard/docs` path. Its `hasSkeleton` predicate requires the spec content to contain `## ` headings (`## Overview/Goal`, `## Scope`, `## Acceptance Criteria`). A bare spec has none → the gate denies the create → the seeds fail. This has been true since gate enforcement was wired into the service layer; the e2e seeds were never updated to send gate-valid spec content.

## The larger product question (flagged, not resolved here)

The `review-loop` failure exposes a real question beyond test debt: **can a user create a spec through the dashboard NewDocModal at all?** The modal collects type/title/parent but no content, so every spec created through it is rejected by the spec-create gate's skeleton requirement. Either (a) the modal must seed a template skeleton for gated types, (b) spec-create is not meant to happen via the modal (only via `lore create spec` / a skill), or (c) this is a real dashboard usability bug. This deserves its own decision under a SPEC-022/SPEC-052 lens — it is NOT SPEC-064's concern (SPEC-064 adds the Settings route, which is orthogonal).

## Impact on SPEC-064

AC-064-7 ("the 4 existing e2e suites run and exit 0") is UNSATISFIABLE as literally worded, for reasons entirely predating and unrelated to the Settings route. Its real INTENT — "the new Settings route caused no regression" — is proven two ways:
1. `read-flow.pw.ts` + `write-flow.pw.ts` (the routing/auth/write-regression-sensitive suites) pass 12/12 exit 0 on merged main.
2. The `browse-ux`/`review-loop` failure set is byte-identical to the pre-Settings-route baseline (same 2 test ids) — the route added ZERO e2e failures.

Corrected AC-064-8 attests intent (1); the delta-identity (2) is recorded here as evidence.

## Recommendation (separate task, not SPEC-064)

Fix the two seeds to send a minimal gate-valid spec skeleton (`## Overview\n## Scope\n## Acceptance Criteria`), OR decide the modal's spec-create policy. Until then, these 2 suites stay deterministically red — a known, documented baseline, not a live regression.


## Resolution (2026-07-24, SPEC-075 closure session)

The TEST-DEBT half is RESOLVED: both seeds now send gate-conformant spec content (commit e3cd126 — browse-ux API seed gained skeleton headings; review-loop switched from the content-less NewDocModal drive to an out-of-band page.request.post with skeleton content). Full dashboard e2e suite 38/38 exit 0, determinism confirmed by two consecutive runs. Standing discipline recorded in packages/dashboard/CLAUDE.md (e2e seeds MUST be gate-conformant; UI-modal spec seeding is structurally impossible).

The PRODUCT question (can a user create a spec via NewDocModal at all?) remains OPEN — now tracked as an actionable adhoc task (see task: NewDocModal gated-type authoring decision).
