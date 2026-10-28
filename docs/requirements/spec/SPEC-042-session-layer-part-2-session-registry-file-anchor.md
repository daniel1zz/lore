---
id: SPEC-042
type: spec
role: spec
title: "Session layer part 2: session registry + file-anchor claim safety (S3)"
status: approved
priority: high
created: 2026-07-11
updated: 2026-10-27
tags: [session, claims, file-anchors, spec-042, write-conflict]
---
# SPEC-042 — Session layer part 2: session registry + file-anchor claim safety (PRD §15 S3)

> spec_kind: feature. Upstream: PRD-001 §15 (S3, committed v0.8, G10). Predecessors:
> SPEC-025 (claim lease + computed readiness), SPEC-041 (S1 bootstrap + S2 handoff).
> Consumption receipts stay OUT (deferred from SPEC-041 D5 — they would make
> `feed session-resume` a write path; they need their own design).
> v2 — revised after 3-lens adversarial review (schema-seams / agent-UX / testability);
> revision log in §Review.

## Overview/Goal

The third-ranked §15 pain point is multi-session write conflict. Today the worktree-mutex
rule ("tasks with intersecting File Anchors must not run concurrently") is a CLAUDE.md
*convention* enforced only by orchestrator discipline: file anchors live as prose inside
task `content` (zero code consumers), and nothing at the task-claim gate rejects a claim
whose declared files are already being worked under a fresh foreign claim. Separately,
there is no cross-plan view of WHO is working: claims are per-task rows; no surface groups
them into sessions (actor, machine, branch, held claims — PRD §15 S3).

**Goal**: (a) a session registry as a pure read-side projection over fresh claims — no new
storage, no daemon, freshness = the existing claim TTL (SPEC-025 ethos); (b) typed
`task.extra.file_anchors` plus a deterministic anchor-overlap predicate added to the
`task-claim` gate — the same convention→predicate upgrade P2 made for upstream approval.

**Honest-topology framing (review U1/U3)**: this team's real dispatch model is ONE machine,
one orchestrator, N worktree implementer subagents. Both headline mechanisms key on actor
identity — they are only as strong as the identity discipline D10 mandates. The spec makes
that precondition explicit instead of assuming a multi-machine topology that doesn't exist.

## Design Decisions

- **D1 — Sessions are derived, never stored.** A "session" = the group of FRESH claims
  sharing the composite key `(by, machine, worktree)`; branches and task slugs are
  aggregated from the member claims. An absent `machine`/`worktree` is a valid, stable
  grouping key equal to itself (review S7): legacy machine-less claims by one actor group
  into ONE session, distinguishable from captured values only by the field's absence.
  `worktree` participates in the key because on a single-machine team it is the field that
  actually discriminates concurrent agents (review U3). Staleness is computed read-side
  against `workflow.claim_ttl_minutes` — no new config key, no daemon, no heartbeat.
  *Rejected*: explicit session records (need an open/close lifecycle → daemon-shaped,
  violates the §15 non-goal; and `lore bootstrap` is contractually read-only per AC-SL-2,
  so it could never write them anyway); grouping by `(by, machine)` only (collapses N
  same-machine agents into one row — dead on the team's actual topology).
- **D2 — Claim schema additive extension + carry-forward refresh** (`taskClaimSchema`,
  `@lore/core` `task-workflow.ts`): `machine?: string`, `worktree?: string` join
  `{by, at, branch?}`. Capture: CLI auto-captures `machine = os.hostname()` ONLY;
  `worktree` and `branch` are explicit-only (`--worktree`, `--branch`) — an honest absent
  field beats a confidently-wrong `process.cwd()` captured in the orchestrator's process
  before dispatch (review U2: auto-captured cwd would describe the dispatcher, not the
  worktree the work happens in, and no read-side mechanism could detect that lie). MCP
  `lore_claim` takes all three as explicit optional fields (no ambient capture server-side
  — the server's hostname/cwd describe the server). **Refresh semantics (review S3 — the
  draft's full-rebuild wording specified a bug)**: a same-holder refresh MERGES FORWARD the
  existing claim's `branch`/`machine`/`worktree`, with explicitly re-passed fields
  overriding; a claim by a NEW holder (first acquire, steal, stale takeover) starts fresh
  with no inherited fields. This deliberately changes the pre-042 `branch` full-rebuild
  behavior (an MCP keep-alive refresh must not silently fragment its session grouping);
  REGRESSION AC pins the new contract. Legacy claims without the new fields stay valid.
- **D3 — Typed anchors: `task.extra.file_anchors: string[]`, mutations owned by
  `TaskWorkflowService`.** Normalized repo-relative POSIX paths; a trailing `/` declares a
  directory scope (preserved by normalization, semantically folded by D4). Validation via a
  shared pure fn `normalizeFileAnchors` in `@lore/core`: each entry non-empty, no `..`
  segments, no leading `/`, no `\`; `./`-prefix and duplicate separators normalized away;
  duplicates (post-normalization, per D4 equivalence) dropped; max 50 entries (the evidence
  cap precedent), each ≤ 512 chars. Authoring surfaces: `lore create task --anchor <path>`
  (repeatable; validated in `CorpusService._createImpl` beside the phase cross-entity
  checks) and a `lore anchor add|rm|list <task>` command group (the `lore phase` precedent)
  backed by `TaskWorkflowService.setAnchors`-family methods that read-modify-write via the
  existing `writeTaskExtra` plumbing — preserving `extra.claim`/`extra.verification_evidence`
  structurally instead of by adapter-side discipline. **`lore set --anchor` does not exist**
  (review S2 + U5): `CorpusService.set` replaces `extra` wholesale (its documented
  behavior), so routing anchor edits through it would let a supported flag silently delete
  another service's owned state, and a full-replace flag is a safety footgun besides
  (forgetting one prior anchor silently removes protection others rely on) — add/rm verbs
  are non-destructive by construction. The prose "File anchors:" convention inside
  `content` remains legal but is NOT parsed — the typed field is the only thing the gate
  reads (SSOT). *Rejected*: parsing prose (fragile, un-typed); glob anchors (matcher
  dependency + ambiguity; directory scopes cover the dispatch use-case); `lore set
  --anchor` full-replace (above).
- **D4 — `anchorsOverlap` pure fn in `@lore/core`**:
  `anchorsOverlap(a: string[], b: string[]) → {overlaps: boolean, pairs: [string, string][]}`.
  Model (review S4 — pinned exactly): each normalized anchor parses to
  `(segments: string[], isDir: boolean)` where `isDir` iff the raw string ends in `/`. Two
  anchors overlap iff their `segments` arrays are equal (REGARDLESS of `isDir` on either
  side — `src/a` × `src/a/` OVERLAP), or one side has `isDir === true` and its `segments`
  is a strict prefix of the other's (`src/a/` × `src/a/b.ts` overlaps; `src/a` × `src/ab.ts`
  does not — whole-segment comparison, never string-prefix). Case-sensitive byte compare.
  Either side empty → no overlap. `@invariant` documented precondition-only pure fn
  (review T6): inputs are `normalizeFileAnchors` output; no ERROR path by design —
  enforcement lives solely at the D3 write seams. No IO, no wall-clock (core invariants).
- **D5 — `task-claim` gains predicate `noAnchorOverlap`, evaluated UNCONDITIONALLY**
  (review S1 + T2 — both lenses independently flagged the same hole): `checkTaskClaim`
  is restructured so the `hasSpecParent !== true` short-circuit gates ONLY
  `upstreamApproved`; `noAnchorOverlap` runs for every task whose plan bundle resolved,
  spec ancestor or not (top-level/prd-parented plans are common and are exactly where
  orchestrator discipline is the only current protection). Fails iff some sibling task in
  the SAME plan holds a FRESH claim by a DIFFERENT actor whose declared anchors overlap the
  candidate's. Vacuous pass when either side declares no anchors (legacy tasks stay
  claimable; gap surfaced by D7's advisory). **Seams pinned (review T1 + S5)**:
  `_claimImpl` computes `nowIso = now()` BEFORE gating and passes it plus the candidate
  actor down — `enforceClaimGate(task, by, nowIso)`; the new context-builder (co-located
  with `buildUpstreamSpecContext`, populating `candidateBy`, `candidateAnchors`,
  `siblingClaims: [{slug, title, by, at, stale, anchors}]` UNCONDITIONALLY whenever a plan
  bundle was fetched) precomputes each sibling's `stale` from that SAME `nowIso` +
  `claimTtlMinutes` — `GateEnforcer.enforce` stays a pure function of `(config, checkpoint,
  ctx)` with zero wall-clock reads. `getPlanBundle` already returns the siblings — zero
  extra IO. **Failure is machine-distinguishable (review U4)**: the anchor predicate's
  failure carries `field: "gate:task-claim:anchor-overlap"` (upstream-approval keeps
  `"gate:task-claim"`), so a scripted caller can tell "release the sibling claim" from
  "wait for spec approval" without parsing prose. The feeding pack names the conflicting
  task slug, holder, staleness age, the overlapping path pairs, AND a literal
  copy-pasteable recovery command (`lore release <conflicting-slug> --by <holder> --force`)
  (review U6) — pointers only, never task bodies. *Rejected*: corpus-wide overlap scope
  (crosses plan boundaries the convention never governed; noisy; additively extendable
  later); conservative-fail on missing anchors (breaks every legacy claim at once).
- **D6 — No per-call bypass; per-predicate config granularity.** `--steal` targets the
  lease on the SAME task and does NOT bypass a sibling anchor conflict. Escape hatches:
  release (or steal) the conflicting task's claim first, or disable ONLY the anchor
  predicate via `workflow.gates.task-claim.anchor_overlap.enabled: false` (review U8 — the
  whole-checkpoint knob `workflow.gates.task-claim.enabled` also exists but takes
  upstream-approval gating down with it; the sub-key keeps the blast radius honest).
  *Rejected*: `--force-anchors` (a per-call bypass demotes the predicate back into a
  convention).
- **D7 — Surfacing in `lore ready` / `lore tree` (PRD-named surfaces).** The ready report
  gains `sessions: [{by, machine?, worktree?, branches: string[], task_slugs: string[],
  newest_at}]` (fresh claims only, grouped per D1 — all-stale claims produce NO session
  rows) and a per-task `anchor_conflicts` advisory `[{task_slug, holder, paths: string[]}]`
  computed against fresh foreign claims. The `anchorless` advisory (claimed siblings with
  no declared anchors) fires ONLY when at least one sibling task in the plan declares
  non-empty anchors (review U7: partial adoption is the live risk; zero-adoption plans get
  silence, not permanent noise). Everything computed, never stored; read-only proof reuses
  the AC-SL-2 mutation-counting-proxy mechanism. `lore tree` claim badge gains `@branch`
  when present — `[claimed:by@branch (stale) ✔n/✘n]` — branch, not machine, is the
  discriminating field on a single-machine team (review U9); machine/worktree stay in the
  JSON surfaces. *Rejected*: a new `lore sessions` verb (PRD names ready/tree; a third
  surface can follow if the block proves load-bearing); `@machine` badge (constant on this
  topology, burns the annotation slot).
- **D8 — Bootstrap additive field `active_sessions`** (same derived shape as ready's
  `sessions`, computed corpus-wide over active plans): a fresh session learns who else is
  working BEFORE it claims. `bootstrapReportSchema` (Zod) itself is extended — not just the
  report literal: plain `z.object` silently strips unrecognized keys, so a shape/schema
  drift would silently drop the field (review S6); a dedicated schema round-trip REGRESSION
  test pins it. Empty corpus → `[]`. S1 contract intact: read-only, pointers/summaries
  only, titles ≤120.
- **D9 — MCP: one new tool (26 → 27).** `lore_claim` gains optional
  `machine`/`worktree`/`branch` passthrough; `lore_create` (task branch) gains optional
  `file_anchors: string[]`; `lore_anchor_set {id_or_slug, anchors, by}` (declarative
  replace via `TaskWorkflowService`, read-modify-write — MCP agents get a merge-safe anchor
  mutation path so the raw wholesale-`extra` `lore_set` is never the only option, review
  S2); `lore_ready`/`lore_bootstrap` payloads carry the new blocks automatically. tools.ts
  additions follow pre-declared-schema discipline (tsc-hotspot ADR).
- **D10 — Actor-identity discipline for concurrent dispatch (NEW, review U1/U3 — the
  load-bearing precondition).** Both D1 grouping and D5's "different actor" test key on
  `by`. On this team's single-machine topology, if every concurrent session falls through
  to the same OS-username default, the anchor gate never fires and all agents collapse into
  one session row — S3 becomes dead code. The spec therefore MANDATES: any dispatcher
  running sessions concurrently MUST assign each a distinct actor identity — convention
  `agent:<branch-or-task-slug>` — via `--by` or `$LORE_ACTOR` (worktree agents: export
  `LORE_ACTOR` in the dispatch bundle). Claims are made BY THE IMPLEMENTER from inside its
  worktree (so captured identity/worktree are honest), not by the orchestrator on its
  behalf. The CLAUDE.md "Worktree 并发安全" section is updated in this spec's docs scope to
  route through `lore claim`/`lore ready` with this naming. Primary AC scenarios exercise
  DISTINCT actors (the topology the feature exists for), with same-actor as the documented
  pass case, not the main path.

## Scope

**In**: `@lore/core` (`taskClaimSchema` additive fields + carry-forward claim build;
`normalizeFileAnchors` + `anchorsOverlap` + session-projection pure fns — new
`packages/core/src/file-anchors.ts`, tests pinned at `packages/core/tests/file-anchors.test.ts`
(review T8: the dedicated `tests/` convention, NOT colocated `src/`); ready-report +
bootstrap schema additions), `checkpoint-registry.ts` (`noAnchorOverlap` predicate,
restructured `checkTaskClaim`, unconditional claim-ctx builder, anchor-overlap feed
message), `task-workflow-service.ts` (claim capture + carry-forward, `nowIso`-before-gate
reordering, `enforceClaimGate(task, by, nowIso)`, `setAnchors`/`addAnchors`/`removeAnchors`
via `writeTaskExtra`), `corpus-service.ts` (create-time `file_anchors` validation),
`session-service.ts` (`active_sessions`), config schema
(`workflow.gates.task-claim.anchor_overlap.enabled`), CLI (`create --anchor`, `anchor
add|rm|list` command group, `claim --machine/--worktree` + hostname auto-capture,
`ready`/`tree` rendering, `gate task-claim` ctx parity), MCP (`lore_claim`/`lore_create`
fields, `lore_anchor_set`), docs (CLAUDE.md worktree-dispatch section rewritten per D10).

**Out**: consumption receipts (see header); corpus-wide overlap scope; glob anchors;
`lore set --anchor` (D3 — deliberately not built); live presence / message bus; hook
installation; dashboard session views; §16 memory-hygiene fields; any daemon; auto-capture
of `worktree`/`branch` (explicit-only, D2).

## Acceptance Criteria

Runner assignments follow the SPEC-041 split: service/core/MCP tests are vitest on
InMemoryStore (MCP handlers in-process via `_registeredTools`); CLI exit-code contracts
spawn the binary under bun test against a throwaway corpus (mkdtemp, never the repo's own
`.lore/`). Where a test needs staleness, the SAME injected `now()` thunk drives both the
sibling-freshness computation and the target-claim staleness check within one `claim()`
call (D5 seam).

- AC-S3-1 (vitest) `anchorsOverlap`/`normalizeFileAnchors`: equal segments overlap
  regardless of trailing slash (`src/a` × `src/a/` → overlap); directory scope contains
  descendants (`src/a/` × `src/a/b.ts`); segment boundary respected (`src/a` × `src/ab.ts`
  → no); `./`-prefix and duplicate separators normalized; case-sensitive; either side
  empty → no overlap; `pairs` lists every overlapping pair; documented precondition-only
  contract (no ERROR path) asserted via the `@invariant` note + normalize-first round-trip.
- AC-S3-2 (vitest) gate block, distinct-actor primary scenario: sibling task in the same
  plan fresh-claimed by `agent:t1`, candidate claimed by `agent:t2` with overlapping
  anchors → VALIDATION_ERROR with `field: "gate:task-claim:anchor-overlap"`; feeding pack
  names conflicting task slug, holder, overlapping path pairs, AND contains the literal
  runnable recovery command (`lore release <slug> --by <holder> --force`); no doc body text.
- AC-S3-3 (vitest) gate pass/block matrix: stale foreign claim → pass; same-actor overlap →
  pass; disjoint anchors → pass; either side anchor-less → pass; overlap in a DIFFERENT
  plan → pass; **plan with NO spec ancestor + fresh foreign overlap → still blocked**
  (short-circuit regression, reviews S1/T2); upstream-approval failure alone still reports
  `field: "gate:task-claim"` (discriminator separation).
- AC-S3-4 (vitest) claim capture + carry-forward, service level: given claim
  `{by: x, machine: "A", worktree: "/w", branch: "b1"}`, a same-holder `claim(id, {by: x})`
  refresh updates `at` and PRESERVES machine/worktree/branch; re-passing any field
  overrides it; a new-holder acquire (post-release), steal, and stale takeover each start
  fresh with no inherited fields; legacy claims without new fields validate, render,
  refresh (REGRESSION).
- AC-S3-5 (vitest) anchors write seams: create-time `--anchor` set validated + normalized +
  deduped; `TaskWorkflowService.addAnchors`/`removeAnchors` are read-modify-write —
  mutating anchors on a task holding an active claim AND evidence preserves BOTH untouched
  (REGRESSION, review S2); `..` / leading `/` / backslash / empty entry / >50 entries /
  >512-char entry → each VALIDATION_ERROR naming the offending entry.
- AC-S3-6 (vitest) sessions projection: claims by `agent:t1@hostA:/w1` and
  `agent:t2@hostA:/w2` group into TWO sessions (same by+machine, distinct worktree → still
  distinct when by differs; and same-by distinct-worktree → two sessions per D1 key);
  legacy machine-less claims by one actor group into ONE session (absent = stable key,
  review S7); two claims both stale → `sessions: []` (staleness filter NEGATIVE, review
  T5); `anchorless` advisory fires only when ≥1 sibling declares anchors — zero-adoption
  plan → NO marker (review U7); mutation-counting proxy records zero writes during ready
  AND bootstrap.
- AC-S3-7 (bun) CLI contract: `create task --anchor` repeatable persists; `lore anchor
  add/rm/list` round-trip; invalid anchor → exit 2; `claim --machine` override beats
  auto-capture; auto-captured machine equals `os.hostname()` computed IN the test file at
  run time (never hardcoded, review T7); `--worktree` absent → no worktree field (no cwd
  capture, D2); anchor-overlap block → nonzero exit, stderr names the conflicting task slug
  and contains the recovery command.
- AC-S3-8 (vitest) MCP parity: `lore_claim` `{machine, worktree, branch}` persisted;
  `lore_anchor_set` replaces anchors while preserving claim/evidence; `lore_ready` payload
  equals CLI `--json` on the same seeded corpus after unwrapping envelopes and normalizing
  wall-clock-derived subfields (`age_minutes`, `stale`) — structural equality elsewhere,
  self-consistency asserted for the normalized fields (review T3); `lore_bootstrap` exposes
  `active_sessions`.
- AC-S3-9 (vitest) tree badge: `[claimed:by@branch …]` with branch, `[claimed:by …]`
  without; stale suffix and evidence counts unchanged (REGRESSION).
- AC-S3-10 (vitest) boundary + schema drift: empty corpus → `active_sessions: []`; plan
  with zero claims → `sessions: []`, empty `anchor_conflicts`; single claim → singleton
  session; `bootstrapReportSchema.parse` round-trips a report WITH `active_sessions`
  populated — the field survives parse (Zod strip regression, review S6).
- AC-S3-11 (vitest) state: `--steal` on the candidate task with a sibling anchor conflict
  still blocks with the anchor-overlap discriminator; after `release` of the conflicting
  claim the same call succeeds; a refresh keep-alive (same holder, no fields re-passed)
  does not change the session grouping key (D2 carry-forward feeding D1).
- AC-S3-12 (human) live dual-session test, exact script (review T10): session A runs
  `lore claim <task-a> --by agent:a --branch wt-a`; session B runs `lore claim <task-b>
  --by agent:b --branch wt-b` where task-b's anchors overlap task-a's → expect exit ≠ 0 and
  stderr naming task-a + `agent:a` + the paths + the recovery command; `lore ready <plan>`
  while both live shows two sessions; after `lore release <task-a> --by agent:a`, session
  B's identical claim retry succeeds.

## Review

3-lens adversarial review applied 2026-07-11 (schema-seams, agent-UX, testability); all
three lenses independently returned revise-then-approve; v2 incorporates:
- HIGH fixed: actor-identity discipline promoted to D10 + distinct-actor primary AC
  scenarios (U1/U3 — predicate and grouping were topology-dead without it); `worktree`
  auto-capture dropped, explicit-only + claims made by implementers not dispatchers (U2 —
  honest-null over confidently-wrong cwd); `checkTaskClaim` short-circuit restructure
  pinned so `noAnchorOverlap` runs unconditionally (S1+T2, found independently by two
  lenses); `now()` seam threading pinned — `nowIso` computed before `enforceClaimGate(task,
  by, nowIso)`, sibling staleness precomputed caller-side, GateEnforcer stays wall-clock
  free (T1+S5); anchor mutations moved off `CorpusService.set` (wholesale-extra replace
  would delete claim/evidence) onto `TaskWorkflowService` read-modify-write verbs + MCP
  `lore_anchor_set` (S2); claim refresh carry-forward replaces full-rebuild — the draft's
  AC-S3-4 wording literally specified the fragmentation bug (S3).
- MED fixed: anchor failure gets its own `field` discriminator + literal recovery command
  in the feeding pack (U4/U6); `lore set --anchor` full-replace footgun replaced by
  `anchor add|rm|list` command group (U5); `anchorless` advisory conditioned on partial
  adoption (U7); per-predicate config sub-key narrows the escape-hatch blast radius (U8);
  trailing-slash equivalence pinned in D4's (segments, isDir) model (S4); MCP deep-equal
  redefined around wall-clock-derived fields (T3); refresh semantics given a worked example
  (T4); all-stale sessions NEGATIVE case added (T5); anchorsOverlap documented as
  precondition-only with no ERROR path by design (T6).
- LOW fixed: tree badge switched `@machine` → `@branch` (U9); hostname asserted via
  in-test computation (T7); core test path pinned to `packages/core/tests/` (T8); 50-entry
  / 512-char anchor caps stated (T9); legacy machine-less grouping key pinned (S7); Zod
  round-trip regression for `active_sessions` (S6); AC-S3-12 given an exact command script
  (T10).
- Confirmed sound by all lenses: derived-not-stored sessions (D1), typed-anchor SSOT over
  prose (D3), checkpointRegistry/GateEnforcer reuse without duplication, additive schema
  strategy, runner split.


## Acceptance Criteria (structured)

- [⚑] [script] AC-S3-1: anchorsOverlap/normalizeFileAnchors: equal segments overlap regardless of trailing slash (src/a vs src/a/ overlap); directory scope contains descendants; segment boundary respected (src/a vs src/ab.ts no); ./-prefix and duplicate separators normalized; case-sensitive; either side empty means no overlap; pairs lists every overlapping pair; precondition-only contract (no ERROR path) documented and normalize-first round-trip asserted
  script: test — bunx vitest run packages/core/tests/file-anchors.test.ts
- [⚑] [script] AC-S3-2: Distinct-actor primary scenario: sibling fresh-claimed by agent:t1, candidate claimed by agent:t2 with overlapping anchors fails VALIDATION_ERROR with field gate:task-claim:anchor-overlap; feeding pack names conflicting task slug, holder, overlapping path pairs AND a literal runnable recovery command (lore release <slug> --by <holder> --force); no doc body text
  script: test — bunx vitest run packages/lore/tests/unit/service/claim-anchor-gate.test.ts
- [⚑] [script] AC-S3-3: Pass/block matrix: stale foreign claim, same-actor overlap, disjoint anchors, either side anchor-less, and different-plan overlap all pass; plan with NO spec ancestor plus fresh foreign overlap is STILL BLOCKED (short-circuit regression); upstream-approval failure alone reports field gate:task-claim (discriminator separation)
  script: test — bunx vitest run packages/lore/tests/unit/service/claim-anchor-gate.test.ts
- [⚑] [script] AC-S3-4: Carry-forward refresh: same-holder claim(id,{by:x}) after {machine:A,worktree:/w,branch:b1} updates at and PRESERVES machine/worktree/branch; re-passed fields override; new-holder acquire, steal, and stale takeover each start fresh with no inherited fields; legacy claims without new fields validate, render, refresh (REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/service/claim-session-fields.test.ts
- [⚑] [script] AC-S3-5: Anchor write seams: create-time --anchor set validated+normalized+deduped; TaskWorkflowService addAnchors/removeAnchors are read-modify-write and preserve an active claim AND evidence untouched (REGRESSION); .. / leading / / backslash / empty entry / over-50 entries / over-512-char entry each rejected with VALIDATION_ERROR naming the offending entry
  script: test — bunx vitest run packages/lore/tests/unit/service/file-anchors-validation.test.ts
- [⚑] [script] AC-S3-6: Sessions projection: distinct-by claims group into distinct sessions; same-by same-machine distinct-worktree claims form TWO sessions (D1 composite key); legacy machine-less claims by one actor form ONE session (absent field is a stable key); two claims both stale yield sessions [] (staleness filter); anchorless advisory fires only when at least one sibling declares anchors, zero-adoption plan shows NO marker; mutation-counting proxy records zero writes during ready and bootstrap
  script: test — bunx vitest run packages/lore/tests/unit/service/session-registry.test.ts
- [⊖] [script] AC-S3-8: MCP parity: lore_claim machine/worktree/branch persisted; lore_anchor_set replaces anchors while preserving claim and evidence; lore_ready equals CLI --json after unwrapping envelopes and normalizing wall-clock-derived subfields (age_minutes, stale) with self-consistency asserted on the normalized fields; lore_bootstrap exposes active_sessions
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-session-registry.test.ts
- [⚑] [script] AC-S3-9: Tree claim badge renders claimed:by@branch when branch present and claimed:by without; stale suffix and evidence counts unchanged (REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/tree-claim-badge.test.ts
- [⚑] [script] AC-S3-10: Boundary + schema drift: empty corpus yields active_sessions []; plan with zero claims yields sessions [] and empty anchor_conflicts; single claim forms a singleton session; bootstrapReportSchema.parse round-trips a report with populated active_sessions (Zod strip regression)
  script: test — bunx vitest run packages/lore/tests/unit/service/session-registry.test.ts
- [⚑] [script] AC-S3-11: State: steal on the candidate task with a sibling anchor conflict still blocks with the anchor-overlap discriminator; after release of the conflicting claim the same call succeeds; a same-holder keep-alive refresh with no fields re-passed does not change the session grouping key
  script: test — bunx vitest run packages/lore/tests/unit/service/claim-anchor-gate.test.ts
- [○] [human] AC-S3-12: Live dual-session script: session A claims task-a with --by agent:a --branch wt-a; session B claims anchor-overlapping task-b with --by agent:b --branch wt-b and gets nonzero exit with stderr naming task-a, agent:a, the paths and the recovery command; lore ready during both shows two sessions; after lore release task-a --by agent:a the identical retry succeeds
- [⚑] [script] AC-S3-7: Spawned CLI on throwaway corpus: create task --anchor repeatable persists; lore anchor add/rm/list round-trip; invalid anchor exits 4 (VALIDATION_ERROR pipeline — validation lives solely in normalizeFileAnchors per D3, no duplicated CLI pre-check; cli-handoff exit-4 precedent, AC corrected with evidence pre-verify per SPEC-041 retro learning 3); claim --machine override beats auto-capture; auto-captured machine equals os.hostname() computed in the test file at run time; omitted --worktree yields no worktree field (no cwd capture); anchor-overlap claim block exits 4 with stderr carrying the gate:task-claim:anchor-overlap discriminator and ANCHOR_OVERLAP reason — the rich feeding pack (conflicting slug/holder/paths + literal recovery command) is the lore gate task-claim pre-flight surface, asserted by the gate-parity regression suite and AC-S3-2 at the registry layer
  script: test — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-claim-anchors.bun.test.ts
  other_command=1

## Code anchors

- packages/core/src/session.ts
- packages/core/src/file-anchors.ts
