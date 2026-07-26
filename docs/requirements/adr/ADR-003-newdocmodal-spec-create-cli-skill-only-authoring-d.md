---
id: ADR-003
type: adr
role: decision
title: "NewDocModal spec-create: CLI/skill-only authoring (disable + explain, not template or content field)"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: TASK-192, type: implements}
---
## Overview/Goal

Decide how the dashboard `NewDocModal` should handle creating a `spec` document,
given that the spec-create gate (SPEC-052 lens, `hasSkeleton` + downstream
structured-AC rules in `knowledge-write-spec-rules-gate-feeding-source`) rejects
every spec the modal can currently produce (type/title/parent only, no content),
producing a silent 4xx with no user-facing explanation.

## Scope

Applies to `packages/dashboard/src/components/NewDocModal.tsx` and its behavior
for `docType === "spec"` only. Other gated transitions (`spec-promote`,
`plan-promote`, `task-claim`) do not fire at create time and are unaffected.
`task`/`adr`/`knowledge`/`plan` creation via the modal is unaffected — none of
them carry a create-time content gate.

## Decision

Candidate (b): **spec authoring is deliberately CLI/skill-only.** The modal
keeps `spec` visible in the type dropdown (so users can see it exists and still
fill title/parent for their own reference), but the moment `docType === "spec"`
is selected, the form renders a visible inline notice explaining that specs
require a gate-conformant skeleton plus structured, oracle-verifiable acceptance
criteria (`lore ac add`) that this quick-create form has no way to collect, and
names the two real authoring paths — `lore create spec` (CLI) and the
`/lore-design` skill. The Create button is disabled for this type; no
`POST /api/dashboard/docs` request is ever sent for a spec, so the silent-4xx
path is structurally eliminated (AC-1).

## Candidates considered

- **(a) Modal seeds a gate-conformant template skeleton** (`## Overview/Goal` /
  `## Scope` / `## Acceptance Criteria` placeholder headings) for gated types.
  Rejected: `hasSkeleton` only checks for the *presence* of `## ` heading
  lines, not that the content under them is real — a user could click Create
  with the auto-inserted placeholder untouched and produce a doc that is
  "gate-shaped" but hollow. Worse, the write-spec rules the gate's own feeding
  source documents go further than `hasSkeleton` checks mechanically: rule 4
  (deterministic, oracle-verifiable ACs) and rule 5 (structured AC via
  `lore ac add`, a distinct follow-up write against an already-created doc) can
  never be satisfied by any single create-time payload, template or not. A
  seeded skeleton would produce specs that pass the create-time gate while
  remaining incomplete by the team's own authoring standard — exactly the
  "mechanically satisfies the gate but produces hollow specs" hack this
  decision was warned against.

- **(c) Full content field in the modal.** Rejected on the same rule-4/5 basis
  as (a) — a textarea still can't add structured ACs, so it only gets you to
  "passes hasSkeleton," not "is a real spec." It would also duplicate the
  CodeMirror 6 + split-preview `Editor` component (SPEC-022) that DocDetail
  already provides for real content authoring post-create, violating this
  module's own SSOT discipline (one markdown-editing surface, not two). A
  content field is strictly worse than "create with a placeholder, then edit
  in the real Editor" — except that path still can't add structured ACs, which
  is the actual blocker, not a content-input affordance.

- **(b) Disable/hide with an explanation.** Chosen. Precedent already exists
  in this exact file: the `knowledge` `sub_type: "assessment"` option is
  deliberately omitted from the dropdown because it "requires a Zod-valid
  `extra.assessment` payload that this simple form has no field to collect...
  written exclusively by `lore assess` / `lore_assess`, never through this
  modal." This generalizes that same pattern to `spec`, upgraded from a
  code-only comment to a user-visible notice (this task's AC-1 explicitly
  requires a *visible* explanation, not just a hidden option). It is also
  consistent with the project's own skill-chain discipline (root CLAUDE.md):
  feature/tech specs are produced via `/lore-design` consuming an upstream
  PRD, or `lore create spec` — never via ad hoc dashboard form-filling. No
  real capability is lost: both authoring paths remain fully available outside
  the dashboard.

## Consequences

- `NewDocModal` gains an inline, visible notice + disabled Create button when
  `docType === "spec"`; no other type's behavior changes.
- A future type gaining a create-time content gate should follow the same
  pattern (visible notice + disabled submit), rather than re-litigating
  candidates (a)/(c) each time.
- If the team later wants dashboard-native spec authoring, the correct fix is
  a dedicated multi-step spec-authoring flow (skeleton + `lore ac add`
  equivalent UI) — not a single-field patch to this quick-create modal.

## Acceptance Criteria

- AC-1: Creating a spec via the dashboard is impossible-by-design — the modal
  never issues a create request for `docType === "spec"` — with a visible
  inline explanation naming `lore create spec` and the `/lore-design` skill.
- AC-2: A component test (`NewDocModal.test.tsx`) covers: selecting `spec`
  renders the notice and disables Create; no `onCreate` call fires for that
  type even if attempted; other types are unaffected.
- AC-3: The affected e2e write-flow spec (`write-flow.pw.ts` and/or
  `review-loop.pw.ts`, whichever exercises NewDocModal's spec path) stays
  green when scoped-run.
