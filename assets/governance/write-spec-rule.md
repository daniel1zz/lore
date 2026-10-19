## Overview

Rules a candidate `spec` document must satisfy before `lore gate spec-create` will
let it through. This document is the feeding source the gate quotes back (via a
minimal, truncated slice — never the full text) when a candidate violates one of
these rules.

## Rules

1. **No parent.** A spec is created with no parent document: it belongs to the product trees
   only through its criteria's rule citations (BR-n, AS-n). Naming any parent at creation, or
   filing it under a document by a link, is rejected (exit 4).
2. **Declared spec_kind.** A spec must declare `extra.spec_kind` as one of
   `feature`, `tech`, or `design`. An absent value defaults to `feature` at create
   time; an explicit unrecognised value is rejected.
3. **Required skeleton sections.** A spec's content must include, at minimum, these
   level-2 headings: `## Overview/Goal`, `## Scope`, `## Acceptance Criteria`.
4. **Deterministic, oracle-verifiable acceptance criteria.** Every AC must be
   checkable by a deterministic oracle — an exit code, a test assertion, a concrete
   observable outcome. Vague verbs ("works", "support", "跑通") are not acceptable
   AC language; they cannot be mechanically verified.
5. **Structured AC via `lore ac add`, citing rules.** A spec is approved only when at least one
   criterion cites a live BR or AS rule (`--cite BR-n` on `ac add`, or `lore ac cite`; BR-1007).
   **Structured AC.** Once the skeleton exists, add machine-checkable
   acceptance criteria with `lore ac add <spec> <id> --statement <s> --mode <script|ai|human>`
   rather than only prose under `## Acceptance Criteria` — structured ACs are what
   `lore verify` / `lore assess` can actually execute and score against.

## Scope

Applies to every `spec` document created through `lore create spec` or
programmatically via `CorpusService.create`. Does not apply to `prd`, `adr`,
`plan`, `knowledge`, or `task` documents.

## Acceptance Criteria

- Any parent on the new document, a PRD included, is rejected by
  `gate-predicates.ts::parentLegal`.
- A spec with an `extra.spec_kind` outside `feature|tech|design` is rejected by
  `gate-predicates.ts::specKindValid`.
- A spec whose content contains no `## ` heading line is rejected by
  `gate-predicates.ts::hasSkeleton`.
