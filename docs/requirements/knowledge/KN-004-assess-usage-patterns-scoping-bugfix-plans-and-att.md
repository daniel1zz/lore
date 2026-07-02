---
id: KN-004
type: knowledge
role: knowledge
title: "Assess usage patterns: scoping bugfix plans and attaching diffs"
status: draft
priority: medium
created: 2026-07-02
updated: 2026-07-02
tags: [assess, usage, judge]
parent: SPEC-026
---
# lore assess usage patterns (learned from first three real runs)

1. **Bugfix/hardening plans inherit the parent spec's full AC surface.** getPlanBundle feeds the linked spec verbatim; a narrow plan hanging off a large spec (e.g. plan-spec-021-hardening under SPEC-021) gets judged against ALL AC-EXPORT-1..10, scoring conservatively on ACs outside its scope (observed: 63/100 despite complete in-scope delivery). Remedy: narrow plans should declare their own acceptance list in plan content — the judge weighs plan goals alongside spec ACs.
2. **Attach --diff for structural claims.** Without a diff, the judge can only score from evidence tails; allocator/schema-shape claims stay in conservative territory (observed in runs 1 and 3). Use lore assess <plan> --diff <merge-base>..HEAD after merging.
3. **Evidence tails should name test files/cases.** Named refs (run 2) lifted AC scores vs generic 'suite green' claims (run 1: 72 → run 2: 80).
4. **Spec truncation is routine** — SPEC-sized docs exceed the 12k budget; judgment.truncated: [spec] is expected, not an error. Raise ai.assess.max_spec_chars in config if full-spec judging matters.
