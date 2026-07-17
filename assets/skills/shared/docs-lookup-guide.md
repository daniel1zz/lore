# External Documentation Lookup

Never code against external dependencies without consulting official docs first.

## Tool Priority
`context7` (API reference, examples) ≈ `mcp-deepwiki` (architecture, internals) > `gitmcp` (repo docs, code examples)

## Tool Usage

### context7
1. `resolve-library-id("{library}")` → get ID
2. `query-docs(libraryId="{id}", query="{specific question}")` → docs

### mcp-deepwiki
- `ask_question(repoName="{owner}/{repo}", question="{architecture question}")`

### gitmcp
1. `match_common_libs_owner_repo_mapping("{library}")` → owner/repo
2. `fetch_generic_documentation(owner, repo)` → readme/docs
3. `search_generic_code(owner, repo, query)` → code examples

## Mandatory Triggers
- Using external library API → query API signature & examples
- Integrating multiple frameworks → query integration guide
- Version upgrade/migration → query migration guide + CHANGELOG
- Unfamiliar API → query usage patterns
- Deprecated API detected → REFUSE without migration plan

## Per-Skill Integration
| Skill | Trigger | Focus |
|-------|---------|-------|
| implement | Before writing code using external APIs | API signatures, return types, examples |
| research | After recommendation determined | Integration guides, version compat |
| diagnose | When recommending alternatives | Migration guides, breaking changes |
| refactor | When planning migration | Upgrade guides, CHANGELOG |
| design | Architecture involving frameworks | Official architecture patterns |

## Version Check
Always verify: docs version vs project's `package.json` version. Flag mismatches.
