---
id: KN-586
type: knowledge
role: knowledge
title: "Role templates with role-bound and context-bound norms and capabilities"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [roles, composition, fragments, identity]
parent: PRD-001
links:
  - {id: ADR-044, type: relates-to}
  - {id: BASE-024, type: informs}
---
# Role templates with role-bound and context-bound norms and capabilities

Ideation, 2026-10-11. Not a decision. Split out of the run-identity initiative (`adr-run-identity-is-issued-by-lore-and-attested-by-the-harness`, decision U5) as its own initiative; next steps are `/lore-product opportunity` then `validate`.

## Idea (user, 2026-10-11)

Preset common roles — e.g. frontend, backend, full-stack. Each run is composed of:
- **role-bound** norms and capabilities: always carried by that role (backend: architecture-design norms);
- **context-bound** norms and capabilities: selected per run from the task's context (a backend run touching Java gets Java-specific norms).

This is the "composition" half of the run-identity model ("fix identity, keep composition dynamic, derive the agent"): role templates are the fixed part, context-bound selection is the dynamic part, and the run record captures what a run actually carried.

## What lore has today (read 2026-10-11)

- Context fragments in three places (shipped / user / project), higher place overrides lower (`baseline-choose-which-fragments-apply`).
- Each fragment declares `audience` (e.g. `main`, `subagent:lore-implementer`) and `mode: static | dynamic`.
- SubagentStart renders fragments per Claude Code agent type (`lore fragments render --outlet hook:subagent-start --agent-type <t>`).
- Project facts collected by lore: module index and root `package.json` scripts only (`packages/lore/src/service/context-facts.ts`) — no language/framework/stack detection.

## Gaps

1. **No harness-independent role.** `audience` names a Claude Code agent type, not a lore role.
2. **No conditional selection.** A fragment cannot say "applies when the task touches `**/*.java`" or "when the project stack includes Java".
3. **Capabilities are not modelled.** Tools, skills and permission limits ("reviewer is read-only") live only in Claude Code agent definitions.
4. **Term collision.** lore's `static | dynamic` means the delivery channel (rules file vs start-of-session injection); the idea's static/dynamic means role-bound vs context-bound. The second pair needs different names (working names: role-bound / context-bound).

## Reference patterns

- Claude Code path-scoped rules: a rules file with `paths:` frontmatter loads only when Claude reads/writes a matching file (verified in https://code.claude.com/docs/en/memory this session). Usable for the MAIN session: a context-bound fragment could render to a rules file with `paths: ["**/*.java"]`.
- That does NOT reach subagents here: all six custom agents set `omitClaudeMd: true` (verified this session), so they load no rules files; a context-bound selection for subagents must happen in lore at SubagentStart (from the task's file anchors or project facts).
- Cursor rules with glob auto-attach and GitHub Copilot `applyTo` instruction files work the same way (recall, unverified — E6).

## Evidence status

E6 only (the user's design intent). Not yet measured: how often an agent works on a stack whose specific norms it did not receive, and whether that produced worse work. This repository is single-stack (TypeScript), so evidence will have to come from other projects or from the run records slice 1 starts producing.

## Dependency on slice 1 of run identity (decided U5)

Slice 1 records, per run, the role/agent type and the injected fragment ids with content hashes. That is the data this initiative needs to compare compositions later; nothing else from this initiative enters slice 1.

## Next step

`/lore-product opportunity` with an outcome to be chosen (candidate: share of runs that received every context-bound norm applicable to the files they changed), then `validate`.
