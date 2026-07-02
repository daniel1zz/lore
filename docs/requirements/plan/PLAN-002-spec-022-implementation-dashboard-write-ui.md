---
id: PLAN-002
type: plan
role: plan
title: "SPEC-022 Implementation — Dashboard Write UI"
status: archived
priority: medium
created: 2026-07-02
updated: 2026-07-02
tags: [spec-022, dashboard, write-ui, bootstrap-dogfood]
parent: SPEC-022
phases:
  - {name: "server-api", description: "HTTP write routes + cookie gate + optimistic concurrency + telemetry discriminator"}
  - {name: "dashboard-ui", description: "Editor, mutations, StatusPill, LinksPanel, HistoryTab, ConflictModal, draft cache, new-doc modal"}
  - {name: "tests", description: "Six-dimension unit + integration + Playwright e2e per spec 9.7"}
  - {name: "closeout", description: "export-docs reverse sync, full-suite verification, merge and commit"}
---
# Plan: SPEC-022 Dashboard Write UI Implementation

Executes SPEC-022 (all design questions ratified 2026-07-02, see spec §8/§9). First iteration tracked on Lore itself (workflow bootstrap dogfooding).

## Phases

1. **server-api** — six dashboard write routes, cookie-session gate, optimistic concurrency (If-Match/409), telemetry source discriminator. Files: packages/lore/src/adapters/http/{routes,dashboard-routes,auth,concurrency}.ts, packages/core telemetry schema.
2. **dashboard-ui** — CodeMirror 6 editor + split preview, typed mutation wrappers, interactive StatusPill, LinksPanel autocomplete, HistoryTab, ConflictModal, localStorage draft cache, new-doc modal. Files: packages/dashboard/src/**.
3. **tests** — six-dimension unit + integration coverage (vitest/bun) + Playwright e2e per spec §9.7.
4. **closeout** — export-docs reverse sync, full-suite verification, merge & commit.

## Acceptance

AC-DASH-WRITE-1..10 + AC-DASH-WRITE-TEL-1 from SPEC-022 §4. Both test runners green; typecheck clean.
