# Coding Style

> Layer 2 project conventions. MUST/SHOULD/MUST NOT only.

## Immutability (CRITICAL)

- MUST create new objects, NEVER mutate existing ones

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "Mutation is simpler here" | Simpler to write, harder to debug. Spread is 3 extra chars. |
> | "Performance requires mutation" | Prove it with a benchmark. Premature optimization is the root of all evil. |
> | "It's a local variable, mutation is safe" | Local today, shared tomorrow. Immutable by default costs nothing. |

## File Organization

- MUST organize by feature/domain, not by type
- 200-400 lines typical, 800 max per file
- MUST extract when a module exceeds 800 lines

## Code Quality Gates

Before marking work complete:
- [ ] No mutation (immutable patterns used)
- [ ] No deep nesting (>4 levels)
- [ ] No hardcoded values (use constants or config)
- [ ] Files focused (<800 lines), functions small (<50 lines)
