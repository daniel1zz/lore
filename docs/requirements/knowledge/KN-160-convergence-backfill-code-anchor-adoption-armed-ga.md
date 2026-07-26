---
id: KN-160
type: knowledge
role: knowledge
title: "Convergence backfill — code-anchor adoption armed + gate feeding-source design finding (2026-07-14)"
status: approved
priority: medium
created: 2026-07-14
updated: 2026-07-14
tags: [adoption, convergence, doctor, code-anchors]
parent: PRD-001
---
## What was done (doctor fix + convergence session, 2026-07-14)

1. **Corpus hygiene**: 6 orphans re-parented (incl. the IoC ADR → PRD root), tree conformance restored (`--check-tree` exit 0). 21 pending docs batch-reviewed via `lore review --pending` — 20 AI-approve (0.76-0.86), 1 reject (SPEC-035 assessment, judged on truncated diff; matches its earlier escalation).
2. **Code-anchor backfill (SPEC-045 adoption)**: 63 anchors declared across **38 of 49 specs** (file-level for services/core modules, directory-scope for cli/mcp/http adapters, eval, dashboard). Oracle: `lore status --check-drift` → consistent, 38 specs checked, exit 0. Drift oracle went from unarmed (0/49) to armed at 78% coverage. The 11 remaining specs (monorepo-skeleton, auth-agent-credentials, cookie-auth, SPEC-019/024/027/029/031/033/036/037) have implementations spread across files with no clean anchor — anchoring them imprecisely would create false-drift noise; left deliberately unanchored.
3. **Recurrence prevention wired**: repo-tracked `hooks/pre-push` (git `core.hooksPath hooks`) runs `lore status --check-tree --check-drift` before every push — fail-open when lore binary/.lore absent (same contract as the g1-g4 gate shims), bypass via `--no-verify`. Cloud CI is NOT viable for corpus checks: `.lore/lore.db` is gitignored (no corpus in a CI checkout); local pre-push is the correct enforcement point.
4. **Template hardening**: plan skill DoD gained item 8 (spec code anchors declared at plan close) + global CLOSE loop gained the same step. Anchors are declared AFTER code lands — pre-declaring a not-yet-written path is instant file_missing false drift.
5. **Staleness sweep ran clean**: `lore review --staleness --limit 5` → 0 candidates (60 knowledge/adr docs all < min_age_days 14). invalidate=0 is currently legitimate — the mechanism arms itself as the corpus ages.

## Design finding — gate feeding sources (do NOT 'fix' blindly)

`armed_gates` shows feeding_source_slug=null for spec-promote/plan-promote/task-claim. Investigation (checkpoint-registry.ts CHECKPOINT_APPLIES_TO) shows this is DELIBERATE: only spec-create has a corpus-wide discoverable feeding skill (applies_to='spec'); the other three checkpoints derive their feeding pack from the TARGET doc's resolved ancestor spec — contextual, not static. Converging them onto corpus-wide skill docs would require extending CHECKPOINT_APPLIES_TO + feed functions (a spec-worthy design change), and would trade contextual feeds for static ones. Default recommendation: accept the current design.

## Meta-learning

'Built but unused' is the recurring adoption gap class (code anchors 0/49, invalidate 0 uses, task anchors 6/117 at review time). Mechanism landing is not adoption — every new oracle/gate spec should carry a final adoption task (backfill + template wiring) before its plan closes. Now encoded in plan DoD item 8 + enforced at push time by hooks/pre-push.
