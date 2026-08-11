---
id: KN-097
type: knowledge
role: knowledge
title: "SPEC-068 D5 gap: version snapshots do not capture slug values (rename history unrecoverable)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: [spec-068, version-history, defect, dogfood]
parent: SPEC-089
---
Found by the SPEC-068 adversarial tester (2026-07-23): VersionRecord (packages/core/src/types.ts) snapshots content/extra/status/title but NOT slug. A lore set --slug rename bumps the version count (satisfying AC-068-7's literal wording) yet the slug value at any historical version cannot be recovered from lore log — SPEC-068 D5's 'recorded in the version log like title changes' is only count-true, not value-true. Related tester findings, documented not asserted: (a) set() bumps version even on a genuine no-op slug restate; (b) set --slug does not cross-check the new slug's leading segment against the doc's own type (a prd can take a spec- slug). Decision needed (owner: next SPEC-068 follow-up or assess): extend VersionRecord with slug (schema + store migration + restore semantics) vs amend D5 wording to scope the claim to version-count. Tests documenting actual behavior: packages/lore/tests/unit/service/set-slug-adversarial.test.ts.
