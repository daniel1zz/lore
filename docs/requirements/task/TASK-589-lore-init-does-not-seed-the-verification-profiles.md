---
id: TASK-589
type: task
role: plan
title: "lore init does not seed the verification-profiles config template despite SPEC-058 D6 documenting verbatim seeding on fresh corpora"
status: draft
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PRD-001
---
assets/project/lore-config-template.yaml's header states: 'Seeded verbatim into a freshly-scaffolded corpus's .lore/config.yaml by lore init / lore setup --project (SPEC-058 Design Decisions D6) — an EXISTING corpus's config.yaml is never touched.' Observed on a fresh corpus (lore init --name babyai --author daniel, 2026-07-28, dist binary passing 'lore setup --check' = in-sync): the generated .lore/config.yaml contains ONLY the project name/author block — no workflow.verification_profiles key at all — and 'lore status' permanently reports 'Verification profiles: not configured'. Either the seeding was never wired into 'lore init' (only into setup --project's initCorpusAt path), or it regressed; either way observed behavior contradicts the documented contract. Impact: every corpus created via plain 'lore init' silently runs with vacuous-pass oracle-coverage floors, which defeats SPEC-058's purpose unless the operator discovers and hand-copies the template.
