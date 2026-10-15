---
id: SPEC-033
type: spec
role: spec
title: "Dashboard as living-PRD projection + human adjudication surface"
status: deprecated
priority: high
created: 2026-07-06
updated: 2026-10-10
tags: [spec-033, dashboard, feedback-loop, d6]
links:
  - {id: SPEC-034, type: relates-to}
---
# SPEC-033 — Dashboard as living-PRD projection + human adjudication surface

> Kind: feature (+design constraints). Parent: PRD-001 §13.5 + §14 D6. Owner directive 2026-07-06: the product must be human-friendly AND AI-friendly — adjudication on ANY surface feeds the same calibration loop; no surface is second-class.
> Consumer: plan → implement → e2e verify. Design-system note: the dashboard has a LIVE visual language (shadcn + SPEC-031 typography); per mode-ui Token Crystallization rules, subsequent UI conforms to the existing system — multi-variant benchmark exploration applies to new visual directions, not extensions of a shipped product. All new pages reuse existing components/tokens.

## 1. Problem

Owner acceptance happens on the dashboard, but: (a) home is a hardcoded doc list, not the resolved living PRD (§13.5: "a page rewrite, not a tweak"); (b) R1 feedback-loop data (judgments, blocking questions, audit trail, calibration stats) has zero dashboard surface; (c) **calibration bypass**: dashboard approve/reject (SPEC-022 routes) skips the implicit calibration capture that CLI has — human-friendly adjudication silently starves the data loop. (c) is a §14 I-class violation, not a feature gap.

## 2. Scope (four blocks)

### 2.1 Surface-neutral calibration (fixes the bypass — highest priority)
- Hoist `packages/lore/src/adapters/cli/calibration-hook.ts` → `packages/lore/src/flows/calibration-hook.ts` (surface-neutral; "composition in the calling layer" invariant intact — the flow module IS the shared calling-layer helper, taking `{judgmentService, telemetry}`).
- Consumers: CLI approve/reject (import path update only), HTTP dashboard approve route (`/api/dashboard/*` write routes — wire after ReviewService succeeds), MCP adjudication tools IF any exist (verify; wire the same).
- Same contract everywhere: version-pinned pairing, silent skip on version mismatch, warning-not-failure on write error (HTTP: `warnings[]` field in the response envelope instead of stderr).
- Optional calibration note: dashboard adjudication UI offers a note field → `delta_reasons`.

### 2.2 Home = resolved living PRD (§13.5)
- `GET /api/docs/:id?resolve=1` (or existing resolve-mdx route — reuse) returns `{doc, resolved_components}`; home renders the PRD with placeholder spans replaced by REACT components (ChildrenOf → linked doc list w/ status chips; RecentDecisions/ActivePlans/HealthStats → typed renderings) off `resolved_components` positions — structured data, never spliced-markdown-as-HTML.
- Side panels: pending-review panel (judgment badges, see 2.3) + ready-task panel (`ready` data over active plans).

### 2.3 Triage queue surface (§14 D6-dashboard)
- Pending list gains: AI judgment badge (`approve 0.93` / `escalate +2Q` / `unreviewed`, stale marker), `escalated-only` filter, expandable blocking_questions.
- Adjudicate inline: approve/reject buttons (existing SPEC-022 routes + 2.1 hook) + optional note. If-Match concurrency preserved.
- HTTP read routes (bearer+cookie, read-only): `GET /api/judgments/:docId` (latest+list), `GET /api/audit/:docId`, `GET /api/audit/verify`, `GET /api/calibration/stats`.

### 2.4 Doc detail + observability
- Doc detail gains an **Audit tab**: who/what/when trail with `ai:`-actor decoding (badge for judge identity + judgment link) — the "traceable" owner requirement made visual.
- A **Loop panel** (home or /loop route): calibration stats table (doc_type × prompt_version, n / agreement / Wilson LB), audit-verify status chip.

## 3. Contracts

- Dashboard imports `@lore/core` ONLY (browser-safety invariant); all data via HTTP routes; new routes registered in `routes.ts` following SPEC-022 auth patterns (cookie for dashboard paths, bearer parity where applicable).
- API client fetchers + TS types land in the dashboard's existing api layer in the SAME task as the routes (single writer; UI tasks only consume).
- Playwright e2e is the acceptance oracle: extend the existing suite with (1) home renders resolved PRD (ChildrenOf list visible, no raw `<ChildrenOf />` text), (2) pending shows a seeded escalate badge + blocking questions, (3) dashboard approve on a judged doc creates a calibration record (assert via API), (4) audit tab shows create→judge→adjudicate chain.

## 4. ACs

- AC-33-1: home = resolved PRD; zero raw placeholder tags rendered as text; panels present.
- AC-33-2: dashboard approve/reject on a judged doc writes the SAME calibration record a CLI adjudication would (pairing table + version pin + note); bypass eliminated — proven by e2e + a shared-hook unit test importing from the hoisted path.
- AC-33-3: escalated-only filter shows blocking questions; badges match CLI `lore pending` semantics.
- AC-33-4: audit tab decodes ai: actors; verify chip reflects `--verify` status.
- AC-33-5: tsc + vitest + bun + dashboard vitest + playwright e2e all green.

## 5. Test dimensions
HAPPY (resolved home, badge render, adjudicate+calibrate) / NEGATIVE (unauthenticated route 401, stale If-Match 412 unchanged) / BOUNDARY (empty pending, doc with zero placeholders, n=0 stats) / ERROR (calibration write failure → warnings[] not 5xx) / STATE (badge goes stale after edit) / REGRESSION (existing 12 playwright scenarios untouched-green; CLI hook behavior unchanged after hoist).
