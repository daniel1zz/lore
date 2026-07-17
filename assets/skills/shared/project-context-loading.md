# Project Context Loading

Before skill execution, load relevant project docs from the lore corpus (`lore` CLI).

## Discovery Sequence
1. Consume the hook-injected `lore bootstrap --json` at SessionStart (root, active_plans, pending_reviews, my_claims, armed_gates, latest_handoffs, resume_hint, active_sessions) — don't re-call mid-skill.
2. `lore search "{feature}" --type spec --json` / `--type prd --json` / `--type adr --json` — filter results to `status: approved` client-side.
3. `lore get "{id-or-slug}" --resolve-mdx --json` — full content + resolved MDX placeholders.
4. `lore tree "{id-or-slug}"` — traceability chain (parent/child hierarchy); `lore get` renders inbound/outbound links for deeper traversal.

## What to Extract by Type
| Type | Extract |
|------|---------|
| `prd` | Goals, non-goals, acceptance criteria |
| `spec` (`--kind feature`) | Happy/error paths, AC, boundaries |
| `spec` (`--kind design`) | Architecture, API contracts, constraints |
| `spec` (`--kind tech`) | Implementation approach, technical constraints |
| `adr` | Decisions to respect, rationale |
| `knowledge` (`--sub-type reference`) | Coverage targets, priority scenarios, playbooks, runbooks |

## Non-lore Resources
- UI Standards: `docs/design-system/ui-standards.md`
- SDK Playbooks: `lore search --type knowledge` (sub_type: research/reference)
- Domain Knowledge: `docs/domain/{domain}/`
- Serena Memories: `mcp__serena__list_memories` / `read_memory`

## Enforcement
| Level | Trigger | Action |
|-------|---------|--------|
| INFO | Doc not found | Proceed with caution |
| WARN | Deviation from PRD/spec | Highlight, ask confirmation |
| REFUSE | Violates ADR or design constraint | Stop, explain conflict |

## Per-Skill Requirements
| Skill | Must Load | Enforcement |
|-------|-----------|-------------|
| implement | PRD, feature spec, design spec, tech spec, ADR | REFUSE on contradiction |
| review | PRD, feature spec, design spec, tech spec, ADR | Check against AC |
| test | PRD (AC), feature spec (AC, boundaries), knowledge (test-plan reference) | WARN if AC uncovered |
| refactor | ADR, design spec, tech spec | REFUSE on ADR violation |
| research | Existing ADRs | WARN if re-researching decided topic |
| diagnose | Serena memories, knowledge (runbook reference) | INFO (recommended) |

## Output Marker
Always output `[CONTEXT_LOADED]` with a type/found/ID/extracts table, even if all "not found".

## If the project has no `.lore/` corpus
Skip the lore steps entirely; suggest `lore init` once per project.
