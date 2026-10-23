---
id: SPEC-230
type: spec
role: spec
title: "Every refusal carries its rule as a required, type-checked field; the site census is removed"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: [redesign, baseline, errors]
---
## Overview/Goal

Implements `adr-a-refusal-carries-its-rule-as-a-required-field-type`. Every refusal lore reports carries the rule it enforces, set where the refusal is constructed and guaranteed by the type checker. This replaces the site census, the call-path walk and per-leaf site coverage.

It builds on D1-1 (`task-d1-1-refusal-sites-declare-their-rule-in-code-census-reads`):
- `LoreError` already has an optional `rule`.
- There is one rule-taking `validationError` and `storeError` helper each.
- 644 refusals already carry their rule.

## Scope

**The rule is required, and its type follows the error code.**
- `LoreError` requires `rule`.
- Codes that report a dependency failure (`STORE_ERROR`, `TRANSPORT_UNAVAILABLE`, `RATE_LIMITED`, `AI_PROVIDER_ERROR`) accept `"infrastructure"` or a rule id `BR-<n>`. Every other code accepts only a rule id.
- A construction without `rule`, or a business code labelled `"infrastructure"`, fails `bun run typecheck`.
- A new code, `INTERNAL_ERROR`, reports an internal defect: an unreachable state, an unwired service or a broken port contract. Its rule is always `"defect"`, and `"defect"` is valid on no other code. The CLI reports it as a defect of lore, with its own exit code. Test doubles throw plain errors and do not construct one.
- Development and release tooling (`scripts/`, `packages/lore/src/distribution/`) is not part of the product's refusal contract. It reports failures with its own error type or exit codes and constructs no `LoreError`.
- A shared chokepoint passes a refusal through unchanged and never sets or changes its rule.

**Every construction is labelled in the same landing.**
- One integration branch makes the field required and labels every construction the type checker then lists. Each label sits in the predicate or check that decides the refusal, not in a shared chokepoint.
- The 712 corpus mappings D1 did not place are exported to a reference document before the corpus keys are removed. They are hints for labelling, never labels themselves.
- A refusal that no live rule describes is not given a guessed rule. Its behaviour gets a rule first, through a spec change set, or the refusal is removed.

**Rule ids in source are checked against the baseline.**
- A check step in the integrate floor reads every `BR-<n>` used as a `rule` value in product source.
- It fails, naming each `file:line` and id, when an id is not a live rule of the baseline snapshot the floor runs against: unknown, proposed-only or retired.

**The census is removed.**
- Remove the site census, `lore baseline sites`, the per-leaf site sections of `lore baseline coverage`, and the `@lore-site` call-point and statement tags.
- `lore baseline coverage` keeps one verdict: every runnable command is declared on a business leaf (BR-1248).
- Retire the site-mapping rules BR-654, BR-655 and BR-1320. Drop the site clauses from BR-658 and BR-661.
- BR-628's site-map sentence is dropped by the unlanded change set of `spec-baseline-approval-is-per-item-an-edit-adds-a-pending`, which already modifies BR-628. This spec lands only after that sentence is gone.

**The rule-to-code index reads the constructions; it is owned by D1-2.**
- `lore rule show BR-<n>` lists the source lines that construct a refusal carrying the id. So do `lore rule set --statement` and `lore rule apply` (BR-1345, task D1-2).
- The list comes from source, so it follows renames and branches without any corpus write.
- This is rule BR-1345 and criterion AC-RIC-4 of `spec-refusal-sites-declare-their-rule-in-code-baseline-leaf`, implemented by task D1-2; BR-1345 was corrected to read constructions. This spec adds no second index criterion.

## Acceptance Criteria

Structured criteria AC-RQ-1 to AC-RQ-4 (`lore ac list`).


## Acceptance Criteria (structured)

- [·] [script] AC-RQ-1: A tsc fixture compiled against @lore/core's LoreError (a throwaway tsconfig including only the fixture): (1) err({code:'VALIDATION_ERROR', message:'m'}) with no rule fails with a type error on that line; (2) the same with rule:'infrastructure' fails; (3) rule:'BR-1' compiles; (4) code STORE_ERROR with rule:'infrastructure' compiles. The test spawns tsc and asserts exit codes and the failing line numbers exactly. And on this repository, bun run typecheck exits 0, so every construction carries a rule. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): rule typed as optional passes (3) and (4); the test requires (1) to fail. Made red once by making rule optional.
  script: test — bun run test:file packages/lore/tests/unit/core/refusal-rule-required.test.ts && bun run typecheck && echo 'AC-RQ-1 PASS: every refusal carries a rule, typed by its code'
  other_command=12
- [⊘] [script] AC-RQ-2: Throwaway source tree and throwaway corpus (lore init) whose baseline has live BR-1 and retired BR-2: the floor step's script exits exactly 1 for a tree naming rule:'BR-2' (src/a.ts:3) and rule:'BR-99' (src/b.ts:7), stdout naming both file:line pairs and ids, and exits 0 for a tree naming only BR-1. A comment mentioning BR-99 is not reported. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a check reading every BR-n string flags the comment; the test asserts it does not. Made red once by dropping the retired-state check.
  script: test — bun run test:file scripts/tests/check-refusal-rule-ids.test.ts && echo 'AC-RQ-2 PASS: refusal rule ids are live baseline rules'
  other_command=3
- [·] [script] AC-RQ-3: Throwaway corpus: (1) lore baseline sites exits exactly 2 as an unknown subcommand; (2) lore baseline coverage --json on a leaf declaring command c and a corpus missing command d exits exactly 1, naming d, and its JSON has no key containing 'site'; (3) no product source file (packages/*/src, scripts/, assets/) contains '@lore-site' or a site-census module. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): hiding 'sites' from help while coverage still emits site keys; the test asserts the JSON keys. Made red once by restoring the census call in coverage.
  script: test — bun run test:file packages/lore/tests/integration/rq-census-removed.bun.test.ts && echo 'AC-RQ-3 PASS: the census is removed; coverage judges commands only'
- [·] [script] AC-RQ-4: On this repository: for each of three refusals that pass through a shared chokepoint (the gate enforcer, the CorpusService write route, the claim gate), the integration test triggers the refusal through the CLI in a throwaway corpus and asserts the reported refusal's rule equals the rule of the predicate that decided it (named per case in the test), never a rule set by the chokepoint. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a chokepoint that stamps one fixed rule on everything it passes satisfies a presence check; the test asserts three different rules. Made red once by having the gate enforcer overwrite rule.
  script: test — bun run test:file packages/lore/tests/integration/rq-chokepoint-passes-rule.bun.test.ts && echo 'AC-RQ-4 PASS: chokepoints pass the predicate rule through'
