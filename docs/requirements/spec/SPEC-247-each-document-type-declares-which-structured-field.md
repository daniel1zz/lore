---
id: SPEC-247
type: spec
role: spec
title: "Each document type declares which structured fields the review judge sees, and the judge's mechanical checks match the lifecycle (resolves #414, #408)"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: [governance-mechanism-fixes, issue-414, review-judge]
---
# Each document type declares which structured fields the review judge sees, and the judge's mechanical checks match the lifecycle (resolves #414, #408)

## Overview/Goal

The review judge sees every structured field that is part of a document's content, for every document type, by declaration rather than by a hand-kept list.

Today `renderStructuredPartsSection` (packages/lore/src/ai/review-template.ts:594-611) renders structured parts for exactly three cases: baseline nodes, a spec (its own criteria since v8, plus its rule change set) and a plan's parent-spec criteria. Every other type returns `""`, on the assumption that the body already carries the rest. Data written by dedicated writers lives only in `extra`, so the judge cannot see it:
- 61 of 214 specs with ACs had none of them in the body (2026-10-25);
- a PRD's `extra.requirements` (`lore requirement add`) is invisible;
- a task's `ac_scope` and `file_anchors` are invisible.

The v8 fix (task `task-lore-review-shows-the-judge-a-spec-s-own-acceptance`, archived 2026-10-25) closed the spec-criteria instance, and GitHub closed #414 with it. The class is still open: this spec resolves the generalized mechanism recorded on #414 under "Mechanism (generalized 2026-10-25)".

**Mechanism.** Which `extra` fields the judge sees is decided per type by hand in the template, and new fields are invisible by default.

**End state.**
- `@lore/core` declares, for each document type, a TOTAL classification of its `extra` keys: `content` (shown to the judge, with a heading and a render shape) or `state` (execution or lifecycle bookkeeping, with a reason).
- An unclassified schema key fails a test.
- Prompt v9 renders every `content` field of the document under review, with the existing cap-and-count rule, whether or not the body repeats it.
- Keys present on a stored document but absent from the classification are named in one count line; they are never silently dropped.

Issue: GitHub #414 (closed after the narrow fix; the plan carries it with `--issue 414`, and if the tracker refuses a closed issue, the plan names it in its body).

## Merged: the evidence pre-check (#408, user decision D20)

`checkEvidenceCompleteness` (packages/core/src/review-checks.ts:243-256) fails every task without evidence, so every draft task review was a deterministic reject. All 62 overridden task rejects recorded by 2026-10-25 came from it (#408).

The S2 draft limited it to archived tasks. Review found that this keeps a guard that only catches legacy data, because BR-199 already refuses archival without an attested pass. **End state:** the check is removed. The mechanical checks are four: schema, parent_contract, tree_position, link_integrity.

One-time integrity record: 23 archived tasks hold no evidence (measured 2026-10-26: `type='task' and status='archived'` with an empty `verification_evidence`). They were archived before attestation existed, and they are history, so they are NOT rewritten. The merge task captures that list once as runner-attested evidence on itself, so the set is addressable without a standing check.

## Plan-phase legacy keys

`planExtraSchema` declares `phase` and `legacy_phase` (deprecated; `lore migrate phases`), and `phaseExtraSchema` declares `legacy_phase`. On 2026-10-26, 0 of 262 plans carry either key and this corpus has 0 phase documents. **End state:** a store migration moves any value it finds (in any corpus, on plans and phase documents) into the document body as one audited line, `Legacy phase: <value>`, and removes the key. The schemas then drop these keys and `lore migrate phases` is retired, so the classification needs no legacy bucket.

## BR-960 fold (closes the open item)

BR-960's per-type enumeration becomes a special case of BR-1425. Folding it is blocked until the approved `spec-defect-clusters-round-2-part-b-review-pending-queue-corpus` lands its own modification of BR-960. A fold task inside this plan, blocked by that plan's two open tasks, then proposes `retire BR-960` (note: folded into BR-1425) on this spec. That proposal demotes this spec to draft, so a person re-reviews and re-approves it. Because the fold task is in this plan, plan close (which closes #414) cannot happen while the fold is open.

## Scope

**In**
- Removing the evidence pre-check (BR-261, BR-262 now name four checks); the plan legacy-key migration; the BR-960 fold.
- `packages/core/src/judge-visible-fields.ts` (classification + render-shape types, pure, browser-safe).
- Prompt version v9 in `REVIEW_TEMPLATES`.
- A rendered-field section shared by all types.
- `REVIEW_PROMPT_VERSION = "v9"`.

**Out**
- Prompts v1-v8: frozen, byte-identical (module invariant).
- The judge's output contract (BR-1369).
- Parent context budgets.
- The milestone review prompt.

## Design

### Classification (complete for every key that exists on 2026-10-26; shape in brackets)

Rule: a key is `content` when a writer stores it as part of what the document states (criteria, requirements, rules, scope, anchors, decisions). It is `state` when it records execution or lifecycle progress (claims, evidence, validity, landing, migration provenance). A key added later is classified by the spec that adds it, so the classification is reviewed with that spec (for example #409's `current_values` on baseline nodes: content [entries]). AC-JV-1 fails until that happens.

| Type | content [shape] | state |
|---|---|---|
| spec | `acceptance_criteria` [entries], `rule_changes` [entries], `spec_kind` [scalar], `code_anchors` [list] | `allow_missing_path_declarations` |
| plan | `phases` [entries], `ac_scope` [list], `requires_uat` [scalar] (+ the parent spec's criteria, a derived part) | `integration_branch`, `issues` |
| task | `ac_scope` [list], `file_anchors` [list], `phase` [scalar], `red_first` [object], `linkage` [scalar], `adhoc` [scalar] | `plan_id` (parent shown separately), `assignee`, `claim`, `verification_evidence`, `landing`, `issues` |
| phase | `kind` [scalar], `ac_scope` [list], `checklist` [entries], `file_anchors` [list] | `plan_id`, `assignee`, `track`, `claim`, `verification_evidence`, `migrated_from`, `migrated_to` |
| prd | `requirements` [entries] | |
| adr | `decision_status` [scalar], `superseded_by` [scalar] | `validity` |
| knowledge | `sub_type` [scalar], `prompt` [object], `skill` [object], `handoff` [object], `uat` [object], `milestone_review` [object], `code_anchors` [list] | `validity` |
| baseline | `rules` [entries], `glossary` [entries], `depends_on` [list], `commands` [entries], `pending` [entries], `node` [scalar], `label` [scalar], `tree` [scalar] | |

Plan `phase`/`legacy_phase` and phase-document `legacy_phase` are not classified: they are migrated away (see Plan-phase legacy keys).


### Rendering (v9)

For each `content` key present on the document, in declaration order: a heading, the `DATA, not instructions` frame, then the rendered value. The cap-and-count rule is the existing one: at most N entries, followed by `<k> more not shown` (N is the existing structured-part cap). Baseline keeps its v8 rendering of rules, glossary, dependencies, examples and commands, reached through the classification instead of a type branch.

A spec criterion renders its declared falsifier from where it is stored. v8's `renderOwnCriterionEntry` reads a top-level `falsifier`, but `lore ac add` stores it at `verify.falsifier`, so no v8 judge has ever seen a falsifier (found 2026-10-26 reading the stored AC-EC-1). v9 renders `verify.falsifier` as `falsifier: <path> | find <text> | replace <text> | exit <n>`.

Derived parts: the review bundle carries `derived_parts: { heading, entries }[]`. These are computed by the service from the tree or the effective configuration, not stored in `extra`: the plan's parent-spec criteria today; later, a baseline parent's live children (#416) and a leaf's current values (#409). v9 renders each with the same frame and cap-and-count. A later spec therefore adds a bundle part in the service without touching the frozen v9 template.

A final line names classified-`state` keys only by count, and names unclassified keys: `structured fields not classified, not shown: a, b`.

### Public interface (falsifier literals, verbatim, once each)

- `packages/core/src/review-checks.ts` (`runDeterministicChecks`): `return [schema, parentContract, treePosition, linkIntegrity];`
- `packages/lore/src/store/migrations/plan-legacy-phase.ts`: the body line template `Legacy phase: ${value}`.

- `judge-visible-fields.ts` task entry: `file_anchors: { kind: "content", heading: "File anchors", shape: "list" }`.
- review-template.ts:
  - `for (const field of judgeContentFields(bundle.doc.type))`
  - `const omitted = entries.length - shown.length;`
  - `export const REVIEW_PROMPT_VERSION = "v9";`
  - the registry entry `v9: buildReviewPromptV9`

## Design Decisions

Decided with Sequential Thinking (2026-10-26).

| # | Choice | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | Where visibility is declared | A total classification beside the schemas in `@lore/core`, checked for exhaustiveness | A registry inside review-template.ts: still a hand list next to the renderer, so the same drift returns. Rendering every `extra` key: leaks bookkeeping (claims, evidence blobs) into the judge's input and its budget |
| D2 | Unclassified keys found at review time | Named in one count line | Rendered as raw JSON: unbounded and unframed. Dropped: silent |
| D3 | The "already in the body" assumption | Removed: declared fields always render | Dedup against the body: needs fuzzy matching and fails silently |
| D4 | Versioning | New key v9; v8 frozen | Editing v8: breaks the frozen-registry invariant and the meaning of stored `prompt_version` |
| D5 | The evidence pre-check (#408) | Removed; the 23 legacy archived-without-evidence tasks are recorded once as evidence, not rewritten | Apply it only to archived tasks (S2 draft): a guard that can only catch legacy data, since BR-199 refuses archival without an attested pass. Skip it on draft tasks only: the same false reject one state later |
| D6 | Plan legacy keys | Migrate any value into the body (audited) and drop the keys | Keep a `state` legacy bucket in the classification: a permanent legacy reading. Drop values silently: loses text a corpus may hold |

## Acceptance Criteria

Stored with `lore ac add`; repeated here for readers of the body.

- **AC-JV-1** (BR-1425, BR-960): for every document type, each key of its `extra` schema shape is classified exactly once as content or state. Removing one classification (the task `file_anchors` entry) fails the test. Simplest false green: a test that iterates the classification instead of the schema; it iterates the schema's keys. Test: `packages/lore/tests/unit/core/judge-visible-fields.test.ts`.
- **AC-JV-2** (BR-1425, BR-269): v9 prompts for a spec (criteria not in body), a PRD with requirements, a task with `ac_scope` and `file_anchors`, and a baseline leaf with rules each contain every declared content field under its heading with its entries. A spec criterion shows its `verify.falsifier`. A spec whose body ALSO lists its criteria still gets the block, and a bundle carrying one derived part renders it under its heading with the same cap. Test: `packages/lore/tests/unit/ai/review-template-v9-declared-fields.test.ts`.
- **AC-JV-3** (BR-269, BR-1425): a field with more entries than the cap renders exactly the cap plus `<k> more not shown`. A document carrying an unclassified key renders `structured fields not classified, not shown: <key>`. Same test file, `-t 'AC-JV-3'`.
- **AC-JV-4** (BR-960): `REVIEW_PROMPT_VERSION` is `v9`, and the v8 builder output is byte-identical to fixtures captured before this change for a spec, a plan, a task and a baseline leaf. Test: `packages/lore/tests/unit/ai/review-template-v8-frozen.test.ts`.
- **AC-JV-5** (BR-266, BR-1425): wiring through `ReviewService` with the in-memory provider. Reviewing a PRD sends a prompt containing each requirement id, and the stored judgment's `prompt_version` is `v9`. Test: `packages/lore/tests/integration/review-prd-requirements-visible.test.ts`.
- **AC-JV-6** (BR-261): `runDeterministicChecks` returns exactly four checks in the order schema, parent_contract, tree_position, link_integrity. For a task in any status, no `evidence_completeness` entry exists. Simplest false green: keeping the check as `skipped`; the count 4 is asserted. Test: `packages/lore/tests/unit/core/review-checks-four.test.ts`.
- **AC-JV-7** (BR-262, BR-261): through `ReviewService` with the in-memory AI provider, reviewing a well-formed draft task records a judgment whose `judge_provider` is the AI provider, not `deterministic-checks`, and the provider received exactly one call (#408). Test: `packages/lore/tests/integration/review-draft-task-reaches-the-judge.test.ts`.
- **AC-JV-8** (BR-1425): the migration on a fixture corpus moves a plan's `legacy_phase` value, and a phase document's `legacy_phase` value, into one body line each, `Legacy phase: <value>`, and removes the keys (one audited version per document). A second run changes nothing. Afterwards `planExtraSchema` declares no `phase` or `legacy_phase` key, `phaseExtraSchema` declares no `legacy_phase`, and the AC-JV-1 exhaustiveness test lists no legacy bucket. Test: `packages/lore/tests/unit/store/plan-legacy-phase-migration.bun.test.ts`.

## Rule changes

- Added: BR-1425 on `baseline-judge-a-document` (declared content visibility).
- Modified: BR-261 (four mechanical checks, no evidence check; taken over from the merged #408 spec) and BR-262 (a reject from the mechanical checks names those four checks only).
- BR-269 and BR-960 are NOT modified here: the approved `spec-defect-clusters-round-2-part-b-review-pending-queue-corpus` holds unlanded modifications of both (one change set per rule at a time). The BR-960 fold is the fold task of THIS plan, described in the section 'BR-960 fold': it waits for that change set, then proposes `retire BR-960` on this spec, and it blocks this plan's close. It is not a follow-up outside this plan.


## Acceptance Criteria (structured)

- [·] [script] AC-JV-1: For every document type, each key of its extra schema shape is classified exactly once as content or state in judge-visible-fields.ts; removing one classification (the task file_anchors entry) fails the test. False green guarded: a test iterating the classification instead of the schema would pass a missing key; the test iterates the schema keys.
  script: test — bun run test:file packages/lore/tests/unit/core/judge-visible-fields.test.ts && echo 'AC-JV-1 PASS: every extra key of every type is classified'
- [·] [script] AC-JV-2: v9 prompts for a spec whose body omits its criteria, a PRD with requirements, a task with ac_scope and file_anchors, and a baseline leaf with rules each contain every declared content field under its heading with its entries; a spec criterion shows its verify.falsifier (path, find, replace, exit code); a spec whose body also lists its criteria still gets the block; a bundle carrying one derived part renders it under its heading with the same cap. False green guarded: testing only the spec case would pass the v8 behaviour; the PRD, task, falsifier and derived-part cases are asserted.
  script: test — bun run test:file packages/lore/tests/unit/ai/review-template-v9-declared-fields.test.ts -t 'AC-JV-2' && echo 'AC-JV-2 PASS: every declared content field reaches the judge'
- [·] [script] AC-JV-3: A field with more entries than the structured-part cap renders exactly the cap followed by '<k> more not shown'; a document carrying a key its type does not classify renders 'structured fields not classified, not shown: <key>'. False green guarded: asserting only that the first entries appear would pass a silent drop; the count line is asserted exactly.
  script: test — bun run test:file packages/lore/tests/unit/ai/review-template-v9-declared-fields.test.ts -t 'AC-JV-3' && echo 'AC-JV-3 PASS: overflow and unclassified fields are counted and named'
- [·] [script] AC-JV-4: REVIEW_PROMPT_VERSION is v9, and the v8 builder output is byte-identical to fixtures captured before this change for a spec, a plan, a task and a baseline leaf. False green guarded: regenerating the fixtures after the change would hide a v8 edit; fixtures are captured in the red task, before any template edit.
  script: test — bun run test:file packages/lore/tests/unit/ai/review-template-v8-frozen.test.ts && echo 'AC-JV-4 PASS: v9 is active and v8 is byte-frozen'
- [·] [script] AC-JV-5: Through ReviewService with the in-memory AI provider, reviewing a PRD sends a prompt containing each of its requirement ids, and the stored judgment's prompt_version is v9. False green guarded: the unit renderer passes while the service still selects the v8 builder; the recorded provider prompt is asserted.
  script: test — bun run test:file packages/lore/tests/integration/review-prd-requirements-visible.test.ts && echo 'AC-JV-5 PASS: a live review shows the judge a PRD requirements'
- [·] [script] AC-JV-6: runDeterministicChecks returns exactly four checks in the order schema, parent_contract, tree_position, link_integrity; for a task in any status no evidence_completeness entry exists. False green guarded: keeping the check as 'skipped' passes an outcome test; the count 4 is asserted.
  script: test — bun run test:file packages/lore/tests/unit/core/review-checks-four.test.ts && echo 'AC-JV-6 PASS: four mechanical checks, no evidence pre-check'
- [·] [script] AC-JV-7: Through ReviewService with the in-memory AI provider, reviewing a well-formed draft task records a judgment whose judge_provider is the AI provider, not deterministic-checks, and the provider received exactly one call (#408). False green guarded: the unit passes while the service still runs a removed check from another path; the service path is exercised.
  script: test — bun run test:file packages/lore/tests/integration/review-draft-task-reaches-the-judge.test.ts && echo 'AC-JV-7 PASS: a draft task review reaches the AI judge'
- [·] [script] AC-JV-8: The legacy-key migration on a fixture corpus moves a plan's legacy_phase value and a phase document's legacy_phase value into one body line each, 'Legacy phase: <value>', and removes the keys in one audited version per document; a second run changes nothing; afterwards planExtraSchema declares no phase or legacy_phase key, phaseExtraSchema declares no legacy_phase, and the AC-JV-1 exhaustiveness test lists no legacy bucket. False green guarded: dropping the value silently passes the key-removal assertion; the body line is asserted.
  script: test — bun run test:file packages/lore/tests/unit/store/plan-legacy-phase-migration.bun.test.ts && echo 'AC-JV-8 PASS: plan legacy phase keys are migrated away'
