---
id: SPEC-044
type: spec
role: spec
title: "Memory hygiene part 2: staleness probes (H2)"
status: approved
priority: high
created: 2026-07-12
updated: 2026-07-27
tags: [memory-hygiene, staleness, probes, spec-044]
parent: PRD-001
---
# SPEC-044 — Memory hygiene part 2: staleness probes (PRD §16 H2)

> spec_kind: feature. Upstream: PRD-001 §16 (H2, committed v0.8, G11; landscape evidence:
> silent staleness is an industry-open problem — tier-tagged research 2026-07-10; live
> incident: `knowledge-retro-stale-claude-md` — a stale doc produced a false 'SPEC-022
> unimplemented' judgment). H1 (SPEC-043 bi-temporal invalidation) is landed and is the
> ONLY write verb this spec's escalations point at; H3 (drift oracle) is the next cycle.
> v2 — revised after 3-lens adversarial review (schema-seams S1–S11 / agent-UX U1–U11 /
> testability T1–T13); revision log in §Review.

## Overview/Goal

H1 gave the corpus an explicit-signal invalidation verb, but the verb only fires when a
human or agent already KNOWS a doc is stale. Silent staleness — a fact changes with no
contradicting signal — still rots the corpus unnoticed, and the docs that rot most
expensively are the ones most depended on (high link in-degree) and least recently
confirmed (age).

**Goal**: `lore review --staleness` re-judges high-in-degree knowledge/ADR docs ("does
this still hold?") **on demand**. Probe priority = link in-degree × age. The probe result
is **escalation, never auto-invalidation** (probabilistic zone, IoC ADR boundary 1): a
`stale_candidate` verdict surfaces the doc with the judge's reasons and the literal
`lore invalidate <slug> --reason "…"` repair command — executing that command remains a
human/agent decision routed through H1's sole write path (`ValidityService`). A probe
NEVER mutates the probed doc (no version bump, no `extra` change, no status change).

## Design Decisions

- **D1 — Candidate selection is a pure, injectable function**:
  `selectProbeCandidates(inputs, nowIso, opts)` in `@lore/core`
  (new `packages/core/src/staleness.ts`). Inputs: doc rows (id, type, status,
  updated_at, extra.validity, deleted_at), per-doc incoming-link counts, and each doc's
  latest-staleness-confirmation timestamp. Filters: type ∈ {knowledge, adr};
  not soft-deleted; NOT currently invalidated (`isInvalidated(doc, nowIso)` — probing an
  already-invalidated doc is wasted spend); `age_days ≥ opts.min_age_days` (INCLUSIVE —
  a doc exactly at the threshold qualifies). No IO, no wall-clock — `nowIso` injected
  (same D-seam discipline as SPEC-042/043). In-degree counts ALL incoming link rows
  (any link type; `to_id = doc.id`) — supplied by a NEW `StoreInterface` method
  `countLinksByToIds(toIds: DocId[]): Map<DocId, number>` (one batch call, all link
  types; the existing `findLinksByToIds` is single-`linkType`-scoped and CANNOT express
  this — review S1) implemented in SQLiteStore, TursoStore, AND InMemoryStore.
- **D2 — Priority = in_degree × age_days, deterministic ordering**:
  `computeStalenessPriority({in_degree, age_days})` = `in_degree * age_days` with
  `age_days` measured from the doc's **last-confirmed** instant:
  `lastConfirmedAt = max(updated_at, latest holds-verdict probe created_at)` — an edit
  or a passing probe both reset the clock, so the same doc does not permanently top the
  queue. Latest-probe timestamps are assembled via a NEW batch
  `StoreInterface.latestJudgmentsByDocIds(docIds, kind)` (ONE call — no per-candidate
  N+1, review T6). `in_degree = 0` docs still qualify (score 0, probed last) — orphaned
  knowledge rots too; the multiplier prioritizes, it does not gate. Tiebreak: older
  lastConfirmedAt first, then lexicographic id. Limit applied AFTER the sort; a limit
  larger than the pool returns the whole pool (review T12).
- **D3 — Probe results persist in `review_judgments` with a `kind` discriminator, and
  the kind boundary is enforced at the STORE contract, not just the service**:
  `migration-005.ts` (current head is migration-004 — review S11) adds
  `kind TEXT NOT NULL DEFAULT 'review'` (`'review' | 'staleness'`) AND D11's
  `superseded_candidate` JSON column in one migration; re-running is a safe no-op
  (review T9). `StoreInterface.latestJudgment`/`findJudgments` gain a `kind` parameter
  (review S2) implemented in all three stores; `JudgmentService.latestFor`/`listFor`
  default it to `'review'` so every existing caller — `lore pending` triage badges,
  review freshness, `recordCalibration`'s `not_latest_judgment` check — is
  byte-identical. Without the store-level filter, a staleness "holds" row (persisted
  `decision: 'approve'`) would become a doc's latest judgment and masquerade as a real
  review approval in `lore pending` — the concrete corruption review S2 named. Rows
  whose stored `kind` is undefined (direct-insert legacy/test fixtures that bypass the
  service) read as `'review'` (`?? 'review'`, never strict equality — review S10).
  Staleness rows reuse the existing decision enum, constrained to `approve` ("holds") |
  `escalate` ("stale_candidate") — `reject` is structurally impossible for probes. The
  kind-conditioned no-reject refinement runs BEFORE the shared escalate-invariant
  refinement so a doubly-malformed candidate surfaces the kind-decision message first
  (`record()` reports `issues[0]` — misleading-error class, review S6/SPEC-042 T1).
- **D4 — Orchestration lives in a new `StalenessProbeService`**: candidate assembly
  (store list + `countLinksByToIds` + `latestJudgmentsByDocIds`, each called ONCE per
  batch), per-candidate `AIProviderService.probeStaleness(bundle, opts)`, persistence
  via `JudgmentService.record({kind: 'staleness', …})`, audit via `AuditService` action
  `staleness_probe` with `details.version`. The audit row's `actor` is the
  COMMISSIONING actor (`by`) — not the synthetic judge string review rows use — because
  a probe is a discretionary, cost-incurring action someone chose to run (review U5);
  the judgment row's `judge` field still carries provider/model/prompt-version.
  `staleness_probe` is EXCLUDED from `VERSION_ACTION_AUDIT_FAMILY`, mirroring `"judge"`
  (probes never bump doc versions — review U10). CorpusService stays read-only in this
  flow; ValidityService is untouched by probing (D12 is a separate, injected seam).
- **D5 — Prompt is a versioned template**: `buildStalenessPromptV1` in
  `packages/lore/src/ai/staleness-template.ts`, `STALENESS_PROMPT_VERSION = "v1"`
  recorded in `judge.version`. Materials: doc content (char-budgeted per D8), computed
  validity state, age_days, and the doc's in-neighbors (slug + title + link type — WHO
  depends on this; capped at `neighbor_limit` with a loud "+n more" tail) so the judge
  sees blast radius. Output JSON: `{decision: "holds" | "stale_candidate", confidence:
  0..1, reasons: string[], blocking_questions: string[] (required iff stale_candidate),
  superseded_candidate?: {ref: string, reason: string ≤200}}` — the SAME field name and
  shape D11 persists (one concept, one name — review S7). Malformed JSON → ONE
  corrective retry (parse error embedded), second failure → `AI_PROVIDER_ERROR` with
  ≤500-char raw prefix and NO judgment row (SPEC-026 pattern). Out-of-enum decision →
  hard error, no retry. The judgment's `doc_version` is the version read at
  bundle-assembly time — a concurrent edit between assembly and persistence simply
  yields a judgment that the existing `(stale)` freshness rule already discounts
  (review T8; no lock, no re-read).
- **D6 — Escalation surface**: every `stale_candidate` result renders (CLI text) the
  doc line + confidence + reasons + a literal repair command:
  `lore invalidate <slug> --reason "<first reason, ≤100 chars>"`, appending
  `--superseded-by <ref>` when the judge's `superseded_candidate.ref` RESOLVES in the
  corpus; an unresolvable nomination renders as a plain-text note, never a broken
  command — and the `--json` payload carries the same information structurally
  (`repair_command?` plus `unresolved_supersede_note?` — review U9). The read-only
  listing surface is `lore review --staleness --list` (NO provider call): docs whose
  LATEST `kind='staleness'` judgment is a fresh escalate (`doc_version ===
  doc.version`), badge `[stale? 0.87 ✋N]` mirroring `formatJudgmentBadge`. This
  deliberately does NOT extend `lore pending` — `ReviewService.pending()` is
  hardcoded to `status='draft'` docs awaiting first review, a structurally disjoint
  population from approved/active staleness candidates (review U1). A later `holds`
  probe or a doc edit naturally clears the listing (latest/freshness semantics — no
  dismiss verb, no new state).
- **D7 — No non-AI mode; same surface-brake semantics as assess/review**: the probe IS
  the AI intent. `--staleness --no-ai` exits 2. SPEC-024 built-in per-surface defaults
  do NOT brake it; only an explicit `ai.default_per_surface.<surface> = false` config
  override requires `--ai`. (`--list` mode is exempt — it is a read, no provider.)
- **D8 — Config split follows existing namespaces (review S9)**: prompt-shaping budgets
  live in `ai.staleness.*` (`max_doc_chars` default 12000, `neighbor_limit` default 20
  — precedent `ai.review.*`/`ai.assess.*`); behavioral knobs live in
  `workflow.staleness.*` (`default_limit` int ≥1 default 5, `min_age_days` int ≥0
  default 14). NO new top-level `review.*` config block. Unknown keys / wrong types
  fail loud at config load (existing strict-Zod behavior).
- **D9 — CLI shape**: `lore review --staleness [--limit N] [--min-age-days D]
  [--fail-on-candidate] [--list] [--json]` (batch, top-N by priority) and
  `lore review <doc> --staleness` (single-doc probe, bypasses selection filters but
  refuses an invalidated target with a loud VALIDATION_ERROR naming the doc's
  invalidation state). Deterministic pre-checks (SPEC-034) do NOT run for staleness —
  different pipeline, stated explicitly. Flag mutexes are synchronous, before ANY IO
  (review U11): `--staleness --no-ai` → exit 2; `--pending --staleness` → exit 2
  (disjoint populations — review U6). Exit 0 on success even when candidates are found
  (a probe is a report; single-doc `lore review` escalate=success is the precedent) —
  EXCEPT with `--fail-on-candidate`, which exits 3 when ≥1 fresh stale_candidate
  results, giving CI the `status --check-tree`-style gate (review U7). Partial-batch
  AI failures adopt the established `review --pending` collect-and-continue idiom
  (review U3): completed judgments are KEPT, per-probe failures land in the payload,
  exit 6 fires only when EVERY probe failed. `--json` emits `{probes: [{doc: {id,
  slug}, decision, confidence, priority, in_degree, age_days, reasons,
  blocking_questions, repair_command?, unresolved_supersede_note?, error?}], skipped:
  {invalidated: n, too_young: n}, total_candidates: n, excluded_by_limit: n}` — every
  skip class is countable, including the limit cut (no silent caps — review U2).
- **D10 — MCP parity**: new tool `lore_staleness_probe`
  `{limit?, min_age_days?, id_or_slug?, list?, by}` (`by` REQUIRED and load-bearing:
  it is the audit-row actor per D4) returning the CLI `--json` payload verbatim
  (envelope-unwrapped deep-equal oracle); `expectedTools` 29 → 30.
- **D11 — U9 byproduct — `superseded_candidate` on REGULAR review judgments**:
  `reviewJudgmentSchema` gains optional `superseded_candidate?: {ref: string, reason:
  string ≤200}` (persisted via the same migration-005 column, D3); when the SPEC-034
  review judge, while judging doc X, believes X supersedes an older doc, the field is
  persisted and `lore review` output renders the nudge
  `lore invalidate <old> --superseded-by <X>` (resolvable refs only, same rule as D6;
  unresolvable → note + JSON field). Absent field → zero rendering change
  (REGRESSION). This is the economic nudge that keeps H1's verb alive without
  automation.
- **D12 — Calibration join (probe → outcome) via an injected port, NOT a cross-service
  import (review S3)**: `ValidityService` gains an OPTIONAL constructor port
  `stalenessCalibration?: {latestStalenessJudgment(docId), recordCalibration(input)}`
  — same optional-DI pattern as `GateEnforcer` and `resolveDeclaredAcIds`; bare
  `new ValidityService(store)` unit-test constructions stay unwired and write nothing.
  When wired (composition root) and `invalidate` lands on a doc whose latest
  `kind='staleness'` judgment is a `stale_candidate` escalate, ONE calibration record
  is written against that judgment (FK `judgment_id`). NO new `action_family` column
  (review S4/T2 — the field does not exist and will not be added): the family is
  DERIVED at stats time by joining `judgment_id → review_judgments.kind`, and
  `computeCalibrationStats`'s group key becomes `(doc_type, judge_prompt_version,
  kind)` so staleness outcomes NEVER pool into review Wilson bounds even though both
  prompt versions are the literal "v1" (review S5). `--undo` deletes nothing
  (append-only). No calibration for `holds` verdicts (no observable outcome exists).
- **D13 — Probes are read-only w.r.t. the probed doc**: no version bump, no `extra`
  mutation, no status transition. The ONLY writes are: judgment row, audit row,
  (via D12, on later invalidation) calibration row. Verifiable: doc's `version` and
  `updated_at` byte-identical before/after a probe.
- **D14 — Session-surface visibility (review U4)**: `lore status` (text + `--json`
  `open_stale_candidates: n`) and `lore bootstrap`'s corpus summary gain the COUNT of
  docs whose latest staleness judgment is a fresh escalate — computed by the same
  query `--list` uses (one derivation site). `lore feed` packs and `lore tree` badges
  are explicitly NOT extended this cycle (owned non-goal, see Scope Out) — the count
  surfaces existence; `--list` is one command away.
- **D15 — Store parity**: migration-005 SQL applies identically to SQLiteStore and
  TursoStore (shared migration path); InMemoryStore mirrors the new fields and both
  new batch methods natively (review T1 — vitest suites assert against InMemory, so
  its `kind`/`superseded_candidate`/`countLinksByToIds`/`latestJudgmentsByDocIds`
  support is IN SCOPE, not implied). Live Turso-replica testing stays out of scope
  (no such precedent exists in the suite; parity rides the shared SQL + typecheck).

## Scope

**In**: `packages/core/src/staleness.ts` (pure selection/priority + verdict Zod schema);
`migration-005.ts` (`review_judgments.kind` + `review_judgments.superseded_candidate`);
`StoreInterface` additions `countLinksByToIds`, `latestJudgmentsByDocIds`, `kind` param
on `latestJudgment`/`findJudgments` — implemented in SQLite/Turso/InMemory;
`StalenessProbeService`; `AIProviderService.probeStaleness` + `staleness-template.ts`;
CLI `lore review --staleness` (batch + single-doc + `--list` + `--fail-on-candidate`);
MCP `lore_staleness_probe` (30 tools); D11 `superseded_candidate` byproduct on regular
reviews; D12 calibration port in `ValidityService` + `computeCalibrationStats` kind in
group key; config `ai.staleness.*` + `workflow.staleness.*`; audit action
`staleness_probe` (excluded from `VERSION_ACTION_AUDIT_FAMILY`); `lore status`/`lore
bootstrap` `open_stale_candidates` count; CLAUDE.md + module CLAUDE.md updates.

**Out** (explicitly): auto-invalidation in any form (IoC boundary 1 — permanent);
scheduled/daemon probing (on-demand only; cron is the caller's concern); H3 drift oracle
(`lore status --check-drift`, next cycle); dashboard staleness surface (follow-up spec,
same as H1's dashboard deferral); `lore feed`/`lore tree` staleness badges (D14 owns the
gap: count in status/bootstrap only this cycle); vector/embedding similarity for
successor detection (NG8 unchanged); probing `prd`/`spec`/`plan`/`task` docs (workflow
lifecycle owns those); live Turso-replica test coverage (D15); cross-corpus probes.

## Acceptance Criteria

Structured ACs (`lore ac add`, mode script unless noted) — statements below are the
binding set; every script AC names its runner and must be executable via `lore verify`.

- **AC-SP-1** (script:test, vitest `packages/core/tests/staleness.test.ts`) — Pure layer:
  selection filters (type, soft-deleted, invalidated-at-injected-now, min_age_days) each
  provably exclude; `age_days == min_age_days` boundary is INCLUDED (T11); priority =
  in_degree × age_days with in_degree=0 docs INCLUDED at score 0; lastConfirmedAt =
  max(updated_at, latest holds-probe at) resets ordering; deterministic tiebreak (older
  lastConfirmedAt, then id); limit applied post-sort and limit > pool returns the whole
  pool (T12); verdict Zod schema rejects decision outside holds|stale_candidate,
  requires blocking_questions iff stale_candidate, and accepts optional
  superseded_candidate {ref, reason ≤200}.
- **AC-SP-2** (script:test, vitest judgment/store tests) — `kind` boundary: staleness
  rows persist kind='staleness'; `latestFor`/`listFor` default-kind='review' leaves ALL
  pre-existing review reads byte-identical (REGRESSION), including: a doc whose newest
  row is a staleness "holds" still renders its REVIEW judgment badge in `lore pending`
  (the S2 corruption oracle) and `recordCalibration`'s `not_latest_judgment` check
  ignores staleness rows; stored undefined kind reads as 'review' via `??` (direct
  `insertJudgment` fixture, S10); staleness decision='reject' rejected with the
  kind-decision message FIRST when the escalate-invariant would also fire (S6 dual-fire
  case); migration-005 backfills legacy rows as kind='review' and re-running it is a
  no-op (T9).
- **AC-SP-3** (script:test, vitest staleness-probe-service tests) — Service happy path:
  batch probe records one judgment + one audit row per candidate (action=
  'staleness_probe', actor = commissioning `by`, details.version present, action
  excluded from VERSION_ACTION_AUDIT_FAMILY so `lore audit --verify` stays clean);
  probed doc's version AND updated_at byte-identical before/after (D13); assembly uses
  exactly ONE `countLinksByToIds` + ONE `latestJudgmentsByDocIds` call per batch
  (counting-subclass store oracle — `FlakyLinkStore` precedent,
  `validity-service.test.ts`; T5/T6); candidate order matches the pure layer's (order
  oracle, not score — InMemoryStore honesty).
- **AC-SP-4** (script:test, vitest ai-provider tests) — Prompt + parse: v1 prompt
  contains doc content, age_days, in-neighbor slugs (capped at neighbor_limit with a
  LOUD "+n more" tail), validity state; malformed JSON → one corrective retry (sequence
  InMemoryAIProvider, DI-injected) then success; second failure → AI_PROVIDER_ERROR
  with ≤500-char prefix and NO judgment row; out-of-enum decision → hard error, no
  retry, no row; judgment.doc_version equals the version read at bundle assembly — an
  edit racing the persistence yields a `(stale)`-discounted judgment, not an error (T8
  STATE case).
- **AC-SP-5** (script:test, vitest) — Escalation never auto-invalidates AND the probe
  actually lands (T3 — no-op must fail this AC): after a stale_candidate probe,
  `extra.validity` unchanged and `lore search` still lists the doc, AND a
  kind='staleness' decision='escalate' judgment row EXISTS for that doc/version;
  rendered repair command names `lore invalidate <slug>` and appends `--superseded-by`
  ONLY when the nominated ref resolves; unresolvable ref → plain-text note in text
  output AND `unresolved_supersede_note` in JSON (U9), never a broken command.
- **AC-SP-6** (script:test, bun spawned-CLI smoke `cli-staleness.bun.test.ts`) — with a
  fake claude-cli shell-script provider fixture (same mechanism as
  `assess-ai.bun.test.ts` — T7) and EXPLICIT `--min-age-days 0` (load-bearing: fresh
  fixtures are younger than the 14-day default — T4): `lore review --staleness
  --limit 1 --min-age-days 0` exits 0 and persists a judgment; `--json` carries
  probes[] + skipped{invalidated,too_young} + total_candidates + excluded_by_limit
  (U2); a partially-failing batch (one probe's provider errors) keeps completed
  judgments, reports the per-probe error, exits 0 (U3), and an all-fail batch exits 6;
  `--fail-on-candidate` exits 3 on ≥1 fresh escalate (U7); `lore review <doc>
  --staleness` refuses an invalidated target (exit 4); `--staleness --no-ai` and
  `--pending --staleness` both exit 2 BEFORE any IO (U6/U11); `--staleness --list`
  performs NO provider invocation (fixture would loudly fail if called) and drops a
  listed doc after that doc is edited (freshness).
- **AC-SP-7** (script:test, vitest MCP parity tests) — `lore_staleness_probe` requires
  `by`; payload deep-equals CLI `--json` (envelopes unwrapped); expectedTools gains
  lore_staleness_probe, length literal 29 → 30.
- **AC-SP-8** (script:test, vitest) — D11 byproduct: review judgment with
  superseded_candidate persists (migration-005 column) and renders the invalidate
  nudge with resolvable ref; absent field → rendering byte-identical to pre-SPEC-044
  (REGRESSION); unresolvable ref renders note-not-command.
- **AC-SP-9** (script:test, vitest validity-service tests) — D12 port join: a
  port-wired ValidityService.invalidate on a doc whose latest staleness judgment is a
  stale_candidate escalate writes ONE calibration record (FK to that judgment);
  invalidate without a prior probe writes none; bare `new ValidityService(store)` (no
  port) writes none and does not error; `--undo` deletes nothing; `holds` verdict never
  produces calibration.
- **AC-SP-10** (script:test, vitest config tests) — `ai.staleness.*` (12000/20) and
  `workflow.staleness.*` (5/14) defaults apply when absent; non-integer / negative
  values fail loud at load; CLI `--limit`/`--min-age-days` override config for that
  invocation only.
- **AC-SP-11** (script:test, vitest calibration tests) — Stats disaggregation:
  `computeCalibrationStats` group key includes the joined judgment `kind`; a fixture
  with BOTH a review calibration and a staleness calibration on the same doc_type and
  the same prompt-version literal "v1" yields TWO stat rows, never one pooled Wilson
  bound (S5).
- **AC-SP-12** (script:test, vitest session/status tests) — Visibility: `lore status
  --json` and `lore bootstrap` payloads carry `open_stale_candidates` computed by the
  SAME query `--list` uses (one derivation site — no second derivation, SPEC-043
  precedent); count drops when the flagged doc is edited or re-probed to holds.
- **AC-SP-13** (human, owner-executed, D12-independence) — Throwaway-corpus live
  script: create knowledge K1 and K2 with a `relates-to` link K2→K1; run `lore review
  --staleness --limit 1 --min-age-days 0` with the real provider; observe K1 selected
  first (in_degree 1 vs 0), a verdict recorded, `lore review --staleness --list`
  showing the escalate (or a clean holds), `lore status` counting it, and `lore
  invalidate` remaining the only path that actually invalidates.

## Review

v2 revision log — 3-lens adversarial review, 35 findings, all resolved or explicitly
owned:

- **S1 (HIGH)** `findLinksByToIds` is single-linkType — new `countLinksByToIds` store
  method (D1, Scope). **S2 (HIGH)** kind filter must live at the store contract; named
  the `lore pending` badge-corruption + `not_latest_judgment` breakage — D3 + AC-SP-2
  regression oracles. **S3 (HIGH)** ValidityService×JudgmentService coupling — injected
  optional port (D12), precedent GateEnforcer/resolveDeclaredAcIds. **S4 (HIGH)** +
  **T2 (HIGH)** `action_family` phantom field — dropped; family derived from joined
  `kind` at stats time (D12). **S5** stats pooling under identical "v1" literals —
  group key gains kind (D12, AC-SP-11). **S6** superRefine error collapse — refinement
  ordering pinned + dual-fire AC (D3, AC-SP-2). **S7** two names for one concept —
  unified on `superseded_candidate {ref, reason}` (D5/D11). **S8/S11** migration
  unnamed — migration-005.ts, both columns, idempotent (D3, D15). **S9** config
  namespace — split `ai.staleness.*` / `workflow.staleness.*`, no new top-level block
  (D8). **S10** undefined-kind fixtures — `?? 'review'` pinned (D3, AC-SP-2).
- **U1 (HIGH)** `lore pending --staleness` conflated disjoint queues — replaced by
  `lore review --staleness --list` (D6). **U2 (HIGH)** `--limit` silent cap —
  `total_candidates` + `excluded_by_limit` in JSON (D9). **U3 (HIGH)** partial-batch
  semantics — collect-and-continue idiom adopted, exit rule pinned (D9). **U4 (HIGH)**
  bootstrap/status invisibility — `open_stale_candidates` count, single derivation
  (D14); feed/tree explicitly owned as out. **U5** `by` cargo-cult risk — `by` is the
  audit-row actor for probes, load-bearing (D4/D10). **U6** `--pending --staleness`
  unguarded — exit-2 mutex (D9). **U7** CI gate — `--fail-on-candidate` exit 3 (D9).
  **U8** D12 wiring undisclosed — merged into S3's port design. **U9** JSON drops the
  unresolvable-note — `unresolved_supersede_note` field (D6). **U10** audit family
  membership — excluded like "judge" (D4). **U11** mutex ordering — before any IO (D9).
- **T1 (HIGH)** InMemoryStore kind support unscoped — D15 + Scope, explicitly in.
  **T3 (HIGH)** AC-SP-5 tautological — strengthened with positive judgment-row
  existence. **T4 (HIGH)** spawned-CLI age defaults select zero candidates —
  `--min-age-days 0` load-bearing in AC-SP-6/13. **T5** call-count mechanism —
  counting-subclass precedent named (AC-SP-3). **T6** lastConfirmedAt N+1 —
  `latestJudgmentsByDocIds` batch + call-count AC (D2, AC-SP-3). **T7** "scripted
  provider via config" didn't exist cross-process — fake claude-cli shell-script
  fixture named (AC-SP-6). **T8** doc_version TOCTOU — assembly-time version pinned
  (D5, AC-SP-4). **T9** migration idempotency — AC-SP-2. **T10** Turso parity — D15
  (SQL parity in scope, live-replica tests owned out). **T11/T12** boundary + limit >
  pool — AC-SP-1. **T13** calibration-stats kind-leak regression — AC-SP-11.

## Non-goals restated

No daemon, no auto-invalidation, no vector store, no dashboard surface this cycle.
Probe spend is bounded by explicit `--limit` × on-demand invocation — there is no
background token burn.


## Acceptance Criteria (structured)

- [✔] [script] AC-SP-1: Pure layer: selection filters (type knowledge/adr only, soft-deleted, invalidated-at-injected-now, min_age_days) each provably exclude; age_days == min_age_days boundary INCLUDED; priority = in_degree * age_days with in_degree=0 docs included at score 0; lastConfirmedAt = max(updated_at, latest holds-probe at) resets ordering; deterministic tiebreak (older lastConfirmedAt, then id); limit applied post-sort and limit > pool returns whole pool; verdict Zod schema rejects decision outside holds|stale_candidate, requires blocking_questions iff stale_candidate, accepts optional superseded_candidate {ref, reason <=200}
  script: test — bunx vitest run packages/core/tests/staleness.test.ts
- [✔] [script] AC-SP-2: kind boundary: staleness rows persist kind='staleness'; latestFor/listFor default kind='review' leaves all pre-existing review reads byte-identical (REGRESSION) — doc whose newest row is a staleness holds still renders its REVIEW badge in lore pending, and recordCalibration not_latest_judgment check ignores staleness rows; stored undefined kind reads as 'review' via ?? (direct insertJudgment fixture); staleness decision='reject' rejected with kind-decision message FIRST in the dual-fire case; migration-005 backfills legacy rows as kind='review' and re-running is a no-op
  script: test — bunx vitest run packages/lore/tests/unit/service/judgment-kind.test.ts
- [✔] [script] AC-SP-3: Service happy path: batch probe records one judgment + one audit row per candidate (action='staleness_probe', actor = commissioning by, details.version present, action excluded from VERSION_ACTION_AUDIT_FAMILY so lore audit --verify stays clean); probed doc version AND updated_at byte-identical before/after; assembly uses exactly ONE countLinksByToIds + ONE latestJudgmentsByDocIds call per batch (counting-subclass store oracle, FlakyLinkStore precedent); candidate order matches the pure layer (order oracle, not score — InMemoryStore honesty)
  script: test — bunx vitest run packages/lore/tests/unit/service/staleness-probe-service.test.ts
- [✔] [script] AC-SP-4: Prompt + parse: v1 prompt contains doc content, age_days, in-neighbor slugs (capped at neighbor_limit with LOUD '+n more' tail), validity state; malformed JSON gets one corrective retry (sequence InMemoryAIProvider) then success; second failure AI_PROVIDER_ERROR with <=500-char prefix and NO judgment row; out-of-enum decision hard error, no retry, no row; judgment.doc_version equals version read at bundle assembly — edit racing persistence yields a (stale)-discounted judgment, not an error
  script: test — bunx vitest run packages/lore/tests/unit/service/staleness-ai-provider.test.ts
- [✔] [script] AC-SP-5: Escalation never auto-invalidates AND the probe actually lands: after a stale_candidate probe, extra.validity unchanged and lore search still lists the doc, AND a kind='staleness' decision='escalate' judgment row EXISTS for that doc/version; repair command names lore invalidate <slug> and appends --superseded-by ONLY when nominated ref resolves; unresolvable ref renders plain-text note in text output AND unresolved_supersede_note in JSON, never a broken command
  script: test — bunx vitest run packages/lore/tests/unit/service/staleness-escalation.test.ts
- [✔] [script] AC-SP-6: Spawned-CLI smoke with fake claude-cli shell-script provider fixture (assess-ai.bun.test.ts mechanism) and EXPLICIT --min-age-days 0 (load-bearing: fresh fixtures are younger than the 14-day default): lore review --staleness --limit 1 --min-age-days 0 exits 0 and persists a judgment; --json carries probes[] + skipped{invalidated,too_young} + total_candidates + excluded_by_limit; partially-failing batch keeps completed judgments, reports per-probe error, exits 0; all-fail batch exits 6; --fail-on-candidate exits 3 on >=1 fresh escalate; lore review <doc> --staleness refuses an invalidated target (exit 4); --staleness --no-ai and --pending --staleness both exit 2 BEFORE any IO; --staleness --list performs NO provider invocation (fixture would loudly fail if called) and drops a listed doc after that doc is edited
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-staleness.bun.test.ts
- [✔] [script] AC-SP-7: MCP parity: lore_staleness_probe requires by; payload deep-equals CLI --json (envelopes unwrapped); expectedTools gains lore_staleness_probe, length literal 29 -> 30
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-staleness.test.ts
- [✔] [script] AC-SP-8: D11 byproduct: review judgment with superseded_candidate persists (migration-005 column) and renders the invalidate nudge with resolvable ref; absent field renders byte-identical to pre-SPEC-044 (REGRESSION); unresolvable ref renders note-not-command
  script: test — bunx vitest run packages/lore/tests/unit/service/review-superseded-candidate.test.ts
- [✔] [script] AC-SP-9: D12 port join: port-wired ValidityService.invalidate on a doc whose latest staleness judgment is a stale_candidate escalate writes ONE calibration record (FK to that judgment); invalidate without prior probe writes none; bare new ValidityService(store) (no port) writes none and does not error; --undo deletes nothing; holds verdict never produces calibration
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-service.test.ts
- [✔] [script] AC-SP-10: Config: ai.staleness.* (max_doc_chars 12000, neighbor_limit 20) and workflow.staleness.* (default_limit 5, min_age_days 14) defaults apply when absent; non-integer / negative values fail loud at load; CLI --limit/--min-age-days override config for that invocation only
  script: test — bunx vitest run packages/core/tests/config-staleness.test.ts
- [✔] [script] AC-SP-11: Stats disaggregation: computeCalibrationStats group key includes the joined judgment kind; a fixture with BOTH a review calibration and a staleness calibration on the same doc_type and the same prompt-version literal 'v1' yields TWO stat rows, never one pooled Wilson bound
  script: test — bunx vitest run packages/lore/tests/unit/service/calibration-kind.test.ts
- [✔] [script] AC-SP-12: Visibility: lore status --json and lore bootstrap payloads carry open_stale_candidates computed by the SAME query --list uses (one derivation site, no second derivation); count drops when the flagged doc is edited or re-probed to holds
  script: test — bunx vitest run packages/lore/tests/unit/service/staleness-visibility.test.ts
- [✔] [human] AC-SP-13: Owner-executed throwaway-corpus live probe: K1 (linked-to) selected before K2 at --min-age-days 0, verdict recorded, --list/status surfaces reflect it, no auto-invalidation occurs
  human: Owner-executed (D12 independence). Throwaway corpus (mkdtemp + lore init): create knowledge K1 and K2 with a relates-to link K2->K1; run lore review --staleness --limit 1 --min-age-days 0 with the real provider; observe K1 selected first (in_degree 1 vs 0), a verdict recorded, lore review --staleness --list showing the escalate (or clean holds), lore status counting it, and lore invalidate remaining the only path that actually invalidates.

## Code anchors

- packages/core/src/staleness.ts
- packages/lore/src/service/staleness-probe-service.ts
- packages/lore/src/flows/staleness-flow.ts
- packages/lore/src/ai/staleness-template.ts
