---
id: SPEC-170
type: spec
role: spec
title: "A criterion of a locked specification can be fixed as an audited correction"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
links:
  - {id: SPEC-166, type: relates-to}
  - {id: SPEC-167, type: relates-to}
---
# A criterion of a locked specification can be fixed as an audited correction

**Goal**: a defect in one acceptance criterion, measured after the specification locked and after evidence exists, is fixed in place through the same audited correction exit the body already has — one version, status kept, reason recorded and counted — instead of forcing a whole-spec supersession. Issue #168 (generalises #162: declaring a falsifier after approval).

**Why now (measured 2026-10-12)**: landing `spec-session-start-injection-carries-only-the-session-s-own`, the first implementer found AC-SI-9 pins `session-service.test.ts` "unedited" although it carries a retired caps case (typecheck and the AC's own command go red), and AC-SI-11 greps a file D10 retires whole (deleted → grep exit 2 → `!` passes vacuously, its falsifier path vanishes). `lore reopen` refused ("9 evidence rows already exist"), `lore ac set|rm` exit 4, and `lore set --correction` reaches only the body — criteria live in `extra.acceptance_criteria`. The only remaining exit was superseding a 12-criterion spec and re-parenting its plan to fix two clauses.

**Baseline**: `baseline-keep-a-record-unchanged` BR-1069 (new), extending BR-1049's correction exit to one existing criterion.

## Scope

- `AcService.setCriterion(spec, acId, patch, opts)` accepts `opts.correction?: { reason: string }`.
- `lore ac set ... --correction "<reason>"` (CLI). No MCP or HTTP surface writes criteria today (`packages/lore/src/adapters/mcp/tools.ts` states no `lore_ac_*` tool exists), so none is added.
- `lore get` counts criterion corrections in its existing `Corrections: N` line.
- The record-edit refusal for a criterion edit names the new exit; shipped prose (produce rule asset) and root CLAUDE.md name it.

## Out of scope

- `lore ac add` / `lore ac rm` on a locked spec stay refused even with `--correction`: a new or removed criterion is a new decision, not a fix (BR-1069).
- Body / title corrections (`lore set --correction`) — unchanged.
- Reopen rules (BR-1050) — unchanged.

## Design Decisions

- **D1 — mirror `CorpusService.set`'s correction, do not invent a second shape.** Same option shape `{ reason }`, same empty-reason refusal (`VALIDATION_ERROR`, field `correction.reason`, CLI exit 2 checked from argv before the app loads), same `change_summary` prefix `Correction: <reason>`, same structural audit marker `details.correction = { reason }` that `lore get`'s `countCorrections` already reads. Rejected: a separate `lore ac correct` command (a second verb for the same act; the flag is how `set` does it).
- **D2 — the correction skips only the record-edit gate and the approved→draft demotion.** Every other `setCriterion` validation still runs: unknown AC id, missing command path (`--allow-missing-path`), falsifier shape, citation rules, the oracle-generation bump on a command change. A correction that changes the command therefore starts the next oracle generation, so earlier evidence no longer counts for that criterion — the honest consequence of changing an oracle. Rejected: freezing the generation on a correction (would let an edited command inherit passes it never earned).
- **D3 — on an unlocked spec the reason is still recorded**, and the ordinary rules apply (an approved-but-unlocked case does not exist for specs; a draft stays draft). Mirrors `set`.
- **D4 — `ac add|rm` gain no correction option.** If `--correction` is passed to them the CLI refuses with exit 2 naming `lore ac set --correction` as the only criterion correction, before the app loads; without it the existing exit-4 refusal stands.
- **D5 — one write.** The correction writes exactly one version row and one audit row; status is unchanged (no `approved → draft`, no re-approval write).

## Public Interface

```ts
// packages/lore/src/service/ac-service.ts
// a SEPARATE type: addCriterion / removeCriterion keep DeclarePathOpts and cannot receive a correction (D4)
interface SetCriterionOpts extends DeclarePathOpts { readonly correction?: { readonly reason: string } }
setCriterion(spec: string, acId: string, patch: SetCriterionPatch, opts?: SetCriterionOpts): Promise<Result<AcceptanceCriterion[], LoreError>>
```

CLI: `lore ac set <spec> <AC> [field flags] --correction "<reason>"`; stdout adds `(correction recorded: <reason>)`.

## Edge cases

| Input | Result |
|---|---|
| locked spec, `--correction "r"`, `--statement x` | exit 0, one version, status kept, `Corrections: N+1` |
| locked spec, no `--correction` | exit 4 (unchanged), refusal names `lore ac set --correction` |
| `--correction ""` / whitespace | exit 2, nothing written |
| locked spec, `--correction r`, `--command` changed | exit 0, `oracle_generation` +1 |
| locked spec, `--correction r`, falsifier flags | exit 0 (closes #162) |
| locked spec, `ac add` / `ac rm` with `--correction` | exit 2, names `ac set --correction` |
| draft spec, `--correction r` | exit 0, reason recorded, status draft |
| unknown AC id with `--correction` | existing not-found error, nothing written |
| `--correction r` with no field flag | existing 'requires at least one field' VALIDATION_ERROR, exit 2, nothing written |

## Acceptance Criteria

Declared with `lore ac add` (AC-CC-1..4).


## Acceptance Criteria (structured)

- [⚑] [script] AC-CC-1: AcService.setCriterion correction on InMemoryStore (new file record-lock-criterion-correction.test.ts): an approved spec with one evidence row; (a) correction {reason:'r'} + statement patch -> ok, statement changed, status still approved, exactly one new version whose change_summary starts 'Correction: r', one audit update row whose details.correction.reason === 'r'; (b) same patch without correction -> the existing record-edit refusal, store write spy count 0; (c) reason '' and '   ' -> VALIDATION_ERROR field correction.reason, write count 0; (d) correction + command change -> oracle_generation exactly +1; (e) correction + falsifier fields -> ok, falsifier stored (closes #162); (f) addCriterion and removeCriterion on the locked spec return the same record-edit refusal code as (b) with write count 0 (their opts type carries no correction); (g) draft spec + correction -> ok, status draft, change_summary carries the reason; (h) unknown AC id + correction -> not-found, write count 0. Smallest red mutation: skipping the demotion-skip makes (a) see status draft; letting correction bypass the gate in addCriterion fails (f).
  script: test — bunx vitest run packages/lore/tests/unit/service/record-lock-criterion-correction.test.ts
- [⚑] [script] AC-CC-2: Compiled CLI, throwaway corpus (mkdtemp + lore init, new file ac-set-correction-compiled.bun.test.ts), an approved spec with an evidence row: (a) lore ac set <spec> <AC> --statement x --correction 'r' exits exactly 0, stdout contains '(correction recorded: r)', and lore get <spec> then prints 'Corrections: 1' and Status approved; (b) the same call without --correction exits exactly 4 and its stderr names 'lore ac set' together with '--correction'; (c) --correction '' exits exactly 2 and lore log shows no new version; (d) lore ac add and lore ac rm with --correction 'r' each exit exactly 2 naming 'ac set --correction', nothing written; (e) a correction declaring --falsifier-path/find/replace/exit-code exits 0 and lore ac list --json shows the falsifier. Smallest red mutation: not registering --correction on ac set makes (a) exit 4.
  script: e2e — bun run build && cd packages/lore && bun test tests/e2e/ac-set-correction-compiled.bun.test.ts
- [⚑] [script] AC-CC-3: bun run typecheck exits 0 with the new option threaded through AcService and the ac CLI command.
  script: tsc — bun run typecheck
- [⚑] [script] AC-CC-4: Shipped prose names the new exit: the produce-rule asset assets/context/corpus-workflow-2-produce.md, its installed copy .claude/rules/lore-corpus-workflow-produce.md and root CLAUDE.md each contain 'lore ac set' followed in the same sentence by '--correction'. Root CLAUDE.md under its eviction floor is plan invariant I3, not this AC. Measured red 2026-10-12: all three lack it. Smallest red mutation: dropping '--correction' from the asset sentence makes this command (the three-file grep loop) exit 1.
  script: other — for f in assets/context/corpus-workflow-2-produce.md .claude/rules/lore-corpus-workflow-produce.md CLAUDE.md; do grep -qE 'lore ac set[^.]*--correction' "$f" || { echo "MISSING ac set --correction: $f"; exit 1; }; done && echo 'AC-CC-4 PASS: produce rule asset, installed rule and root CLAUDE.md name lore ac set --correction'

## Code anchors

- packages/lore/src/service/ac-service.ts#SetCriterionOpts
- packages/lore/src/adapters/cli/commands/ac.ts
- packages/lore/tests/unit/service/record-lock-criterion-correction.test.ts
- packages/lore/tests/e2e/ac-set-correction-compiled.bun.test.ts
