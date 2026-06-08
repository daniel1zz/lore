---
id: PRD-001
type: prd
role: intent
title: "Lore — Internal-First AI Team Knowledge Platform"
status: approved
priority: critical
version: 0.4
created: 2026-06-07
updated: 2026-06-08
tags: [product-overview, L0, lore, mvp, internal-first, ai-native, protocol-aware]
audience: [founding-team, ai-agents]
children:
  - SPEC-001-service-layer
  - SPEC-002-corpus-schema
  - SPEC-003-cli-adapter
  - SPEC-004-prd-as-living-root
  - SPEC-005-review-workflow
  - SPEC-006-version-history
  - SPEC-007-migration-v1
related:
  - {id: IDEATION-001, type: informs}
derived_from:
  - DocMan v1 ARCH-01KPZ6GG4N4AXRHX9WKE6DVP6P
  - DocMan v1 PRD-01KJ2MTE53XHNSPJY1W43YMRZQ
  - IDEATION-001-v2-positioning-synthesis
changelog:
  - version: 0.4
    date: 2026-06-08
    summary: "Restructured to outline-level. Detail extracted into 7 child feature specs (SPEC-001 through SPEC-007). PRD is now the tree root; specs are leaves."
  - version: 0.3
    date: 2026-06-08
    summary: "Phase 1 is CLI-only. MCP/HTTP/TUI are later adapters on service layer."
  - version: 0.2
    date: 2026-06-07
    summary: "Phase 2 stakeholder review synthesis. 3-phase delivery, security architecture, protocol-aware constraints."
  - version: 0.1
    date: 2026-06-07
    summary: "Initial draft from Phase 1 ideation synthesis."
---

# Lore — Internal-First AI Team Knowledge Platform

## 1. Executive Summary

Lore is an AI-native shared knowledge / memory platform for AI-first founding teams (3-5 people + multiple AI agents). A single CLI binary backed by a service layer abstraction delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, and knowledge. **PRD-as-living-root**: every document is reachable through a tree rooted at the product PRD.

- **Positioning**: Internal-first for 9-12 months, OSS path later. No commercial monetization.
- **Architecture**: Service layer abstraction — CLI is the first adapter (P1), MCP/HTTP/TUI are mechanical additions (P2/P3).
- **Strategy**: Protocol-aware App — v1.0 architecture preserves protocol extraction for v2.1+.
- **Delivery**: 3 phases, each independently usable.

## 2. Problem & Users

**Core problem**: AI dev teams produce knowledge fragmented across per-agent memory, Notion, Linear, local markdown, Slack, and human heads. No shared, navigable, AI-consumable corpus exists.

**Primary users**: AI-first founding team (3-5 people) — PM writes PRDs, engineers write specs/ADRs, AI agents read/write under human review.

**Secondary users**: Long-running AI agents (Claude Code, Cursor, Codex, Aider) — first-class users, not tool consumers.

**Excluded (v1.0)**: Solo devs (DocMan v1 serves them), enterprises (v2.x), non-technical PMs.

## 3. Goals & Non-Goals

### Goals

| ID | Goal | Phase |
|---|---|---|
| G1 | CLI binary + service layer delivers core surface | P1 |
| G2 | PRD-as-living-root tree navigable from CLI | P1 |
| G3 | DocMan v1 import (zero data loss) | P1 |
| G4 | MCP adapter on same service layer | P2 |
| G5 | Cloud sync — multi-user multi-device shared corpus | P2 |
| G6 | HTTP API adapter | P2 |
| G7 | Internal adoption: 3+ projects, 90%+ new docs in Lore | P2 |

### Non-Goals (v1.0)

| ID | What | Why |
|---|---|---|
| NG1 | SaaS / billing | Internal-first |
| NG2 | Enterprise SSO / RBAC | 3-5 people, flat trust + minimal access controls |
| NG3 | Mobile apps | CLI + web sufficient |
| NG4 | Public plugin API | OSS phase |
| NG5 | Protocol RFC | v2.1+ — v1.0 builds reference implementation |
| NG6 | v1 backward compat | One-shot migrate only |
| NG7 | Real-time CRDT collab | Pull-sync sufficient |
| NG8 | Vector/semantic search | FTS5 first |

## 4. Solution Architecture

```
┌─────────┐  ┌─────────┐  ┌──────────┐  ┌─────────┐
│   CLI   │  │   MCP   │  │   HTTP   │  │   TUI   │
│  (P1)   │  │  (P2)   │  │  (P2)    │  │  (P3)   │
└────┬────┘  └────┬────┘  └────┬─────┘  └────┬────┘
     └────────────┴─────┬──────┴──────────────┘
                        │
              ┌─────────▼──────────┐
              │    Service Layer   │  ← all business logic here
              │  → SPEC-001        │
              └─────────┬──────────┘
                        │
              ┌─────────▼──────────┐
              │    Storage Layer   │
              │  (libSQL / Turso)  │
              └────────────────────┘
```

Adapters are thin I/O mappers — zero business logic duplication.

## 5. Module Map

This PRD is the tree root. Each module is a child feature spec with full detail (interfaces, data models, behavior contracts). Cross-links between specs are typed relationships.

```
PRD-001 (this document)
├── SPEC-001 Service Layer Architecture
│     Core interfaces, DI pattern, storage abstraction, error model
│
├── SPEC-002 Corpus Schema
│     Document types, link types, lifecycle states, version model, FTS5
│
├── SPEC-003 CLI Adapter
│     Command taxonomy (22 commands), arg parsing, output format, errors
│
├── SPEC-004 PRD-as-Living-Root
│     MDX components, resolution pipeline, rendering contract (CLI/Web/MCP)
│
├── SPEC-005 Review Workflow
│     pending/approve/reject flow, agent-default-draft, status transitions
│
├── SPEC-006 Version History
│     Snapshot model, diff semantics, restore, audit log
│
├── SPEC-007 Migration v1
│     v1→v2 schema mapping, ID conversion, secret scan, dry-run
│
├── SPEC-008 MCP Server Adapter (@modelcontextprotocol/sdk v1, stdio + HTTP)
├── SPEC-009 Sync Engine (Turso @libsql/client v0.17, embedded replicas)
├── SPEC-010 Auth & Agent Credentials (Better-Auth, device flow + API keys)
├── SPEC-011 HTTP API Adapter (Bun.serve, hosts auth + MCP + REST)
└── (P3) SPEC-TBD Web UI
```

## 6. Phased Delivery

### Phase 1: CLI + Local Store (M1-3)

Replaces DocMan v1. Service layer + CLI adapter + local SQLite.

| Month | Milestone |
|---|---|
| M1 | Tech spike (Bun+SQLite+MDX). Service layer + store. `init`, `create`, `get` |
| M2 | Full CLI taxonomy. PRD-as-living-root rendering. `list`, `search`, `tree`, `link` |
| M3 | Review workflow. Version history. Migration v1. **Gate: Lore manages its own corpus** |

**Kill**: P1 not transformative vs DocMan v1 → pause before P2.

### Phase 2: MCP + Sync + Auth + HTTP (M4-6)

Multi-user multi-agent shared corpus.

| Month | Milestone |
|---|---|
| M4 | MCP adapter on service layer. Agent credentials. Cloud sync via Turso |
| M5 | Conflict resolution. Multi-user auth. HTTP API. `lore watch` |
| M6 | Team adoption: 3+ projects. **Gate: success metrics check** |

**Kill**: <50% adoption, sync conflicts >1/week, teammate reverts to old tools >1 week.

### Phase 3: Web UI + Polish (M7-9)

Gated on Phase 2 metrics.

| Month | Milestone |
|---|---|
| M7 | Read-only web UI: PRD tree, doc detail, search |
| M8 | Review queue in web. TUI evaluation |
| M9 | Polish. Internal GA |

## 7. Cross-Cutting Constraints

### NFRs

| ID | Category | Target |
|---|---|---|
| NFR-1 | CLI cold-start | < 200ms p95 (lazy init) |
| NFR-2 | Local query (FTS5) | < 50ms p95 / 1k docs |
| NFR-3 | Sync cycle (P2) | < 2s p95 incremental |
| NFR-4 | Concurrency (P2) | Optimistic locking, doc-level version vectors. Never silently resolve conflicts |
| NFR-5 | Secrets | CLI never logs API keys; corpus excludes .env |
| NFR-6 | Encryption (P2) | TLS + at-rest mandatory. Client-side E2EE opt-in. Local SQLite encrypted |
| NFR-7 | Audit | Append-only, tamper-evident. Writes + auth + sync events. Separate from corpus storage |
| NFR-8 | A11y (P3) | WCAG 2.1 AA, ARIA tree pattern |
| NFR-9 | i18n | English first, i18n-ready |
| NFR-10 | Offline (P2) | Full offline against local SQLite. Token TTL 7 days. Revocation check on reconnect |
| NFR-11 | Distribution | Homebrew + npm |
| NFR-12 | Architecture | Service layer = single source of business logic. Adapters are thin. Protocol-ready interchange format. `src/service/`, `src/store/`, `src/adapters/{cli,mcp,http}/` |
| NFR-13 | Backup (P2) | Turso managed backups. Soft-delete 30-day window. No permanent delete without human confirm |
| NFR-14 | Rate limit (P2) | 60 writes/min per agent. Alert at 100/5min |

### Security (cross-cutting)

- **Threat model**: STRIDE across 4 surfaces (CLI local, MCP, sync, web)
- **Agent containment (P2)**: Rate limit + human confirm for destructive ops + instant revocation + version rollback
- **MDX injection**: Whitelist 7 named components only. Props sanitized. `<Embed>` internal-only. CSP headers on web
- **Identity**: P1 = local user via config. P2 = API key per agent, server-verified, rotatable/revocable

## 8. Success Metrics & Kill Criteria

| Metric | Target (month 6) | Measurement |
|---|---|---|
| New docs in Lore | ≥ 90% | Weekly count |
| Active projects | ≥ 3 | `lore status` |
| Human users | ≥ 3 | Auth records |
| AI agents writing | ≥ 3 | Agent registry |
| Lore calls per agent session | ≥ 5 | Telemetry |
| Context from Lore vs pasted | ≥ 60% | Session logs |
| Duplicate-decision docs | 0/month | Audit log |
| Voluntary side-project use | ≥ 1 teammate | Self-report |

**Kill criteria**: See §6 per-phase gates. Global: if Anthropic/Cursor ships multi-vendor shared memory → decision gate ADR.

## 9. Risks

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | Second-system syndrome | H | 3-phase delivery; P1 must be useful standalone |
| R2 | Multi-agent merge unsolved | H | v1.0 optimistic locking; CRDT only for outline ordering; defer field-level merge |
| R3 | Turso ops burden | M | Managed tier; StoreInterface abstraction |
| R4 | Web UI scope creep | LOW | Deferred to P3 SHOULD; HTTP API is the MUST |
| R5 | v1 migration incomplete | H | FR-10 MUST P1; dry-run + validation before cutover |
| R6 | Anthropic ships native memory | **H** | Decision gate in kill criteria. Protocol-aware arch ensures corpus model survives as standard |
| R7 | Bun compile issues | M | M1 tech spike validates; fallback: Deno compile / Node SEA |
| R8 | Agent write storms | M | Rate limit + review gate + version rollback |

## 10. Assumptions

| ID | Assumption | Confidence | Validation |
|---|---|---|---|
| A1 | Multi-agent shared memory is real pain | M | Consciously unvalidated externally. P1 kill criteria provide early signal |
| A2 | Web UI adds value vs CLI-only | M | P3 is SHOULD; only built if P2 metrics pass |
| A3 | PRD-as-living-root scales to 500 docs | M | P1 mockup with real v1 data |
| A4 | Bun + libSQL/Turso stack works | H | M1 tech spike |
| A5 | 3-phase delivery achievable solo + AI | M | Phase gates at M3 and M6 |

## 11. Competitive Landscape (stub)

| Category | Known Players | Lore Differentiation |
|---|---|---|
| Agent memory | Letta, Mem0, Devin Memory | PRD-as-living-root + typed graph vs flat K/V |
| IDE memory | Cursor Rules, Claude Projects, Kiro | Vendor-neutral CLI vs platform-locked |
| Standards | `.context`, `llms.txt`, MCP | Structured navigable corpus vs static files |
| Dead predecessors | Mem.ai, Almanac, Dust.tt, Slab | Internal-first avoids GTM failure; must avoid complexity traps |

**Action**: Complete competitive analysis before design phase.

## 12. Out of Scope

- v2.1+: Agent-memory protocol RFC (extracted from v1.0 architecture)
- v2.2+: Enterprise features (SSO, RBAC, audit retention)
- v2.x: Field-level conflict resolution
- v3.0: Real-time CRDT collab, mobile, vector search

---

## Provenance

- **Ideation**: 6-role parallel brainstorm → `IDEATION-001-v2-positioning-synthesis`
- **Phase 2 review**: 6-role stakeholder review (2 APPROVE_WITH_CONDITIONS / 4 REQUEST_CHANGES). All conditions addressed in v0.2-0.3.
- **Owner decisions**: A1 skip external validation; protocol-aware app; 3-phase delivery; Web UI → SHOULD; P1 CLI-only; service layer abstraction.
- **v0.4**: PRD restructured to outline-level. Detail lives in 7 child feature specs.
