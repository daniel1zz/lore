---
id: KN-042
type: knowledge
role: knowledge
title: "Write-spec rules (gate feeding source)"
status: approved
priority: medium
created: 2026-07-08
updated: 2026-07-12
tags: []
links:
  - {id: SPEC-040, type: governs}
  - {id: SPEC-045, type: governs}
  - {id: SPEC-046, type: governs}
  - {id: SPEC-047, type: governs}
  - {id: SPEC-048, type: governs}
  - {id: SPEC-049, type: governs}
---
## Overview

Rules a candidate `spec` document must satisfy before `lore gate spec-create` will
let it through. This document is the feeding source the gate quotes back (via a
minimal, truncated slice — never the full text) when a candidate violates one of
these rules.

## Rules

1. **Legal parent.** A spec must be parented to a legal upstream document type — a
   `prd`. Creating a spec with no parent, or a parent of the wrong type, is rejected.
2. **Declared spec_kind.** A spec must declare `extra.spec_kind` as one of
   `feature`, `tech`, or `design`. An absent value defaults to `feature` at create
   time; an explicit unrecognised value is rejected.
3. **Required skeleton sections.** A spec's content must include, at minimum, these
   level-2 headings: `## Overview/Goal`, `## Scope`, `## Acceptance Criteria`.
4. **Deterministic, oracle-verifiable acceptance criteria.** Every AC must be
   checkable by a deterministic oracle — an exit code, a test assertion, a concrete
   observable outcome. Vague verbs ("works", "support", "跑通") are not acceptable
   AC language; they cannot be mechanically verified.
5. **Structured AC via `lore ac add`.** Once the skeleton exists, add machine-checkable
   acceptance criteria with `lore ac add <spec> <id> --statement <s> --mode <script|ai|human>`
   rather than only prose under `## Acceptance Criteria` — structured ACs are what
   `lore verify` / `lore assess` can actually execute and score against.
6. **Optional code anchors.** Specs MAY declare code anchors —
   `lore create spec --code-anchor <path[#Symbol]>` / `lore anchor add <spec>` —
   verified by `lore status --check-drift` (SPEC-045).

## Scope

Applies to every `spec` document created through `lore create spec` or
programmatically via `CorpusService.create`. Does not apply to `prd`, `adr`,
`plan`, `knowledge`, or `task` documents.

## Acceptance Criteria

- A spec with no `parent_id`, or a `parent_id` pointing to a non-`prd` doc, is
  rejected by `gate-predicates.ts::parentLegal`.
- A spec with an `extra.spec_kind` outside `feature|tech|design` is rejected by
  `gate-predicates.ts::specKindValid`.
- A spec whose content contains no `## ` heading line is rejected by
  `gate-predicates.ts::hasSkeleton`.
