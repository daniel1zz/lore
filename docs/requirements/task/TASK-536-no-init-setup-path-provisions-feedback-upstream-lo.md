---
id: TASK-536
type: task
role: plan
title: "No init/setup path provisions feedback.upstream — lore report-issue fails out-of-box on every fresh corpus and demands hand-edited YAML"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: PRD-001
---
lore report-issue is a first-class CLI command, but its required config (feedback.upstream.corpus_path + feedback.upstream.root_prd in .lore/config.yaml) is provisioned by NO initialization path: lore init writes only the project block; assets/project/lore-config-template.yaml contains no feedback key; and SPEC-060 explicitly lists the '.lore/config.yaml write surface' as out of scope for lore setup --project. Result: the first invocation of report-issue on any fresh corpus fails with a config-validation error and instructs the operator to hand-edit YAML with a corpus_path they must discover themselves. Note the machine-level 'lore setup' install knows exactly where the lore repo lives (it installs from it) — it could seed a machine- or project-level default upstream, or 'lore report-issue' could interactively offer to write the config on first use (resolving the lore repo from the installed binary's symlink). Environment initialization should leave every advertised command runnable, or the command's error should self-provision rather than point at manual YAML surgery.
