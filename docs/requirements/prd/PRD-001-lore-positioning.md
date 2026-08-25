---
id: PRD-001
type: prd
role: intent
title: "Lore — Internal-First AI Team Knowledge Platform"
status: approved
priority: critical
created: 2026-06-07
updated: 2026-08-23
tags: [product-overview, L0, lore, mvp, internal-first, ai-native, protocol-aware]
links:
  - {id: SPEC-102, type: relates-to}
  - {id: SPEC-094, type: relates-to}
  - {id: SPEC-095, type: relates-to}
  - {id: SPEC-096, type: relates-to}
  - {id: SPEC-097, type: relates-to}
  - {id: SPEC-098, type: relates-to}
  - {id: SPEC-099, type: relates-to}
  - {id: SPEC-100, type: relates-to}
  - {id: SPEC-101, type: relates-to}
  - {id: SPEC-093, type: relates-to}
  - {id: SPEC-092, type: relates-to}
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
| G12 | Phase execution model live (§18): plans created after the landing spec ships execute via phases; phase completion 100% computed (oracle: P3 unit suite + seeded-corpus fixture); task→phase migration zero data loss (oracle: P7 pre/post reconciliation, idempotent re-run); phases-per-plan distribution tracked at each `lore assess` with the §18 re-open trigger | P2+, landing specs before the v0.11 PRD review |
| G13 | Two-tier seat model live (§15 S4): `lore seat` covers seat entry / list / resume; seat-aware resume verified over the S4 equivalence-class table (main checkout / seat worktree / task-worktree-under-seat / detached HEAD), 0 counterexamples across all enumerated classes | P2+, landing specs before the v0.11 PRD review |
| G14 | Upstream issue feedback loop live (§20): a consuming project's agent on ANY machine files a structured defect report via `lore report-issue` into the configured GitHub tracker, while this corpus retains authority over resolution (`adr-a-tracker-is-replaceable-a-corpus-is-not-github-is-the`). The four original R-5 rails are dispositioned rather than carried forward: identity pin → superseded by an authenticated target check (`gh api user` + an explicitly-passed repo, never a git-remote inference); version-skew reject and sync-upstream reject → NOT APPLICABLE on a hosted tracker, which exposes no upstream schema version and no replica state; rate cap → DELETED, because abuse control belongs to the tracker and a cap only refuses honest reporters (measured 2026-08-23: 10 open reports against a ceiling of 10 refused every new report while 6 criticals sat untriaged). The local-SQLite intake this goal originally described was measured structurally unreachable from any other machine, so it never satisfied "a consuming project's agent" at all. Trigger surfaces committed (hints + vendored stanza owner-promoted 2026-07-24) and dashboard Issues triage surface live (F5); ≥1 true defect fixed end-to-end through the loop | P2+ |
| G15 | Dashboard console first batch live (§21 F1+F2): evidence/AC adjudication context + keyboard triage + judgment drill-down, with route-level usage telemetry recording to the SPEC-012 sink; oracle: keyboard-only component-test loop (incl. editor-focus suppression) + boundary-state component tests + Playwright adjudicate-with-evidence-visible e2e + telemetry enabled/disabled two-branch assert | P2+, committed v0.13 |
| G16 | Multi-project dashboard live (§22): one instance mounts ≥3 registered projects with one login; switcher performs full context switch with per-project pending badges; two-corpus write-isolation + If-Match-replay e2e (R-12), gate-equivalence e2e (R-13), stale-bleed e2e (R-16), and runtime-degradation test (R-17) pass; registry-less regression incl. the new route-shape pin passes | P2+, committed v0.14 |

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

- [spec] The mirror oracles' two command surfaces are O(corpus) by accident: one row contract for list --json, a real argv parser for export-spec-mirror (draft)
- [task] lore log and created_by print the literal system while the audit trail holds the real actor: a false label that made me accuse the wrong agent (draft)
- [task] [Skill:test] the mirror end-to-end oracles cost O(corpus) against a fixed 30s timeout and now exceed it (archived)
- [task] [Skill:implement] DUPLICATE_SLUG.existing_id names the rejected doc, not the existing one (archived)
- [task] 48 files fabricate an exit code from spawnSync so every ENOBUFS reads as exit 1: the spawnSync audit needs a ratcheted check script (draft)
- [task] The mirror --check absorbed the content probe in 90951390 without re-measuring its 13 callers: re-separate the halves or make it incremental (draft)
- [task] One unknown key discards the whole .lore/config.yaml and the error then claims nothing was configured: silence, not the non-abort, is the defect (draft)
- [spec] A GitHub-filed defect must be claimable: one ingest seam turns a listed issue into a corpus task (approved)
- [task] [Skill:implement] D9's configured-repo substitution silently skips projection when the config is not GitHub-shaped (draft)
- [task] [Skill:test] repair the two assertions my read-side slice superseded (archived)
- [spec] lore issues falls through to the LOCAL corpus on a retired-shape upstream while report-issue refuses it (approved)
- [spec] The retired-shape refusal message has two independent definitions and no oracle fails when they diverge — measured: they already had (approved)
- [knowledge] PRD-001's prose contradicts the exporter it describes, check:spec-mirror's exit code carries no signal, and the CLAUDE.md floor displaces its cost onto the next writer (draft)
- [spec] Phase writes are version-less BY DESIGN (SPEC-023) — the root CLAUDE.md lifecycle paragraph contradicts it, and the premise that phase history is dispensable has moved (approved)
- [knowledge] Five findings from planning the GitHub read side: a refusal can promise a phase no spec declares (approved)
- [knowledge] A deterministic gate:pass is not design completeness, raw fan-in inverts blast radius, and an absent JSON key is not an absent field (approved)
- [spec] A conclusion with no currency signal and no falsifier: retrieval ranks a superseded claim above the one that replaced it (approved)
- [spec] Governance weight must scale with measured blast radius: a gate with no risk input can only be all-on or all-off (approved)
- [knowledge] A worktree with no node_modules resolves workspace imports to the MAIN checkout, silently (approved)
- [knowledge] A --dry-run flag that does not exist writes the files anyway, a mirror CLI with no per-doc --force, and the five-pass gradient from a green-on-arrival oracle to a positive one (approved)
- [knowledge] An equality oracle over two copies goes vacuous the moment the copies are collapsed, plus three findings from closing the defect channel's SSOT (approved)
- [knowledge] Under vitest, importing a name a module does not export is green unless you call it, so a vitest oracle never proves an export exists (approved)
- [adr] Phase writes log a version row and do NOT demote the plan — SPEC-023's 'history is dispensable' clause is overturned, its soft-grouping model is not (approved)
- [knowledge] lore release erases all three ownership signals at once, so a live peer's unmerged work renders as unowned — the bucket the merge protocol authorises acting on (approved)
- [knowledge] Worktree agents are built from origin/main, not local HEAD, so the standing pull-before-dispatch rule is a no-op exactly when it matters (approved)
- [spec] CLAUDE.md governance — content-dimension checks: wire the dead admission half, split capacity from content, and measure what the contract asks for (approved)
- [knowledge] lore evidence --capture now clears the attested floor, and AC-CT-2 asserts a corpus-wide property that is false by 440 rows (approved)
- [spec] Project CLAUDE.md content contract — governance-injected prose target + deterministic line/byte ceiling lint across template, init-context, and pre-push (approved)
- [spec] Out-of-box reporting channel — report-issue self-provisions its upstream config (deprecated)
- [spec] Upstream issue reporting: lore report-issue (consumer defect feedback loop) (deprecated)
- [spec] report-issue has no specified concurrency contract: AC-072-9 asserts an assumed one and flakes at ten percent on every tree (approved)
- [knowledge] The orphan-branch sweep asks a content question with a SHA predicate, and a red-first test task has no legal terminal state (approved)
- [spec] Context verb family — two-zone CLAUDE.md anatomy, lore context init refresh, admission checks, init-context skill retirement (approved)
- [spec] The defect channel reaches no machine but its own: GitHub becomes intake while the corpus keeps resolution authority (approved)
- [knowledge] A worktree without its own bun install silently tests against the main checkout's @lore/core — a false-oracle in both directions (approved)
- [knowledge] Three mechanism gaps measured while dispatching the GitHub-intake plan: red-first tasks are un-archivable, falsifier declaration demotes a spec, and --merged is unsafe for worktree cleanup (approved)
- [adr] A tracker is replaceable, a corpus is not — GitHub is the defect channel's intake, never its resolution SSOT (approved)
- [knowledge] A gate at the end of a && chain is never invoked while main is red, and the blast radius my dispatch bundle carried was wrong by 10 sites (approved)
- [spec] Corpus truthfulness: a verdict must carry the state it describes, and a post-arming stamp-less record is never green (approved)
- [spec] AC-as-code: structured acceptance criteria + oracle binding (approved)
- [knowledge] Five gaps from landing plan A's type foundation — two same-batch worktrees on a stale base, a compile oracle green under its own falsifier, and a shipped arming constant that never arms downstream (approved)
- [knowledge] lore feed's readiness line counts retracted tasks while lore ready excludes them — two unfiltered call sites in session-service (draft)
- [knowledge] Ten measured gaps from landing plan A wave 1 — and the one that deadlocked the whole plan shape (approved)
- [knowledge] A symlinked node_modules makes the green control pass while every cross-package mutation goes invisible: runnability and observability are two properties (approved)
- [adr] A falsifier's scratch worktree gets dependencies by hybrid symlink, with the workspace scope redirected inward — runnability and mutation observability are separate assertions (approved)
- [spec] A falsifier's scratch worktree must be runnable AND observable: hybrid dependency materialization with the workspace scope redirected inward (approved)
- [knowledge] Five gaps measured while landing the discovery-refusal guard's second write path: a mirror that reports OK without comparing content, an unattachable red, a quota that drops the newest evidence, a wrapper exit code, and an adopted verdict silently overruled (approved)
- [knowledge] A declared property with no measuring oracle, and the red-first vs falsifier deadlock that leaves every early AC's discriminating power asserted rather than demonstrated (approved)
- [task] lore verify --falsify compares only the exit code, so an unrunnable scratch worktree mints a proven red from a module-not-found error (draft)
- [knowledge] Redeeming three advisories produced two more rounds of the same defect, and the judge's escalation caught a real design break no self-check did (approved)
- [spec] Oracle executability: a runner's discovery refusal is not a measurement, and must never mint a red (approved)
- [task] lore done's test-anchor refusal demands an ATTESTED unfiltered pass, but its predicate never checks attestation — an unattested --capture row satisfies it (draft)
- [knowledge] The green-control pattern, and its cost: a falsifier that can never go red replaces one that always could (approved)
- [spec] Falsifiability reachability: a feedable checkpoint, an attestable red, a guard that means what it says, and a mirror whose drift trips (approved)
- [knowledge] The falsifier mechanism is shipped but inert: a coverage field blind to 692 criteria, and 8 declarations with no live execution path (approved)
- [adr] A record with no state stamp is acceptable but never green: a third class, not a pass and not a refusal (approved)
- [knowledge] A repo-wide oracle cannot have hand-enumerated file anchors, and four more orchestration-layer errors measured in one session (approved)
- [spec] Attestation completeness guard: detect zero-match / under-match test oracles (approved)
- [spec] The defect channel cannot be honestly maintained: an unreleasable cap whose remedy is inert, two reads that disagree on which corpus, and no non-derogatory supersession (approved)
- [knowledge] lore verify --falsify compares only the exit code, so an uninstalled scratch worktree mints a proven red out of a module-not-found error (approved)
- [spec] Bootstrap fixpoint integrity: binary provenance, an anchor-coverage ratchet, and mirror content drift (approved)
- [knowledge] AC coverage counts evidence by plan lineage and ignores ac_scope, and an oracle generation cannot see its own test file being rewritten (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [spec] Autonomous Feedback Loop (AI review, data-driven self-optimization) (domain overview) (approved)
- [spec] Two-runner changed-test selection — deterministic test:changed replaces vitest-only regression sweep (approved)
- [knowledge] Governance gaps measured while resuming handoff 107, and why most are recorded here instead of in the defect channel (approved)
- [knowledge] bun run test:changed — full selection contract and its residuals, one of which is now closed (approved)
- [spec] Session Layer (multi-session collaboration & context continuity) (domain overview) (approved)
- [knowledge] Retired from root CLAUDE.md 2026-08-13: four standing lessons evicted verbatim to free bytes for a correction (approved)
- [knowledge] Three mechanism facts that lived only in source comments: the /$bunfs/ compiled-binary discriminator, the sibling exporter that rewrites the mirror mid-test-run, and why a verdict line must print last (approved)
- [knowledge] Eleven findings from landing corpus-resolution provenance: two ACs pinned to mechanisms that do not exist, two assess MAJORs that were truncation artifacts, and a peer session rewriting the tooling underneath (approved)
- [knowledge] Evicted from the service module doc: the AcService and DriftCheckService Service Map rows, verbatim (approved)
- [knowledge] Seven findings from landing the release-side trailer unbind: a body-only mirror detector, a test that required the defect to persist, and an assess that scored MAJORs against files it called unverifiable (approved)
- [adr] Verdict staleness is measured by blast radius, never by git ancestry — a peer merge preserves ancestry while invalidating the verdict (approved)
- [knowledge] The nine UNENFORCED standing lessons, evicted from CLAUDE.md with the mechanism each one still needs (draft)
- [knowledge] Governance gaps measured while landing the anchor-coverage ratchet (approved)
- [spec] Oracle exclusivity in a shared checkout: a mirror check that cannot repair itself, a pollution guard that sees mirror content, a gitignored probe namespace, and a serialized suite (approved)
- [knowledge] The AC coverage badge ignores fail_superseded, so a criterion re-proved by a newer attested pass renders as failed forever in its spec and its mirror (approved)
- [knowledge] Retired from root CLAUDE.md: eight pointer-less standing lessons (approved)
- [knowledge] A concurrent write silently invalidates the other party's verdict: the orchestrator polluted its own implementer's corpus-reading tests, and a peer merge staled a full-suite green (approved)
- [knowledge] An AC id is spec-local but every prose reference treats it as global: 51 exact ids are claimed by more than one live spec (draft)
- [task] lore list silently omits invalidated docs and reports a self-consistent total, so a corpus-wide census is wrong by exactly the hidden population with no signal that anything was filtered (draft)
- [task] The --cwd blind spot is a CLASS, not one function: lore done's unfiltered-run floor also strips only a 'cd' prefix, so obeying this repo's own no-cd discipline makes a task un-archivable (draft)
- [task] lore done tells you to archive a plan whose declared phases are mostly EMPTY: 'every child task is archived' cannot distinguish a finished plan from one that was never decomposed (draft)
- [task] lore set --content-file silently accepts a replacement that deletes most of a document, with no volume-delta warning and no confirmation (draft)
- [task] lore assess scores findings against files listed in its OWN truncation manifest, so a path the judge never saw is reported as a MAJOR gap (draft)
- [spec] Multi-session concurrency: queryable ownership, checkout-scoped exclusion, probed liveness (approved)
- [task] lore review truncates the parent spec before the judge sees it, so the judge scores absent text as a missing-definition defect and escalates the whole plan (draft)
- [task] The defect channel has no adopt verb: a filed report can be closed but never given an owner, so every accepted defect stays plan-less forever (draft)
- [task] The two mirror exporters disagree: bun run mirror:export never rewrites a changed file but the test suite does, so the documented 're-export and commit before the run' remedy is unreachable (draft)
- [task] mirror:export never rewrites an existing file whose rendered content changed, and check:spec-mirror compares only count and slug parity — so every archived task reads 'draft' in the mirror while both commands report OK (draft)
- [adr] Multi-session coordination is decentralised: file locks plus process probing, no resident daemon (approved)
- [task] The oracle-file-existence precheck understands only the 'cd <dir> &&' form the repo's own discipline forbids, so a compliant command is refused as a missing file (draft)
- [knowledge] Two governance-tooling gaps measured while designing the concurrency mechanism: three of four gates have no feeding source, and the coverage hook accepts a reason only on deferral (approved)
- [task] AC ids are not globally unique, so an ad-hoc task scoped to a colliding id cannot reach the attested path the predecessor task built (draft)
- [knowledge] Eight findings from resuming the corpus-provenance follow-ups: a handoff item that was already half-fixed, and a mirror whose update path never ran (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] The clean-tree floor and the repo's own test selection contradict each other, and five agents independently stashed to escape it (draft)
- [task] The mirror export silently skips a changed knowledge doc and every parity check reports OK (draft)
- [task] The handoff and UAT carve-out in the foreign-write guard is unnamed in the spec and unasserted by any AC (archived)
- [task] A captured evidence row observes the exit code, validates against it, then discards it — so runner-captured passes cannot archive their own task (draft)
- [spec] Corpus resolution carries provenance, and a foreign write is a decision not an accident (approved)
- [task] verify-execution-root carries a byte-identical copy of the isWithin bare-root defect just fixed in the shared resolver (draft)
- [task] The undetermined provenance value has no policy: fail-open vs fail-closed on detector disagreement is unoracled (draft)
- [task] The pure resolver's isWithin rejects everything at the filesystem root, so each caller must route around it (archived)
- [task] The MCP boot carries the same frozen-startup-cwd provenance the HTTP fix removed, and no oracle can reach it (draft)
- [task] The HTTP exemption is conditional on where lore serve was launched, not on the adapter (archived)
- [task] Merged-tree broad-suite run after the corpus-provenance plan landed (draft)
- [task] The resume-coverage verb accepts a reason after deferred: but rejects one after done, and reports the explained completion as 'still unaccounted' — the asymmetry costs a Stop round-trip and discourages the more informative disposition (archived)
- [task] lore done --override-attestation demands fresh prose that restates evidence rows already on the task — let it CITE a recorded row instead, with refusals that keep the cheaper path from being the weaker one (archived)
- [task] main carries two RED e2e cases: migrate-ordinals-compiled expects SPEC-1 while the compiled binary emits the zero-padded SPEC-001 — a deterministic format divergence sitting red on a clean tree, unmentioned by any handoff (archived)
- [task] Nothing automated runs the test suite: pre-push runs four corpus checks and zero tests, there is no CI at all, and this repo has no remote so pre-push never even fires — a sound oracle that nothing invokes is not a gate, and two defects already walked through (archived)
- [adr] CI/CD is the consuming team's own infrastructure, not a lore deliverable — lore ships corpus gates, never a test runner or pipeline (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] The git safety gate's worktree rule matches only --force, and its header calls non-force removal safe — so it passed a removal of a LIVE peer's worktree on an unmerged branch, while the exact blocking predicate already sat one branch away at line 363 (archived)
- [task] AC-IC-1 harness runs out of sampling budget under load while the contract itself holds (archived)
- [knowledge] Evicted from the CLI adapter module doc: the claim/evidence/done bullet (draft)
- [task] The wire-contract mirror comment in issue-reports-routes.ts describes a gap that AC-DC-12 already closed (archived)
- [task] A worktree nested inside the main checkout resolves the LIVE corpus, so any corpus-writing test run from it pollutes the shared corpus (draft)
- [spec] A write-side fact with no read-side address: counts with no member list, a doc type with no drift oracle, and a taxonomy with no filter (approved)
- [knowledge] Fifteen findings from fixing a consumer defect list: an unreleasable quota, an attested path left ungated while the self-report path is gated, and four gaps in my own ACs (approved)
- [task] The issues-resolution e2e fixture calls --adhoc with no --ac-scope, which cb526317 made a refusal (draft)
- [task] test:changed's alias map is blind to @/ and @lore/lore, so every dashboard component test is unselectable when its component changes (draft)
- [knowledge] Evicted from the service module doc: ReviewService's judgment gate, and the two different byte floors that let an anchored doc pass the guard while reddening the suite (draft)
- [spec] Memory hygiene part 3: doc-code drift oracle (H3) (approved)
- [knowledge] Evicted from the CLI adapter module doc: the gate/feed pre-flight pair and why LORE_GATE_BYPASS is gate-scoped (draft)
- [adr] Governance-document conflict exposure is deferred: read-count telemetry cannot observe a compliance failure, and the mechanism needs its own design pass (approved)
- [spec] Mirror identifier SSOT: one writer for export-index human_id, an idempotent migrate-export seam, and a check that cannot self-heal (approved)
- [spec] Governance defaults must ship and every recorded gap must resolve: a shipped-default drift check, one remedy for an unconfigured upstream, and a gap namespace that does not collide with the PRD (approved)
- [spec] Judgment surfaces must verify before they certify: machine-checked finding paths, a mirror-free assess diff, a falsifier that sees its own worktree, and a close gate that asks about reds (approved)
- [knowledge] Five governance-tooling gaps measured while resuming handoff-90: a dispatch gate that cannot resume a worktree, an unreachable unfiltered-anchor requirement, a scoped oracle that rebuilds a shared binary, an AC ceiling that squeezes out rationale, and a judge verdict on a truncated spec (approved)
- [knowledge] Attestation is structurally one-sided: lore verify can attest greens but never reds, and the done-gate's unfiltered-run requirement is unreachable from AC oracles that all carry -t (approved)
- [knowledge] Eight findings from landing four governance specs: a bunx-installed compiler that made me overrule a true record, a designed behaviour I reported as a defect, and six review rounds converging on missing data (approved)
- [knowledge] Seven findings from planning the bootstrap-fixpoint slice: a plan-scoped anchor mutex and its equally blind report, a hook that misnames its own refusal, an asymmetric AC demotion, the self-exempting-oracle pair, and four probes of my own that nearly lied (approved)
- [knowledge] Nine findings from landing the mirror-id-unify merge: two concurrent sessions poisoning one checkout, a suite mutually exclusive with its own corpus, an ordinal reversion loop the merge armed, an AI judge that read a rename backwards, and an exclusivity probe of mine that lied (approved)
- [knowledge] Four governance-tooling gaps measured while resuming handoff-82: a silent pass, an undecomposable count, three unfeedable gates, and the eighth false-oracle vector (approved)
- [spec] Typecheck coverage: two named blind spots, and the stale comments that understate them (approved)
- [knowledge] An attested pass is not evidence of production wiring: three instances of the same AC-design defect in one session, all found after attestation (approved)
- [spec] Governance visibility: an armed gate that vacuously passes lends its authority to everything it waves through (approved)
- [knowledge] Handoff — agent:widen-coverage-derivation (approved)
- [knowledge] Seven of lore's own outputs misled this session — a false plan-close hint over an ungated cascade, a gate shipped without its feeding source, a silent oracle, an empty log from a short-circuited chain, an AC edit that froze all downstream claims three times, an 82% figure off by 20x, and an unanchorable private symbol (approved)
- [spec] Oracle-tier falsifiability: a criterion never observed red is a computed state, plus pipe-refusal and unclaimed-oracle detection (approved)
- [task] deriveAcCoverageState fails open on an absent falsified, so not-measured and observed-red read identically — and the required-field type that was trusted is unenforced in test fixtures (draft)
- [task] One honest historical fail row pins a criterion to state fail forever, because fail-first precedence over an append-only log has no recency notion (draft)
- [knowledge] The anchor set IS the acceptance-unit design, so an omitted call site is an orchestrator defect no implementer can fix — three measured instances in one plan (approved)
- [adr] Falsifiability moves from the task tier to the oracle tier: a criterion never observed red is a distinct computed state, reported not gated (draft)
- [task] De-vacuuming AC-ACQ-7 exposed three sibling faults it was masking: a withdrawn false-positive bound, an identically vacuous AC-ACQ-6, and a drifted verbatim fixture (draft)
- [task] AC-ACQ-7 is vacuous by construction and its oracle never reads the corpus, hiding a 5-of-5 false-positive rate in the shipped quantifiability lint's hyphen-boundary matching (archived)
- [task] MCP lore_create.supersedes still creates-then-fails — the type precheck landed in the CLI command, above the shared flow both surfaces document as the anti-divergence seam (archived)
- [task] 可用性两则：必填参数靠二次报错发现；CLI 参数名与存储字段名不一致 (draft)
- [task] lore review 对大文档截断，approve 结论建立在部分文本上 (draft)
- [task] lore verify 无跨 task 的 attestation 复用：同 HEAD 同命令重复执行 (draft)
- [task] lore assess 仅靠 commit message 匹配关联 task，未利用已声明的 file_anchors (draft)
- [task] lore approve 的 review「独立性」不校验 actor：改→自审→自批可在单 actor 内闭环 (draft)
- [task] lore done 的红先行 gate 不读 capture_source：转录文本即可满足 expected-fail 要求 (draft)
- [spec] SPEC — AC-Quantifiability Gate (design-time standardization enforcement) (draft)
- [task] lore ac add/set 静默把 approved spec 打回 draft，进而阻塞并发批次中后发 task 的 claim (draft)
- [task] lore done 不检查 AC 的最新 attestation 是否 pass —— task 可在 attested-fail 状态下被归档（不可逆） (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] lore status --check-claude-md silently runs on SCHEMA DEFAULTS when the operator's context config fails to parse, so a configured budget is ignored with no message (archived)
- [task] The shared renderDocMarkdown seam still drops structured extra silently, so a feeding pack and a gate DENIAL pack both hide the evidence (archived)
- [knowledge] Module CLAUDE.md snapshot — cli adapter, pre-eviction (frozen 2026-08-06) (approved)
- [task] A module CLAUDE.md at its byte ceiling silently relocates that module's facts into other modules' docs — realized on service/, and three more docs are next (archived)
- [task] Validity landed on lore list only — the DISPATCH surface (feed task-start) still hands out retracted work with no signal, and status counts include retracted docs (archived)
- [knowledge] Load average is the wrong instrument for is-this-red-suite-my-fault: memory pressure fakes a code regression, and a failure COUNT is not a failure identity (approved)
- [knowledge] Module CLAUDE.md snapshot — packages/lore/src/adapters/http (frozen 2026-08-06, pre-eviction) (approved)
- [knowledge] Module CLAUDE.md snapshot — packages/lore/src/ai (frozen 2026-08-06, pre-eviction) (approved)
- [knowledge] Module CLAUDE.md snapshot — packages/lore/src/store (frozen 2026-08-06, pre-eviction) (approved)
- [knowledge] Module CLAUDE.md snapshot — packages/lore/src/service (frozen 2026-08-06, pre-eviction) (approved)
- [knowledge] A newly-armed threshold is calibrated against the agent's base, and a concurrent peer merge invalidates that calibration silently (approved)
- [task] lore ready's records carry no validity signal, so a dispatcher cannot tell no-retracted-tasks from validity-never-consulted (draft)
- [task] Nothing cross-checks a task's file_anchors against the paths its own body names, so the anchor mutex is blind to a collision the task already documented (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] lore done's attestation refusal calls a capture_source:runner row SELF-REPORTED, misdirecting the reader to the wrong field (archived)
- [task] The ac-scope re-keying left the red-first floor unarmed for the shape it created, plus three named residuals from the capture-window slice (archived)
- [knowledge] The substring-matcher lesson has a mirror face: over-matching, and a corpus that documents its own markers is where it fires (approved)
- [task] An invalidated doc is indistinguishable from a live one in lore list (both surfaces) and every --json payload, and --include-invalid is silently inert (archived)
- [task] A mistyped task file_anchor is stored and consulted exactly like a correct one, so the mutual exclusion it declares is silently absent — advisory, never a refusal (archived)
- [task] lore get's default render silently omits structured extra (issue_report), with no marker that it did (archived)
- [knowledge] Retired from root CLAUDE.md — the Implementation Status section, verbatim (draft)
- [knowledge] Retired from root CLAUDE.md — the 19 dogfooding standing lessons, verbatim (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] active_sessions derives only over ACTIVE plans' tasks — with 0 active plans and adhoc tasks parented to the PRD, the field is unconditionally empty, and an orchestrator read that [] as 'nobody is working' before removing a live agent's worktree (archived)
- [task] lore uat record 不校验目标 doc 类型：verdict 挂到 knowledge/adr 上静默成功，plan-close gate 永远读不到 (archived)
- [task] LORE_GATE_BYPASS honored by 'lore gate' subcommands but ignored by the same gate logic embedded in create/set write paths (archived)
- [task] corpus-workflow injection labels 'lore release' as Done and never mentions 'lore done' — 13/13 agents left a plan's readiness inflated at 34/34 (archived)
- [knowledge] A backgrounded command's completion notice reports the shell's exit code, not your oracle's (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] capture_source is optional at the evidence write boundary with a silent self-report default, so a caller that never said is recorded as if it had (archived)
- [task] Plan-member sites twelve and thirteen, both structurally invisible to the new guard: my_claims[].plan_slug and lore list --plan-id (archived)
- [task] A test's green depends on an ambient CLAUDE_CODE_SESSION_ID, so every full-suite verdict on this machine is machine-conditional (archived)
- [knowledge] lore get's human view hides extra.issue_report, so a reporter's measured refutation is invisible to the spec author (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] lore evidence --capture has a hard-coded 600s window that a legitimately-scoped oracle already exceeds, so the disciplined path terminates in a self-report row (archived)
- [task] An ad-hoc task can never reach the attestation path that already ships for it — ac-scope requiredness is keyed on the parent plan's spec, which --adhoc guarantees is absent (archived)
- [adr] A guard does not exist until it runs against the real tree, and a new guard needs a family with >=7 remaining instances (draft)
- [spec] Declaring ac_scope is required at task creation, so the runner-attested evidence path is reachable by construction (draft)
- [task] The tenth plan-member site is a WRITE path: create-time extra.phase validation resolves the plan by parent_id while every phase-scoped read resolves it by membership (archived)
- [task] The eleventh plan-member site, found by enumeration: bootstrap's active-plan task listing and its active_sessions sibling both key on the parent_id proxy (archived)
- [task] PhaseWorkflowService.claim captures no session_id, so every same-actor phase-anchor overlap now hits a fail-safe refusal it can never satisfy (archived)
- [task] A -t filter is a regex, so this repo's own AC titles containing parens or plus silently match zero and exit 0 in the pre-recording window (archived)
- [knowledge] D5 re-scope: 35 open tasks against the named-consumer criterion — 0 blocking, 14 must-fix, 8 onboarding-only, 13 descheduled (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] plan-membership has ten known sites and no enumeration guard: the single-definition test keys on one literal form, leaving arrow-const/inline comparisons and parent_id-keyed plan resolution invisible (archived)
- [task] Three of five static checkers are INERT: no exported main and/or no real-tree assertion, so nothing ever runs them against this checkout (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] Three byte-identical copies of isPlanMember survive because the shared module's own JSDoc records a false module-boundary blocker (archived)
- [task] Two concurrent orchestrators both resolve to agent:main-orchestrator — LORE_ACTOR suppresses the only precedence tier carrying a session discriminator, collapsing SPEC-042 sessions and disabling noAnchorOverlap (archived)
- [task] MCP lore_evidence_add cannot set capture_source and has no --capture equivalent, so an agent using lore through MCP is structurally unable to produce a runner-captured evidence row (archived)
- [task] Two independent copies of 'does this task have a claim' now exist — the service short-circuit made the MCP adapter's hasRecordedTaskClaim redundant, and AC5's redundancy judgement was never made (archived)
- [task] evidence-precheck only sees a cd in the FIRST segment of a command chain, so it falsely refuses this repo's own mandated build-then-cd e2e form and nudges the author toward --oracle manual (archived)
- [task] A ninth plan-member query hides in the one-shot task→phase migration, where a dropped member cannot be recovered by a second run — plus one comment this sweep made stale and one orthogonal parent_id dependence to settle (archived)
- [task] The MCP refusal omits the derived cd target the CLI now names, and --oracle manual remains an unmarked self-selected opt-out from every precheck (draft)
- [knowledge] The global lore is a symlink into the main checkout's dist: rebuilding hot-swaps the CLI under live agents, and not rebuilding leaves every CLI fix inert (approved)
- [knowledge] A handoff KD that counts un-persisted artifacts loses them; and a wrong --json path makes a successful write look failed, so the retry duplicates it (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] AC statement drift is deterministically detectable: an unchanged statement whose -t-matched tests were all retitled keeps the oracle green while the statement is false (draft)
- [task] A non-empty output_tail can be hand-authored prose, and the red-first archive floor is opt-in — the record's form is satisfied while its evidentiary content is absent (archived)
- [spec] Evidence output_tail integrity: a self-reported row must carry captured output (non-pass since 2026-08-01, pass since 2026-08-03), and a runner tail must witness the criterion it is filed under (approved)
- [task] Eight more plan-member queries still key on parent_id instead of extra.plan_id — two of them gate task-claim and drive plan-close archival, so the membership error changes writes, not just displays (archived)
- [task] AC-ETI-7 proves the tail-window helper but not its invocation: the three-hop acRef forwarding is typecheck-only, so a regression that stopped forwarding would leave every AC-ETI-7 row green (archived)
- [task] The uncommitted-worktree guard treats 'no claim at all' as 'a claim that recorded no worktree', so every orchestrator post-merge evidence call from a main checkout is falsely refused with a message about a claim that does not exist (archived)
- [task] computeScopeMismatchWarning cannot distinguish a too-wide range from tests never being declared anchors — it false-positives on every plan whose tasks ship tests, and exempts the anchor-less plans most likely to be wrong (archived)
- [task] lore_evidence_add and lore_release over MCP get no callerCwd, so the uncommitted-worktree guard is silently absent on the surface AI agents actually use — the second optional-param-hides-an-unwired-adapter instance this session (archived)
- [knowledge] vitest silently drops a nonexistent path and reports a large green test count; lore evidence's oracle-file precheck caught it against the orchestrator itself (approved)
- [task] Plan membership is extra.plan_id but the last-task advisory and lore ready both query parent_id — a diverged member fires the advisory early and is attributed to the wrong plan (archived)
- [task] The MCP assess adapter still calls deriveCommitSetForPlan with the old 2-arg shape, so the convention-mismatch suppression the CLI just gained is silently absent for every MCP caller (archived)
- [task] lore evidence and lore release accept an attestation from a worktree whose declared anchors are uncommitted — the corpus records a verified, unclaimed task backed by no commit (archived)
- [task] The session-start marker collapses five distinct conditions into one undefined, so the new same-session check can be entirely inert on any install that has not re-run lore setup — and nothing anywhere says so (archived)
- [task] getAssessTemplateReproducibility has zero production callers: the reproducible field is defined, schema'd and rendered but never stamped, so every real assess run leaves it absent and the reader still sees nothing (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Handoff — agent:main-orchestrator-82242b77 (approved)
- [task] Short-id rendering truncates ULIDs to 8 chars — a 1024ms window collapses to one printed id, across 9 sites with no shared formatter (archived)
- [knowledge] Three signals said a peer's worktree was safe to remove; two could not have said otherwise, and the one that answered correctly was git reflog (approved)
- [task] session-start-freshness BOUNDARY cases assert a wall-clock budget for an ORDERING invariant: 116ms and 133ms red under full-suite load, 13/13 green alone (archived)
- [task] provenance-writes-io-error's four cases inject I/O faults by unlinking an open SQLite file — a POSIX no-op, so the suite carries a 1-in-3 false RED (archived)
- [knowledge] A conjunction detector over acceptance criteria is anti-correlated with this codebase's own false-oracle discipline — measured 80.1% fire, 50% precision, do not promote (approved)
- [knowledge] The --adhoc flag severs plan membership, and every governance predicate keyed on plan membership silently goes inert — the ad-hoc attestation path already ships (approved)
- [task] Settle the v5 registry policy: slot 5 is slot-frozen but output-unfrozen by explicit policy, and a stamped prompt_version 5 therefore does not reproduce (archived)
- [task] Verifying a handoff you just authored arms the coverage floor against the writing session, charging it with the next steps it is explicitly handing off (archived)
- [task] lore assess derives a plan's commits by grepping task slugs out of commit messages, a convention nothing enforces — a conventionally-worded commit yields zero, and the resulting diff_available=false manufactures a false major finding (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] main is RED: a fourth SelectionReason was added to the producer while a consumer hard-codes the three-value vocabulary in a regex (archived)
- [knowledge] Arming the attested-pass floor: the gate refused its own task, and the retroactive count was 2 not 3 (approved)
- [task] lore done accepts an unattested self-reported pass as sufficient to archive: gate the terminal transition on attestation, with one audited escape (archived)
- [task] test:changed's fourth invisible edge: a tree-scanning oracle test judges files it never imports, so the test that guards test-budget debt is never selected by the change that creates it (archived)
- [task] lore handoff reports Modified Files (none) while four dispatched worktrees hold uncommitted work — the ticket is authored mid-flight and records nothing about the flight (draft)
- [task] vitest run silently drops a .bun.test.ts named alongside a valid file — exit 0 on a partial run; the loud 'no test files found' guard is defeated by a quorum of one (archived)
- [task] The judge truncation notice says content was cut but never which sections — section ORDER decided a verdict, and manual reordering is the only remedy (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [adr] Lore's mechanisms validate a proxy for the property, not the property, and fail silent — three questions every new deterministic mechanism must answer (approved)
- [adr] lore done requires a runner-attested pass: the sixth false-oracle face closes on the read side, not on lore evidence (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] AC-ACS-1 and AC-ACS-9 are still compound after the split — the predecessor task's Scope defined a half that was itself a conjunction, contradicting its own acceptance criterion (archived)
- [spec] lore ac set — in-place edit of a declared acceptance criterion, under prose-edit demotion governance (approved)
- [task] A stale untracked dashboard-assets.ts breaks every subsequent build with an error naming neither the cause nor the remedy (archived)
- [task] Resume-coverage disposition parser: an unrecognised token on a KNOWN item id is reported as an unmentioned item, and done rejects the trailing reason that deferred accepts (archived)
- [task] A task cannot be retracted: --supersedes emits a repair command that structurally cannot work, and a draft task has no deprecation path visible to list/ready/search (archived)
- [task] lore evidence --ac accepts an AC ref on an ad-hoc task that has no governing spec — unresolvable at write time, permanent by append-only (draft)
- [task] Two more evidence consumers erase an expected-fail row: doc-type-meta counts it as neither pass nor fail, and the dashboard adjudication bar reports status=none (archived)
- [task] check-ac-ref-integrity re-implements governing-spec resolution and its private copy is narrower than the write path — every ad-hoc task with AC-scoped evidence is falsely reported dangling (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] test:changed selects nothing for any scripts/ change and still exits 0 — the prescribed worktree oracle measured a 350-line slice zero times (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [spec] lore assess — AI plan-outcome assessment (LLM-as-judge feedback loop) (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Six-agent wave against the evidence/assess layer: the judge missed the real defect for the second consecutive session, three of six agents attested work they had not committed, and my own AC's premise was unsatisfiable (approved)
- [task] Discharge D7 in code: the forced-contention control cannot exclude a startup-phase refusal (false RED), and the readable-run floor is set to the sample size AC-IC-1 rejects (archived)
- [spec] lore assess: project evidence rows instead of embedding the task body, and never author an absence finding against content the judge could not read (approved)
- [task] Every AC oracle is -t-scoped, so 'the file passes' is attested nowhere — require an attested unfiltered run per touched test file (archived)
- [spec] AI-surface robustness: assess timeout floor, partial-provider fail-loud, judge grounding downgrades (approved)
- [task] lore ready renders an expected-fail evidence row as a green ✔ — a deliberate RED reads as verified (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] lore assess --diff spawnSync sets no maxBuffer: a diff over 1 MiB exits 2 blaming git for this call sites own ceiling (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] main is RED on check-test-budgets: 8 new spawn-heavy assess test cases landed with no declared timeout, escaping through the scripts/ selector blind spot that was fixed hours later (archived)
- [knowledge] Merge-verify must read the diff's SHAPE, not just re-run the oracles: two defects shipped past a fully green oracle set, and a selector's UNIVERSE is part of its contract (approved)
- [task] Literal NUL bytes in two scripts source files: one is already unreviewable-binary to git, the other is a latent bomb past the 8000-byte sniff window (archived)
- [task] Red-first discipline is asked for in prose but never recorded: require a result=fail evidence row from any task claiming it (archived)
- [task] lore assess asks the caller for a git range that cannot be correct under concurrency — derive the plan's own commit set instead (archived)
- [task] test:changed's file universe is packages/** not the repo: the whole scripts/ tier is invisible even to rule (a), changed-test-file selection (archived)
- [task] Split the compound AC-ACS-1 / AC-ACS-4 into one assertion per oracle, running the new halves' oracles in the same slice (archived)
- [task] Key test-budget ledger rows on a test-title fingerprint, not (path,line): three unrelated insertions broke it in 24h (archived)
- [task] check-ac-ref-integrity prints an exemption COUNT, not its justification — echo each applied exemption's version citation and merged/lost verdict (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [task] test:changed cannot see the whole integration-CLI tier: the binary-consumer escape hatch matches only .bun.test.ts spawning dist/lore, never a vitest test spawning the entry source (archived)
- [adr] Judge flakiness: keep D5 unchanged — explicit human dismissal already ships as --override-judgment, and an N-consecutive-escalate threshold would reward re-rolls (draft)
- [task] SPEC-050 does not carry the g1 help-guard rule (it lives only in hook comments), and knowledge 01KY95H6 is now partly superseded — record per-finding status, do not invalidate (draft)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [spec] Resume-coverage floor — the satisfaction boundaries: a deferral must carry its reason, and a sidechain chain cannot discharge (approved)
- [knowledge] An LLM judge returned escalate and approve on the identical document version, and D5 turns either outcome into a hard approval block (approved)
- [task] The approved-to-draft demotion rule is mirrored in ac-service.ts instead of shared — extract it to @lore/core beside VALID_TRANSITIONS (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [adr] The coverage floor's MCP arming compares the tool name's LAST segment deliberately — a full-name match would silently disarm alias-registered consumers (approved)
- [task] g1 spec-create gate denies 'lore create spec --help' with PARENT_REQUIRED — a read-only introspection command cannot violate a create predicate (archived)
- [task] verifyAdhocTask stamps ac_ref on its runner-attested evidence: retire the last shape difference between the ad-hoc and plan-owned verify channels (archived)
- [task] Sweep the CLAUDE.md standing-lessons layer against the mechanized-eviction rule, naming the enforcing mechanism for every line removed (archived)
- [knowledge] Mechanized-eviction sweep of the CLAUDE.md standing-lessons layer: 4 evicted with demonstrated mechanisms, 15 kept as measured-unmechanized, 967 bytes freed (draft)
- [knowledge] Three of four remaining assess gaps were bundle-visibility artifacts, not defects: the diff was never passed, the ledger was never shown, the counter was monotonic by construction (approved)
- [spec] Execution-time attestation floor + ad-hoc task channel (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [spec] A test case's timeout budget must be declared when its spawn count makes the default unsafe: a structural oracle instead of a bigger number (approved)
- [task] An ad-hoc task's attested evidence cannot carry ac_ref: appendEvidenceEntry resolves declared AC ids through parent_id, which is structurally a PRD for --adhoc tasks (archived)
- [knowledge] A shared checkout makes a full-suite verdict unmeasurable: start-clean is not throughout-clean (approved)
- [knowledge] An SSOT-to-installed parity check is unfalsifiable when the installed path is a symlink into the SSOT — the prescribed distribution oracle is inert on this machine (approved)
- [task] AdjudicationBar's compact status chip still derives from meets_floor alone — the same gate/UI disagreement just fixed in PlanAttestationPanel, one surface over (archived)
- [task] IC spec: discharge the startup-write contention gap AC-IC-1/AC-IC-2 leave open, and enumerate the classifier decision table (draft)
- [adr] A CLAUDE.md standing lesson is evicted when a deterministic mechanism enforces it, never by age or by arrival order (approved)
- [spec] Resume-ticket coverage floor — blocking channel, arming provenance, cross-turn idempotence (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] File-level anchor mutex does not prevent one agent's DATA from referencing another agent's file: a (path,line) ledger broke on a pure insertion, surfacing as orphaned-row AND new-debt at once (approved)
- [task] lore evidence's oracle-file precheck resolves against the main checkout, so a worktree implementer's brand-new test file reads as missing (archived)
- [task] The ad-hoc task channel has no attested-evidence path: lore verify requires a plan, so every --adhoc task is self-report-only by construction (archived)
- [task] meets_floor renders pass while the declared-scope conjunct blocks — surface it in the projection and panel (archived)
- [knowledge] Recovering attestation on an already-archived plan: the --task + explicit --ac escape is the sanctioned path, a plan-wide verify run is the catalogued false pass (draft)
- [knowledge] git branch --merged lists every worktree branch that has not started work yet — cleaning by that list deletes live agents workspaces (approved)
- [knowledge] vitest -t with a non-matching pattern exits 0 having run nothing: the sixth false-oracle vector, and it is NOT the loud path-filter case (approved)
- [task] archive-sweep gate-disable is silently inert — a wholesale config overwrite drops the required project block (archived)
- [task] lore status --check-claude-md reports a saturated file as healthy: 5 bytes of headroom prints as 'within budget (0 findings)', so the standing-lessons layer is silently closed (archived)
- [task] Land the baseline+ledger policy for check:test-budgets (55 pre-existing violations currently gate nothing) (archived)
- [spec] Declared-scope attestation contract: task-owned ac_scope, intersection by default, loud refusal on unknown scope (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] grep in the agent shell is ugrep --ignore-files and its blind spot does not match git check-ignore: a zero-hit result proves nothing (approved)
- [task] ESCALATED (recommended 2026-07-24, still unbuilt): attestation_exempt is a gate-read field with no writer verb (archived)
- [knowledge] 2>&1 | jq is >/dev/null wearing a parser: asking for --json does not license discarding lore's advisory stream (approved)
- [knowledge] A control that shares the load with the observation is not a control: an A/B at base reproduced a contention artifact and read as 'pre-existing' (approved)
- [knowledge] Four assessments converged on a missing capability that shipped — the gap was the dispatch bundle, not the tool (approved)
- [task] lore evidence must refuse a -t-filtered pass with no matched-count proof (the self-report path has no completeness guard) (archived)
- [task] plan-close must block when the coverage conjunct is scope-undeclared AND tasks carry evidence (a fully-inapplicable gate exits 0 today) (archived)
- [spec] An escalate blocks approval for every doc type, and the denial names the questions (approved)
- [task] openValidatedUpstream lets a synchronous store-init throw escape the write-contention re-typing (archived)
- [task] The concurrency exclusion classifier excuses governed-path throws (false-GREEN vector) (archived)
- [spec] Superseded-handoff archival has no recency guard (approved)
- [adr] Answers to the three blocking questions on the 2026-07-28 product-direction grill (approved)
- [adr] An escalate gates every doc type; a reject stays scoped to spec and adr (approved)
- [adr] A gate premised on the agent's judgment being untrustworthy must have NO agent-settable override (approved)
- [spec] plan-close predicates measure invariants: an applicability verdict in the type, per-claimed-AC attested coverage, and attributable domain-doc sync (approved)
- [knowledge] Handoff supersession keys on (plan, actor) — concurrent sessions sharing an actor archive each other's live tickets (approved)
- [knowledge] Session process review — 2026-07-31 ten-agent two-wave run: 7/7 deterministic clean, four plans closed through a self-disabled gate (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Ten-agent two-wave run: self-reported evidence, predictable anchor gaps, and foreign-red attribution (approved)
- [task] SPEC-FIRST: require --ac-scope at task creation so the runner-attested evidence path stays reachable (draft)
- [task] AC-LL-8 guards the loader strip, not the no-sync-bearing-createApp-call-site invariant (archived)
- [knowledge] Handoff — agent:main-orchestrator (approved)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [spec] Eager libsql load makes every command depend on a healthy TMPDIR (approved)
- [knowledge] Measured: rmSync unlinks a symlink it is pointed at, while statSync selects on the target's mtime (approved)
- [knowledge] An ungated approve is not a mechanized approve — a judge's escalate can be filed away, blocking questions and all (approved)
- [adr] A newly-armed structural oracle enforces from a baseline and carries an auditable exemption ledger, never a tree-wide green (approved)
- [task] Fix the SPEC-072 cross-corpus database-is-locked race exposed by the libsql lazy-load speedup (archived)
- [knowledge] Retro: eight approving review rounds cannot catch an error the author and reviewer both read from the same drifted doc (approved)
- [spec] ADR decision_status has a create surface and no CLI update surface: a value-restricted affirmative writer for proposed to accepted (approved)
- [spec] git-safety-gate probes report the wrong blast radius — argument-blind probes (approved)
- [knowledge] Grill review 2026-07-28 — seven product-direction decisions from evidence-first self-review (approved)
- [knowledge] turn-state.mjs resolveSessionId reads CLAUDE_SESSION_ID, but this harness provides CLAUDE_CODE_SESSION_ID — 73 of 73 state dirs are ppid-named (approved)
- [spec] lore setup deletes repo source through dev symlinks — removal must never resolve through a link (approved)
- [knowledge] A zero-match vitest -t title filter exits 0 — the sixth false-oracle face (approved)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [task] Ship the dispatch-isolation gate + wire stop-handoff-coverage in this repo (archived)
- [task] Fix lore setup removal reaching through dev symlinks (D1-D4, D6) (archived)
- [spec] Dispatch isolation must be enforced by a gate, and isolation does not imply a correct base (approved)
- [knowledge] Retro: a FRESH-install probe vacuously passes convergence-shaped defects (setup removal) (approved)
- [adr] lore verify's attested-evidence scope belongs to the task that declares it: default to declared-scope intersection, refuse an unknown scope, and demote the per-task attested floor to a reported fact (draft)
- [spec] Resume-ticket coverage: a shipped upper bound left the lower bound unrepresented (approved)
- [knowledge] Re-measuring finding 1 falsified its cause: lore verify --ac works, and the real defect is a plan-wide default write-scope over an evidence-derived claimed set (approved)
- [knowledge] Eight findings from building and closing the plan-close-invariants slice: an inert --ac flag, an unwritable decision_status, evidence with no commit provenance, and a dev symlink that swapped the CLI's build (approved)
- [knowledge] lore setup follows a dev symlink into assets/ and deletes the repo SSOT, then aborts mid-run while --check reports in sync (approved)
- [adr] plan-close predicates must measure invariants, not proxies: default to per-claimed-AC attested coverage instead of an evidence ratio, and qualify the domain-doc window with relatedness (approved)
- [task] 缺第五个 gate：dispatch-time（派 subagent 实施前无 claimed task）——四个 gate 全在 corpus 写入路径上，绕过 corpus 的工作零阻力 (draft)
- [knowledge] Root-cause synthesis: the eight dogfooding findings are one defect eight times — a proxy substituted for an invariant, with the delta unrepresented (approved)
- [task] Fix ordering regression: placeholder-command guard preempts the doc-type error (archived)
- [task] Mechanical oracle for the single-read-site invariant on feedback.upstream (archived)
- [knowledge] Four dogfooding findings: gates validate a spec against itself not the spec it claims to extend; ACs are immovable once evidenced; test:changed default base is wrong on feature branches; git log alone misses a stranded task (approved)
- [spec] Context provenance: injected corpus-global state and a pasted resume ticket must each declare their own scope (approved)
- [spec] Issue closure loop — computed resolution + agent-reachable visibility (approved)
- [knowledge] Retro — three mechanism gaps found while building the issue-closure loop: lore done's type-keyed evidence guard, --help reaching a gate, and anchors never reconciled against the diff (approved)
- [task] No init/setup path provisions feedback.upstream — lore report-issue fails out-of-box on every fresh corpus and demands hand-edited YAML (archived)
- [knowledge] Retro — a green AC over a store-free layer let a schema change ship dead: we reproduced the consumer-reported integration-reachability defect while fixing issues (approved)
- [spec] Upstream Issue Feedback Loop (consumer-reported defects → corpus) (domain overview) (approved)
- [task] Reject placeholder command strings at evidence WRITE time (read path must stay tolerant) (archived)
- [task] lore 全局纪律缺一条：「绝不屏蔽 lore 自身输出」应进 governance corpus-workflow 资产（原建议的 hook 方案已作废） (draft)
- [knowledge] Retro — plan-close's recovery text is not executable: omitted exempt_kind, and a merge instruction that collides with dedicated writers (approved)
- [spec] Dashboard production packaging — one-command lore dashboard (F5a) (approved)
- [task] Task-scoped oracles cannot verify integration reachability: an AC passes green while its deliverable is dead code (draft)
- [task] No gate arms the doc-code drift oracle: a spec whose implementation merged with zero code_anchors passes every existing gate (draft)
- [task] evidence --ac gate only validates against the plan's direct governing spec, breaking AC traceability across an implements chain (draft)
- [spec] Provenance (domain overview) (approved)
- [spec] Phase Execution Model (plan → phase → checklist; supersedes fine-grained task pre-decomposition) (domain overview) (approved)
- [spec] Plan closure must be loud — terminality divergence, silent demotion, absence-as-assertion (approved)
- [spec] Assessment freshness — plan-close denies a stale assessment (approved)
- [spec] Dashboard Console (adjudication cockpit re-centered; admin-console breadth admission-gated) (domain overview) (approved)
- [spec] Tiered review — ledger fast-track, judgment-required promote, pending-as-promises (approved)
- [spec] Trace layer — read/deny observability table, default-on, with lore trace stats (approved)
- [knowledge] Product chain round two: worked examples, decomposition layer, interview instrument, anchored scoring (approved)
- [adr] Product skill chain: derive features via OST, execute graded validation, benchmark-first (draft)
- [spec] Worktree-derived actor identity — agent:<branch> as deterministic default (approved)
- [task] Design: setup must be a brownfield-aware, completeness-guaranteed onboarding orchestrator (skill-driven), not a silent file-copying CLI step (draft)
- [task] spec-create gate's missing-rule-doc remediation points to a lore dev-repo script (bun scripts/seed-write-spec-rule.ts) that consumers do not have (draft)
- [task] lore init does not seed the verification-profiles config template despite SPEC-058 D6 documenting verbatim seeding on fresh corpora (draft)
- [task] Multi-root corpus incoherence: data model allows unlimited parentless PRDs but bare 'lore tree' renders a single root and root-PRD inference picks an arbitrary PRD (draft)
- [knowledge] Full-system spec compliance audit 2026-07-27 — 85/11/1 verdicts, remediation dispatch, open decisions (draft)
- [spec] Verify reachability — plan-promote early warning, reachability-aware attestation feeding pack, exemption kind taxonomy (approved)
- [plan] Audit remediation 2026-07-27 — parent-cycle write guard, MDX unknown-component strip, actor-identity guard (archived)
- [spec] Workflow hardening — evidence red vocabulary, claim worktree validation, task done verb, worktree corpus resolution (approved)
- [spec] Claim-time actor-identity guard + zero-evidence release advisory (approved)
- [knowledge] Session process review — 2026-07-27 context-refresh incident → CTX Phase 4 hardening (draft)
- [knowledge] Stale in-context snapshot replayed as current state in a cross-plan report — timeless-context bias, mechanized at reporter layer (draft)
- [adr] Distribution-first: every improvement names its consumer-delivery surface before it counts as landed (draft)
- [task] CLI gap: no safe update path for adr extra.decision_status — add lore set --decision-status (draft)
- [knowledge] Context verb family autopilot run — verify task-scoping semantics, legacy-shape upgrade paths, TDD-paired worktree dispatch (draft)
- [adr] CLAUDE.md Specs section is pointer-only — per-spec index lines retired to the corpus (approved)
- [adr] Context capability is a first-class lore verb family — init-context skill retired, CLAUDE.md becomes two-zone (approved)
- [spec] Distribution & Adoption (phased, spike-gated one-step install) (domain overview) (approved)
- [task] Dogfood pin: root CLAUDE.md must carry the claude-md-contract pointer line (draft)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [knowledge] Handoff — agent:main-orchestrator (archived)
- [task] lore setup MCP-add step is non-idempotent — 'already exists' exits 1 and fails the whole converge (archived)
- [task] [Skill:implement] ordinal-aware provenance composite — insertWithAllocatedOrdinalAndProvenance closes BUG-002 window on numbered creates (archived)
- [task] [Skill:docs] restate SPEC-084 plan Invariant 2 as three sanctioned ordinal-write sites + mechanize the grep oracle (archived)
- [spec] Corpus-allocated ordinal identity: store-atomic SPEC/ADR numbering, prose titles, repair migration (approved)
- [knowledge] Converge governance prose distribution: retire the machine-level corpus-workflow.md file in favor of runtime injection from the binary (approved)
- [knowledge] Retro — CLAUDE.md spec-index re-bloat: boundary-ADR drift recurred within 4 days (52.8KB), compressed + entry contract added (approved)
- [knowledge] CLAUDE.md Specs-section as-built narratives — frozen 2026-07-26 snapshot (pre-compression) (approved)
- [task] Mechanize CLAUDE.md byte-budget check in pre-push (twice-proven re-bloat, ingress-agnostic oracle) (archived)
- [spec] Lifecycle archival — plan-close cascade, deterministic archive sweep, injected candidate surfacing (approved)
- [spec] Session-start handoff neutrality — injection drops resume_hint, neutral open-thread directory (approved)
- [spec] Output Contract & Document Taxonomy (domain overview) (approved)
- [knowledge] Triple SPEC-080 numbering collision across concurrent sessions (2026-07-26) (approved)
- [spec] Dashboard hardening: write-path integrity, delete/restore, component test coverage (approved)
- [spec] Assess input transparency: pre-flight diff budgeting + file-boundary truncation (approved)
- [spec] Assess reliability: reasoning-length resilience + surface-correct error hints (approved)
- [spec] Hermetic judge sessions + fail-loud AI config (approved)
- [spec] Dashboard read-path contract fixes + markdown typography (approved)
- [spec] Output-contract mechanization (spec_kind + tree blueprint + text-projection splice) (approved)
- [spec] Structured review judgment + triage queue (approved)
- [spec] Audit trail + calibration data (approved)
- [spec] Dashboard as living-PRD projection + human adjudication surface (approved)
- [spec] Dashboard browsing UX: breadcrumb + tag/status filters + type-differentiated presentation (approved)
- [spec] Dashboard execution-tracking surface: readiness route + plan progress + evidence viewer (approved)
- [spec] Trusted runner: attested evidence for script-mode ACs (approved)
- [spec] Assessment dimension framework v2: facts/judgment split + typed findings (approved)
- [spec] Session layer part 1: bootstrap pointer-set + lossless handoff (S1+S2) (approved)
- [spec] Session layer part 2: session registry + file-anchor claim safety (S3) (approved)
- [spec] Memory hygiene part 1: bi-temporal invalidation (H1) (approved)
- [spec] Memory hygiene part 2: staleness probes (H2) (approved)
- [spec] Distribution part 1: asset SSOT + local safe installer (P0+P1) (approved)
- [spec] Session seat auto-briefing: worktree-aware SessionStart injection (approved)
- [spec] Distribution part 2: npm single-platform publish + TTY postinstall (P2) (approved)
- [spec] Gate denials carry the feeding pack (GateEnforcer error enrichment) (approved)
- [spec] Gate hooks cross-corpus false-deny fix (cd-prefix TARGET_CWD + g1 lookup-anomaly fail-open) (approved)
- [spec] CLI strict flags: unknown-flag rejection + actor-flag unification (approved)
- [spec] AI-advisory AC-vagueness supplement on lore review <spec> (approved)
- [spec] UAT-verdict-as-plan-close-gate (approved)
- [spec] Requirement→AC completeness oracle (approved)
- [spec] Phase execution model: phase doc type, computed completion, checklist/track, migration (approved)
- [spec] Two-tier worktree seat model: lore seat verb + seat-aware resume (approved)
- [spec] Verification profiles: per-spec_kind oracle-coverage floors (approved)
- [spec] Requirement-layer quantifiability lint (close SPEC-052 upstream blind spot) (approved)
- [spec] lore setup --project scaffold completion + repo-level install ledger (approved)
- [spec] Config write layer: ConfigService, HTTP surface, and the edit-safety model (approved)
- [spec] Verify execution-root correctness under linked worktrees (approved)
- [spec] Dashboard Settings UI: two-scope config editing with precedence and blast-radius disclosure (approved)
- [spec] CLI ergonomics: unique ID-prefix resolution + single-pass create-task validation (approved)
- [spec] git-safety-gate heredoc/string-literal awareness (command-position discipline) (approved)
- [spec] Execution liveness signals: session actor tier, evidence claim renewal, plan last-activity (approved)
- [spec] Deterministic task dispatch bundle: lore feed task-start (approved)
- [spec] report-issue trigger surfaces: error-path hints + vendored discipline stanza (approved)
- [spec] dashboard Issues triage surface: badge, list, in-place adjudication (approved)
- [spec] Dashboard adjudication workbench + route telemetry (PRD §21 F1+F2) (approved)
- [spec] Distribution integration model + asset update convergence (approved)
- [spec] Dashboard execution read surface (PRD §21 F3) (approved)
- [spec] Dashboard multi-project: mount registry, machine-scope auth, project-addressed routing (PRD §22) (approved)
- [spec] Audit hardening: link provenance + actor fidelity + tamper-evident hash chain (approved)
- [spec] Bootstrap injection projection: tier-1/tier-2 payload split (approved)
- [spec] PRD-as-outline contract: structured outline, domain-overview kind, plan-close sync predicate, budget oracle (approved)
- [spec] Audit hardening part 2: gate-skip observability + push-time chain verification (approved)
- [spec] Governance prose runtime injection: retire the installed corpus-workflow.md (approved)
- [spec] Seat-briefing runtime injection: retire the installed seat-briefing.md (approved)
- [task] Backend attribution and phase projection — cookie-write author via resolveActor; planPhaseStatus projects declared phases (archived)
- [task] Dashboard frontend UX pair — NewDocModal searchable parent picker; review queues include in-review ahead of drafts (archived)
- [task] SPEC-069 adhoc tasks are unclaimable: task-claim gate crashes walking a prd parent (archived)
- [task] Dashboard UI/UX dogfood fix batch — light-prose contrast, home responsive, PendingPanel overlap, chip a11y, NewDocModal default, count invalidation, phase empty-state copy (archived)
- [task] attestation-floor feeding pack names tasks but the exemption mechanism is plan-level — pack should state the plan-level repair (extra.attestation_exempt on the PLAN) instead of per-task listing that misleads into writing dead task-level fields (archived)
- [task] spec-promote base >=1-AC rule is spec_kind-agnostic — SPEC-080 C2's 'domain-overview needs no ACs' is unimplementable; make the AC floor profile-aware or codify the parity-AC pattern (archived)
- [task] Dashboard declared-phase rendering — mirror server PhaseScorecard type, render source:declared entries in PhaseProgressPanel (archived)
- [task] lore pending does not filter invalidated docs — an invalidated draft (assessment -2 duplicate) is stuck in the review queue forever; SPEC-043 list-surface filtering should apply (or rejected+invalidated drafts need an exit path from pending) (archived)
- [task] lore evidence self-reported pass lacks oracle-file-existence precondition — a test-oracle pass whose command matched zero files records cleanly (AC-080-3 incident: oracle file absent through two verify rounds while a manual pass stood in) (archived)
- [task] lore gate spec-promote CLI pre-flight is not spec_kind-aware — reports default floor-1 denial for domain-overview specs whose service-layer promote now passes (CLI/service parity gap widened by profile-aware min_acs fix) (archived)
- [task] MCP lore_evidence_add bypasses the oracle-file-existence precheck — routes directly to TaskWorkflowService.addEvidence, so an MCP-originated self-reported test/e2e pass citing a missing file records cleanly (CLI is gated since e6aa451) (archived)
- [task] Reconcile SPEC-080 citations in session.ts/config.ts comments after SPEC-084 renumbering — buildBootstrapInjection/config budgets cite 'SPEC-080 §Projection Contract/D1-D8' which belong to the bootstrap-injection spec, not PRD-as-outline (triple numbering collision) (archived)
- [knowledge] Orchestrator false-completion anti-pattern: inherited next-steps treated as work boundary, turn-end treated as session-end, self-filed blocked labels never re-derived (approved)
- [task] Arm SPEC-080 Phase 3 after 2 observed clean plan-closes — flip --check-prd-budget advisory to exit-3 in pre-push AND enable plan-close prd_sync knob; include I5 oracle (plain lore status byte-identity pre/post while disarmed) as arming precondition (archived)
- [knowledge] SPEC-080 triple numbering collision — resolution protocol + gate mechanization candidate (approved)
- [adr] CLAUDE.md carries only standing discipline — histories archive to docs/claude-md-archive + lore corpus (approved)
- [adr] NewDocModal spec-create: CLI/skill-only authoring (disable + explain, not template or content field) (approved)
- [adr] Dashboard cookie-session writes attribute author via resolveActor chain, never literal system (approved)
- [adr] planPhaseStatus projects declared extra.phases alongside SPEC-056 phase docs (approved)
- [adr] Dashboard review queues include in-review docs ahead of drafts (approved)
- [knowledge] Ideation — Dashboard capability expansion (6-role brainstorm, 2026-07-24) (approved)
- [knowledge] Dogfood — dashboard UI/UX review 2026-07-26 (10 findings, fix batch + 4 deferred decisions) (approved)
- [spec] Extension Hooks System (direction pointer only — no commitment) (domain overview) (approved)
- [spec] Dashboard Multi-Project (single-instance switcher over the machine's registered corpora) (domain overview) (approved)
- [spec] Memory Hygiene (knowledge trustworthiness over time) (domain overview) (approved)
- [task] Create-time orphan advisory: warn (or default-parent to root PRD) when adr/plan/knowledge is created parentless while a root PRD exists (archived)
- [task] Search snippets render bigram-expanded shadow text (同步 步更 更新…) — collapse overlapping bigrams back to original prose in snippet output (archived)
- [task] lore dashboard leaks the Vite child on SIGTERM — only SIGINT is handled, orphaned vite keeps the port and breaks the next run's origin allowlist (archived)
- [task] Dashboard bootstrap Origin allowlist hardcodes port 5173 — any non-default Vite port (auto-increment or --dashboard-port) gets 403 and a fully unauthenticated dashboard (archived)
- [task] FTS5 CJK search returns zero hits — unicode61 tokenizes contiguous CJK runs as single tokens, so any substring query misses (Chinese corpora effectively unsearchable) (archived)
- [task] Gate hook denies the WHOLE chained Bash command when any segment matches a trigger — feeding pack masks that earlier segments never ran (archived)
- [task] Multi-project nav links drop the /p/:name prefix — clicking any nav item under /p/guyin silently switches the user back to the default project (archived)
- [spec] CLI Adapter (approved)
- [task] Stabilize deleted-corpus-liveness.bun.test.ts (2 recorded load-dependent failures) or adopt dispatch watchdog (archived)
- [task] XDG semantics: resolveGlobalConfigPath falls through to ~/.config when XDG_CONFIG_HOME is set (test-env leak of real machine config) (archived)
- [task] SPEC-076 assess follow-ups: classifyEntry no-manifest-entry edge, prune substring match, markerRewrites contract (archived)
- [task] gate feeding pack recovery via lore_set extra wholesale-wipes plan.extra.phases (archived)
- [task] Fix Result-contract gap: BEGIN IMMEDIATE issued outside try/catch in SQLiteStore insertWithProvenance/updateWithProvenance (archived)
- [task] Tree-check contract vs SPEC-069 adhoc channel: task-under-prd flagged misplaced by design (archived)
- [task] Register eslint react-hooks plugin in dashboard flat config (4 pre-existing rule-not-found errors) (archived)
- [task] Fix SPEC-077 T2 client shape drift: PhaseScorecard client types vs real /api/phase-status response (PhaseProgressPanel render TypeError blanks /execution) (archived)
- [task] Fix live SPEC-042 regression: apiGetReady types /api/ready as flat ReadyRecord[] but server returns ReadyReport object (home-page render TypeError) (archived)
- [task] Decide + implement NewDocModal gated-type authoring (spec creation via dashboard modal is structurally gate-rejected) (archived)
- [task] Fix SPEC-061 miss: vitest -t zero-matched-case run recorded completeness=complete (false-oracle vector) (archived)
- [task] Fix SPEC-069 gap: adhoc task claim structurally impossible (claim gate PRD-parent vs getPlanBundle) (archived)
- [task] Fix pre-existing dashboard e2e regression: browse-ux spec-seed blocked by spec-create gate, review-loop home render (archived)
- [knowledge] Retro — 2026-07-20 whole-repo static bug audit + fix sweep (15 findings, all fixed) (approved)
- [knowledge] Session process review — 2026-07-20 lore self-audit + fix sweep + skill authoring (approved)
- [knowledge] Session process review — 2026-07-21 setup-scaffold + config-layer + verify-trust fixes (approved)
- [knowledge] Non-force git worktree remove needs no hook guard — git is already the gate (approved)
- [knowledge] Retro — SPEC-071 built under live multi-session concurrency: number race, stale-binary guard vindication, dual-suite contention (approved)
- [spec] Version snapshots capture slug values (SPEC-068 D5 follow-up) (approved)
- [spec] Strict-flag hardening: single-dash multi-char tokens fail loud (SPEC-051 follow-up) (approved)
- [knowledge] Full-suite oracle contention + orphaned-browser CPU noise — misattribution corrected, scoped-oracle dispatch mechanized (approved)
- [knowledge] Guyin dogfood 2026-07-22 — 9 findings verified against main HEAD, hotfixes + spec dispositions (approved)
- [spec] CJK-aware slugify (pinyin transliteration) + lore set --slug repair path (approved)
- [knowledge] Dogfood retro — full-lifecycle fresh-corpus run (snip-demo) 2026-07-17 (approved)
- [knowledge] Bun 1.3.10: process.stdout instantiation sets fd1 O_NONBLOCK — silent >64KB pipe truncation (approved)
- [adr] Verification skill family — routed convergence + shared failure-first discipline (approved)
- [adr] Retire lore-planner agent; vendor upstream workflow skills into assets SSOT (approved)
- [knowledge] lore verify long-oracle flake — vitest onTaskUpdate RPC timeout under load (approved)
- [knowledge] Global handoff skill retired — lore-native handoff (SPEC-041 S2) is the sole cross-session memory path (approved)
- [knowledge] Decision-score log — instrument-first bootstrap session (2026-07-10) (approved)
- [knowledge] Retro — IoC P2+P4 build under score-gated autonomy (adversarial-review findings + migration/MCP-gate learnings) (approved)
- [knowledge] Global Claude Code workflow migrated from DocMan to lore (IoC adoption) (approved)
- [knowledge] Convergence backfill — code-anchor adoption armed + gate feeding-source design finding (2026-07-14) (approved)
- [spec] Dashboard write UI (create / edit / approve / link) (approved)
- [spec] Dashboard — Read-only Skeleton (approved)
- [spec] Upstream asset-ization — prompt & skill as first-class knowledge sub-types (approved)
- [spec] Corpus-governed spec-production loop — IoC vertical slice (approved)
- [spec] HTTP-backed AI provider (alongside claude-cli) (approved)
- [spec] Built-in AI provider for lore create (approved)
- [spec] plan.phases as a first-class grouping layer (approved)
- [spec] lore sync-docs — backfill new spec files into corpus (approved)
- [spec] lore export-docs — reverse sync from corpus to spec files (approved)
- [spec] Eval Framework (active)
- [spec] Telemetry Module (active)
- [spec] Sync Engine (Turso) (approved)
- [spec] Migration v1 (approved)
- [spec] Version History (approved)
- [spec] Review Workflow (approved)
- [spec] PRD-as-Living-Root (approved)
- [spec] HTTP API Adapter (approved)
- [spec] MCP Server Adapter (approved)
- [spec] Corpus Schema (approved)
- [spec] Service Layer Architecture (approved)
- [spec] Task execution workflow metadata (evidence / claim / ready) (approved)
- [spec] P4 — Upstream-downstream linkage + feed-before-produce protocol (approved)
- [spec] P2 — Workflow state machine: checkpoint registry + cross-tier production-chain gates (approved)
- [knowledge] Write-spec rules (gate feeding source) (approved)
- [adr] Corpus-governed active AI workflow (Inversion of Control) with deterministic gates (approved)
- [knowledge] Lore as sole dev context — output contract + spec_kind taxonomy + dashboard-as-PRD-projection (approved)
- [knowledge] Assess material-budget distortion on multi-task plan diffs (approved)
- [knowledge] DocMan replacement assessment — Lore coverage map + two remaining gaps (approved)
- [knowledge] assess diff truncation systematically hides tests from the judge (approved)
- [knowledge] MDX placeholder parser flags JSX inside fenced code blocks (approved)
- [knowledge] Retro — SPEC-038 + SPEC-039 double delivery (multi-agent orchestration learnings) (approved)
- [knowledge] Anthropic Official Agent-Loop Engineering — Research Digest (approved)
- [adr] AC-as-code — 验收标准作为类型化 oracle 绑定数据 (approved)
- [plan] Bugfix — eval/assess/export findings 2026-07-07 (archived)
- [knowledge] Retro — e2e corpus-pollution incident (port-squatter absorbed write suite) (approved)
- [spec] Auth & Agent Credentials (approved)
- [spec] AI assistance in lore set and lore link (approved)
- [spec] Default --no-ai for agent and MCP execution paths (approved)
- [plan] CLI v3 Roadmap — State Alignment + New Surface (archived)
- [spec] Cookie Auth — CLI-managed local bootstrap (approved)
- [spec] Monorepo Skeleton (Bun workspaces, P1 layout) (approved)

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

## 12. Out of Scope

- v2.1+: Agent-memory protocol RFC (extracted from v1.0 architecture)
- v2.2+: Enterprise features (SSO, RBAC, audit retention)
- v2.x: Field-level conflict resolution
- v3.0: Real-time CRDT collab, mobile, vector search
- §14 explicit exclusions: code-diff review (owner decision 2026-07-06 — the loop's object is corpus document lifecycle, not git diffs); external workflow-orchestration engines (the loop is built on Lore's own service layer + config, no new runtime dependency); removing the human from the loop entirely (I2 sampling floor is permanent at every autonomy level)

---
