---
name: lore-product-lens
description: "Use when the user wants a structured multi-angle review of a product, project or feature set, even on one dimension such as positioning: 'review this product', 'product audit', 'product review', 'product health check', 'product lens', '产品审视', '产品评审', '产品分析'. NOT for abstract strategy analysis (use lore-analyze)."
---

# Product Lens — Multi-Dimensional Product Review

Parallel subagent review of a product across 6 dimensions, producing a scoring matrix + structured report.

## Args

`$ARGUMENTS` is parsed as: `[scope] [focus]`

| Scope | Focus | What it does |
|-------|-------|--------------|
| `full` (default) | — | All 6 dimensions |
| `quick` | — | 3 core dimensions (scenario, users, features) |
| `single` | dimension slug | One dimension deep-dive |
| `compare` | competitor name | Weighted comparison vs a specific competitor |

Dimension slugs: `scenario`, `users`, `features`, `positioning`, `competitive`, `business`

## Phase 1: Product Context Intake

Before reviewing, build a **Product Context Brief** — the shared input all 6 subagents receive.

### 1.1 Auto-discovery

Gather context from available sources (parallel where possible):

| Source | How to find | What to extract |
|--------|------------|-----------------|
| PRD / product docs | `find . -name "*.md" \| grep -iE "prd\|product\|requirements\|spec"` | Vision, target users, features, success metrics |
| Domain docs | `lore search "domain" --type knowledge --json` | Business rules, entities, workflows |
| README | Read `README.md` | Product description, tech stack, setup |
| Package manifest | `package.json`, `Cargo.toml`, `pyproject.toml` | Name, description, dependencies |
| API surface | Serena `get_symbols_overview` on entry points | Endpoints, public interfaces, feature scope |
| Existing reviews | `lore search "review retro" --type knowledge --json` | Prior findings, known gaps |

### 1.2 User confirmation

Present the extracted context as a **Product Context Brief**:

```
## Product Context Brief
- **Product**: [name]
- **Vision**: [one-liner]
- **Target users**: [user segments]
- **Core scenarios**: [top 5 usage scenarios]
- **Key features**: [feature list with status]
- **Market position**: [how it differentiates]
- **Tech stack**: [languages, frameworks]
- **Maturity**: [MVP / growth / mature]
```

Ask the user to confirm or supplement. Missing fields are acceptable — subagents adapt to available context. But flag any critical gaps (no target users identified, no clear scenarios) as intake warnings.

## Phase 2: Parallel Review

Spawn 6 subagents (or fewer if `scope=quick/single`). Each receives:
1. The Product Context Brief
2. Their dimension-specific lens (from `references/{dimension}-lens.md`)
3. Relevant source files/docs identified during intake
4. Scoring rubric (standardized 1-10 scale per sub-criterion)

### Subagent dispatch template

For each dimension, spawn via `Agent(subagent_type="general-purpose")`:

```
You are a Product Review Agent specializing in [{dimension_name}].

## Your Task
Review this product through your specialized lens and produce a structured assessment.

## Product Context
{product_context_brief}

## Your Lens
{content from references/{slug}-lens.md}

## Source Material
{relevant files/docs for this dimension}

## Output Format
Produce a JSON block at the end of your review:

### Narrative Assessment
For each sub-criterion in your lens:
1. **Finding**: What you observed (with evidence — file paths, code refs, doc quotes)
2. **Impact**: Why it matters (connect to product outcomes)
3. **Score**: 1-10 with justification
4. **Recommendations**: Specific, actionable improvements

### Scoring Output
```json
{
  "dimension": "{slug}",
  "dimension_name": "{display_name}",
  "overall_score": <1-10>,
  "sub_scores": [
    {"criterion": "<name>", "score": <1-10>, "evidence": "<brief>", "priority": "critical|high|medium|low"}
  ],
  "top_findings": ["<finding1>", "<finding2>", "<finding3>"],
  "action_items": [
    {"action": "<what>", "impact": "high|medium|low", "effort": "high|medium|low"}
  ]
}
```
```

### Dimension → Lens mapping

| # | Dimension | Slug | Lens file | Core question |
|---|-----------|------|-----------|---------------|
| 1 | Scenario Coverage | `scenario` | `scenario-lens.md` | Does the product cover the scenarios that matter? |
| 2 | User Group Fitness | `users` | `user-group-lens.md` | Does the product serve each user segment well? |
| 3 | Core Feature Completeness | `features` | `feature-lens.md` | Are the right features built, and built right? |
| 4 | Market Positioning | `positioning` | `positioning-lens.md` | Is the positioning clear, defensible, and communicated? |
| 5 | Competitive Analysis | `competitive` | `competitive-lens.md` | How does it compare to alternatives? |
| 6 | Business Viability | `business` | `business-lens.md` | Can this product sustain and grow as a business? |

## Phase 3: Synthesis

After all subagents complete, aggregate into the final report.

### 3.1 Scoring Matrix

Build a table from all subagent JSON outputs:

```
## Scoring Matrix

| Dimension | Score | Top Finding | Priority Items |
|-----------|-------|-------------|----------------|
| Scenario Coverage | 7.2 | Missing offline scenario | 2 critical |
| User Group Fitness | 6.5 | Admin UX neglected | 1 critical |
| Core Features | 8.0 | MVP complete, gaps in analytics | 0 critical |
| Market Positioning | 5.8 | Undifferentiated messaging | 3 critical |
| Competitive Analysis | 6.0 | Feature parity but no moat | 1 critical |
| Business Viability | 7.5 | Unit economics sound | 0 critical |

**Weighted Overall: 6.8 / 10**
```

Weights (adjustable by user):
- Scenario: 20%, Users: 20%, Features: 20%, Positioning: 15%, Competitive: 10%, Business: 15%

### 3.2 Cross-Dimensional Insights

Identify patterns that span multiple dimensions:
- Contradictions (e.g., positioning says "enterprise" but UX review shows consumer-grade onboarding)
- Reinforcements (e.g., strong feature set + weak positioning = hidden gem, fix messaging)
- Risk clusters (e.g., 3 dimensions flag the same user segment as underserved)

### 3.3 Prioritized Action Items

Merge all action items from subagents, deduplicate, and rank by:
1. Cross-dimensional impact (appears in multiple reviews = higher priority)
2. Impact × Effort matrix (high impact + low effort first)
3. Dependency order (foundational fixes before downstream improvements)

### 3.4 Output structure

```markdown
# Product Lens Report: {product_name}

## Executive Summary
{2-3 sentence verdict with overall score}

## Scoring Matrix
{table from 3.1}

## Dimension Reports

### 1. Scenario Coverage (score/10)
{narrative from scenario subagent}

### 2. User Group Fitness (score/10)
{narrative from users subagent}

... (all 6 dimensions)

## Cross-Dimensional Insights
{patterns from 3.2}

## Action Plan
{prioritized items from 3.3, grouped by priority tier}

## Methodology
- Review date: {date}
- Scope: {full/quick/single}
- Sources analyzed: {list of files/docs}
- Context completeness: {intake warnings if any}
```

## Phase 4: Feedback Loop (MANDATORY — a review that only produces a report has failed)

⛔ **Do not end at the report.** A scoring matrix nobody routes back into the corpus is a one-off opinion: the gaps it found reappear next quarter because nothing changed upstream. Every finding must land somewhere that governs future work.

### 4.1 Route each action item

| Finding type | Destination | Command |
|-------------|-------------|---------|
| Uncovered scenario / underserved user segment | **Opportunity candidate** (a need, not a feature) | `/lore-product opportunity` — feeds Level 2 of the OST |
| Missing capability vs competitors | Verify first — competitor claims in a review are E6 unless sourced | `lore-product-benchmark` to confirm, then opportunity |
| Positioning / messaging gap | PRD strategy update (why / for whom) | `lore set <prd> --content-file ...` (small, reviewed edit; behaviour goes to the baseline tree via `lore rule add`) |
| Contradiction between stated strategy and shipped product | **ADR** — one of the two must change | `lore create adr` |
| Assumption the review proved wrong | Invalidate the doc that asserted it | `lore invalidate <doc> --superseded-by <report> --reason "..."` |
| Confirmed defect / UX breakage | Task on the active plan | `lore create task --anchor <path>` |

### 4.2 Persist the report

```bash
lore create knowledge --sub-type retro --title '{product} Product Lens {date}' --content ...
lore link <report> <prd> --type=relates-to
```

### 4.3 Close the loop explicitly

End the run by stating, in one block: how many findings were raised, how many were routed (and where), and how many were **deliberately dropped with a reason**. ⛔ Silent attrition — findings that appear in the report and are never mentioned again — is the failure mode this phase exists to prevent; a dropped finding must be dropped on the record, not by omission.

## Also use when

Other phrases that route here: 'evaluate product', 'multi-dimensional review', '多维度评审'. If the user names only one dimension (e.g. 'how's our positioning'), invoke this skill anyway; it lets them scope down. The review evaluates six lenses (scenario coverage, user group fitness, core feature completeness, market positioning, competitive analysis, business viability), produces a scored matrix, and ends with a mandatory routing phase that files every finding back into the lore corpus; a review that ends at a report is incomplete.
