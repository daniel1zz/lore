---
id: SPEC-135
type: spec
role: spec
title: "Mirror identifier SSOT: one writer for export-index human_id, an idempotent migrate-export seam, and a check that cannot self-heal"
status: draft
priority: high
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
# Overview

The corpus→file mirror's `.lore/export-index.json` `human_id` field has **two live writers that
disagree on its format and silently revert each other**. Nothing in the tree enforces the single
writer the code's own module header claims to have. This spec makes the padded form the sole
composed value, enforces that **in the type system** so the disagreement becomes a compile error,
proves the migrate↔export seam is idempotent across a full round trip, and pins that the drift
*check* can never self-heal.

Measured on `main` @ `6be150ef`, 2026-08-11. This is a data-integrity defect armed by the
mirror-id-unify merge (`cedb29db`) — before it, both writers agreed on the unpadded form, so the
disagreement is new.

## Problem

**The two writers.**

- `packages/lore/src/service/ordinal-migration-service.ts:743` composes the expected id with
  `formatDocDisplayId({ type: doc.type, ordinal: finalOrdinal.ordinal })` — the **UNPADDED**
  general-purpose display formatter (`SPEC-21`). `:758` writes that value into
  `index.mappings[doc.id].human_id`; `:754` emits a `rename_command` (`git mv …`) built from it.
- `packages/lore/src/service/export-docs-service.ts:1031` composes the same field with
  `formatMirrorHumanId(doc)` — the **PADDED** mirror formatter (`SPEC-021`) — and at `:1035`
  `delete index.mappings[docId]` to force a re-export whenever the stored value disagrees.

**Padded is already the decided canonical form, so this is not an open question.**
`packages/core/src/ordinal.ts:133-145` records it as a user decision (2026-08-10,
`task-unify-mirror-identifiers-on-zero-padded-form-export-all`): the mirror's filenames have
always zero-padded (`SPEC-021-*.md`), cross-type frontmatter `links:`/`parent:` entries cite the
padded form, and aligning `human_id` to the FILENAME convention is what drove the
migration-coverage eval's `links_broken` to zero. The same JSDoc asserts `formatMirrorHumanId` is
"Consumed ONLY by the corpus→file mirror write path (`ExportDocsService`'s
`.lore/export-index.json` `human_id` allocation …)" — a claim `ordinal-migration-service.ts`
falsifies today.

**The reversion loop.** `mirror:export` writes `SPEC-021`. `lore migrate ordinals --apply` sees
`SPEC-021 !== SPEC-21`, rewrites it to `SPEC-21`, and emits a bogus `git mv` toward
`SPEC-21-*.md`. The next export sees the disagreement, deletes the mapping and re-exports back to
`SPEC-021`. Every numbered doc with `ordinal < 100` oscillates on each cycle — which is nearly all
of them.

**Why no existing gate caught it, and why a grep rule is the WRONG layer.**
`scripts/check-ordinal-write-sites.mjs` is a real, armed allowlist gate — but it guards the
`ordinal` **COLUMN** (allocation arithmetic and raw SQL writes), a *different field*, and
`ordinal-migration-service.ts` is itself on its `SANCTIONED_ORDINAL_WRITE_FILES` allowlist. So the
"one legal composition site" invariant exists **only as JSDoc prose** in
`packages/core/src/ordinal.ts`. Prose is not a mechanism.

A textual rule cannot replace it either, and the reason is measured, not aesthetic:
`ordinal-migration-service.ts` uses `formatDocDisplayId` **legitimately six times** (`:584`,
`:594`, `:611`, `:637`, `:652` build the report's `old_display`/`new_display`, which are the
CLI display contract and MUST stay unpadded), and the token `human_id` is **overloaded across two
different types** in the same file — the report's `old_human_id`/`new_human_id` (`:750`/`:751`)
are not the index's `human_id`. Any proximity- or token-keyed grep is therefore either noisy or
blind, and a rule that flags "writes `human_id`" would flag the CORRECT post-fix code at `:758`.

**Why AC-084-4 did not catch it, and why it must be re-baselined.**
`packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts:205-207` pins the migration's output
to the UNPADDED form (`new_human_id: "SPEC-1"`, `suggested_file_path:
"docs/requirements/spec/SPEC-1-alpha-decision.md"`, and the matching `rename_command` string).
That AC is GREEN and attested. Its fixture seeds unpadded mappings, so its own "second run
performs literally zero writes" clause is satisfied *within* migration while the
export→migrate→export round trip is not idempotent at all. The AC is not wrong about what it
asserts; it simply never asserts the seam. Correcting the pinned values is a **re-baseline**, and
AC-MIS-4 exists to make that visible rather than quiet.

## Decisions

- **D1.** `formatMirrorHumanId` is the ONLY function whose output may be assigned to an
  export-index `human_id`. `OrdinalMigrationService`'s step-3 reconcile composes via it.
  Specifically, `ordinal-migration-service.ts:743` becomes, verbatim:
  `const expectedHumanId = formatMirrorHumanId({ type: doc.type, ordinal: finalOrdinal.ordinal });`
  (the exact expression AC-MIS-2's declared falsifier mutates — an implementation that restructures
  this call must update the falsifier via `lore ac set` rather than leave it stale).
- **D2.** The reconcile's `old_human_id`, `new_human_id`, `suggested_file_path` and
  `rename_command` all derive from the padded value, so a suggested rename can never point away
  from the mirror's filename convention. ⛔ The report's `old_display`/`new_display` fields stay
  **UNPADDED** — they are the `formatDocDisplayId` CLI contract pinned by AC-084-3. Do not
  "unify" them; the two forms coexist deliberately, one per consumer.
- **D3 — the invariant is enforced by the TYPE SYSTEM, not by a grep.** `formatMirrorHumanId`'s
  return type becomes a branded `MirrorHumanId` (a nominal alias declared in
  `packages/core/src/ordinal.ts`), and `exportIndexMappingSchema`'s `human_id` field
  (`packages/core/src/schemas.ts:1132`) carries that brand. A plain `string` — including
  `formatDocDisplayId`'s output — then **cannot** be assigned to it, so the reversion loop is a
  `tsc` error rather than a silent runtime oscillation. `bun run typecheck` is the enforcing
  oracle. This is chosen over a textual rule because the measured shape of the offending file
  (six legitimate `formatDocDisplayId` calls, an overloaded `human_id` token) makes every
  textual predicate either noisy or blind.
- **D4.** The brand has exactly ONE sanctioned escape — the JSON parse boundary in
  `packages/core/src/schemas.ts`, where a value read from `.lore/export-index.json` is admitted.
  `scripts/check-ordinal-write-sites.mjs` gains a narrow rule guarding that escape: a
  `MirrorHumanId` cast (`as MirrorHumanId`, or a laundering `as unknown as`) anywhere outside
  `packages/core/src/schemas.ts` is a violation. This is a cast-site rule, not a composition-site
  rule — it has a single, unambiguous token to key on, which is exactly what the discarded
  proximity rule lacked.
- **D5.** `runCheck` (`scripts/export-spec-mirror.ts:167-200`) stays byte-read-only. Its JSDoc
  already claims "NEVER calls `exportDocs` and never writes a byte"; AC-MIS-5 turns that claim
  into an assertion, because a check that repairs what it checks can never fail.

## Scope

Existing files changed:

- `packages/core/src/ordinal.ts` — the `MirrorHumanId` brand and `formatMirrorHumanId`'s return type
- `packages/core/src/schemas.ts` — `exportIndexMappingSchema.human_id` carries the brand; the sole
  sanctioned cast at the parse boundary
- `packages/lore/src/service/ordinal-migration-service.ts` — D1/D2 (the `:743` composition and the
  four padded report/rename fields)
- `packages/lore/src/service/export-docs-service.ts` — brand propagation only; its composition at
  `:1031` is already correct
- `packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts` — AC-MIS-4's re-baseline
- `scripts/check-ordinal-write-sites.mjs`, `scripts/check-ordinal-write-sites.d.mts`,
  `scripts/tests/check-ordinal-write-sites.test.ts` — D4's cast-escape rule and its fixture cases

New oracle files created by this spec (each is the declared `--command` of the AC that needs it):

- `packages/lore/tests/unit/service/mirror-human-id-ssot.bun.test.ts` — AC-MIS-1
- `packages/lore/tests/integration/mirror-roundtrip-idempotency.bun.test.ts` — AC-MIS-2
- `packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts` — AC-MIS-6's negative control:
  in an isolated temp project using the SAME `--noEmit` shape `bun run typecheck` uses, a fixture
  assigning a plain `string` to `MirrorHumanId` exits **exactly 2** with output containing both
  `TS2322` and `MirrorHumanId`, while an EMPTY-include project also exits **exactly 2** but carries
  `TS18003` and no real compile code. That PAIRING — not the exit code, which is 2 either way — is
  what makes AC-MIS-6 more than an exit-code comparison. See AC-MIS-6's CORRECTED note for the
  measurement; ⛔ do not reshape the fixture into `noEmitOnError` + `outDir` to manufacture an
  exit 1, which would test a compiler configuration this repo never uses.
- `packages/lore/tests/integration/mirror-check-read-only.bun.test.ts` — AC-MIS-5 (imports
  `runCheck` from `scripts/export-spec-mirror.ts` and drives it with an explicit throwaway
  `repoRoot`; the script itself needs no edit, its `runCheck(app, repoRoot)` signature is already
  root-injectable)

## Out of Scope

- The AC-FR-10 oracle's repair-then-assert shape and the suite↔corpus mutual exclusion — owned by
  the oracle-exclusivity spec. ⛔ This spec must not touch
  `scripts/tests/spec-mirror-export.test.ts`; AC-MIS-5's home is the NEW file listed above, not
  that suite.
- Any change to `formatDocDisplayId`'s unpadded CLI/MCP/dashboard contract, pinned by AC-084-3.

## Acceptance Criteria

Structured, oracle-bound criteria are attached via `lore ac add` (**AC-MIS-1 … AC-MIS-6**, six in
total) and are the authoritative list. The id→mechanism mapping below is normative — dispatch keys
on these ids:

- **AC-MIS-1** (D1/D2) — the migration's reconcile emits the PADDED form: `new_human_id`,
  `suggested_file_path` and `rename_command` all carry the 3-digit form, while `new_display` stays
  unpadded.
- **AC-MIS-2** (D1) — round-trip idempotency across the seam: export → `migrate ordinals --apply` →
  export leaves `.lore/export-index.json` byte-identical, on a throwaway corpus. A declared
  falsifier reverting D1's expression to `formatDocDisplayId` must turn it red (bun strips types
  without checking them, so the mutation still RUNS and this stays a genuine behavioural red).
- **AC-MIS-3** (**D4**) — the brand's single sanctioned escape is guarded: an `as MirrorHumanId`
  cast outside `packages/core/src/schemas.ts` makes `check-ordinal-write-sites.mjs`'s `main()`
  return **exactly 3** naming rule and file:line, the identical cast inside `schemas.ts` returns 0,
  and the real tree returns 0.
- **AC-MIS-4** — AC-084-4's pinned values are re-baselined to the padded form, and the re-baseline
  record cites the prior decision by literal token (`ordinal.ts:133-145` and `2026-08-10`) so the
  justification is grep-checkable rather than an unfalsifiable adequacy judgment.
- **AC-MIS-5** — `runCheck` reports drift on a drifted throwaway corpus and leaves the export index
  and every mirror file byte-identical. Its `--command` drives the NEW test file
  (`packages/lore/tests/integration/mirror-check-read-only.bun.test.ts`) which calls
  `runCheck(app, repoRoot)` against a throwaway root — never `bun run check:spec-mirror` against
  the live tree.
- **AC-MIS-6** (**D3**) — the brand prevents the regression at COMPILE time. Its `--command` has
  two halves that must BOTH hold on the green path: `bun run typecheck` exits 0 on the real tree,
  AND a negative-control fixture in an isolated temp project shows that assigning a plain `string`
  to the brand exits **exactly 2** with output containing both `TS2322` and `MirrorHumanId`, while
  an EMPTY-include project also exits 2 but carries `TS18003` and not `TS2322`.

  ⛔ **CORRECTED 2026-08-11, and the correction is the point.** An earlier version of this bullet
  pinned **exit 1** and asserted that exit 2 meant a config-level fatal. That figure came from a
  probe run through `bunx tsc`, which downloaded its own TypeScript into a temp lockfile — not the
  compiler this repo builds with. Re-measured against `node_modules/.bin/tsc` (TypeScript 5.9.3):
  under `--noEmit`, **both** a real `TS2322` and an empty-include `TS18003` exit **2**; exit 1
  appears only under `noEmitOnError` + `outDir` with no `noEmit`, a shape `bun run typecheck` never
  uses. Two consequences: the discriminator between *checked and found errors* and *never checked*
  is the **error code in the output**, never the exit code — so the `TS18003` pairing is mandatory,
  not decorative; and the handoff record this session initially "corrected" (a peer's measured
  `typecheck exit 2`) was **right all along**, which is why a single unverified probe must never
  overrule a recorded measurement.

## Sequencing Risks

- **AC-MIS-4 rewrites a GREEN attested AC.** "AC red → change AC → green" and "concealing a
  failure" are indistinguishable in an audit unless the change is annotated at the moment it is
  made. The re-baseline is a correction because the pinned value contradicts a decision recorded
  BEFORE the pin (`ordinal.ts:133-145`, 2026-08-10) and contradicts the mirror's own filename
  convention — not because it is inconvenient. Record it, do not merely do it.
- **`lore ac set` on SPEC-084 demotes it to `draft`** and hard-blocks every descendant claim.
  SPEC-084 is `approved` (id `01KYF1NXCQ78C4SSJ34HKJBYAW`); re-read its status immediately before
  any dependent dispatch, and re-`review`+`approve` inside the same session.
- **D3 changes a type in `@lore/core`, which the dashboard imports.** `@lore/core` must stay
  browser-safe: the brand is a type-only construct, so it must not introduce any runtime import.
  A `packages/*` export change also requires building the sub-package before a dependent
  typecheck is meaningful.
- **D4 arms a new rule over the whole tree.** A newly armed rule retroactively invalidates the
  back-catalogue; budget the sweep and any written exemption in the same slice.


## Acceptance Criteria (structured)

- [✔] [script] AC-MIS-1: OrdinalMigrationService's step-3 reconcile emits the ZERO-PADDED form, observed on a fixture that seeds UNPADDED stored mappings so a diff is actually forced (a padded-seeded fixture would produce no reconcile entry at all and assert nothing): the emitted entry carries old_human_id, new_human_id, suggested_file_path and rename_command in the 3-digit form (SPEC-001, docs/requirements/spec/SPEC-001-*.md), AND the same entry's new_display remains UNPADDED (SPEC-1) so D2's display/mirror split is asserted here rather than resting on AC-084-3 alone
  script: test — bun test packages/lore/tests/unit/service/mirror-human-id-ssot.bun.test.ts 2>&1 && echo "AC-MIS-1 PASS: step-3 reconcile emits zero-padded new_human_id, suggested_file_path and rename_command"
- [✔] [script] AC-MIS-2: Round-trip idempotency across the migrate<->export seam: on a throwaway corpus, mirror export -> lore migrate ordinals --apply -> mirror export leaves .lore/export-index.json BYTE-IDENTICAL (asserted by hash equality of the file, not by an absence of reported errors), so no numbered doc oscillates between padded and unpadded
  script: test — bun test packages/lore/tests/integration/mirror-roundtrip-idempotency.bun.test.ts 2>&1 && echo "AC-MIS-2 PASS: export -> migrate ordinals --apply -> export leaves export-index.json byte-identical on a throwaway corpus"
- [✔] [script] AC-MIS-3: check-ordinal-write-sites.mjs carries a MirrorHumanId cast-escape rule: over an injected fixture tree, an 'as MirrorHumanId' (or laundering 'as unknown as MirrorHumanId') cast in any file other than packages/core/src/schemas.ts makes main() return EXACTLY 3 and names both the rule and the offending file:line; the identical cast inside schemas.ts returns 0; and the real tree returns 0
  script: test — bunx vitest run scripts/tests/check-ordinal-write-sites.test.ts 2>&1 && echo "AC-MIS-3 PASS: human_id-composition rule returns exactly 3 on an unsanctioned fixture, 0 inside the allowlist, and 0 on the real tree"
- [✔] [script] AC-MIS-5: The mirror drift check is byte-read-only: driving runCheck(app, repoRoot) against a THROWAWAY corpus deliberately drifted (a mapping carrying the unpadded form plus a renamed mirror file) REPORTS the drift with a nonzero verdict and leaves both the export index and every mirror file byte-identical (hash equality before and after), so the check can never repair what it checks. The oracle never invokes bun run check:spec-mirror against the live tree and never writes the repo corpus
  script: test — bun test packages/lore/tests/integration/mirror-check-read-only.bun.test.ts 2>&1 && echo "AC-MIS-5 PASS: runCheck reports drift on a drifted throwaway corpus and leaves index + mirror files byte-identical"
- [✔] [script] AC-MIS-4: AC-084-4's pinned reconcile values are re-baselined to the padded form (SPEC-001 and docs/requirements/spec/SPEC-001-alpha-decision.md replace SPEC-1 and SPEC-1-alpha-decision.md), the migrate-ordinals suite passes, and the suite ITSELF asserts its own in-place RE-BASELINE record by reading its own source and requiring the literal tokens RE-BASELINE, ordinal.ts:133-145 and 2026-08-10 — so the justification is machine-checked by a test that runs on every suite execution rather than by greps bolted onto the AC command. REVISION RECORD (2026-08-11, in-flight): the original command was 'grep -q SPEC-001-alpha-decision.md <f> && grep -q RE-BASELINE <f> && grep -q ordinal.ts:133-145 <f> && grep -q 2026-08-10 <f> && bun test <f>'; attested verify returned result=inconclusive with 'ran 1 of 5 declared paths' at exit 0, because SPEC-061's completeness guard counts every test-file-shaped argv token in the command and the four greps each named the same test file. This is a CORRECTION not a weakening: every one of the four grep assertions survives verbatim, moved inside the suite as real test cases, so the assertion set is strictly larger (it now also runs under bun run test) while the command declares exactly one path and the completeness guard can reach a verdict
  script: test — bun test packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts 2>&1 && echo "AC-MIS-4 PASS: padded pins in place and the suite self-asserts its RE-BASELINE record citing ordinal.ts:133-145 / 2026-08-10"
- [✘] [script] AC-MIS-6: The MirrorHumanId brand prevents the reversion loop at COMPILE time, asserted with its own reverse control in the same command: bun run typecheck exits 0 on the real tree AND a negative-control fixture in an isolated temp project shows that assigning a plain string to MirrorHumanId exits EXACTLY 2 with output containing BOTH TS2322 and MirrorHumanId, while an EMPTY-include project also exits 2 but with TS18003 and NOT TS2322. CORRECTION (2026-08-11): an earlier version of this criterion pinned exit 1 and claimed exit 2 meant a config fatal. That was measured with a bunx-downloaded TypeScript, not this repo's. Re-measured against node_modules/.bin/tsc 5.9.3: under --noEmit BOTH a real TS2322 and an empty-include TS18003 exit 2; exit 1 appears only under noEmitOnError + outDir with no noEmit, a shape bun run typecheck never uses. So the discriminator between checked-and-found-errors and never-checked is the ERROR CODE IN THE OUTPUT, and an exit-code comparison provably cannot make it here — which is why the TS18003 pairing above is mandatory rather than decorative. SUMMARY-TEXT CORRECTION (2026-08-11, same session as the CORRECTION above): the declared command's trailing echo still asserted "exit exactly 1", contradicting this same CORRECTION paragraph's own measured value of exit 2 -- fixed the echo text to say "exit exactly 2" via lore ac set. No assertion changed, only the printed summary text; this edit demotes the spec to draft and requires re-review + re-approve.
  script: tsc — bun run typecheck 2>&1 && bun test packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts 2>&1 && echo "AC-MIS-6 PASS: monorepo typecheck clean with the brand, and the negative control confirms a plain string assignment is TS2322 at exit exactly 2"

## Code anchors

- packages/core/src/ordinal.ts#formatMirrorHumanId
- packages/lore/src/service/ordinal-migration-service.ts
- scripts/check-ordinal-write-sites.mjs
