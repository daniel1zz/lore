---
id: TASK-1824
type: task
role: plan
title: "[Skill:fix] The one write route honours claim-scoped corpus authoring (corpus_scope lease) for worktree writes — regression from DCL-3"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (reported by session a979eecd, 2026-10-19; regression from DCL-3, commit 979066fc): rule-service writes (setSiteMap / baseline map, rule add/set, moveRule) now go through CorpusService.writeDoc, which calls refuseIfForeignCorpusWrite with intentDeclared=false (corpus-service.ts ~1143-1146). The claim-scoped grant (lease corpus_scope, commit 7f8ddb93, issue #39) is never consulted on that route, so a worktree implementer that claimed with `--worktree <abs> --corpus-scope baseline-hygiene` is refused on a real `lore baseline map <leaf> --sites-file rows.json` (gate:corpus-write:foreign-provenance), while the same command with no change reports "authorized": dry-run and real write disagree.
Approach: the one write route consults the same corpus-write authority the pre-DCL-3 rule-service path consulted (the actor's fresh claim lease and its corpus_scope) before refusing a foreign-corpus write; one decision function for both the authorization report and the write, so they cannot disagree.
AC: integration test on a throwaway repo + linked worktree: (a) a claim with --worktree and --corpus-scope covering the leaf lets `baseline map --sites-file` write from the worktree (exit 0, one version); (b) the same write with no scoped lease is refused with gate:corpus-write:foreign-provenance (exit 4); (c) the no-change report and the real write agree in both cases. Made red once with the pre-fix writeDoc (runner-produced red via --capture).
