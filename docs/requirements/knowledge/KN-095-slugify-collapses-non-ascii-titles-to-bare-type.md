---
id: KN-095
type: knowledge
role: knowledge
title: "Slugify collapses non-ASCII titles to bare type prefix; no post-hoc slug edit"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: [dogfood, slugify, cjk, defect]
parent: SPEC-089
links:
  - {id: SPEC-089, type: informs}
---
# Finding: non-ASCII title → degenerate slug, and slug is unfixable after create

Observed 2026-07-23 in the guyin corpus (dogfooding):

1. `lore create adr --title "产品定位：内部圈子使用，功能强大优先于合规保守"` produced slug **`adr`** — the kebab-title step strips all CJK characters, leaving only the type prefix. Bare-type slugs are collision-prone and non-descriptive; a second all-CJK adr title would presumably yield `adr-2`-style or conflict.
2. No repair path: `lore set` has no `--slug` option, so the only fix is delete + recreate (churns ULID, loses links). Workaround used: recreate with an English-leading title — which then produced `adr-adr-…` (type prefix duplicated because the title itself began with "ADR:") and a 64-char truncation mid-word (`…-over-compli`).

Defects to consider (not yet built — verify current slugify behavior first per escalation≠build):
- Slugify should transliterate or fall back to a short ULID suffix when the kebab result is empty/near-empty, never emit the bare type name.
- Avoid `{type}-{type}-…` duplication when title already starts with the type word.
- Truncation should cut at a token boundary.
- Consider a guarded `lore set --slug` (slug is documented as "human-readable, editable" in DocRecord docs, but no surface edits it).

Impact: any Chinese-language team (guyin is one) gets degenerate slugs for every doc unless they anglicize titles.
