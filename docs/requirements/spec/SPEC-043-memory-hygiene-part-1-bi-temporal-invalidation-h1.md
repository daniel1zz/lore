---
id: SPEC-043
type: spec
role: spec
title: "Memory hygiene part 1: bi-temporal invalidation (H1)"
status: approved
priority: high
created: 2026-07-11
updated: 2026-07-27
tags: [memory-hygiene, validity, invalidation, spec-043, bi-temporal]
parent: PRD-001
---
# SPEC-043 — Memory hygiene part 1: bi-temporal invalidation (PRD §16 H1)

> spec_kind: feature. Upstream: PRD-001 §16 (H1, committed v0.8, G11; landscape evidence:
> Zep/Graphiti bi-temporal invalidation, arXiv 2501.13956, tier-tagged research 2026-07-10;
> live incident: `knowledge-retro-stale-claude-md` — a stale doc produced a false judgment).
> H2 (staleness probes) and H3 (drift oracle) are separate follow-up specs; H2's escalation
> verdicts land on THIS spec's invalidation mechanism (Scope commits H2 as the next cycle so
> H1's write verb does not sit economically disincentivized — review U9).
> v2 — revised after 3-lens adversarial review (schema-seams / agent-UX / testability);
> revision log in §Review.

## Overview/Goal

The corpus silently rots: nothing distinguishes "this knowledge/ADR still holds" from "this
was true in June". Lore has already been bitten — a stale doc produced a false
'SPEC-022 unimplemented' judgment. Workflow `status` cannot carry this: `deprecated` is a
terminal lifecycle state about the DOCUMENT's process, not a timestamped claim about when
the CONTENT stopped being true, and ADR's `decision_status: superseded` +
`extra.superseded_by` exist but feed no read path — reads filter only `deleted_at` today.

**Goal (honest scope — review U4)**: knowledge/ADR docs gain explicit bi-temporal validity
metadata; superseding marks the old doc invalid (never deletes — version history stays
append-only). **List/search-shaped reads (`search`, `list`, `RecentDecisions`, `RelatedOf`)
filter invalidated knowledge by default with an `--include-invalid` escape; direct-address
and composed reads (`get`, `Embed`, `feed`, MCP payloads, judge materials) are NEVER
filtered but ALWAYS carry an explicit invalidation marker** (banner, badge, degrade note,
or structured JSON field, per surface — D3/D4/D9). Dashboard views carry no marker until a
follow-up spec (Out). Explicit-signal invalidation only — silent staleness is H2's probe
territory (escalation, never auto-invalidation).

## Design Decisions

- **D1 — `extra.validity` nested object on `knowledge` + `adr` docs only**:
  `validitySchema = {valid_at?: ISO, invalid_at?: ISO, invalidated_by?: docId (ULID),
  reason?: string ≤500}` in `@lore/core` (new `packages/core/src/validity.ts`), joined to
  `knowledgeExtraSchema`/`adrExtraSchema` as one optional key (the `extra.claim` nesting
  precedent). Read-side defaults: absent `validity`/`valid_at` → the doc's `created_at`
  (zero-migration); absent `invalid_at` → currently valid. Pure predicates
  `isInvalidated(doc, nowIso)` / `effectiveValidAt(doc)` in core (no IO, no wall-clock —
  nowIso injected) are the SSOT every surface calls. **Validation split (review S8 — core
  stays wall-clock free)**: the ordering rule (`invalid_at ≥ valid_at`, equality legal) is
  a pure `validitySchema.superRefine`; the "not in the future" rule lives in
  `ValidityService` (service layer computes nowIso, the `CorpusService.set` convention).
  `reason` cap 500 stays — the pointer for longer narratives is `invalidated_by`, which
  works for ANY target type (an incident/retro knowledge doc counts as a successor —
  review U8). *Rejected*: top-level DocRecord columns (migration, touches every store);
  validity on all six doc types (statuses/oracles already govern executables).
- **D2 — Write path: `ValidityService.invalidate(idOrSlug, {supersededBy?, reason?, by,
  undo?})`, CLI `lore invalidate`** — stateless, store-injected, read-modify-write via the
  TaskWorkflowService pattern (sibling `extra` keys preserved structurally, version bump +
  audit `action: "invalidate"` with `details.version` — D7). `--superseded-by` accepts
  id-or-slug, resolves via the `resolveDocId` precedent, and **persists the resolved ULID,
  never the raw input** (review S7). **ADR convergence, non-atomicity stated honestly
  (reviews S5+T6, found independently by two lenses)**: "one verb", NOT one atomic storage
  operation — this codebase has no store transactions. Pinned ordering: (1) doc-extra
  update (validity + `decision_status: "superseded"` when supersededBy given /
  `"deprecated"` when not + `superseded_by`) + version + audit FIRST — the higher-value
  invariant; (2) the `supersedes` link (successor → old) SECOND. A crash between (1) and
  (2) leaves validity set with a missing link; **re-running the same invalidate is
  idempotent and repairs the link** (documented recovery semantics, AC-tested via the
  STALE_VERSION/sequential-CAS technique). `--undo` clears
  `invalid_at`/`invalidated_by`/`reason` (audit-logged, version-bumped); `decision_status`
  is NOT auto-reverted — the asymmetry is returned as a **structured field
  `decision_status_unchanged: "superseded"` in the CLI `--json` and MCP payloads** (review
  U7 — MCP agents never read help text), plus help-text prose. Doc status NEVER touched
  (D5). *Rejected*: invalidation via `lore set` (D10 closes that side door entirely).
- **D3 — Filtered read surfaces (pinned): `lore search`, `lore list`,
  `RecentDecisions`, `RelatedOf`** — excluded when `isInvalidated(doc, now)`; SERVICE-side
  via the D1 predicate. Seams pinned (review T1): `CorpusService.search`/`list` and
  `OutlineService.resolve` gain `now: () => string = defaultNow` parameters (the
  TaskWorkflowService signature precedent), threaded to `isInvalidated`. **Resolver
  implementation note (review S6)**: the validity filter MUST run on the full candidate
  array BEFORE `slice(0, limit)` (`outline-service.ts:409` shape) so next-most-recent
  backfills the limit. **SearchHit extension (review S3)**: `SearchHit` today carries no
  `extra`/`created_at`, so the predicate is uncomputable on hits — the type gains
  `created_at` + a narrow `validity` projection, added to BOTH stores' search SQL/impl
  (no N+1 per-hit fetch; cross-package type change named in Scope). Escapes:
  `--include-invalid` (CLI), `include_invalid: true` (MCP `lore_search`/`lore_list`),
  `includeInvalid` prop (MDX). NOT filtered — but ALWAYS marked (D4/D9): `lore get`
  (banner), `lore tree` (`[invalid]` badge; hiding nodes breaks parent chains),
  version/log/diff (history is the point), `Embed` + `lore feed` + judge materials (D9),
  bootstrap/handoff-resume (pointer-set / advisory by design). *Rejected*: store-level SQL
  filtering (opaque-extra json_extract on every query; service predicate is the SSOT).
- **D4 — Invalidation markers on the text-projection seam** (`renderResolvedToMarkdown`
  splice, SPEC-032 precedent; adapter-seam, NOT CorpusService). Wiring sites pinned —
  **three, not two (review U2)**: CLI `get` non-raw, `export-docs` body, and
  `feed-flow.ts::renderDocMarkdown` (the `lore feed` pack). Banner format (pinned so edge
  cases are non-issues — review T6): `> ⚠ INVALIDATED <invalid_at date>` + `— superseded
  by <slug>` only when `invalidated_by` resolves (suffix ` (deleted)` when the successor is
  soft-deleted — review S9) + `; <reason>` only when reason present (no dangling
  separators). `--raw` never carries the banner (raw = stored bytes). Search/list/tree rows
  render `[invalid]` badges when invalidated docs surface.
- **D5 — Temporal validity ⊥ workflow status.** Invalidation never transitions status;
  status transitions never write `validity`. An `approved` doc can be invalidated
  (approval is provenance; invalidation is currency). `VALID_TRANSITIONS` untouched.
  Consequence (review U2 workflow): `findFeedingSkill`'s `status: approved` query still
  returns an invalidated skill doc — which is WHY the feed pack banner (D4) and the status
  warning (D8) exist. NOTE (reviews S4+U10): the gate feeding source is DYNAMIC discovery
  (`CorpusService.findFeedingSkill` — most-recent approved `sub_type: "skill"` matching
  `applies_to`), NOT config-pinned; v1's premise was wrong.
- **D6 — MCP: `lore_invalidate {id_or_slug, superseded_by?, reason?, undo?, by}`**;
  `lore_search`/`lore_list` gain `include_invalid?`. **`lore_get` (and the HTTP doc route)
  gains computed `validity_state: {invalidated: boolean, invalid_at?, invalidated_by_slug?,
  reason?}` in its payload (review U3)** — agents parse JSON, not markdown banners; the
  MCP surface is always agent-facing (SPEC-024) and was the weakest channel. tools.ts
  pre-declared-schema discipline; `mcp-tools.test.ts`'s `expectedTools` array gains
  `"lore_invalidate"` and the length literal bumps 28 → 29 (review T4 — the oracle owns
  the number; this states the exact edit).
- **D7 — Audit continuity**: `invalidate`/`--undo` audit entries carry `details.version`;
  `VERSION_ACTION_AUDIT_FAMILY` extended (SPEC-042 T1 precedent). No calibration records.
- **D8 — `lore status` invalidated-feeding-source warning reuses `SessionService`'s
  armed-gate computation (review S4)** — bootstrap already derives armed checkpoints +
  feeding-source slugs; the warning calls the same helper (extracted if needed), never a
  second derivation (the 2026-07-11 gate-ctx SSOT-drift incident class).
- **D9 — Composed/judge surfaces degrade loudly, never silently (reviews U1/U5)**:
  `resolveEmbed` checks `isInvalidated` and, instead of splicing the stale body verbatim,
  degrades to the existing not-found-note pattern (`[embed skipped: <slug> invalidated
  <date> — lore get <slug> to read it, includeInvalid to embed anyway]`) with an
  `includeInvalid` prop escape that embeds WITH an inline banner line.
  `buildReviewPromptV1` materials: when the bundle's doc or parent is invalidated, a
  `# Staleness Notice` section (the existing truncation-notice pattern in
  `review-template.ts:112-119`) tells the judge to discount currency claims — filtering
  the parent outright would remove structural context. `ChildrenOf`/`ModuleTree` stay
  unfiltered structural navigation (D3) — their rows are pointers, not content splices.
- **D10 — `CorpusService.set` side door closed (review S2 — the "one write path" claim was
  only true for the front door)**: `set()` gains knowledge/adr extra re-validation
  mirroring the `spec_kind` precedent, PLUS a writer-identity guard: a `set`/`lore_set`/
  dashboard-PATCH whose patch would CHANGE `extra.validity` (deep-compare vs existing) →
  VALIDATION_ERROR naming `lore invalidate` (the SPEC-041 D4 handoff-guard precedent).
  Same fix corrects the ADR create-path error collapse (review S1): the `adr` superRefine
  branch forwards individual Zod issues (the `knowledge` branch already does) instead of
  collapsing every failure into the misleading `decision_status` message — the SPEC-042 T1
  bug class, now twice-paid.
- **D11 — Supersede orchestration (review U6 — the two-command dance reintroduced the
  silent-rot hazard at workflow level)**: `lore create <type> --supersedes <old>` (CLI +
  MCP `lore_create.supersedes`) composes `CorpusService.create` THEN
  `ValidityService.invalidate(old, {supersededBy: new})` — the `buildFeed` composition
  precedent; `ValidityService` remains the sole validity mutator. **Half-failure UX
  pinned**: when create succeeds but invalidate fails, the command exits nonzero and
  prints the exact repair command (`new doc created but NOT superseded — run: lore
  invalidate <old> --superseded-by <new-slug>`) — loud orphan, never silent. The
  two-command path remains valid for scripts that prefer it.
- **D12 — Independent-party human AC (SPEC-042 assess recommendation, adopted)**: the sole
  human-mode AC is executed by the OWNER (or CI), never self-recorded by the orchestrating
  agent; the AC embeds the exact command script.

## Scope

**In**: `@lore/core` (`validity.ts`: schema + `isInvalidated` + `effectiveValidAt`;
`knowledgeExtraSchema`/`adrExtraSchema` `validity` key; ADR superRefine issue-forwarding
fix; `SearchHit` type extension `created_at` + `validity`; barrel exports),
`ValidityService` (new), CorpusService (search/list filter + `now` params +
`include_invalid` plumbing + D10 set-guard + SearchHit SQL in BOTH SQLiteStore/TursoStore +
InMemoryStore), OutlineService (`RecentDecisions`/`RelatedOf` filter-before-slice +
`Embed` degrade + `includeInvalid` props + `now` seam), feed-flow banner wiring,
review-template staleness notice, `lore status` warning via the shared SessionService
armed-gate helper, text-projection banner (3 sites, D4), CLI `invalidate` +
`create --supersedes` + `--include-invalid` flags + badges, MCP `lore_invalidate` +
`lore_get.validity_state` + `lore_create.supersedes` + `include_invalid` params, app.ts
wiring, docs (CLAUDE.md SPEC-043 entry). New test files pinned:
`packages/core/tests/validity.test.ts`, `packages/lore/tests/unit/service/
{validity-service,validity-filtering,outline-validity,validity-feed-and-judge}.test.ts`,
`packages/lore/tests/unit/adapters/{validity-projection,mcp-invalidate}.test.ts`,
`packages/lore/tests/unit/adapters/cli-invalidate.bun.test.ts` (with `assertFreshBinary`
beforeAll guard — review T7).

**Out**: H2 staleness probes / H3 drift oracle (separate specs, H2 committed next);
auto-invalidation; validity on spec/plan/task/prd; vector store (NG8); deletion ever;
dashboard invalid-doc views (human curators get CLI/export markers only until then —
stated honestly); store-level SQL validity filtering; SQLite-FTS5 ranking-preservation
regression (accepted scope limit — review T2: InMemoryStore has no ranking signal; the
order-preservation assertion below is the honest oracle).

## Acceptance Criteria

Runner split per SPEC-041/042 precedent (vitest = InMemoryStore + in-process
`_registeredTools` MCP; bun = spawned binary on throwaway corpus, `assertFreshBinary`
guarded, mindful of the 9-spawn/5s-budget lesson — heavy assertions live at the vitest
layer, the bun file smoke-checks).

- AC-MH-1 (vitest, core) pure layer: absent validity → valid, `effectiveValidAt` falls
  back to created_at; `invalid_at ≥ valid_at` ordering enforced in schema with
  **equality accepted** (boundary); `invalid_at < valid_at` rejected; reason >500
  rejected; `isInvalidated` flips exactly at the injected nowIso instant — NO future-date
  check here (that is the service's, per D1 split).
- AC-MH-2 (vitest, service) invalidate: happy path writes invalid_at/reason, preserves
  sibling extra keys verbatim, bumps version, audits with `details.version`; future
  invalid_at rejected AT THE SERVICE seam; nonexistent target → DOC_NOT_FOUND;
  unresolvable `supersededBy` → DOC_NOT_FOUND naming the bad ref; persisted
  `invalidated_by`/`superseded_by` are resolved ULIDs even when a slug was passed.
- AC-MH-3 (vitest, service) ADR convergence + honesty about atomicity: with supersededBy —
  invalid_at + decision_status="superseded" + superseded_by + `supersedes` link, doc-write
  ordered BEFORE link-write; without — "deprecated", no link; non-knowledge/adr target →
  VALIDATION_ERROR naming allowed types; **partial-failure recovery: with the link-add
  forced to fail (sequential-CAS/STALE_VERSION technique), the doc half is committed, and
  re-running the same invalidate repairs the missing link (idempotent)**.
- AC-MH-4 (vitest, service) undo: clears invalid_at/invalidated_by/reason, bumps version,
  audits; decision_status stays "superseded" AND the result carries structured
  `decision_status_unchanged: "superseded"` (CLI --json and MCP payload alike); undo on a
  never-invalidated doc → VALIDATION_ERROR.
- AC-MH-5 (vitest, service) filtering: search and list exclude invalidated knowledge+adr
  by default; `include_invalid` restores them and **the relative ORDER of surviving doc
  ids is unchanged between the two result sets** (InMemoryStore has no ranking signal —
  order, not score, is the oracle); future valid_at does NOT exclude (only invalid_at
  filters); `now` is injected via the D3 seam in every case.
- AC-MH-6 (vitest, service) resolvers: RecentDecisions filters BEFORE slice so
  next-most-recent backfills the limit; ALL candidates invalidated → short/empty list, not
  an error (exhaustion boundary); RelatedOf skips invalidated targets; **Embed degrades to
  the skip-note instead of splicing stale content, and `includeInvalid` embeds WITH an
  inline banner line**; includeInvalid restores RecentDecisions/RelatedOf;
  ChildrenOf/ActivePlans/ModuleTree/HealthStats unchanged (REGRESSION).
- AC-MH-7 (vitest, adapters) projection: `lore get` non-raw + export-docs render the D4
  banner with pinned format — no-reason → no dangling separator; soft-deleted successor →
  `(deleted)` suffix; no banner on valid docs; `--raw` never carries it (REGRESSION).
- AC-MH-8 (bun, CLI, `assertFreshBinary`, budget-conscious) smoke: invalidate happy exit 0;
  undo-on-never-invalidated exit 4; non-knowledge/adr target exit 4; search hides →
  `--include-invalid` shows with `[invalid]` badge; `create adr --supersedes <old>` happy
  path creates + invalidates + links in one command; `lore status` warning STRING surfaces
  for one pre-armed invalidated-feeding-source fixture (deep logic tested in AC-MH-12).
- AC-MH-9 (vitest, MCP) parity: `lore_invalidate` requires `by`, deep-equals CLI --json
  (envelopes unwrapped); `lore_search`/`lore_list` `include_invalid` ≡ CLI flags;
  **`lore_get` payload carries computed `validity_state` (invalidated boolean +
  invalid_at + invalidated_by_slug + reason) for invalidated docs and
  `invalidated: false` otherwise**; `expectedTools` gains "lore_invalidate", length
  literal 28 → 29.
- AC-MH-10 (vitest, service) boundary + guard: re-invalidating keeps ORIGINAL invalid_at
  while refreshing reason/invalidated_by (first signal wins); legacy doc without validity
  round-trips set/get untouched (no phantom validity); **D10 guard: `CorpusService.set`
  (and thus lore_set/dashboard PATCH) changing `extra.validity` → VALIDATION_ERROR naming
  `lore invalidate`; malformed validity via set also rejected with the REAL issue message,
  and an ADR create with valid decision_status + malformed validity reports the validity
  issue, not the misleading decision_status message (D10/S1 REGRESSION)**.
- AC-MH-11 (human, owner-executed per D12) throwaway-corpus script: create knowledge K1 →
  `lore invalidate <K1> --reason obsolete` → `lore search` hides K1 →
  `--include-invalid` shows it with `[invalid]` badge → `lore get <K1>` shows the banner →
  `lore invalidate <K1> --undo` restores default visibility.
- AC-MH-12 (vitest, service/flows) loud composed surfaces: `lore feed <checkpoint>` pack
  renders the D4 banner when the discovered feeding-skill doc is invalidated (feed-flow
  wiring site); review-judge prompt gains the `# Staleness Notice` section when the
  bundle's doc or parent is invalidated and NOT otherwise; `lore status` report carries
  the invalidated-feeding-source warning computed via the SAME SessionService armed-gate
  helper bootstrap uses (no second derivation).
- AC-MH-13 (vitest, adapters/flows) supersede orchestration: `create --supersedes`
  composes create→invalidate with ValidityService as sole mutator; with the invalidate
  step forced to fail, the command reports nonzero AND prints the exact repair command
  naming both slugs (loud orphan, never silent).

## Review

3-lens adversarial review applied 2026-07-11 (schema-seams / agent-UX / testability);
verdicts: revise-then-approve / NEEDS_WORK / NEEDS_WORK. v2 incorporates:
- HIGH fixed: SearchHit physically lacked the fields the filter needs → type + both-store
  SQL extension (S3); CorpusService.set was an unguarded second write path → D10
  writer-guard + re-validation (S2); ADR create-path error collapse would misreport
  validity errors → issue-forwarding fix (S1, the twice-paid SPEC-042 T1 bug class);
  feeding-source "pinned by slug in config" premise was factually wrong + status warning
  risked SSOT re-derivation → D5 correction + D8 shared-helper mandate (S4+U10); Embed
  spliced stale content unmarked → D9 degrade (U1); feed banner was promised but wired
  nowhere and tested nowhere → D4 third wiring site + AC-MH-12 (U2); MCP lore_get returned
  raw content with zero validity signal on the one surface agents actually use → D6
  validity_state (U3); AC-MH-5's "unchanged ranking" was vacuous on InMemoryStore (score
  always 0) → order-preservation oracle (T2); "in ONE write" overstated atomicity that no
  store provides → D2 pinned ordering + idempotent-repair semantics + CAS-technique ERROR
  coverage (S5+T6, independently found by two lenses).
- MED fixed: two-command supersede reintroduced silent rot at workflow level → D11
  orchestration + loud orphan UX + AC-MH-13 (U6); undo asymmetry invisible to MCP →
  structured decision_status_unchanged field (U7); judge materials could carry stale
  parent content unmarked → D9 staleness notice (U5); now-seam unpinned at
  CorpusService/OutlineService → D3 defaultNow params (T1); AC-MH-8 spawn-weight → deep
  logic moved to AC-MH-12, bun file smoke-only + assertFreshBinary (T3+T7); ULID vs slug
  persistence unspecified → resolve-and-store-ULID pinned (S7); future-check would have
  violated core wall-clock purity → D1 validation split (S8); filter-before-slice resolver
  trap called out (S6); Overview overclaim narrowed to the honest surface list (U4).
- LOW fixed: equality boundary, NOT_FOUND ERROR cases, resolver exhaustion, banner format
  edge cases (no-reason / deleted successor), tool-count literal named, reason-cap
  successor-pointer generalization (invalidated_by for any target type), H2-next
  commitment noted.
- Confirmed sound by all lenses: extra-nested validity (zero migration), isInvalidated
  pure-predicate SSOT, ValidityService as sole mutator, status⊥validity orthogonality,
  --raw regression kept (structurally dead today, guards a real future hoist).


## Acceptance Criteria (structured)

- [⚑] [script] AC-MH-1: Pure layer: absent validity means valid and effectiveValidAt falls back to created_at; invalid_at >= valid_at enforced in schema with equality ACCEPTED (boundary); invalid_at < valid_at rejected; reason over 500 rejected; isInvalidated flips exactly at the injected nowIso instant; NO future-date check here (service-owned per D1 split)
  script: test — bunx vitest run packages/core/tests/validity.test.ts
- [⚑] [script] AC-MH-2: invalidate happy path writes invalid_at/reason, preserves sibling extra keys verbatim, bumps version, audits with details.version; future invalid_at rejected at the service seam; nonexistent target DOC_NOT_FOUND; unresolvable supersededBy DOC_NOT_FOUND naming the bad ref; persisted invalidated_by/superseded_by are resolved ULIDs even when a slug was passed
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-service.test.ts
- [⚑] [script] AC-MH-3: ADR convergence with pinned ordering: supersededBy sets invalid_at + decision_status=superseded + superseded_by + supersedes link with doc-write BEFORE link-write; without supersededBy decision_status=deprecated and no link; non-knowledge/adr target VALIDATION_ERROR naming allowed types; partial-failure recovery: with link-add forced to fail (CAS technique) the doc half commits and re-running the same invalidate idempotently repairs the missing link
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-service.test.ts
- [⚑] [script] AC-MH-4: undo clears invalid_at/invalidated_by/reason, bumps version, audits; decision_status stays superseded AND the result carries structured decision_status_unchanged=superseded in CLI --json and MCP payloads alike; undo on a never-invalidated doc VALIDATION_ERROR
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-service.test.ts
- [⚑] [script] AC-MH-5: search and list exclude invalidated knowledge+adr by default; include_invalid restores them and the relative ORDER of surviving doc ids is unchanged between the two result sets (order, not score, is the oracle on InMemoryStore); future valid_at does NOT exclude; now injected via the D3 seam in every case
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-filtering.test.ts
- [⚑] [script] AC-MH-6: RecentDecisions filters BEFORE slice so next-most-recent backfills the limit; all candidates invalidated yields short/empty list not an error; RelatedOf skips invalidated targets; Embed degrades to the skip-note instead of splicing stale content and includeInvalid embeds WITH an inline banner line; includeInvalid restores RecentDecisions/RelatedOf; ChildrenOf/ActivePlans/ModuleTree/HealthStats unchanged (REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/service/outline-validity.test.ts
- [⚑] [script] AC-MH-7: lore get non-raw + export-docs render the D4 banner with pinned format: no-reason means no dangling separator; soft-deleted successor renders (deleted) suffix; no banner on valid docs; --raw never carries it (REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/validity-projection.test.ts
- [⚑] [script] AC-MH-8: Spawned CLI smoke (assertFreshBinary beforeAll, budget-conscious): invalidate happy exit 0; undo-on-never-invalidated exit 4; non-knowledge/adr target exit 4; search hides then --include-invalid shows with [invalid] badge; create adr --supersedes creates+invalidates+links in one command; lore status warning STRING surfaces for one pre-armed invalidated-feeding-source fixture
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-invalidate.bun.test.ts
- [⚑] [script] AC-MH-9: MCP parity: lore_invalidate requires by and deep-equals CLI --json (envelopes unwrapped); lore_search/lore_list include_invalid equivalent to CLI flags; lore_get payload carries computed validity_state (invalidated boolean + invalid_at + invalidated_by_slug + reason) for invalidated docs and invalidated=false otherwise; expectedTools gains lore_invalidate and length literal 28 to 29
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-invalidate.test.ts
- [⚑] [script] AC-MH-10: Boundary+guard: re-invalidating keeps ORIGINAL invalid_at while refreshing reason/invalidated_by (first signal wins); legacy doc without validity round-trips set/get untouched; D10 guard: CorpusService.set changing extra.validity is VALIDATION_ERROR naming lore invalidate; malformed validity via set rejected with the REAL issue message; ADR create with valid decision_status + malformed validity reports the validity issue not the misleading decision_status message (S1 REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-service.test.ts
- [○] [human] AC-MH-11: Owner-executed (D12, never self-recorded by the orchestrating agent) throwaway-corpus script: create knowledge K1; lore invalidate K1 --reason obsolete; lore search hides K1; lore search --include-invalid shows it with [invalid] badge; lore get K1 shows the INVALIDATED banner; lore invalidate K1 --undo restores default-search visibility
- [⚑] [script] AC-MH-12: Loud composed surfaces: lore feed pack renders the D4 banner when the discovered feeding-skill doc is invalidated (feed-flow wiring site); review-judge prompt gains the Staleness Notice section when the bundle doc or parent is invalidated and NOT otherwise; lore status report carries the invalidated-feeding-source warning computed via the SAME SessionService armed-gate helper bootstrap uses (no second derivation)
  script: test — bunx vitest run packages/lore/tests/unit/service/validity-feed-and-judge.test.ts
- [⚑] [script] AC-MH-13: create --supersedes composes create then invalidate with ValidityService as sole mutator; with the invalidate step forced to fail the command reports nonzero AND prints the exact repair command naming both slugs (loud orphan, never silent)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/validity-supersede-orchestration.test.ts

## Code anchors

- packages/core/src/validity.ts
- packages/lore/src/service/validity-service.ts
- packages/lore/src/flows/supersede-flow.ts
