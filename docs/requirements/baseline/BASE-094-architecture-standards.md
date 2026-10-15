---
id: BASE-094
type: baseline
role: intent
title: "Architecture: standards"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-095
---
# Standards

Rules new code must follow. Every rule is an AS-n with four parts:

- **Current Reality** — what the code does today (may differ from the target).
- **Target Rule** — the rule new code must follow.
- **Current Exceptions** — the AD-n debt entries that still violate it (existing debt may stay; new or enlarged debt is forbidden).
- **Migration** — how the exceptions close.

Standards are grouped into nodes by concern: layering, error model, gates and write paths, storage, testing, distribution and oracles, corpus structure. A criterion may cite an AS-n; it may not cite an AD-n.
