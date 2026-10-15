---
id: BASE-040
type: baseline
role: intent
title: "Standard: corpus structure"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
links:
  - {id: SPEC-092, type: supersedes}
---
# Standard: corpus structure

Rules on how corpus documents relate to the product trees.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders them as stored on 2026-10-11 so a reader of this body sees all four parts. Edit rules with `lore rule set`, then re-render.

Confidence values (BR-623): **established** means the owner has decided the rule is the target; **observed** means the behaviour is measured in code (file:line in Current Reality) but no one has yet decided it as the target and no acceptance criterion cites it. Enforcement is independent of confidence: an observed rule can be guaranteed by code.

## AS-18: A spec relates to the product trees through its acceptance-criteria citations (BR-n, AS-n), not through a single tree parent.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: A spec takes no parent: packages/core/src/doc-type-rules.ts:18 allows no parent type for spec and :42 lists spec in PARENTLESS_TYPES, so create with a parent and a parent link are refused (exit 4). Approval needs a criterion citing a live BR/AS rule (BR-1007, packages/lore/src/service/spec-approval-citation.ts). lore migrate spec-parents (spec-parent-migration-service.ts) cleared the parent of all 173 non-deleted specs on 2026-10-10 with one audit entry each; lore list --type spec shows 173 specs, 0 with a parent_id. Implements / Implemented by are computed from citations (spec-relations.ts:88 computeImplements, :119 computeImplementedBy).
- **Target Rule**: A spec has no required tree parent; every structural view of specs (lore tree, coverage, requirement coverage) is computed from citations.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: Done in baseline slice 3b; reversible with lore migrate spec-parents --revert.
- **Examples**:
  - A spec whose criteria cite BR-12 and AS-8 is listed under both the business leaf and the architecture standard.
  - Refused at target state: deciding a spec's place in the product by its parent_id.

## AS-20: SPEC-n and ADR-n numbers are allocated by the corpus at create time and never authored: a title starting with an uppercase SPEC-n or ADR-n prefix is refused on create and on title edit for every spec and ADR, a domain-overview spec receives no number, and a number is never reused.

- Confidence: observed; enforced by: guaranteed; lifecycle: live
- **Current Reality**: Allocation is store-atomic (insertWithAllocatedOrdinal, bounded retry, loud ORDINAL_ALLOCATION_EXHAUSTED); a unique index on (type, ordinal) counts soft-deleted rows so numbers are never reused; the display id is composed at read time and never stored. Domain-overview specs are exempt from allocation only (packages/core/src/ordinal.ts:92 exemptKinds). The title check is case-sensitive, uppercase prefix plus word boundary (ordinal.ts:268), applies to every spec and ADR including domain-overview (ordinal.ts:275), and runs on create (schemas.ts:642) and on title edit (corpus-service.ts:2154); a title that only contains SPEC-n later, or a lowercase prefix, is accepted.
- **Target Rule**: The corpus is the only authority for SPEC-n and ADR-n numbers; no title carries a self-declared number.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed; the 2026-07-27 one-shot ordinal migration is done.
- **Examples**:
  - Two concurrent spec creates get consecutive numbers; a deleted spec's number is not given to a new one.
  - Creating a spec titled 'SPEC-3 Foo' is refused, including for a domain-overview spec; 'Foo (see SPEC-3)' is accepted.
  - A domain-overview spec is created with no SPEC-n number.

## AS-21: A spec's kind is one of feature, tech, design or domain-overview; an unknown kind is refused at write time and an absent kind on create defaults to feature.

- Confidence: established; enforced by: guaranteed; lifecycle: live
- **Current Reality**: SPEC_KINDS in @lore/core (spec-kind.ts) is the single list and the write schema validates against it; domain-overview specs have a lighter verification floor, no AC requirement and no fast-track review.
- **Target Rule**: The kind list stays one closed enum in @lore/core; every write path validates against it and no kind is accepted outside it.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed.
- **Examples**:
  - Creating a spec with spec_kind 'draft' is refused with a validation error.
  - A spec created without a kind is stored as feature.

## AS-22: The corpus holds everything about the product and the process (requirements, designs, decisions, plans, evidence, assessments, learnings); a repo CLAUDE.md holds only code-adjacent navigation and links to the corpus for the why; a fact lives in one place and is linked from the other, never duplicated.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: The split is a written convention; no check detects a CLAUDE.md section that duplicates corpus text.
- **Target Rule**: No fact is stored in both the corpus and a CLAUDE.md; a lint flags a CLAUDE.md section that copies corpus text.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: Add the duplication lint when a consumer needs it; until then the rule is prompt-only.
- **Examples**:
  - A module CLAUDE.md names the invariant and cites the decision slug instead of copying the decision text.
  - Refused at target state: pasting a spec's acceptance criteria into a CLAUDE.md.

## Stage outputs (descriptive, not a rule)

The convention the lore skills follow: each stage of work leaves one output document, and the stage is complete when that document reaches its final state. It carries no AS id because no check enforces it; a part that gains a check becomes an AS rule.

| Stage | Required output | Complete when |
|---|---|---|
| Direction | PRD version bump | PRD approved |
| Feature definition | spec (kind feature) | spec approved |
| UI/UX design | spec (kind design) plus a repo prototype artifact | spec approved |
| Technical decision | adr | adr accepted |
| Structural tech design | spec (kind tech) | spec approved |
| Execution | plan, tasks and verification evidence | tasks archived |
| Closeout | assessment and a retro knowledge doc | assessment verdict persisted |

A spec relates to the product through its criteria citations (AS-18), not through a parent; cross-references between specs are typed links. Binary or HTML artifacts live in the repo and are referenced from the design spec by relative path. By convention the approver of a design or tech spec differs from its author (not enforced).


Source: spec-domain-overview-output-contract-document-taxonomy (superseded by this standard, 2026-10-10).
