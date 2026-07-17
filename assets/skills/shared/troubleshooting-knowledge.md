# Troubleshooting Knowledge Management

Project-specific diagnostic knowledge stored in `docs/troubleshooting/`.

## Document Structure
| File | Purpose |
|------|---------|
| `known-issues.md` | Catalog: symptoms → root cause → solution → prevention |
| `{domain}-issues.md` | Domain-specific issues (create when domain has 3+ issues) |
| `incident-history.md` | Production incidents: timeline, root cause, resolution, lessons |
| `resolution-patterns.md` | Reusable fix patterns across issues |
| `index.yaml` | Metadata, keyword index, error pattern index |

## Lookup (before diagnosis)
1. Search `docs/troubleshooting/` by error pattern, component, symptoms
2. Check incident history if production-related
3. Check resolution patterns by issue category
4. Check Serena memories: `mcp__serena__list_memories` (filter: `bugfix-*`, `error-*`)
5. Fall back to static references in `~/.claude/skills/lore-diagnose/references/`

## Update (after successful fix)
1. Add/update entry in `known-issues.md` (symptoms, root cause, solution, prevention)
2. Update `index.yaml` with keywords and error patterns
3. Create domain doc if threshold reached
4. Add to `resolution-patterns.md` if fix is reusable
5. Link to ADR if issue reveals architectural problem

## Known Issue Format
```
## ISSUE-{NNN}: {Title}
Category | Severity | First Seen | Status (active/resolved/workaround)
### Symptoms → Root Cause → Solution → Prevention → Related
```
