---
id: PLAN-235
type: plan
role: plan
title: "Audit verify reads only the keys it joins, runs off the HTTP request loop, and checks the anchor on every surface"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-25
tags: []
parent: SPEC-079
phases:
  - {name: "P1"}
---
## Overview

`GET /api/audit/verify` (called by the dashboard home page's AuditVerifyChip, `packages/dashboard/src/components/LoopPanel.tsx:70-79`, on every load) takes 8-17 s on this repo's corpus and holds the whole HTTP server: a 4 ms `GET /api/auth/me` issued during it waited 7 s. Governing spec: spec-079-audit-hardening-link-provenance-actor-fidelity-tamper (the full-chain verdict it defines is unchanged).

Measured 2026-10-19 on `.lore/lore.db` (read-only connection): audit 58,843 rows, versions 48,512 rows whose content+extra total 886 MB.

| step (`AuditService.verify`, audit-service.ts:387-437) | time |
|---|---|
| `listAllVersions` `SELECT *` over versions | 3836 ms |
| `rowToVersionRecord` (JSON.parse of extra) | 1162 ms |
| the same rows, only doc_id, version, action, created_at | 674 ms |
| `queryAudit` | 170 ms |
| `listAuditChain` + sha256 walk | 273 ms |

Causes: (1) the completeness join reads every version's full content and extra although it uses four columns; (2) every step is synchronous bun:sqlite plus synchronous JS inside one request handler, so the event loop is held for the whole run; (3) separately, the HTTP route (routes.ts:609-614) and the MCP tool (tools.ts:2730) never pass the anchor, so the dashboard's "clean" never checks `.lore/audit-anchor.json` (the CLI does).

## Design

- D1 Narrow read. The completeness join gets a store method returning only (doc_id, version, action, created_at) for versions since the watermark, on all StoreInterface implementations, backed by a covering index `versions(created_at, doc_id, version, action)` (new migration). `listAllVersions` is no longer used by verify.
- D2 Off the serving loop. The full-chain verdict is O(rows) by design (SPEC-079: the chain over the whole trail), and besides the reads it is CPU work in JS (the completeness join and a sha256 per audit row: 273 ms today, growing with the trail), so running it on a long-lived server's loop stalls that server whatever the store's I/O model. Both long-lived servers — the HTTP server and the MCP server — therefore run `verify` in a Bun Worker for every persistent store: the worker opens its own store instance from the same project config (a local SQLite file read-only, or the Turso store with the same URL/replica settings), runs the unchanged `AuditService.verify`, and returns the report. The InMemory store exists only in tests and its data lives in one thread, so a server composed on it runs `verify` on the loop; this is decided by store kind at composition and named there, not a fallback taken on failure. A worker that fails to start or errors makes the verify request fail with that error. The one-shot CLI calls the service directly.
- D3 Anchor parity. The HTTP route and the MCP tool read `.lore/audit-anchor.json` the way the CLI does and pass it to `verify`, so every surface reports the same verdict for the same corpus.
- Not chosen: verifying from the last anchor (weakens the verdict: a pre-anchor row altered without touching its stored hash goes undetected; SPEC-079 requires the whole chain); a timeout or cached verdict (a stale result presented as current).

## Phases

- P1: one task (D1-D3 share the verify path and its tests).

## Acceptance (observable, red first)

- Non-blocking, HTTP: for each persistent store kind — a throwaway SQLite-file corpus and a Turso store in `file:` mode (as turso-store.bun.test.ts already runs it) — on a corpus seeded to this repo's shape (>= 58k audit rows, >= 48k versions, large content), while `GET /api/audit/verify` runs, concurrent `GET /api/auth/me` requests complete with p95 <= 50 ms.
- Non-blocking, MCP: in the same fixtures (both store kinds), while an MCP `lore_audit` verify call runs, a concurrent cheap MCP call (e.g. `lore_get` of one doc) completes within 50 ms p95.
- Cost independent of payload: verify's run time changes by no more than 20% when every version's content is made 10x larger in the same fixture.
- Verdict unchanged: the existing SPEC-079 tamper and anchor tests (audit-tamper, audit-anchor bun tests) pass; with an anchor file present the HTTP response's `anchor.status` is not "absent", and equals the CLI's for the same corpus; the MCP verify result's anchor status equals the CLI's too.
- Runner choice: a unit test of the composition shows SQLite file → worker, Turso → worker, InMemory → in-loop, and a worker error surfaces as the request's error.
