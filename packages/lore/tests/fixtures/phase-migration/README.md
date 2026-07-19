# phase-migration fixtures (SPEC-056 migration shape spike)

Produced by `task-skill-research-migration-shape-spike-read-only-corpus-copy`
(plan `plan-implementation-spec-056-phase-execution-model-strategy-a`, spec
`spec-spec-056-phase-execution-model-phase-doc-type-computed-comp`, D6/D6a/P7
edge rules) as a **read-only** spike: no write ever touched the live
`.lore/lore.db`. Method: `cp .lore/lore.db{,-shm,-wal}` into a scratch dir,
`PRAGMA wal_checkpoint(FULL)` on the copy, then `sqlite3 -json` queries
against the copy only. The copy was discarded after analysis; nothing here
was captured by running `lore` against the live corpus.

## Files

- **`live-corpus-census.json`** — the raw shape census of the live corpus's
  167 active task docs / 42 plan docs at scan time (2026-07-19). Provenance
  record for `seed.json`'s realistic baseline shapes. A point-in-time
  snapshot, not live data — do not treat it as ground truth for a real
  migration run; regenerate from a fresh corpus copy if needed.
- **`seed.json`** — the fixture itself: 3 plan docs + 13 task docs,
  DocRecord-shaped (`id`/`slug`/`type`/`role`/`title`/`status`/`priority`/
  `content`/`parent_id`/`extra`/`tags`/`version`/`created_at`/`updated_at`/
  `created_by`/`deleted_at`), directly insertable into an `InMemoryStore` or
  a throwaway SQLite copy for a `PhaseMigrationService` dry-run test. Every
  `extra` shape was validated against the real `taskExtraSchema` /
  `planExtraSchema` / `evidenceEntrySchema` / `taskClaimSchema` (`@lore/core`)
  before being committed — see `scenario_index` inside the file for a
  task-slug → edge-rule → expected-post-migration-outcome mapping.

## Why synthesized scenarios, not purely live data

AC-P-5 (SPEC-056) requires the fixture to explicitly cover: legacy_phase
residue, a multi-claim group, an evidence array near/over the 50-entry cap,
tasks with/without anchors, and an empty declared plan phase. The live
census shows **none of these edge cases currently exist in this corpus**:

| Required scenario | Live corpus reality |
|---|---|
| `legacy_phase` residue | 0/167 tasks carry `extra.legacy_phase` |
| Multi-claim collapse group | Only 3/167 tasks hold a fresh claim at scan time, on 2 different plans, never 2+ on the same plan+phase |
| Evidence near/over the 50-cap | Max single-task evidence array observed: 16 entries |
| Empty declared plan phase | 0/25 plans-with-declared-phases have an unreferenced phase name |

So `seed.json` combines **live-observed baseline shapes** (the 8 distinct
`extra`-key signatures found by the census, reproduced faithfully — anchor
mixes including directory-scope trailing-slash entries, `ac_ref`/
`attestation`/`attestation.first_seen` combinations, bare/minimal tasks) with
**synthesized edge-case tasks** for the 4 scenarios above, deliberately
layered onto realistic-looking plan/task data rather than isolated toy
fixtures, so a future migration test exercises the P7 edge rules and the
common-case shapes in one self-contained 3-plan/13-task corpus.

## Shape census summary (full detail in `live-corpus-census.json`)

- 167 active task docs across 42 plans; 147 archived / 3 approved / 17 draft.
- 130/167 tasks carry evidence (457 entries total, sizes 1–16); 37/167 carry none.
- 53/167 carry `file_anchors` (13 of those include a directory-scope entry); 114/167 carry none.
- 119/167 carry `extra.phase`; 0/167 carry `extra.legacy_phase`; 48/167 carry neither.
- 233 evidence entries carry `ac_ref`; 151 carry `attestation`; 42 of those carry `attestation.first_seen: true`.
- 0 evidence entries carry `origin` (the field does not exist pre-SPEC-056 — it's the migration's own annotation).
- 8 distinct `extra`-key signatures observed (full breakdown in the census file); `seed.json` covers all 8 plus 2 synthesized (`claim`+full-combo, `legacy_phase`-only) = 10 total.

## `seed.json` scenario index (see the file's `scenario_index` array for full text)

| Plan | Task(s) | Edge rule covered |
|---|---|---|
| plan-alpha-legacy-and-multiclaim | task-alpha-build-holder-displaced + task-alpha-build-holder-winner | P7 multi-claim collapse (older holder displaced → `track` note; newer holder wins) + D6 merged evidence 20+35=55 > 50-cap, preserved via `origin`, never truncated |
| plan-alpha-legacy-and-multiclaim | task-alpha-legacy-phase-residue | D6/P7 `legacy_phase` grouping fallback |
| plan-alpha-legacy-and-multiclaim | task-alpha-docs-bare | baseline bare task |
| plan-alpha-legacy-and-multiclaim | *(declared phase `ghost`, no task)* | P7 empty declared phase → still migrates to an empty phase doc |
| plan-beta-anchors-and-scale | task-beta-core-mixed-anchors | file+dir-scope anchor mix; ac_ref/attestation/legacy-bare evidence mix |
| plan-beta-anchors-and-scale | task-beta-core-untouched | baseline untouched draft |
| plan-beta-anchors-and-scale | task-beta-no-phase-field-at-all | P7 one-phase-per-task fallback (no `phase`, no `legacy_phase` at all) |
| plan-beta-anchors-and-scale | task-beta-core-archived-first-seen | `attestation.first_seen: true` isolated single-entry case |
| plan-gamma-boundary-and-empty | task-gamma-solo-near-cap-evidence | D6 boundary: 49 entries, SOLO in its phase group, stays under cap |
| plan-gamma-boundary-and-empty | task-gamma-untouched-draft | baseline — simplest possible shape `(plan_id,)` |
| plan-gamma-boundary-and-empty | *(declared phase `orphan`, no task)* | P7 empty declared phase, second independent instance (proves generality) |
| plan-gamma-boundary-and-empty | task-gamma-evidence-no-phase-no-anchors | live-census signature `(plan_id, verification_evidence)` |
| plan-gamma-boundary-and-empty | task-gamma-freshly-claimed-no-evidence | live-census signature `(claim, file_anchors, phase, plan_id)` |
| plan-gamma-boundary-and-empty | task-gamma-anchors-declared-not-started | live-census signature `(file_anchors, phase, plan_id)` |

## Consumer-rename grep list

The full grep list of every call site touching `doc.type === "task"`
semantics, `getPlanBundle().tasks`, `resolveTargetTask`, `assessPlan`
bundle consumption, CLI/MCP badges, and `lore tree` rendering — the P1
consumer-rename inventory this spike also produced — was appended directly
to the affected P2/P3 implement task docs in the corpus (not duplicated
here, to avoid a second drifting copy): see the "Consumer call sites (spike
output)" section on:

- `task-skill-implement-phaseworkflowservice-rename-checkpoint-conf`
- `task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence`
- `task-skill-implement-phasemigrationservice`

(`lore get <slug>` to read.)
