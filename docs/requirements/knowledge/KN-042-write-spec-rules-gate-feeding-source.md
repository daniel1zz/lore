---
id: KN-042
type: knowledge
role: knowledge
title: "Write-spec rules (gate feeding source)"
status: approved
priority: medium
created: 2026-07-08
updated: 2026-07-14
tags: []
parent: PRD-001
links:
  - {id: SPEC-040, type: governs}
  - {id: SPEC-041, type: governs}
  - {id: SPEC-042, type: governs}
  - {id: SPEC-043, type: governs}
  - {id: SPEC-044, type: governs}
  - {id: SPEC-045, type: governs}
  - {id: SPEC-090, type: governs}
  - {id: SPEC-046, type: governs}
  - {id: SPEC-047, type: governs}
  - {id: SPEC-048, type: governs}
  - {id: SPEC-049, type: governs}
  - {id: SPEC-050, type: governs}
  - {id: SPEC-051, type: governs}
  - {id: SPEC-088, type: governs}
  - {id: SPEC-053, type: governs}
  - {id: SPEC-054, type: governs}
  - {id: SPEC-055, type: governs}
  - {id: SPEC-056, type: governs}
  - {id: SPEC-057, type: governs}
  - {id: SPEC-058, type: governs}
  - {id: SPEC-059, type: governs}
  - {id: SPEC-060, type: governs}
  - {id: SPEC-061, type: governs}
  - {id: SPEC-062, type: governs}
  - {id: SPEC-063, type: governs}
  - {id: SPEC-064, type: governs}
  - {id: SPEC-065, type: governs}
  - {id: SPEC-066, type: governs}
  - {id: SPEC-067, type: governs}
  - {id: SPEC-069, type: governs}
  - {id: SPEC-089, type: governs}
  - {id: SPEC-071, type: governs}
  - {id: SPEC-070, type: governs}
  - {id: SPEC-091, type: governs}
  - {id: SPEC-092, type: governs}
  - {id: SPEC-072, type: governs}
  - {id: SPEC-073, type: governs}
  - {id: SPEC-074, type: governs}
  - {id: SPEC-075, type: governs}
  - {id: SPEC-076, type: governs}
  - {id: SPEC-077, type: governs}
  - {id: SPEC-078, type: governs}
  - {id: SPEC-079, type: governs}
  - {id: SPEC-080, type: governs}
  - {id: SPEC-081, type: governs}
  - {id: SPEC-082, type: governs}
  - {id: SPEC-084, type: governs}
  - {id: SPEC-083, type: governs}
  - {id: SPEC-085, type: governs}
  - {id: SPEC-095, type: governs}
  - {id: SPEC-096, type: governs}
  - {id: SPEC-097, type: governs}
  - {id: SPEC-098, type: governs}
  - {id: SPEC-099, type: governs}
  - {id: SPEC-100, type: governs}
  - {id: SPEC-101, type: governs}
  - {id: SPEC-102, type: governs}
  - {id: SPEC-103, type: governs}
  - {id: SPEC-104, type: governs}
  - {id: SPEC-105, type: governs}
  - {id: SPEC-106, type: governs}
  - {id: SPEC-107, type: governs}
  - {id: SPEC-108, type: governs}
  - {id: SPEC-109, type: governs}
  - {id: SPEC-110, type: governs}
  - {id: SPEC-111, type: governs}
  - {id: SPEC-112, type: governs}
  - {id: SPEC-113, type: governs}
  - {id: SPEC-114, type: governs}
  - {id: SPEC-115, type: governs}
  - {id: SPEC-116, type: governs}
  - {id: SPEC-117, type: governs}
  - {id: SPEC-118, type: governs}
  - {id: SPEC-119, type: governs}
  - {id: SPEC-120, type: governs}
  - {id: SPEC-121, type: governs}
  - {id: SPEC-122, type: governs}
  - {id: SPEC-123, type: governs}
  - {id: SPEC-124, type: governs}
  - {id: SPEC-125, type: governs}
  - {id: SPEC-126, type: governs}
  - {id: SPEC-127, type: governs}
  - {id: SPEC-128, type: governs}
  - {id: SPEC-129, type: governs}
  - {id: SPEC-130, type: governs}
  - {id: SPEC-131, type: governs}
  - {id: SPEC-132, type: governs}
  - {id: SPEC-133, type: governs}
  - {id: SPEC-134, type: governs}
  - {id: SPEC-135, type: governs}
  - {id: SPEC-136, type: governs}
  - {id: SPEC-137, type: governs}
  - {id: SPEC-138, type: governs}
  - {id: SPEC-139, type: governs}
  - {id: SPEC-140, type: governs}
  - {id: SPEC-141, type: governs}
  - {id: SPEC-142, type: governs}
  - {id: SPEC-143, type: governs}
  - {id: SPEC-144, type: governs}
  - {id: SPEC-145, type: governs}
  - {id: SPEC-146, type: governs}
  - {id: SPEC-147, type: governs}
  - {id: SPEC-148, type: governs}
  - {id: SPEC-149, type: governs}
  - {id: SPEC-150, type: governs}
  - {id: SPEC-151, type: governs}
  - {id: SPEC-152, type: governs}
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
