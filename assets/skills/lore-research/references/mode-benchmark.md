# Research Mode: Benchmark

## Scope

Performance comparison of candidate solutions with data-driven, methodology-aware recommendation.
Multi-role parallel evaluation to prevent cherry-picked benchmarks and ensure statistical rigor.

## Input

```yaml
input:
  topic: "ORM performance: Prisma vs Drizzle vs Knex"
  metrics: [query latency, cold start, memory usage]  # specific metrics to compare
  workload: "CRUD API, 10k rows, PostgreSQL"           # realistic workload description
  constraints: [TypeScript, PostgreSQL compatible]
  candidates: 2-5  # optional, default from discovery
```

## Phase 0: Benchmark Scope Definition (MANDATORY)

Before collecting any data, define:
```yaml
scope:
  question: "Which solution is fastest for {workload}?"
  decision_impact: "What changes if A is 2x faster than B? Would we still pick B for DX?"
  metrics:
    primary: ["{metric that most affects the decision}"]
    secondary: ["{nice-to-know metrics}"]
  minimum_bar: "Acceptable if within {X}% of fastest option"
  conditions: "Results only valid for {workload/scale/config}"
```

If performance difference would not change the decision → STOP. Recommend based on other criteria (DX, maintenance).

## Phase 1: Discovery (Doc-First)

Gather existing benchmark data — do NOT run new benchmarks unless no data exists.

```yaml
actions:
  - context7: Official performance docs, tuning guides, known limitations
  - gitmcp: Benchmark code in candidate repos (look for /benchmarks, /perf directories)
  - github: Dedicated benchmark repos "stars:>100 {A} vs {B} benchmark"
  - WebSearch: Published benchmarks "{A} vs {B} benchmark {year}" — prefer last 12 months
  - CRITICAL: Check official docs FIRST — often contain authoritative benchmarks
```

### Discovery Output
For each benchmark source found, log:
- Source URL/reference
- Date published
- Methodology described? (Y/N)
- Hardware/environment specified? (Y/N)
- Sample size / iterations noted? (Y/N)
- Credibility tier (1/2/3 per Evidence Protocol)

## Phase 2: Multi-Role Parallel Evaluation

Launch **3 parallel subagents**, each evaluating ALL collected benchmark data from a specialized lens.
Use `Agent` tool — send ALL 3 in a single message for true parallel execution.

### Role Matrix

| # | Role | Identity Prompt | Evaluation Focus |
|---|------|----------------|-----------------|
| 1 | **Performance Statistician** | "You are a performance analysis statistician. You care about methodology rigor, sample sizes, confidence intervals, and reproducibility." | Is the methodology sound? Sample size adequate? Confidence intervals reported? Warm-up accounted for? Results reproducible? Cherry-picking detected? What's the margin of error? |
| 2 | **Environment Auditor** | "You are an environment and configuration auditor. You verify benchmarks compare apples to apples." | Hardware/OS consistent across candidates? Configuration fair (default vs tuned)? Driver/connection pooling equivalent? Cold start vs warm measured? Runtime versions matched? Any candidate given unfair advantage? |
| 3 | **Practical Engineer** | "You are a production engineer. You evaluate whether benchmarks reflect real-world workloads and operational reality." | Does benchmark match real workload patterns? Edge cases tested (large payloads, concurrent connections, error paths)? Memory/CPU under sustained load? P99 latency not just P50? Operational overhead (connection management, migrations)? |

### Subagent Prompt Template

Each subagent receives:

```
## Role
{Identity Prompt}

## Benchmark Brief
**Question**: {what we're comparing and why}
**Candidates**: {list of candidates}
**Metrics**: {primary and secondary metrics}
**Workload**: {target workload description}
**Collected Data**: {summary of benchmark sources found in Phase 1, with methodology notes}

## Your Task
Evaluate the collected benchmark data from your specialized perspective.
Use WebSearch, context7, GitHub tools to verify claims and find additional data.

Provide:
1. **Methodology Assessment** — quality score (1-10) for each benchmark source from your lens
2. **Per-Candidate Performance Summary** — what the data shows, with confidence level
3. **Red Flags** — any benchmark that should be discounted or weighted down, and why
4. **Missing Data** — what data SHOULD exist but doesn't?
5. **Conditions Matrix** — when does each candidate win? (workload, scale, config)

Output as structured analysis. 400 words max.
```

## Phase 3: Synthesis & Normalized Comparison

After all 3 agents return, synthesize into weighted comparison:

```yaml
criteria:
  methodology_rigor:  { weight: 30%, source: "Performance Statistician" }
  environment_fairness: { weight: 30%, source: "Environment Auditor" }
  practical_relevance:  { weight: 40%, source: "Practical Engineer" }
```

### Synthesis Framework

1. **Discard unreliable data** — any benchmark flagged by ≥2 roles gets discounted
2. **Normalize results** — common units, note methodology differences
3. **Conditions Matrix** — when each candidate wins (not just "overall winner")

### Benchmark Results Table

| Metric | Candidate A | Candidate B | Candidate C | Winner | Conditions | Source Quality |
|--------|------------|------------|------------|--------|-----------|---------------|
| {metric 1} | ... | ... | ... | ... | ... | H/M/L |
| {metric 2} | ... | ... | ... | ... | ... | H/M/L |

4. **Confidence Assessment**:
   - HIGH: ≥3 independent sources agree, sound methodology
   - MEDIUM: 1-2 sources, minor methodology concerns
   - LOW: Single source, or conflicting data, or poor methodology

5. **Recommendation with Conditions**:
   - "A wins for {workload X} by {margin}%"
   - "B wins for {workload Y} when {condition}"
   - "Within margin of error for {workload Z} — choose based on other criteria"

## Phase 4: Post-Selection Docs Lookup (MANDATORY)

Query official tuning/optimization docs for the recommended option:
- Performance tuning guides
- Configuration best practices
- Known performance pitfalls
- Connection pooling / caching recommendations

## Phase 5: Persist Decision (MANDATORY)

Use `lore create adr --parent <spec it governs>` to persist the benchmark-driven decision:

```
lore template show adr --blank > adr-fields.yaml   # fill, then:
lore create adr --parent <spec it governs> \
  --title "Use {A} for {purpose} — benchmark-driven" \
  --decision-status proposed \
  --fields-file adr-fields.yaml
```

Fields carry: performance question (context), options with normalized results and conditions, the decision with methodology quality and confidence, constraints (A wins for {workload X} by {margin}% under {conditions}; B preferred when {alternative condition}).

## Tools (mode-specific priority)

| Tool | Priority | Use For |
|------|----------|---------|
| WebSearch | 1 | Published benchmarks, community comparisons |
| github | 1 | Benchmark repos, perf test code |
| context7 | 1 | Official performance docs, tuning guides |
| gitmcp | 2 | Benchmark implementations in repos |
| mcp-deepwiki | 2 | Architecture understanding affecting performance |
