---
id: ADR-046
type: adr
role: decision
title: "Helper agent types split only on mechanism-enforced capability; roles are composed per dispatch"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: [agents, subagent, dispatch, composition]
parent: PRD-001
links:
  - {id: KN-590, type: relates-to}
  - {id: SPEC-118, type: relates-to}
---
# Helper agent types split only on mechanism-enforced capability; roles are composed per dispatch

## Context

Lore ships three helper agent types (`assets/agents/`): `lore-explorer` (read-only, haiku), `lore-reviewer` (read-only, sonnet, review methodology) and `lore-implementer` (writes, worktree). A user-local `tester` type existed alongside them on the maintainer's machine.

Measured 2026-10-15:

- What separates `lore-explorer` from `lore-reviewer` is the model and the prompt body. Both remove only Write/Edit/NotebookEdit via `disallowedTools`; Bash stays available, so "read-only" is enforced for file-edit tools and is prose for everything Bash can do.
- The user-local `tester` declared "test files only, cannot modify source code", but its `disallowedTools` held no tool at all — the boundary existed only as prompt text. In mechanism it was identical to `lore-implementer`.
- Role guidance (how to test adversarially, how to review) already ships as on-demand skills (`lore-test`, `lore-review`) and as context fragments selected per agent type (`audience: subagent:<type>`), so a type is no longer needed to carry it.
- The dispatch-isolation gate (BR-1023) keys worktree enforcement on a list of writing type names that had to be kept in step with every new role type.

`knowledge-agent-identity-as-a-lore-concept-fix-identity-keep` already separates fixed run identity from dynamic composition; a type per role is composition frozen into identity.

## Decision

1. A helper agent type exists only for a difference a mechanism enforces: which tools it may use, and whether it must write in its own worktree. Today that yields exactly two shipped types:
   - `lore-reader`: Write/Edit/NotebookEdit removed, no worktree — replaces `lore-explorer` and `lore-reviewer`;
   - `lore-implementer`: full tools, worktree enforced by BR-1023 — also the type for test-writing work. The name is kept: renaming the only write type changes no mechanism and would rewrite BR-1023, run records and fixtures.
2. Role (explore, review, implement, test) is composition, chosen per dispatch: the dispatch bundle names the role, and the role's guidance arrives on demand (the role's skill, role-scoped fragments). Independence between implementer and tester is a separate run, not a separate type.
3. Model choice is a dispatch parameter, not a reason for a type.
4. A prose-only restriction ("test files only") is not a type boundary. If such a restriction must hold, it needs a mechanism (a tool restriction or a hook); until one exists it is reported as unenforced, never encoded as a type.

## Consequences

- Fewer type names for hooks, fragment audiences and skills to keep in step; the isolation gate's writing-type list shrinks to the single write type.
- Until role selection is itself recorded per run (blocked on #167: a run's composition record lists 0 fragments), "this run was dispatched as a tester" is NOT ENFORCED and not auditable — the bundle says it, nothing checks it. This is a known gap, carried by the role-templates follow-up (handoff NS4, D8).
- `lore setup` converge removes installed files the shipped payload no longer carries and prints the removal list (`setup-manifest.ts` removals), so `agents/lore-explorer.md` and `agents/lore-reviewer.md` leave existing installs on their next converge. A consumer that hard-codes `subagent_type: "lore-reviewer"` breaks then; the release note must name the replacement.
- `lore-reader` is only partly read-only: Bash can still write. That residue is NOT ENFORCED and is counted here rather than hidden; closing it needs a hook that refuses mutating commands from a reader run, which is out of this decision's scope.

## Alternatives rejected

- Keep one type per role: every new role adds a type name to every consumer, while the role text it carries is already deliverable on demand.
- Enforce "test files only" by a new type with a path-restricting hook: no measured incident motivates it, and it reintroduces a role-shaped type.
