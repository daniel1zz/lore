---
id: KN-898
type: knowledge
role: knowledge
title: "Evicted from the service module doc: AuditService verify worker"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
---
Evicted verbatim from the module CLAUDE.md on 2026-10-23 (task G3: bring the file under its eviction floor). These are the pre-eviction lines; the module file keeps the rule and points here.

- **`AuditService.verify` is TWO independent oracles, not one** — a `(doc_id, version)` join PLUS an action-family check (never a bare action-string match, see `VERSION_ACTION_AUDIT_FAMILY`), and separately a FULL-table tamper-evident hash-chain walk (`walkAuditChain`, optional `.lore/audit-anchor.json` cross-check). The completeness join reads only `listVersionKeys` (four columns, covering index `idx_versions_keys`). ⛔ The HTTP route and MCP tool never call `verify` on their own loop: they go through `audit-verify-runner.ts` (`App.auditVerifyRunner`), which runs the unchanged `verify` in a Bun Worker (`audit-verify-worker.ts`) for every persistent store — SQLite file read-only, Turso by local replica path with no sync — and in-loop only for an InMemory composition, chosen by store kind. A worker error fails the request; there is no in-loop fallback, timeout or cached verdict. The runner also reads `.lore/audit-anchor.json`, so every surface reports the CLI's anchor status.
