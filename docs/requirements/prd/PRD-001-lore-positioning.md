---
id: PRD-001
type: prd
role: intent
title: "Lore — Internal-First AI Team Knowledge Platform"
status: approved
priority: critical
created: 2026-06-07
updated: 2026-07-10
tags: [product-overview, L0, lore, mvp, internal-first, ai-native, protocol-aware]
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
| G9 | Autonomous feedback loop live (§14): R1 — every lifecycle transition audit-traced + ≥1 doc type at `assist`; R2 (data-gated) — human review load ↓≥70%, ≥1 doc type at `auto` on Wilson-bounded agreement data | P2+, R1 committed, R2/R3 contingent (§14.6) |
| G10 | Session layer live (§15): bootstrap pointer-set + lossless handoff (`/clear` → resume with zero human re-briefing) + session registry with file-anchor claim safety | P2+, committed v0.8 |
| G11 | Memory hygiene live (§16): bi-temporal invalidation + staleness probes + `lore status --check-drift` with 0 false-negatives on a seeded drift fixture | P2+, committed v0.8 |

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

- [spec] SPEC-042 — Session layer part 2: session registry + file-anchor claim safety (S3) (approved)
- [knowledge] Decision-score log — instrument-first bootstrap session (2026-07-10) (draft)
- [spec] SPEC-041 — Session layer part 1: bootstrap pointer-set + lossless handoff (S1+S2) (approved)
- [spec] SPEC-040 — Assessment dimension framework v2: facts/judgment split + typed findings (approved)
- [spec] P4 — Upstream-downstream linkage + feed-before-produce protocol (approved)
- [spec] P2 — Workflow state machine: checkpoint registry + cross-tier production-chain gates (approved)
- [spec] Upstream asset-ization — prompt & skill as first-class knowledge sub-types (approved)
- [spec] Corpus-governed spec-production loop — IoC vertical slice (approved)
- [knowledge] Lore as sole dev context — output contract + spec_kind taxonomy + dashboard-as-PRD-projection (approved)
- [knowledge] Assess material-budget distortion on multi-task plan diffs (approved)
- [knowledge] DocMan replacement assessment — Lore coverage map + two remaining gaps (approved)
- [knowledge] assess diff truncation systematically hides tests from the judge (approved)
- [knowledge] MDX placeholder parser flags JSX inside fenced code blocks (approved)
- [knowledge] Retro — SPEC-038 + SPEC-039 double delivery (multi-agent orchestration learnings) (approved)
- [spec] SPEC-039 — Trusted runner: attested evidence for script-mode ACs (approved)
- [spec] SPEC-038 — AC-as-code: structured acceptance criteria + oracle binding (approved)
- [knowledge] Anthropic Official Agent-Loop Engineering — Research Digest (approved)
- [adr] AC-as-code — 验收标准作为类型化 oracle 绑定数据 (approved)
- [spec] SPEC-036 — Dashboard browsing UX: breadcrumb + tag/status filters + type-differentiated presentation (approved)
- [spec] lore export-docs — reverse sync from corpus to spec files (approved)
- [plan] Bugfix — eval/assess/export findings 2026-07-07 (archived)
- [knowledge] Retro — e2e corpus-pollution incident (port-squatter absorbed write suite) (approved)
- [spec] SPEC-037 — Dashboard execution-tracking surface: readiness route + plan progress + evidence viewer (approved)
- [spec] SPEC-033 — Dashboard as living-PRD projection + human adjudication surface (approved)
- [spec] SPEC-035 — Audit trail + calibration data (approved)
- [spec] SPEC-032 — Output-contract mechanization (spec_kind + tree blueprint + text-projection splice) (approved)
- [spec] SPEC-034 — Structured review judgment + triage queue (approved)
- [spec] SPEC-031 — Dashboard read-path contract fixes + markdown typography (approved)
- [spec] SPEC-030 — Hermetic judge sessions + fail-loud AI config (approved)
- [spec] SPEC-029 — Assess reliability: reasoning-length resilience + surface-correct error hints (approved)
- [spec] SPEC-028 — Assess input transparency: pre-flight diff budgeting + file-boundary truncation (approved)
- [spec] SPEC-027 — Dashboard hardening: write-path integrity, delete/restore, component test coverage (approved)
- [spec] lore assess — AI plan-outcome assessment (LLM-as-judge feedback loop) (approved)
- [spec] Task execution workflow metadata (evidence / claim / ready) (approved)
- [spec] Dashboard write UI (create / edit / approve / link) (approved)
- [spec] HTTP API Adapter (approved)
- [spec] Service Layer Architecture (approved)
- [spec] Version History (approved)
- [spec] PRD-as-Living-Root (approved)
- [spec] Review Workflow (approved)
- [spec] Auth & Agent Credentials (approved)
- [spec] Migration v1 (approved)
- [spec] Corpus Schema (approved)
- [spec] MCP Server Adapter (approved)
- [spec] AI assistance in lore set and lore link (approved)
- [spec] HTTP-backed AI provider (alongside claude-cli) (approved)
- [spec] Default --no-ai for agent and MCP execution paths (approved)
- [spec] plan.phases as a first-class grouping layer (approved)
- [plan] CLI v3 Roadmap — State Alignment + New Surface (archived)
- [spec] CLI Adapter (approved)
- [spec] lore sync-docs — backfill new spec files into corpus (approved)
- [spec] Built-in AI provider for lore create (approved)
- [spec] Cookie Auth — CLI-managed local bootstrap (approved)
- [spec] Dashboard — Read-only Skeleton (approved)
- [spec] Monorepo Skeleton (Bun workspaces, P1 layout) (approved)
- [spec] Eval Framework (active)
- [spec] Telemetry Module (active)
- [spec] Sync Engine (Turso) (approved)

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
| NFR-15 | AI judge calls (§14) | Per-doc prompt bounded by `ai.review.*` char budgets (SPEC-026 `ai.assess.*` precedent). Batch review = ≤N judge calls for N docs, no hidden fan-out. Judge call count + duration recorded in telemetry — cost is visible before it is optimized |

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

**Kill criteria**: See §6 per-phase gates. Global: if Anthropic/Cursor ships multi-vendor shared memory → decision gate ADR. **Output-contract theater check**: if the contract is bypassed (`--force`, self-approval without review, or a stage skipped) in >30% of plans over any 4-week window → the gates add friction without compliance; trigger a decision-gate ADR to simplify or drop them. **Feedback-loop calibration check (§14.5)**: 8 weeks of shadow with weekly judgment volume <10 or an unreachable Wilson bound → freeze at `assist`, decision-gate ADR, SPEC-036+ not built.

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
| A6 | Weekly lifecycle-decision volume during active development is high enough (≥10/week) to calibrate §14 unlock gates in useful time | M | Measured in R1 shadow mode; §8 feedback-loop kill criterion is the guard |

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
3. **Process convention (NOT a hard gate)**: a stage is complete iff its doc reaches `approved`. Anti-rubber-stamp rule: for design/tech specs the approver SHOULD differ from the author (agent-authored → human-approved). Candidate hardening (SPEC-032): `lore ready` warns when a plan's parent spec is not approved. **§14 mechanizes this layer**: approver≠author becomes a hard invariant (I1), and the approve decision itself becomes AI-triaged with confidence-gated escalation.

Remaining SPEC-032 scope: `lore.tree.yaml` authoring, `spec_kind` Zod enum + `migrate spec-kind` audit, text-projection placeholder splicing (both `lore get --resolve-mdx` stdout and `export-docs` `.md` — `OutlineService.resolve()` today emits `resolvedComponents` data but leaves `content` verbatim), ready-warning, CLAUDE.md duplication lint. SPEC-033 scope: dashboard home replaced by the resolved-PRD projection (today's home is an unrelated hardcoded doc-list — a page rewrite, not a tweak).

### 13.4 Context boundary (SSOT rule)

- **Lore corpus**: everything about the product and the process — requirements, designs, decisions, plans, evidence, assessments, learnings.
- **In-repo CLAUDE.md**: code-adjacent technical navigation only (how to modify this code), atomically co-evolving with the code, referencing Lore slugs for the "why".
- A fact lives in one place and is linked from the other, never duplicated. Verification oracle (SPEC-032 candidate): a doc-lint flags CLAUDE.md sections that duplicate ≥N% of a corpus doc's text.

### 13.5 Dashboard = PRD projection

Dashboard home = resolveMdx-rendered living PRD (SPEC-004 machinery: ChildrenOf / RecentDecisions / ActivePlans / HealthStats) + pending-review and ready-task panels. Product current shape = the resolved PRD; iteration history = version log + assessment timeline; decisions = RecentDecisions + adr filter. Full page rewrite specified in SPEC-033.

## 14. Autonomous Feedback Loop (AI review, data-driven self-optimization)

**Vision (owner, 2026-07-06)**: Lore closes its own quality loop. AI reviews every lifecycle decision with structured, data-backed feedback; humans are pulled in only when the AI cannot decide; every automated decision is log-traceable; the accumulated decision data drives self-optimization. End state: Lore is not just self-hosting (it already manages its own corpus) but self-running, self-feedback, self-optimizing.

**Today's gap (measured 2026-07-06)**: the loop exists as disconnected parts. `lore pending` holds 12 docs, 100% awaiting manual approval regardless of how confident an AI reviewer would be; SPEC-026 assessments carry structured `gaps`/`recommendations` that no downstream consumer reads; SPEC-025 evidence and SPEC-012 telemetry record locally but aggregate nowhere; approve/reject reasons are free text — feedback is not comparable across time, so nothing can learn from it.

### 14.1 Capability domains

| ID | Domain | What it delivers |
|---|---|---|
| D1 | Structured review judgment | AI reviewer emits a Zod-typed `ReviewJudgment` per pending doc — never free text |
| D2 | Confidence-gated triage | Judgment either auto-executes (whitelisted type, above threshold, in `auto` stage) or escalates to a human with structured blocking questions |
| D3 | Audit trail | Every lifecycle transition (automated or human) emits an append-only `AuditEvent`; `lore audit <doc>` answers "who decided what, on which input, on what basis" |
| D4 | Calibration data | Human confirm/override of AI judgments accumulates as labeled `CalibrationRecord`s; aggregated into per-doc-type × per-prompt-version agreement rates |
| D5 | Self-optimization | L1: assessment `recommendations` feed forward into subsequent spec/plan generation context. L2: judge-prompt versions iterate, evaluated offline against calibration data. L3: thresholds/sampling rates self-tune within hard bounds |
| D6 | Escalation surfaces | CLI triage queue (`lore pending` upgraded), dashboard panel (extends SPEC-033), push notification on escalation events |

### 14.2 Data entities (Zod SSOT, all append-only)

- **ReviewJudgment** — `{decision: approve|reject|escalate, confidence: 0-1, reasons[]: {dimension, finding, evidence_ref}, checks[]: deterministic pre-checks run (schema validity, check-tree, link integrity, evidence completeness), judge: {provider, model, prompt_version}}`. Judge identity is the exact `{provider, model, prompt_version}` tuple — this tuple is what I1 compares. An `escalate` decision MUST carry `blocking_questions[]` — the exact points the AI could not resolve become the human queue's display content. Deterministic checks run BEFORE the LLM: a doc failing schema/tree checks is rejected without burning a judge call (the `check-tree` pre-check depends on SPEC-032 arming the blueprint — declared dependency).
- **AuditEvent** — `{actor: human id | ai judge identity, action, doc_id, doc_version, judgment_ref?, timestamp}` for every status transition. This is a NEW queryable surface (`lore audit <doc>` / `lore audit --verify`) — SPEC-012 telemetry is a write-only JSONL sink with no read path; storage may reuse that sink (NFR-7: audit separate from corpus storage) but the query surface is net-new build, not an extension. Completeness is an oracle: zero transitions without a matching event.
- **CalibrationRecord** — `{judgment_ref, human_outcome: confirmed|overridden, delta_reasons[]}`. Written whenever a human acts on (or samples) an AI judgment. The aggregation over these records — agreement rate per doc type per prompt version — is the single data source for stage unlocks (14.3), circuit breakers, and L2 prompt selection. No unlock decision may cite AI self-reported confidence alone.

**Ground-truth caveat (acknowledged, not solved)**: with a single human owner, "agreement" measures consistency with one person's decisions, not objective doc quality. For an internal tool this is definitionally acceptable — the owner's judgment IS the approval standard being automated — but it means agreement data cannot detect owner-correlated blind spots. Mitigations: I2 stratified sampling, L1 provenance tagging (14.6), and the §8 kill criterion. When the team grows past one reviewer, per-reviewer calibration becomes the upgrade path.

**Trigger model (no daemon)**: judgments are computed on demand — `lore review <doc>` (single) and `lore review --pending` (batch) CLI/MCP verbs; optionally invoked by the create/set flows behind config. Consistent with SPEC-025's read-side-computation ethos: no background process, no heartbeat. Judge-call cost is bounded by SPEC-026-style char budgets; a batch run over N pending docs makes at most N judge calls, deterministic-check failures short-circuit for free.

**Storage & testability**: Zod schemas live in `@lore/core`; judgments/calibration records persist in dedicated store tables (not doc `extra` — they are cross-doc data, §13.4 SSOT); 14.3 thresholds live in `LoreConfigSchema` following the `workflow.claim_ttl_minutes` precedent. The store MUST expose a seeding path for synthetic CalibrationRecords so 14.3 state transitions and circuit breakers are CI-testable without accumulating real judgments. Rolling-agreement aggregation reads a bounded, indexed window (last 50 records per type) — O(window) per recompute, never a full-table scan; NFR-2's query budget applies to it.

### 14.3 Staged unlock state machine (per doc type, data-gated)

Every doc type starts in **shadow** and advances only on measured data; ambition is capped by evidence, not by policy:

| Stage | Behavior | Entry condition |
|---|---|---|
| shadow | AI judges every pending doc, judgment recorded + shown as advisory; human still decides everything (no load reduction — this stage buys calibration data, not time) | Day 1, all types |
| assist | Human queue is triaged: AI-confident items pre-sorted with one-keystroke confirm; escalations flagged with blocking questions. Partial load reduction | ≥20 calibration records for the type |
| auto | AI executes approve/reject itself above the confidence threshold; below threshold → escalate. Human sampling floor stays active. This stage delivers the ↓70% target | Wilson-score lower bound of rolling agreement ≥0.90 at n≥50 for the type (raw "95% over 50" has a confidence interval too wide to distinguish signal from noise — the gate is the interval bound, not the point estimate) |

- Expected (not mandated) unlock order: knowledge → task → plan → spec/PRD — low blast radius accumulates data fastest. The data, not the roadmap, decides.
- **Blast-radius-scaled strictness**: the `auto` bound is per-type config; defaults 0.90 for knowledge/task, 0.95 for plan/spec/PRD. High-stakes types demand tighter evidence, not just more of it.
- **Honest expectation**: at this team's volume, spec/PRD types may never reach `auto` — that outcome is acceptable, not a failure. `assist`-level triage (pre-sorted queue, blocking questions) already delivers the owner's core ask for those types; G9-R2 is satisfiable by any type reaching `auto`, and unlocking only low-stakes types is the expected, honest reading.
- **Rolling window**: agreement is computed over the most recent 50 judgments per type (config), recomputed on every new CalibrationRecord.
- **Circuit breaker**: the Wilson lower bound drops below the unlock threshold → the type reverts to shadow automatically + push notification. Re-entry requires re-satisfying the full entry condition on NEW post-reversion data (no flapping: one reversion costs the type its accumulated streak).
- All thresholds (bound, window sizes, sampling floor) live in config with the defaults above; L3 may tune them only within §14.4 bounds.

### 14.4 Non-negotiable invariants

| ID | Invariant | Rationale |
|---|---|---|
| I1 | Approver ≠ author, mechanized: the judge tuple `{provider, model, prompt_version}` that authored a doc cannot auto-approve it; reviews use an independent judge prompt (substrate: SPEC-030 hermetic judge sessions — LIVE). **Honest limit**: this is process independence, not statistical independence — same-model judges share correlated blind spots. Cross-provider judging is a config option, and the residual correlated-error risk is exactly what I2 sampling exists to catch | Blocks the AI-writes → AI-approves → feeds-AI self-reinforcement loop, to the extent prompt-lineage separation can |
| I2 | Human sampling floor: even fully unlocked types route ≥10% of auto-decisions to human spot-check, **stratified** per doc type × judge prompt_version (flat random sampling has weak power against clustered failures, e.g. one bad L2 prompt iteration degrading one type); sampling is seeded/deterministic in tests. L3 may raise but never lower the floor, never to zero | LLM error rate is irreducible; unsampled automation lets errors compound silently |
| I3 | Every automated decision is reversible: version history stays append-only; `lore audit` links decision → judgment → doc version for one-command rollback | Automation without cheap reversal is a ratchet |
| I4 | AI-generated improvements are draft-first AND provenance-tagged: L1/L2 outputs (injected context, new prompt versions) never mutate approved docs directly; every L1 recommendation injected into a generation context carries its source `judgment_ref` so later audits can trace — and discount — self-reinforced context | Self-optimization must not pollute the SSOT it optimizes, visibly or invisibly |
| I5 | Escalation is fail-loud default: any judgment outside whitelist/threshold/stage escalates; no silent fallback to auto | Extends D-007 fail-loud philosophy to decisions |

### 14.5 Success metrics

R1 exit (oracle-checkable in CI + corpus):

| Metric | Baseline (2026-07-06) | Target | Measurement |
|---|---|---|---|
| Audit completeness | 0 (no audit surface) | 100% of transitions have an AuditEvent | `lore audit --verify` oracle |
| Judgment coverage | 0 | 100% of pending docs carry a ReviewJudgment when reviewed | CLI queue render |
| Calibration volume | 0 | ≥20 records on ≥2 doc types | store count |

R2 exit (requires weeks of real usage — measured, not CI-asserted):

| Metric | Baseline (2026-07-06) | Target | Measurement |
|---|---|---|---|
| Human review decisions/week | 100% of transitions manual (12-doc queue, 2+ day dwell) | ↓≥70% (denominator: measured R1 weekly decision volume, recorded before R2 starts) | AuditEvent aggregation |
| Escalation precision | n/a (no triage) | ≥80% of escalated items genuinely needed the human (owner-relative by construction — it measures "AI escalates trivia" annoyance, not objective necessity) | CalibrationRecord on escalations |
| Agreement (unlocked types) | n/a | Wilson lower bound ≥0.90 rolling | CalibrationRecord aggregation |
| Median time to detect+rollback a wrong auto-decision | n/a | ≤7 days (I2 sampling + a weekly `lore audit` digest bound the detection window) | AuditEvent timestamps |

**Kill criterion (§8 addition)**: if after 8 weeks of shadow mode any of — weekly judgment volume <10, or agreement so noisy the Wilson bound cannot reach 0.90 at any achievable n — then freeze the loop at `assist` permanently and record a decision-gate ADR; the calibration machinery (SPEC-036+) is not built.

### 14.6 Delivery stages & spec split

- **R1 — close the loop (shadow/assist)**: D1 judgment schema + on-demand review verbs, D3 audit events on every transition, D6 CLI triage queue, D4 records start accumulating. Shadow itself reduces no load (human still decides everything); the first relief arrives when types reach `assist` (pre-sorted queue, one-keystroke confirm).
- **R2 — unlock self-decision** (contingent on R1 data volume passing the kill criterion): 14.3 state machine live; types unlock on data. D5-L1 feed-forward: assessment `recommendations` are injected at the AI-template context-assembly point (`AIProviderService` template render, the same seam SPEC-026 uses) when generating a child spec/plan under the assessed plan's lineage — each injected item provenance-tagged per I4. Dashboard panel (after SPEC-033) + push channel: a configurable exec hook (`notify.command` in config — shell command receiving the escalation event as JSON on stdin; no vendor-specific channel).
- **R3 — self-optimization** (contingent on R2 exit metrics): D5-L2 prompt iteration (offline eval against calibration data, winner promoted), D5-L3 bounded threshold self-tuning.
- **Stage-gate reviews are self-hosted**: each R-stage exit review runs through `lore assess` (SPEC-026) against this section's metrics and persists as an assessment doc under the stage's plan — the loop's own gates leave the same evidence trail the loop enforces on everything else. No stage may be declared passed from memory or chat; the assessment doc is the gate record.

Committed landing specs (R1 only): **SPEC-034** structured review judgment + triage queue (D1, D2-triage, D6-CLI); **SPEC-035** audit trail + calibration data (D3, D4). Input-quality hardening serving every R stage (committed 2026-07-08, NOT an R2 unlock): **SPEC-038** AC-as-code — structured, oracle-bound acceptance criteria on specs (`extra.acceptance_criteria`, script/ai/human verify modes, evidence `ac_ref`, assess judges against the declared AC set; see ADR "AC-as-code"). Contingent (named by capability for traceability, NOT committed — each requires a decision-gate ADR citing R1/R2 data before creation; the spec numbers originally reserved here as SPEC-036–038 have since been consumed by other landed specs — refer by capability name): unlock state machine + auto-execution; L1 feed-forward; L2/L3 self-optimization. This staging exists because §9-R1 (second-system syndrome) applies to §14 itself — a 5-spec autonomous-review platform built ahead of its data is the failure §14 is designed to prevent. Declared dependencies: SPEC-034's check-tree pre-check needs SPEC-032 (blueprint arming); the dashboard escalation panel needs SPEC-033. Benchmark patterns to validate at design time: confidence-triaged AI code review (CodeRabbit / GitHub Copilot review), LLM-observability data models (Langfuse / LangSmith traces + scores + prompt versions), active-learning sampling loops (Label Studio-class systems).

### 14.7 Assessment dimension framework v2 (input-quality hardening, committed 2026-07-10)

The v1 assess rubric is one-dimensional (per-AC evidencing) and its `gaps`/`recommendations` are free-text — the measured §14 gap "recommendations that no downstream consumer reads" is structural: untyped output cannot be programmatically consumed. Committed upgrade (landing spec: SPEC-040), serving every R stage like SPEC-038; NOT an R2 unlock, §14 staging untouched:

- **Two-layer split**: deterministic facts are computed in code and FED to the judge (AC coverage incl. attested ratio — already live; per-task evidence completeness; scope-match between plan-declared scope and spec AC surface; gate/process compliance), while judgment dimensions are reserved for what has no executable oracle. The judge never re-derives what code can compute (IoC ADR boundary 1).
- **Typed multi-dimension rubric**: `outcome` (AC satisfaction — v1 carried over), `evidence_integrity` (claims backed by attested vs self-reported evidence), `scope_fidelity` (delivered = planned; creep/cut named explicitly). Per-dimension score + advisory-only judge confidence + `based_on: evidence|absence` grounding declaration. `regression_risk` and `knowledge_capture` are NOT judge dimensions — SPEC-040's 3-lens design review found them ungrounded in bundle-visible material (fabrication invitation); both are demoted to deterministic facts (tests-touched/attested-ratio signals; knowledge-link counts).
- **Typed findings**: `gaps[]` → `{dimension, severity, ac_ref?, statement}`; `recommendations[]` → `{target: spec|plan|prompt|skill|process, action, rationale}` carrying provenance (I4). This is the D5-L1 consumer-side unblock: R2 feed-forward injection requires typed recommendations to exist first.
- **Judge self-declared uncertainty**: `unverifiable[]` names materials the judge could not see (complements the diff Truncation Manifest); scoring an unseen material down without a matching `unverifiable` entry is a mechanically detectable rubric violation.
- **Scope-fit fix**: a narrow plan hanging off a broad spec is judged against the plan-declared AC subset (evidence: `knowledge-assess-usage-patterns` #1 — 63/100 despite complete in-scope delivery).
- **Golden-set regression gate (the L2 harness arrives early)**: promoting a new assess prompt/rubric version requires non-inferiority on replayed historical assessments labeled by human outcomes (the existing assessment docs + SPEC-035 calibration overrides are the seed corpus). The same data discipline §14.3 applies to autonomy applies to the instrument itself — no rubric version ships on vibes.

Baseline instrument-defect evidence: `knowledge-assess-material-budget-distortion` (3× systematic under-scoring, 30-50 points), `knowledge-assess-usage-patterns` (#1 scope mismatch, #9 ±2 score noise), `knowledge-round-3-findings` (judge session contamination — since fixed by SPEC-030), §14 intro's unconsumed-recommendations gap.

## 15. Session Layer (multi-session collaboration & context continuity)

**Vision (owner, 2026-07-10)**: sessions become governed, first-class work units. Today Lore governs artifacts (docs) and their production functions (prompt/skill — IoC P1), but not the unit that produces them: an agent session. Cross-session amnesia, context-drift-vs-`/clear`-loss, and multi-session write conflicts are the three highest-ranked unsolved pain points in the 2026-07-10 strategic review. Three capabilities, all read-side computed (SPEC-025 ethos — no daemon, no heartbeat):

- **S1 Session bootstrap** — a `lore_bootstrap` MCP tool / CLI verb emitting the pointer-set (tree roots, active plans, pending queue, caller's fresh claims, armed gates) for SessionStart hook injection. Replaces the DocMan bootstrap dependency (gap recorded in `knowledge-docman-replacement-assessment`). Pointers + summaries, never full dump (IoC ADR boundary 2).
- **S2 Session handoff** — `lore handoff` persists a typed session digest (knowledge `sub_type: handoff`: modified files, active plan/task ids, key decisions with confidence scores, failing oracle output) and `lore feed session-resume` replays it at the next session's start. Makes `/clear` lossless: the cure for context drift stops costing the context. Handoff docs enter the same review/judge loop as every other doc — an unreviewed handoff is advisory, never authoritative.
- **S3 Session registry & write-conflict safety** — lightweight session records (actor, machine, worktree, branch, held claims) surfaced in `lore ready` / `lore tree`; a file-anchor overlap predicate at the task-claim gate upgrades the worktree-mutex *convention* (CLAUDE.md) into a corpus-enforced *predicate* — the same convention→predicate move P2 made for upstream approval.

Non-goals: no live message bus between sessions (the corpus is the medium); no daemon (freshness TTL-computed like claims).

## 16. Memory Hygiene (knowledge trustworthiness over time)

**Vision (owner, 2026-07-10)**: the corpus must not silently rot. Landscape evidence (2026-07-10 tier-tagged research): bi-temporal invalidation (Zep/Graphiti, arXiv 2501.13956) is the strongest known explicit-signal mechanism; *silent* staleness (a fact changes with no contradicting signal) is an industry-open problem — and Lore has already been bitten (`knowledge-retro-stale-claude-md`: a stale doc produced a false 'SPEC-022 unimplemented' judgment). Three capabilities:

- **H1 Bi-temporal invalidation** — knowledge/ADR docs gain `valid_at`/`invalid_at` semantics; superseding marks the old doc invalid (never deletes — version history stays append-only); default queries/feeds filter invalidated knowledge; an `--include-invalid` escape shows history.
- **H2 Staleness probes** — `lore review --staleness` re-judges high-in-degree knowledge/ADR docs ("does this still hold?") on demand; result is escalation, never auto-invalidation (probabilistic zone, IoC ADR boundary 1). Probe priority: link in-degree × age.
- **H3 Doc-code drift oracle** — specs may declare code anchors (file paths / exported symbols); `lore status --check-drift` verifies anchor existence — deterministic, CI-runnable, zero LLM calls.

Non-goals: no vector store (NG8 unchanged — H1-H3 are metadata + FTS5 + judge verbs); no automatic deletion, ever.

## 12. Out of Scope

- v2.1+: Agent-memory protocol RFC (extracted from v1.0 architecture)
- v2.2+: Enterprise features (SSO, RBAC, audit retention)
- v2.x: Field-level conflict resolution
- v3.0: Real-time CRDT collab, mobile, vector search
- §14 explicit exclusions: code-diff review (owner decision 2026-07-06 — the loop's object is corpus document lifecycle, not git diffs); external workflow-orchestration engines (the loop is built on Lore's own service layer + config, no new runtime dependency); removing the human from the loop entirely (I2 sampling floor is permanent at every autonomy level)

---

## Provenance

- **Ideation**: 6-role parallel brainstorm → `IDEATION-001-v2-positioning-synthesis`
- **Phase 2 review**: 6-role stakeholder review (2 APPROVE_WITH_CONDITIONS / 4 REQUEST_CHANGES). All conditions addressed in v0.2-0.3.
- **Owner decisions**: A1 skip external validation; protocol-aware app; 3-phase delivery; Web UI → SHOULD; P1 CLI-only; service layer abstraction.
- **v0.4**: PRD restructured to outline-level. Detail lives in 7 child feature specs.
- **v0.5** (2026-07-03): Sole-context positioning (§1) + output contract & document taxonomy (§13: spec_kind feature/tech/design, stage→output→gate table, 3 enforcement layers, SSOT boundary, dashboard-as-PRD-projection) + G8 + §6/§8 governance hooks + §5 module map converted to live `<ChildrenOf />`. Owner-approved: taxonomy option C (spec_kind field, not a new first-class type); full-chain launch. 5-stakeholder review applied — enforcement-layer status corrected to as-built (Layers 1-2 already implemented in `@lore/core`), spec-under-spec mount rejected (contract stays `spec:["prd"]`), export-fidelity limitation documented, spec_kind write-time validation + migrate audit added, approver≠author convention added. Landing specs: SPEC-032 (contract mechanization) + SPEC-033 (dashboard projection). Input: `knowledge-lore-as-sole-dev-context-output-contract-spec-kind-tax`.
- **v0.6** (2026-07-06): Autonomous feedback loop (§14: D1-D6 capability domains, three data entities, shadow→assist→auto staged unlock, five invariants, R1-R3 delivery) + G9 + §13.3 layer-3 mechanization pointer + §12 exclusions + A6 + §8 feedback-loop kill criterion. Owner-confirmed boundaries: loop object = document lifecycle (not code diffs); self-decision whitelist = all types including spec/PRD (data-gated, not day-1); end-state autonomy = L3 within I2 sampling-floor bounds; escalation surfaces = CLI + dashboard + push. 5-stakeholder review applied (avg 5.6 → revisions): unlock gates rebased from point estimates to Wilson lower bounds; single-owner ground-truth limitation acknowledged with mitigations; I1 downgraded to honest process-independence claim + cross-provider option; I2 sampling stratified; L1 feed-forward provenance-tagged (I4) with named injection seam; trigger model pinned to on-demand verbs (no daemon); AuditEvent scoped as net-new query surface over SPEC-012's write-only sink; storage/config/fixture-seeding homes named; R1 load-drop misattribution fixed; spec commitment cut from 5 to 2 (SPEC-034/035), SPEC-036-038 ADR-gated on data; SPEC-032/033 dependencies declared. One reviewer claim rejected with evidence: SPEC-030 alleged nonexistent — it is landed (hermetic-spawn.ts, corpus doc 01KWKDC4). Second synthesis pass (same review inputs): bounded-window aggregation guard (NFR-2), NFR-15 judge-call cost visibility, blast-radius-scaled auto bounds (0.95 for plan/spec/PRD), honest spec/PRD-may-stay-assist expectation, self-hosted stage-gate reviews via `lore assess`. Committed landing specs: SPEC-034 (judgment + triage), SPEC-035 (audit + calibration).
- **v0.7** (2026-07-08): AC-as-code committed as §14 input-quality hardening (SPEC-038: structured `extra.acceptance_criteria` with script/ai/human verify modes, oracle-enum SSOT consolidation, evidence `ac_ref`, assess judges against the declared AC set — serves R1+ judge-input quality; NOT an R2 unlock, §14 staging untouched). §14 contingent-spec references renamed from stale reserved numbers (SPEC-036–038, since consumed by landed specs) to capability names. Origin: Anthropic official loop-engineering research (knowledge doc) + ADR "AC-as-code" (4-perspective design review applied). Loop framing: feedback × feedback-trustworthiness × loop-closure; this delivers the standardized feedback supply side. Deferred by decision: trusted runner (SPEC-039 candidate), assess-gap auto-task + calibration-gated autonomy (§14 R2, data-gated as before).
- **v0.8** (2026-07-10): Strategic review applied (full corpus audit + tier-tagged competitive research: spec-kit/Kiro/GSD/superpowers/beads confirmed red-ocean on spec/plan/orchestration; outcome-verification loops, production-grade self-evolution, and memory hygiene confirmed open gaps that Lore's SPEC-025/026/034/035/038/039 line already sits on). Owner directives: all subsequent development fully self-hosted on Lore; score-gated autonomy (human pulled in only below confidence threshold); every plan closes with a self-assessment — **instrument first**: assessment dimension framework v2 committed as §14.7 (landing spec SPEC-040) BEFORE new capability work, so early autonomous cycles do not accumulate mis-calibrated data. New sections: §15 session layer (S1 bootstrap / S2 handoff / S3 registry+write-safety, G10), §16 memory hygiene (H1 bi-temporal invalidation / H2 staleness probes / H3 drift oracle, G11) — capability-named landing specs to follow, each through the §13 output contract. §14 R2/R3 data-gating and the §8 kill criterion untouched.
