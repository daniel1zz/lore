---
id: KN-159
type: knowledge
role: knowledge
title: "Global Claude Code workflow migrated from DocMan to lore (IoC adoption)"
status: approved
priority: medium
created: 2026-07-14
updated: 2026-07-14
tags: [dogfood, adoption, workflow, migration]
parent: PRD-001
---
## What happened

The user's global Claude Code workflow (~/.claude) was fully migrated off the retired DocMan MCP system onto the lore CLI, restructured around lore's own IoC paradigm rather than transplanting DocMan mechanisms.

## Shape of the new global workflow

- **Corpus governs, hooks are thin**: the repo's four gate shims (g1-g4) were generalized into ~/.claude/hooks/lore-gate-*.sh (PATH-resolved binary, allow-through when cwd has no .lore/) and wired globally for Bash + MCP surfaces. Fail-open contract preserved verbatim.
- **SessionStart** injects `lore bootstrap --json` (resume_hint / latest_handoffs / my_claims / armed_gates / active_sessions) — replacing DocMan's bespoke resume-scan + bootstrap machinery with the SPEC-041 pointer set.
- **Workflow loop** (global-instructions.md): FEED (feed-before-produce, search-first) → PRODUCE (typed chain + deterministic gates, feeding-pack-driven retry) → EXECUTE (claim → oracle → evidence/verify attested → release) → CLOSE (assess / adr+knowledge / invalidate / handoff).
- **Agents**: lore-explorer/implementer/planner/reviewer with SPEC-042 actor-identity discipline (distinct LORE_ACTOR per concurrent worktree agent, implementer claims from inside its worktree) and SPEC-025 evidence contracts.
- **Skills**: ~30 skill dirs swept to lore CLI; lore-autopilot / lore-doctor / lore-session / lore-kickoff created; docman-hub/telemetry/eval/diagnose archived (no lore equivalent — cross-project aggregation deliberately dropped).

## Dropped without replacement (deliberate)

wf_understand/wf_decompose turn-gating (native plan mode instead), init_*/get_module module docs (layered CLAUDE.md via zz-init-context), cross-project hub aggregation, spec_ref test-file header gate (superseded by SPEC-038 ac_ref at evidence time).

## Learnings

- The v1→v2 conceptual map that mattered most: stored task status → computed readiness; orchestrator-asserted completion → attested evidence; hook-encoded discipline → corpus-encoded gates with feeding packs.
- Generalizing the gate shims took a 3-line patch (PATH binary + .lore presence check) — the fail-open contract made global reuse safe by construction.
- Hook test rebuild surfaced one latent defect: pre-subagent-gate had silently become advisory-only while its header still claimed HARD gate; fixed the doc, kept behavior.
