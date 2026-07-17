# Research Protocol — Cross-Cutting

Shared methodology for all research modes. Loaded by both `/research` skill and `researcher` agent.

## Tool Priority

| Priority | Tool | Use For |
|----------|------|---------|
| 1 | context7 (resolve-library-id, query-docs) | Official docs, API details, version status |
| 1 | mcp-deepwiki (ask_question) | Architecture understanding of repos |
| 1 | GitHub (search) | Discovery, health metrics, stars, issues |
| 2 | gitmcp (search_generic_code) | Real-world usage patterns and implementations |
| 2 | Bash (`npm search`, `pip search`) | Package registry discovery |
| 2 | **OpenCLI (Public API)** | **Community signals — zero LLM cost, parallel-friendly**. `arxiv` / `google-scholar` / `hf` for papers & models; `hackernews` / `lesswrong` / `lobsters` / `devto` / `reddit` for topic heat & community consensus; `stackoverflow` for errors. Prefer over WebSearch when sources match. See `~/.claude/skills/research/references/opencli-query.md` |
| 3 | WebSearch | Community sentiment, recent articles, benchmarks (last resort) |

## Reasoning Engine

Choose the lightest engine that fits:

1. **Fast-path**: Framework has canonical SDK (e.g. Next.js → NextAuth) AND no disqualifying constraint → verify via context7, write ADR, done. Skip ceremony.
2. **Sequential Thinking**: Use `mcp__sequential-thinking__sequentialthinking` for discovery → evaluation → comparison → conclusion. Default for most research.
3. **Multi-role subagents**: Only when >= 3 serious candidates with controversial trade-offs. Mode docs describe role matrices.

## Build vs Buy

Default = BUY. BUILD only when:
- No mature option (< 1k stars, unmaintained, no TS support)
- Trivially simple (< 50 lines, no edge cases)
- Unacceptable trade-offs (license, security, bundle size)

## Completion Gate (MUST pass before concluding)

- **Confidence floor**: 70% (anchored to verifiable signals: tool calls, docs fetched, metrics pulled)
- **Evidence triangulation**: Every key claim needs >= 2 independent source types
- **Source types**: OFFICIAL_DOC, COMMUNITY, BENCHMARK, CASE_STUDY, REPO_METRIC
- **Single-source claims**: Tag as `[UNVERIFIED]`
- **Checklist**:
  - [ ] Discovery broad (not just top results)
  - [ ] Official docs queried for ALL candidates
  - [ ] >= 1 negative source per candidate
  - [ ] Deal-breakers checked (license, CVEs, maintenance)
- **Bias check**: Include >= 1 sub-5k-star candidate; prove favorite wrong; check declined-but-once-popular options
- **Stopping rules**:
  - >= 80% confidence + winner by >= 10% → STOP
  - Top-2 within 5% → CONTINUE seeking differentiator
  - < 70% → ESCALATE with explicit unknowns

## Evidence Tagging

- `[Source: {TYPE}] {claim} -- {ref}` where TYPE in {OFFICIAL_DOC, COMMUNITY, BENCHMARK, CASE_STUDY, REPO_METRIC}
- `[FACT]` = observed/measured, `[INFERENCE]` = derived, `[UNVERIFIED]` = single source
- Each recommendation MUST include >= 1 counter-evidence and why it doesn't flip the conclusion.

## Output Format

Return to caller:
1. **Decision** + confidence % + basis
2. **Comparison table** (for sdk/pattern/benchmark)
3. **Key findings** with source citations
4. **Counter-evidence** considered
5. **Handoff YAML**:

```yaml
handoff:
  decision: "{chosen option}"
  confidence: 0-100
  constraints_for_design:
    - "{constraint downstream must respect}"
  risks_for_implement:
    - "{risk to watch for}"
  verification_criteria:
    - "{how to verify post-implementation}"
  open_questions:
    - "{unresolved questions}"
```

## Rules

- Default BUY over BUILD.
- Never conclude below 70% confidence -- escalate with explicit unknowns.
- Triangulate: every key claim needs >= 2 independent source types.
- Do not implement code. Research only.
- Bash for package searches and non-destructive commands only.
