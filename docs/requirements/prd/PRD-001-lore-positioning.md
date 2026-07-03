---
id: PRD-001
type: prd
role: intent
title: "Lore — Internal-First AI Team Knowledge Platform"
status: approved
priority: critical
version: "0.5"
created: 2026-06-07
updated: 2026-07-03
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

**Lore is the sole project context**: every development-lifecycle output (requirements, designs, decisions, plans, execution evidence, assessments) lives in the corpus as a typed document; git-tracked files and dashboards are projections of the corpus, never parallel sources of truth. The dashboard's home surface IS the resolved living PRD. (Enforcement: §13; conformance oracle: `lore status --check-tree`.)

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
| G8 | Output contract live: `lore status --check-tree` reports 0 drift on this repo AND every closed plan since v0.5 carries all six stage outputs (§13.2) | P2+, checked at each plan closeout |

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

This PRD is the tree root. Each module is a child spec (kind=feature/tech/design, §13.1) with full detail (interfaces, data models, behavior contracts, visual specs). Cross-links between specs are typed relationships.

The module tree below is rendered live from the corpus (SPEC-004 placeholder resolution) — a hand-maintained list demonstrably drifts (this section was 8 specs stale at v0.5, stopping at SPEC-011 while the corpus reached SPEC-031):

<ChildrenOf />

Text readers: run `lore tree <this-prd>` — the tree command splices the live children — or use the dashboard tree view. **Known limitation (accepted at v0.5, closed by SPEC-032)**: `OutlineService.resolve()` returns the placeholder data as a separate `resolvedComponents` array and leaves `content` verbatim (it does not splice rendered text back into the body). So every plain-text projection — `lore get --resolve-mdx` stdout AND the SPEC-021 `export-docs` `.md` snapshot — shows the raw `<ChildrenOf />` tag; only structured consumers (the dashboard) render it inline. SPEC-032 makes text projections splice placeholders so §5 reads as a tree everywhere.

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
| M6 | Team adoption: 3+ projects. **Gate: success metrics check** + **output-contract gate: `check-tree` drift = 0; no stage skipped in last 3 closed plans (§13.2)** |

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

**Kill criteria**: See §6 per-phase gates. Global: if Anthropic/Cursor ships multi-vendor shared memory → decision gate ADR. **Output-contract theater check**: if the contract is bypassed (`--force`, self-approval without review, or a stage skipped) in >30% of plans over any 4-week window → the gates add friction without compliance; trigger a decision-gate ADR to simplify or drop them.

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

## 13. Output Contract & Document Taxonomy

### 13.1 Spec kinds

`spec` docs carry `extra.spec_kind: "feature" | "tech" | "design"`, **write-time validated as a Zod enum (fail-loud; unknown values rejected)**, default `"feature"` (backward compatible — all existing specs are feature specs). A one-shot audit `lore migrate spec-kind --dry-run` (parity with `migrate phases`) flags existing specs that are actually tech/design before the taxonomy is relied upon. Design specs are first-class normative contracts: reviewed, approval-gated, implementation must conform. Binary/HTML artifacts (prototypes, mockups, screenshots) live in-repo under `docs/design/`, referenced from the design spec by relative path — the corpus stores the normative text, the repo stores the artifact.

### 13.2 Stage → required output → completion gate

| Stage | Required output | Mounts under | Stage complete when |
|---|---|---|---|
| Direction / inception | PRD version bump | root | PRD approved |
| Feature definition | spec (kind=feature) | PRD | spec approved |
| UI/UX design | spec (kind=design) + repo prototype artifact | PRD, `relates`→feature spec | spec approved |
| Technical decision | adr | prd or spec | adr accepted |
| Structural tech design | spec (kind=tech) | PRD, `relates`→driving spec/adr | spec approved |
| Execution | plan → tasks + verification evidence (SPEC-025) | spec → plan | tasks archived |
| Closeout | assessment (SPEC-026) + retro knowledge | plan | assess verdict persisted |

Cardinality: one required output doc per stage instance; multi-spec efforts repeat rows per spec. All spec kinds mount under the PRD — the live `PARENT_TYPE_CONTRACT` keeps `spec: ["prd"]` (NOT widened to spec-under-spec); cross-references between specs use typed links, not tree parenthood.

### 13.3 Enforcement layers (status: partially live)

1. **Create-time hard gate — LIVE**: `PARENT_TYPE_CONTRACT` (`@lore/core` doc-type-rules) already rejects illegal parent types at create/link time. Escape hatch: `knowledge` mounts anywhere — ad-hoc notes are never blocked.
2. **Check-time soft gate — shipped, unarmed**: `lore status --check-tree` exists but the repo has no `lore.tree.yaml` blueprint yet. SPEC-032 authors the blueprint and arms the check.
3. **Process convention (NOT a hard gate)**: a stage is complete iff its doc reaches `approved`. Anti-rubber-stamp rule: for design/tech specs the approver SHOULD differ from the author (agent-authored → human-approved). Candidate hardening (SPEC-032): `lore ready` warns when a plan's parent spec is not approved.

Remaining SPEC-032 scope: `lore.tree.yaml` authoring, `spec_kind` Zod enum + `migrate spec-kind` audit, text-projection placeholder splicing (both `lore get --resolve-mdx` stdout and `export-docs` `.md` — `OutlineService.resolve()` today emits `resolvedComponents` data but leaves `content` verbatim), ready-warning, CLAUDE.md duplication lint. SPEC-033 scope: dashboard home replaced by the resolved-PRD projection (today's home is an unrelated hardcoded doc-list — a page rewrite, not a tweak).

### 13.4 Context boundary (SSOT rule)

- **Lore corpus**: everything about the product and the process — requirements, designs, decisions, plans, evidence, assessments, learnings.
- **In-repo CLAUDE.md**: code-adjacent technical navigation only (how to modify this code), atomically co-evolving with the code, referencing Lore slugs for the "why".
- A fact lives in one place and is linked from the other, never duplicated. Verification oracle (SPEC-032 candidate): a doc-lint flags CLAUDE.md sections that duplicate ≥N% of a corpus doc's text.

### 13.5 Dashboard = PRD projection

Dashboard home = resolveMdx-rendered living PRD (SPEC-004 machinery: ChildrenOf / RecentDecisions / ActivePlans / HealthStats) + pending-review and ready-task panels. Product current shape = the resolved PRD; iteration history = version log + assessment timeline; decisions = RecentDecisions + adr filter. Full page rewrite specified in SPEC-033.

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
- **v0.5** (2026-07-03): Sole-context positioning (§1) + output contract & document taxonomy (§13: spec_kind feature/tech/design, stage→output→gate table, 3 enforcement layers, SSOT boundary, dashboard-as-PRD-projection) + G8 + §6/§8 governance hooks + §5 module map converted to live `<ChildrenOf />`. Owner-approved: taxonomy option C (spec_kind field, not a new first-class type); full-chain launch. 5-stakeholder review applied — enforcement-layer status corrected to as-built (Layers 1-2 already implemented in `@lore/core`), spec-under-spec mount rejected (contract stays `spec:["prd"]`), export-fidelity limitation documented, spec_kind write-time validation + migrate audit added, approver≠author convention added. Landing specs: SPEC-032 (contract mechanization) + SPEC-033 (dashboard projection). Input: `knowledge-lore-as-sole-dev-context-output-contract-spec-kind-tax`.
