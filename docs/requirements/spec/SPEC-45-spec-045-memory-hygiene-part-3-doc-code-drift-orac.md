---
id: SPEC-049
type: spec
role: spec
title: "SPEC-045 — Memory hygiene part 3: doc-code drift oracle (H3)"
status: approved
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [memory-hygiene, drift, code-anchors, spec-045]
parent: PRD-001
---
# SPEC-045 — Memory hygiene part 3: doc-code drift oracle (PRD §16 H3)

> spec_kind: feature. Upstream: PRD-001 §16 (H3, committed v0.8, G11: "`lore status
> --check-drift` with 0 false-negatives on a seeded drift fixture"). H1 (SPEC-043
> invalidation) and H2 (SPEC-044 staleness probes) are landed; H3 is the deterministic
> third leg — zero LLM calls, CI-runnable. v2 — revised after 3-lens adversarial review
> (schema-seams S1–S10 / agent-UX U1–U10 / testability T1–T10); revision log in §Review.

## Overview/Goal

H1 catches staleness someone SIGNALS; H2 catches staleness a judge SUSPECTS. Both are
about knowledge/ADR content. Specs rot differently: a spec names concrete code artifacts
("`selectProbeCandidates` in `packages/core/src/staleness.ts`") and the CODE moves —
files are deleted or renamed, exports disappear — while the spec text silently keeps
pointing at ghosts. Today nothing checks that binding.

**Goal**: specs may declare **code anchors** — repo-relative file paths, directory
scopes, or `path#ExportedSymbol` bindings — in `spec.extra.code_anchors`. `lore status
--check-drift` verifies every declared anchor against the working tree. **Deterministic,
zero LLM calls, CI-runnable** (exit 3 on drift). The oracle's contract is **zero
false-negatives** (G11): it never reports "consistent" while a declared file/dir/symbol
is actually missing — including under probe IO errors, which become drift rows, never
silent scan aborts. False POSITIVES are tolerated and documented. Drift is a REPORT,
not a mutation.

## Design Decisions

- **D1 — Anchor grammar: one string form, `path[#Symbol]`**, stored as
  `spec.extra.code_anchors: string[]`. Parse/validate is **per-entry on the FULL raw
  string** (`parseCodeAnchor(raw)` splits on the LAST `#`, THEN the path part goes
  through SPEC-042's `normalizeFileAnchors` rules — never the reverse, and NEVER a
  batched normalize over extracted paths: `normalizeFileAnchors`'s internal Set dedup
  would silently swallow `a.ts#Foo` + `a.ts#Bar` as duplicate paths — review S3).
  Path rules verbatim from `packages/core/src/file-anchors.ts` (POSIX, repo-relative,
  no `..`, trailing `/` = dir scope, ≤512 chars, ≤50 entries). Symbol part:
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/` — ASCII-only (Unicode-named exports cannot be
  anchored, an explicit Scope-Out; authoring rejects them LOUD — review T7); the regex
  deliberately admits reserved words (`default` is meaningful per D3; others just scan
  as `symbol_missing`, the tolerated-FP direction — review S9). Dir anchors MUST NOT
  carry a symbol (loud authoring reject). Zod (`specExtraSchema.code_anchors`)
  validates shape only; grammar runs at EVERY write seam (D6a).
- **D2 — Pure drift core in `@lore/core`** (new `packages/core/src/code-anchors.ts`,
  browser-safe, no fs, no wall-clock): `parseCodeAnchor`, `scanExportedSymbols(source)`,
  and `computeDrift(declared, probes)` → `{consistent, drifts: Array<{spec_id,
  spec_slug, spec_status, anchor, kind}>}` with `kind ∈ file_missing | dir_missing |
  dir_empty | symbol_missing | node_type_mismatch | probe_error` (six kinds — a path
  that exists as the WRONG node type — dir anchor hitting a file or vice versa — is
  `node_type_mismatch`, never collapsed into `*_missing`, review T8; a probe that
  ERRORED is `probe_error`, D4). `consistent` is true ONLY when every anchor
  affirmatively verified — any missing/errored/mismatched probe result ⇒ inconsistent
  (the zero-false-negative property, unit-testable with no filesystem).
- **D3 — Lexical export scan, line-anchored, enumerated forms**:
  `scanExportedSymbols` matches, at line start (leading whitespace allowed — a
  `// export const X` comment does NOT match): `export
  (const|let|var|function|async function|class|abstract class|type|interface|enum) X`,
  `export { A, B as C }` (multi-line brace lists; `as` alias exports the ALIAS), and
  `export default` (matches anchor symbol `default`). Explicitly NOT covered
  (documented false-positive sources, printed as a footnote whenever a
  `symbol_missing` drift is reported): `export * from`, `module.exports`, re-export
  chains, **`export type { X }` type-only brace lists, and destructured exports
  `export const {a, b} = obj`** (review T6). The scan reads the ONE anchored file only.
- **D4 — Filesystem probing via an injected `FsProbe` port; services stay fs-free**:
  `DriftCheckService` (new, `packages/lore/src/service/drift-check-service.ts`) loads
  all non-deleted specs (existing `StoreInterface.findMany({type: "spec"})` — no new
  store method needed), collects per-entry-parsed anchors, probes each DISTINCT path
  once (probe-level dedup — a separate, later concern from D1's per-entry validation),
  and feeds results to `computeDrift`. Port: `{stat(path): 'file'|'dir'|'missing',
  readFile(path): string|null, listDir(path): string[]|null}` — **every probe call is
  individually wrapped: a THROWN probe error becomes a `probe_error` drift row for
  that anchor and the scan CONTINUES** (never batch-abort — an aborted scan would be a
  silent false-negative on every remaining anchor, review T2). `listDir` = immediate
  children only, **dotfiles EXCLUDED from the emptiness count** (a dir containing only
  `.gitkeep` reports `dir_empty` — errs toward false positive, the safe direction —
  review S7). The REAL probe (node:fs sync, repo root = `process.cwd()`, same
  assumption as `--check-tree`) is built in the adapter and passed per call.
- **D5 — CLI surface + exit precedence + status.ts restructure**: `lore status
  --check-drift [--json]`; composable with `--check-tree`. **In-scope refactor** (review
  S6/U1): `status.ts`'s `--check-tree` branch currently early-exits
  (`process.exit(4)` on missing blueprint) and cannot compose — both checks become
  value-returning functions combined at the end. Exit precedence (pinned, review U1):
  **any drift found (either check) → 3; else blueprint missing/invalid (tree check
  requested but unarmable) → 4; else 0.** "Real drift" is never masked by "you forgot
  lore.tree.yaml"; both reports always print/emit fully. Worked example (review U10):
  `workflow.drift.enabled: false` + inconsistent tree → drift section prints its
  explicit `disabled` note, tree section prints its drifts, exit 3. Unarmed corpus
  (zero specs declare anchors) → `armed: false` stated loud, exit 0. Every drift row
  renders `spec-slug → anchor (kind)` PLUS a literal repair hint (review U5):
  `fix: lore anchor rm <spec-slug> '<anchor>' (or update the path/export)`. Output
  ordering is deterministic (sort by spec_slug, then anchor). `--json` emits
  `data.code_drift = {armed, enabled, consistent, specs_checked, status_breakdown,
  drifts[]}` — the scanned population is countable, never implicit (review U7: ALL
  non-deleted specs are checked regardless of status — a draft spec anchoring
  not-yet-written code IS a legitimate aspirational signal; the row's `spec_status`
  field lets consumers filter). Plain `lore status` (no flag) does NOT probe the
  filesystem — it prints a store-only `code anchors declared: N specs (run --check-drift
  to verify)` line when N > 0 (review U4: unlike SPEC-044's always-on
  `open_stale_candidates`, drift verification costs fs IO; the cheap armed-count keeps
  the surface honest without probing).
- **D6 — Authoring, doc-type-dispatched with two write shapes**: `lore anchor
  add/rm/list <target>` resolves the target doc FIRST, then dispatches by type: task →
  `TaskWorkflowService` file_anchors (byte-identical, REGRESSION); spec →
  `DriftCheckService.addCodeAnchors/removeCodeAnchors` (incremental RMW,
  union/difference, preserving ALL sibling extra keys, CAS via `expected_version` —
  a concurrent conflicting write surfaces CONFLICT, never lost-update, review T5);
  any other type → VALIDATION_ERROR exit 4 naming "task or spec" (review S5). `lore
  create spec --code-anchor <path[#Symbol]>` (repeatable) authors at create — a
  DISTINCT flag from task `--anchor` (review U2: one flag with two sub-grammars is a
  trap); symmetrically, task-anchor authoring seams (`--anchor`, `lore anchor
  add <task>`, `lore_anchor_set` task target) REJECT entries containing `#` loud,
  naming the spec grammar (validation at the authoring seam only — stored legacy
  values are untouched).
- **D6a — Grammar runs at EVERY write seam (no side doors — review S1/S2)**:
  `CorpusService._createImpl` gains a `type === "spec"` branch running per-entry
  grammar on any `extra.code_anchors` present (mirroring the existing task
  `file_anchors` branch), and `CorpusService.set` re-validates grammar (not just Zod
  shape) whenever the incoming extra carries `code_anchors` — malformed entries are
  rejected LOUD naming the offending anchor. Wholesale-extra clobber-by-omission via
  `set` remains the documented file_anchors-style limitation (the RMW verbs are the
  sanctioned path); unlike SPEC-043's validity there is no hard block — anchors carry
  no service-computed state that a user must not hand-edit, they just must PARSE.
- **D7 — MCP parity WITHOUT a new tool**: `lore_status` gains optional
  `check_drift?: boolean` — **this is the tool's FIRST input schema** (it is
  registered argless today; the change migrates it to the schema-carrying
  registration path, named explicitly so the implementer doesn't bolt an inline
  schema onto the 3-arg form — review S10/U9); no-arg calls stay byte-identical
  (REGRESSION, review T10). Payload `code_drift` deep-equals CLI `--json` via a
  shared builder in **`flows/drift-flow.ts`** (named module, single derivation site —
  review S8; staleness-flow precedent). `lore_anchor_set` gains spec targets with
  **declarative REPLACE semantics — matching its existing task behavior and its name —
  NOT the CLI's incremental add/rm** (review U3/S4): the tool description documents
  the divergence in bold ("replaces the full code_anchors array; use CLI `lore anchor
  add` for incremental edits"). Tool count stays 30. `lore bootstrap` gains the same
  store-only `code_anchor_specs: N` count plain-status shows (one cheap query, shared
  helper — review U8); bootstrap never fs-probes.
- **D8 — Config brake**: `workflow.drift.enabled` (boolean, default true) — when
  false, `--check-drift` exits 0 with an explicit `disabled` note (LOUD skip; JSON
  `enabled: false`); strict-Zod rejects unknown keys/types. No other knobs this cycle.
- **D9 — Drift never mutates**: no invalidation, no status transitions, no doc version
  bumps, no audit rows. The ONLY writes this spec introduces are the authoring paths
  (D6/D6a). (Paired oracle note: read-only-ness alone is no-op-satisfiable — AC-DR-8
  is explicitly paired with AC-DR-1/AC-DR-4's positive detection, review T9.)
- **D10 — `lore get` projection via the adapter-seam splice**: the `Code anchors`
  list renders through **`renderResolvedToMarkdown`** (the SPEC-032 text-projection
  seam — CLI `get` non-raw + `export-docs`; named so the projection is vitest-testable
  without `get.ts`'s bun-only import chain — review T3). NO live drift check inside
  `get` (a read verb must not grow fs side channels). Specs without anchors render
  byte-identically (REGRESSION).
- **D11 — Discoverability (review U6)**: the spec-create feeding-source doc
  (`knowledge-write-spec-rules-gate-feeding-source`) gains one advisory rule line
  ("specs MAY declare code anchors — `lore create spec --code-anchor
  <path[#Symbol]>` / `lore anchor add <spec>` — verified by `lore status
  --check-drift`"). This is a corpus-doc edit performed as a cycle deliverable (not
  code); listed in Scope so it is not forgotten.

## Scope

**In**: `packages/core/src/code-anchors.ts` (parse/scan/computeDrift, six drift kinds);
`specExtraSchema.code_anchors` (shape) + `_createImpl`/`set` grammar seams (D6a);
`DriftCheckService` (FsProbe port with per-call error wrapping, addCodeAnchors/
removeCodeAnchors CAS RMW, checkDrift); `status.ts` restructure to value-returning
composable checks + exit precedence + repair hints + plain-status armed count; `lore
anchor` doc-type dispatch; `lore create spec --code-anchor` + task-seam `#` rejection;
`flows/drift-flow.ts` shared payload builder; MCP `lore_status.check_drift` (first
input schema, no-arg regression) + `lore_anchor_set` spec REPLACE + `lore bootstrap`
armed count (tool count stays 30); config `workflow.drift.enabled`; `Code anchors`
line via `renderResolvedToMarkdown`; feeding-source advisory line (corpus edit, D11);
seeded-drift-fixture bun e2e (G11); CLAUDE.md updates.

**Out** (explicitly): symbol RESOLUTION beyond lexical scan (no TS compiler API/LSP;
FP forms documented incl. `export type {}` and destructured exports); Unicode-named
export anchoring (ASCII identifier grammar only — loud authoring reject); anchors on
doc types other than spec; auto-invalidation or ANY write on drift; watch mode/daemons;
git-history drift (current working tree only); dashboard surface; CI workflow files;
`lore ready` drift surfacing (plan/task-scoped command, drift is spec-scoped — the
status/bootstrap armed counts are the session surfaces this cycle).

## Acceptance Criteria

Structured ACs (`lore ac add`) — every script AC names its runner; `lore verify`
executes them.

- **AC-DR-1** (script:test, vitest `packages/core/tests/code-anchors.test.ts`) — Pure
  grammar + scan + drift kinds: parseCodeAnchor per-entry on full raw strings
  (`a.ts#Foo` + `a.ts#Bar` both survive — never batch-normalized away), last-# split,
  dir+symbol loud reject, Unicode symbol loud reject, reserved-word symbols admitted;
  scanExportedSymbols matches every D3 form (incl. multi-line `export {` and `as`
  alias) and does NOT match commented-out or mid-line occurrences; `export type { X }`
  and destructured exports produce `symbol_missing` (documented FP, never a crash or
  false consistent); computeDrift classifies all SIX kinds incl. node_type_mismatch
  (dir anchor → file at path, file anchor → dir) and probe_error; consistent ONLY when
  every anchor affirmatively verifies.
- **AC-DR-2** (script:test, vitest `packages/lore/tests/unit/service/
  drift-check-service.test.ts`) — Service orchestration with in-memory FsProbe: anchors
  collected across ALL non-deleted specs (draft through archived — status_breakdown
  reported); per-unique-path probe dedup (counting-probe: N specs anchoring one path →
  1 stat); soft-deleted excluded; unarmed → `{armed: false, consistent: true}`; a
  probe stub that THROWS on one path yields a probe_error drift row for that anchor
  while every other anchor still gets checked (ERROR dimension — no batch abort); the
  service module never imports node:fs (source-text grep oracle,
  sync-docs-service.test.ts precedent).
- **AC-DR-3** (script:test, vitest same file) — Authoring RMW: addCodeAnchors/
  removeCodeAnchors write normalized entries preserving spec_kind +
  acceptance_criteria + every sibling key verbatim; CAS: a concurrent version bump
  between read and write surfaces CONFLICT (STATE dimension), never lost-update;
  invalid grammar (bad identifier, symbol-on-dir, `..` path, `#` on a task target) →
  VALIDATION_ERROR naming the offending anchor; doc version bumps exactly once per
  successful write; task-target behavior byte-identical (REGRESSION); D6a seams:
  `_createImpl` with malformed `extra.code_anchors` rejects loud, `set` carrying
  malformed code_anchors rejects loud while valid ones pass.
- **AC-DR-4** (script:test, bun `packages/lore/tests/unit/adapters/
  cli-drift.bun.test.ts` — THE G11 FIXTURE; budget-conscious: ONE mkdtemp corpus,
  seeded once — `lore create prd` FIRST (spec-create gate requires a prd parent), then
  specs via `--parent <prd> --code-anchor ...`; sequential file mutations between
  spawns, no per-case re-init, cli-invalidate.bun.test.ts discipline) — 0
  false-negatives, seeded: existing file, file#ExportedSymbol, non-empty dir/ all
  verify → exit 0 consistent; then EACH drift class in turn (delete file, rename
  export, empty the dir, anchor a never-existing path, dir-anchor a plain file) →
  exit 3, row names spec slug + anchor + kind + literal repair hint, and NO
  seeded-missing anchor is EVER reported consistent; `--check-drift --check-tree`
  composed exit follows D5 precedence (drift 3 wins over missing-blueprint 4);
  unarmed → exit 0 + explicit armed:false; `workflow.drift.enabled: false` → exit 0 +
  explicit disabled note; plain `lore status` shows the store-only armed count and
  performs zero probing.
- **AC-DR-5** (script:test, vitest `packages/lore/tests/unit/adapters/
  mcp-drift.test.ts`) — MCP parity: `lore_status {check_drift: true}` payload
  `code_drift` deep-equals CLI `--json` `data.code_drift` (shared drift-flow builder);
  `lore_status` called with NO args returns the pre-SPEC-045 shape unchanged
  (REGRESSION — first-schema migration must not break argless calls);
  `lore_anchor_set` on a spec REPLACES code_anchors (declarative) and on a task stays
  byte-identical incl. loud `#` rejection; expectedTools length stays 30.
- **AC-DR-6** (script:test, vitest `packages/lore/tests/unit/adapters/
  spec-projection-anchors.test.ts`) — Projection: `renderResolvedToMarkdown` output
  (the seam CLI get non-raw + export-docs consume) renders the `Code anchors` list
  when declared and byte-identical output when absent (REGRESSION); rendering performs
  zero filesystem probing (probe counter untouched).
- **AC-DR-7** (script:test, vitest `packages/core/tests/config-drift.test.ts`) —
  Config: `workflow.drift.enabled` defaults true when absent; explicit false parses;
  non-boolean fails loud; unknown keys under `workflow.drift` rejected (strict Zod).
- **AC-DR-8** (script:test, vitest drift-check-service tests) — D9 read-only (paired
  with AC-DR-1/AC-DR-4 positive detection — alone this only proves non-mutation): a
  full checkDrift pass over an armed, DRIFTING corpus (the same fixtures that assert
  detection) performs ZERO store writes (write-counting store oracle), bumps no doc
  version, writes no audit rows.
- **AC-DR-9** (human, owner-executed) — Throwaway-corpus live run: init corpus in a
  tmp dir; `lore create prd`, then a spec with `--parent <prd> --code-anchor
  'src/x.ts#Exported'`; seed `src/x.ts` with that export; `lore status --check-drift`
  → consistent; rename the export in the file; re-run → exit 3 naming the anchor with
  the repair hint; `lore log <spec>` shows no new version (drift never mutates).

## Review

v2 revision log — 3-lens adversarial review, 30 findings, all resolved or explicitly
owned:

- **S1/S2 (HIGH)** set()/create grammar bypass — D6a: grammar at every write seam,
  named `_createImpl` branch + `set` re-validation; clobber-by-omission stays the
  documented limitation (file_anchors precedent, not validity's hard block). **S3
  (HIGH)** batched-normalize swallows same-path anchors — per-entry
  parse-then-normalize pinned (D1); probe dedup separated (D4). **S4 (HIGH)** + **U3
  (HIGH)** setCodeAnchors vs add/rm contradiction — two CLI methods
  (addCodeAnchors/removeCodeAnchors, incremental CAS RMW) + MCP lore_anchor_set stays
  declarative REPLACE, divergence documented in the tool description (D6/D7). **S5**
  anchor dispatch for other types — resolve-then-dispatch + VALIDATION_ERROR pinned
  (D6). **S6 (HIGH)** + **U1 (HIGH)** composed exit infeasible under early-exit
  control flow — status.ts restructure IN SCOPE, value-returning checks, drift-3-wins
  precedence with worked example (D5). **S7** listDir semantics — immediate children,
  dotfiles excluded from emptiness (`.gitkeep`-only = dir_empty, safe direction)
  (D4). **S8** unnamed shared builder — `flows/drift-flow.ts` (D7). **S9**
  reserved-word regex note (D1). **S10** + **U9** lore_status first-schema migration
  named (D7).
- **U2 (HIGH)** `--anchor` dual-grammar trap — distinct `--code-anchor` flag; task
  seams reject `#` loud (D6). **U4 (HIGH)** plain-status silence — store-only armed
  count line, no probing; asymmetry vs open_stale_candidates justified (D5). **U5
  (HIGH)** missing repair command — per-row literal fix hint (D5). **U6 (HIGH)** zero
  discoverability — feeding-source advisory line as cycle deliverable (D11). **U7**
  population loudness — all non-deleted specs + specs_checked/status_breakdown/
  spec_status in payload (D5). **U8** bootstrap parity — store-only armed count,
  shared helper (D7). **U10** disabled+tree worked example (D5).
- **T1 (HIGH)** fixture missing PRD-parent prerequisite — pinned in AC-DR-4/AC-DR-9.
  **T2 (HIGH)** probe IO failure unspecified — per-call wrapping, probe_error kind,
  no batch abort (D4, AC-DR-2). **T3 (HIGH)** AC-DR-6 vitest infeasibility —
  renderResolvedToMarkdown seam named (D10). **T4** spawn budget — single-corpus
  sequential-mutation discipline pinned in AC-DR-4. **T5** RMW concurrency — CAS via
  expected_version + STATE case (D6, AC-DR-3). **T6** missing FP forms — export type
  {} + destructured added to D3 + AC-DR-1. **T7** Unicode foreclosure — Scope-Out +
  loud reject AC (D1). **T8** type-mismatch unclassified — node_type_mismatch kind
  (D2, AC-DR-1). **T9** AC-DR-8 no-op-satisfiable — pairing stated (D9, AC-DR-8).
  **T10** argless lore_status regression — AC-DR-5.

## Non-goals restated

Zero LLM calls — this is the deterministic leg of §16. No writes on drift, ever. The
lexical scan trades documented false positives for a guaranteed absence of false
negatives (G11) — including under probe errors, which surface as drift, never as a
truncated scan.


## Acceptance Criteria (structured)

- [✔] [script] AC-DR-1: Pure grammar + scan + drift kinds: parseCodeAnchor per-entry on full raw strings (a.ts#Foo + a.ts#Bar both survive, never batch-normalized away), last-# split, dir+symbol loud reject, Unicode symbol loud reject, reserved-word symbols admitted; scanExportedSymbols matches every D3 form (multi-line export{} and as-alias) and NOT commented-out or mid-line occurrences; export type {X} and destructured exports produce symbol_missing (documented FP, never crash or false consistent); computeDrift classifies all SIX kinds incl. node_type_mismatch and probe_error; consistent ONLY when every anchor affirmatively verifies
  script: test — bunx vitest run packages/core/tests/code-anchors.test.ts
- [✔] [script] AC-DR-2: Service orchestration with in-memory FsProbe: anchors collected across ALL non-deleted specs with status_breakdown; per-unique-path probe dedup (counting-probe: N specs one path -> 1 stat); soft-deleted excluded; unarmed -> {armed:false, consistent:true}; a probe stub that THROWS on one path yields a probe_error drift row while every other anchor still gets checked (no batch abort); service module never imports node:fs (source-text grep oracle)
  script: test — bunx vitest run packages/lore/tests/unit/service/drift-check-service.test.ts
- [✔] [script] AC-DR-3: Authoring RMW: addCodeAnchors/removeCodeAnchors write normalized entries preserving spec_kind + acceptance_criteria + every sibling key; CAS via expected_version surfaces CONFLICT on concurrent bump (STATE), never lost-update; invalid grammar (bad identifier, symbol-on-dir, .. path, # on task target) VALIDATION_ERROR naming the anchor; version bumps exactly once; task-target byte-identical (REGRESSION); D6a: _createImpl and set() with malformed extra.code_anchors reject loud, valid pass
  script: test — bunx vitest run packages/lore/tests/unit/service/drift-check-service.test.ts
- [✔] [script] AC-DR-4: G11 seeded fixture (budget-conscious: ONE mkdtemp corpus, PRD seeded FIRST then specs via --parent + --code-anchor, sequential file mutations, no per-case re-init): all-verified -> exit 0 consistent; EACH drift class (delete file, rename export, empty dir, never-existing path, dir-anchor on plain file) -> exit 3 with spec slug + anchor + kind + literal repair hint, NO seeded-missing anchor EVER reported consistent; --check-drift --check-tree composed exit = drift-3-wins-over-4 precedence; unarmed -> exit 0 + armed:false; workflow.drift.enabled:false -> exit 0 + explicit disabled note; plain lore status shows store-only armed count with zero probing
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-drift.bun.test.ts
- [✔] [script] AC-DR-5: MCP parity: lore_status {check_drift:true} code_drift deep-equals CLI --json data.code_drift (shared drift-flow builder); argless lore_status returns pre-SPEC-045 shape unchanged (REGRESSION, first-schema migration); lore_anchor_set on spec REPLACES code_anchors (declarative, divergence documented) and on task byte-identical incl. loud # rejection; expectedTools stays 30
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-drift.test.ts
- [✔] [script] AC-DR-6: Projection: renderResolvedToMarkdown output renders the Code anchors list when declared and byte-identical output when absent (REGRESSION); rendering performs zero filesystem probing (probe counter untouched)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/spec-projection-anchors.test.ts
- [✔] [script] AC-DR-7: Config: workflow.drift.enabled defaults true when absent; explicit false parses; non-boolean fails loud; unknown keys under workflow.drift rejected (strict Zod)
  script: test — bunx vitest run packages/core/tests/config-drift.test.ts
- [✔] [script] AC-DR-8: D9 read-only (paired with AC-DR-1/AC-DR-4 positive detection — alone proves only non-mutation): full checkDrift over an armed DRIFTING corpus performs ZERO store writes (write-counting store oracle), bumps no doc version, writes no audit rows
  script: test — bunx vitest run packages/lore/tests/unit/service/drift-check-service.test.ts
- [✔] [human] AC-DR-9: Owner-executed live drift run: consistent -> rename export -> exit 3 with repair hint, zero doc mutation
  human: Owner-executed. Throwaway corpus in tmp dir: lore create prd, then spec with --parent <prd> --code-anchor 'src/x.ts#Exported'; seed src/x.ts with that export; lore status --check-drift -> consistent; rename the export; re-run -> exit 3 naming the anchor with repair hint; lore log <spec> shows no new version (drift never mutates).
