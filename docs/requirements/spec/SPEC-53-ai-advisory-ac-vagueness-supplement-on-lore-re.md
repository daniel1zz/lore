---
id: SPEC-053
type: spec
role: spec
title: "SPEC-053 — AI-advisory AC-vagueness supplement on lore review <spec>"
status: approved
priority: medium
created: 2026-07-18
updated: 2026-07-18
tags: []
parent: PRD-001
---
# SPEC-053 — AI-advisory AC-vagueness supplement on `lore review <spec>`

## Overview/Goal

SPEC-052's deterministic `lintAcQuantifiability` (zero-LLM wordlist) is the hard gate on
acceptance-criteria quality at `spec-create` / `spec-promote`. It catches **lexical**
un-quantifiability (an abstract word with no measurable token) but is blind to **semantic**
vagueness: an AC like `"returns quickly enough"` or `"handles reasonable load"` is
lexically clean (no abstract word from the list) yet declares no measurable threshold.

This spec adds an **advisory (never-blocking) AI dimension** to `lore review <spec>`: when the
document under review is a `spec` with declared `extra.acceptance_criteria`, the review judge
(SPEC-034 LLM-as-judge, already invoked on every `lore review`) is shown each AC plus the
already-computed deterministic lint verdict, and asked to flag ACs that pass the lexical lint
but remain **semantically un-measurable**. Findings surface as a **typed, enumerated
`advisory[]`** on the review judgment — structurally separate from decision-driving `reasons[]`
— and MUST NOT, by themselves, force `decision=reject`. The deterministic lint stays the sole
hard gate; this layer is nuance, not enforcement.

The `advisory[]` field is a single typed extension point for future spec-quality advisory
dimensions (the deferred requirement→AC completeness oracle slots in as a new `kind`), replacing
a stringly-typed convention with a Zod-enforced enum.

## Scope

**In scope:**
- `REVIEW_PROMPT_VERSION` bumped `v1` → `v2` via a NEW `REVIEW_TEMPLATES["v2"]` entry (v1 entry
  frozen, byte-identical — historical judgments' `prompt_version` stays meaningful; calibration
  already keys on prompt version).
- A pure advisory-section builder rendered ONLY when the reviewed doc is a `spec` with ≥1
  declared AC: lists each AC id + the deterministic `lintAcQuantifiability` verdict + an
  explicit advisory-only framing clause.
- A new optional `advisory[]` field on the review-judgment schemas (raw LLM output + persisted),
  each entry `{ kind, ac_id?, finding }` with `kind` from a Zod enum whose single source of
  truth lives in `@lore/core`; a judgment with no advisory validates byte-identically (additive,
  migration-free — mirrors SPEC-040's optional `truncated` precedent).
- `review-render` renders an advisory block when `advisory[]` is present; byte-identical no-op
  when absent.

**Out of scope:**
- Any change to `lintAcQuantifiability` or the `spec-create`/`spec-promote` hard gates
  (SPEC-052 owns those — deterministic lint remains the only blocking layer).
- Requirement→AC completeness (a separate backlog item; this spec only reserves its `kind` slot).
- Any new CLI command or flag; advisory rides the existing `lore review <spec>` call.
- advisory-calibration wiring (a future feedback-loop spec may add it; the typed field makes it
  possible but this spec does not build it).

## Acceptance Criteria

(Structured, script-mode, oracle-bound — added via `lore ac add`.)

- **AC-053-1** — `REVIEW_PROMPT_VERSION === "v2"` and `Object.keys(REVIEW_TEMPLATES).length === 2`
  (keys exactly `["v1","v2"]`), asserted by a passing unit test (exit 0).
- **AC-053-2** — The advisory `kind` enum (`@lore/core`) accepts `"ac_quantifiability"` and a
  Zod parse of an `advisory[]` entry with an out-of-enum `kind` fails; asserted by a test with
  ≥1 accept case and ≥1 reject case (exit 0).
- **AC-053-3** — `buildReviewPromptV2` output contains the literal heading
  `# AC Quantifiability (advisory)` and every declared AC id when the bundle is a `spec` with ≥1
  AC, and contains NO such heading when the doc is a non-spec OR a spec with 0 declared ACs;
  asserted by a test covering all 3 branches (exit 0).
- **AC-053-4** — `buildReviewPromptV2` output contains the exact advisory-only clause instructing
  the judge that advisory findings MUST NOT by themselves force `decision=reject`; asserted by a
  substring test (exit 0).
- **AC-053-5** — `buildReviewPromptV2`'s advisory section embeds the deterministic
  `lintAcQuantifiability` verdict (pass/finding count) for the reviewed spec's ACs, so the judge
  does not re-derive the lexical result; asserted by a test that feeds ACs with a known lint
  outcome and checks the rendered count (exit 0).
- **AC-053-6** — `buildReviewPromptV1` output is byte-identical to a frozen fixture captured
  before this change (REGRESSION); asserted by a string-equality test (exit 0).
- **AC-053-7** — The `review-render` advisory renderer returns a non-empty block containing each
  advisory finding when `advisory[]` has ≥1 entry, and returns the empty string `""` when
  `advisory[]` is absent/empty (REGRESSION no-op); asserted by a test with both branches (exit 0).

## Design Decisions

- **D1 — typed `advisory[]` over `reasons[]`+dimension string.** advisory findings have a
  different contract (never affect `decision`) than `reasons` (explain `decision`); conflating
  them in one free-text-`dimension` array is a semantic muddle and a stringly-typed coupling. A
  typed `advisory[]` with an enumerated `kind` structurally separates the two, gives the known
  future requirement→AC-completeness dimension a drop-in slot, and lets a later spec calibrate
  advisory precision independently. Cost is one optional field.
- **D2 — v2 prompt registry entry, v1 frozen.** The `REVIEW_TEMPLATES` version registry exists
  precisely for this (module header: "a future prompt A/B spec adds a new key rather than
  mutating this one"). v1 stays byte-identical so historical `prompt_version="v1"` judgments and
  their calibration records remain interpretable.
- **D3 — advisory only for spec-with-ACs.** AC-quantifiability is spec-specific; the section is
  absent for every other doc type and for a spec with no declared ACs, keeping non-spec review
  prompts byte-identical to v1 on that axis.
- **D4 — deterministic lint verdict fed to the judge.** The judge is shown the lexical lint
  result so it spends its judgment on the SEMANTIC gap the lint cannot see, rather than
  re-litigating the wordlist — one derivation site (`lintAcQuantifiability`), no drift.
- **D5 — no non-AI mode change.** `lore review` already runs the AI judge; the advisory rides
  the same single provider call (no second call), so there is no new AI surface to brake.

## Downstream Handoff

- **implement**: new `advisory` enum + entry schema in `@lore/core` (`review-judgment.ts`);
  `buildReviewPromptV2` + registry wiring in `packages/lore/src/ai/review-template.ts`;
  `AIProviderService.judgeDoc` selects v2 and passes the spec's ACs; advisory render helper in
  `packages/lore/src/adapters/cli/review-render.ts`.
- **test**: all 7 ACs are pure prompt-construction / schema-validation / rendering assertions —
  NO live provider needed; failure-first (frozen v1 fixture must exist before the v2 diff).


## Acceptance Criteria (structured)

- [✔] [script] AC-053-1: REVIEW_PROMPT_VERSION === 'v2' and Object.keys(REVIEW_TEMPLATES).length === 2 (keys exactly v1,v2), asserted by a passing unit test exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
- [✔] [script] AC-053-2: The advisory kind enum accepts 'ac_quantifiability' and a Zod parse of an advisory entry with an out-of-enum kind fails; test has >=1 accept and >=1 reject case, exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
- [✔] [script] AC-053-3: buildReviewPromptV2 output contains literal heading AC Quantifiability advisory and every declared AC id for a spec with >=1 AC, and NO such heading for a non-spec or spec with 0 ACs; test covers all 3 branches, exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
- [✔] [script] AC-053-4: buildReviewPromptV2 output contains the exact advisory-only clause that advisory findings MUST NOT force decision=reject; substring test exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
- [✔] [script] AC-053-5: buildReviewPromptV2 advisory section embeds the lintAcQuantifiability verdict pass and finding count for the spec ACs so the judge does not re-derive lexical result; test checks rendered count exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
- [✔] [script] AC-053-6: buildReviewPromptV1 output is byte-identical to a frozen fixture captured before this change REGRESSION; string-equality test exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
- [✔] [script] AC-053-7: review-render advisory renderer returns a non-empty block containing each advisory finding when advisory has >=1 entry, and returns empty string when advisory absent or empty REGRESSION no-op; test with both branches exit 0
  script: test — bunx vitest run packages/core/tests/unit/review-advisory.test.ts packages/lore/tests/unit/ai/review-template-v2.test.ts packages/lore/tests/unit/adapters/cli/review-render-advisory.test.ts
