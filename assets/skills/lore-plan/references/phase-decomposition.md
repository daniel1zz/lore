# Phase & Task Self-Containment — Cross-Session Readiness Standard

> Layer 2 convention: every phase description and task doc MUST be self-contained enough for cold-start execution.

## Root Problem

Lore docs are the ONLY persistent carrier across sessions. Conversation context is NOT persistent.
A fresh session (or a dispatched lore-implementer) has ZERO prior context — it can ONLY read the
task doc itself (`lore get <task>`), the plan's phase descriptions, and linked docs. If the context
that justified a task lives only in the planning conversation, it is already lost.

## Self-Containment Standard ("Cold-Start Executable")

### Phase description (`lore phase add <plan> <name> --description "..."`) — MUST cover:
- Scope: what this phase delivers
- Approach: implementation path (not just "implement X" — HOW)
- Key files: known files to create/modify
- Constraints: performance/security/compatibility requirements

### Task content (`lore create task --content-file ...`) — MUST carry:
- `Estimate:` / `Approach:` / `Source:` (implement tasks) — see plan-file-format.md
- `Covers:` — spec AC ids this task satisfies (evidence records against them via `--ac`)
- `AC:` — Given/When/Then, oracle-verifiable (see ac-quality.md); ≥1 dimension,
  specific enough to verify — not "works correctly" but "handles X edge case"
- Decision context where non-trivial choices were made:
  - `WHY ...` — why this approach over alternatives
  - `TRAP: ...` — known pitfalls discovered during review/analysis
  - `ASSUMPTION: ...` — unstated assumptions the executor must know

### Task metadata (flags, not prose):
- `--anchor <path>` — files this task will create/modify (the anchor-overlap gate reads ONLY this)
- `--priority` — critical path position
- `lore link <blocker> <task> --type=blocks` — artifact-justified prerequisites

## Session-End Checklist

Lore's model requires FULL upfront decomposition (mode-create § 5.1) — there should be no
"undecomposed phases". If a session nevertheless ends with planning incomplete:

1. MUST check: `lore list --type task --plan-id <plan> --phase "<name>" --json` per declared
   phase — any phase with zero tasks?
2. For each thin phase/task, verify the Cold-Start standard above
3. If any fails the standard — enrich it NOW (`lore set <task> --content-file ...`,
   `lore phase add --description` on recreate), not "next session"
4. Capture the volatile context before it evaporates:
   - `lore handoff --plan <plan> --next "decompose Phase N per ..." --decision "..."`
   - Durable rationale worth reuse → `lore create knowledge --parent <spec or prd it concerns> --sub-type research --title
     "Decomposition Context — {Phase}"` + `lore link <knowledge> <plan> --type=informs`

## Anti-Patterns

- MUST NOT write a phase description as a one-liner summary
- MUST NOT omit WHY/TRAP/ASSUMPTION notes when non-trivial choices were made
- MUST NOT defer decomposition to the next session without a handoff + enriched context
- MUST NOT assume the next session will "figure it out" from the spec alone
- MUST NOT put load-bearing context ONLY in the dispatch bundle — the task doc is the SSOT;
  the bundle's Context Digest is derived from it, not a substitute for it
