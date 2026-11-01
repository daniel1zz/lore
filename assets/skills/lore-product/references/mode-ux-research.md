# Mode: UX Research

**Purpose**: Rigorous user research planning, execution, and synthesis — not just reports, but validated insights that drive product decisions

> **Cross-reference**: [jtbd-framework.md](jtbd-framework.md) for switch interviews | [cross-cutting-concerns.md](cross-cutting-concerns.md) for research ethics

## Phase 1: Research Design

### 1a. Define Research Questions

Use ST to derive research questions from product context:
- What do we need to learn? (not "what do we want to confirm")
- What decisions will this research inform?
- What is the riskiest assumption we hold right now?

### 1b. Select Study Type

| Type | When | Methods | Sample Size |
|------|------|---------|-------------|
| **Generative** (exploratory) | Early stage, problem unclear | Contextual inquiry, diary studies, ethnographic observation, switch interviews | 8-12 participants |
| **Evaluative** (validation) | Solution exists, testing fit | Usability testing, A/B tests, concept testing, card sorting | 5-8 per round (usability), 100+ (quantitative) |
| **Descriptive** (measurement) | Need baseline metrics | Surveys, analytics review, benchmark testing | 100+ (statistical power) |

### 1c. Study Plan Template

```
Research Title: {title}
Research Questions: {1-3 specific questions}
Study Type: generative | evaluative | descriptive
Method: {specific method}
Participants: {count} x {recruitment criteria}
Recruitment: {channel and screening criteria}
Timeline: {planning → recruitment → sessions → analysis → report}
Ethical Considerations: {consent, data handling, compensation, vulnerable populations}
Success Criteria: {what constitutes "enough" data to make a decision}
```

## Phase 2: Multi-Role Parallel Research Analysis

Launch **5 parallel subagents**, each analyzing research data from a distinct methodological lens.
Use `Agent` tool — send ALL 5 in a single message for true parallel execution.

### Role Matrix

| # | Role | Identity Prompt | Analysis Focus |
|---|------|----------------|----------------|
| 1 | **Behavioral Scientist** | "You are a behavioral scientist specializing in cognitive biases and decision-making patterns." | What cognitive biases are at play? Where do stated preferences contradict observed behavior? What heuristics are users relying on? What environmental factors influence behavior? |
| 2 | **UX Researcher** | "You are a senior UX researcher with expertise in qualitative and quantitative methods." | What are the key usability findings? What patterns emerge across participants? What are the severity ratings? How do findings map to the user journey? What needs further investigation? |
| 3 | **Accessibility Specialist** | "You are a WCAG expert focused on inclusive design for diverse abilities and contexts." | Who is excluded by current design? What barriers exist for assistive technology users? What situational impairments affect all users? What cognitive load issues exist? |
| 4 | **Data Analyst** | "You are a quantitative researcher who validates qualitative findings with data." | What do the numbers say? Where does quantitative data support or contradict qualitative observations? What segments behave differently? What is statistically significant vs noise? |
| 5 | **Product Strategist** | "You are a product leader who translates research into roadmap decisions." | What are the product implications? Which findings should change our roadmap? What new opportunities emerged? What should we stop building? What needs a PRD? |

### Subagent Prompt Template

Each subagent receives:

```
## Role
{Identity Prompt}

## Research Context
{Study plan summary + raw data/findings}

## Your Task
Analyze this research from your perspective.

Provide:
1. **Key Insights** (3-5): Insight (not observation). Format: "Users do X because Y, which means Z for our product"
2. **Surprising Findings**: What contradicts our assumptions?
3. **Confidence Level**: Per insight — High (multiple data points) / Medium (pattern emerging) / Low (single observation)
4. **Blind Spots**: What this research did NOT capture that matters
5. **Recommendations** (2-3): Specific, actionable product changes with expected impact

Keep output concise (400 words max). Distinguish observations from interpretations.
```

## Phase 3: Synthesis

After all 5 agents return, synthesize:

### Synthesis Framework

1. **Insight Convergence** — findings corroborated by 3+ roles (highest confidence)
2. **Methodological Tensions** — where behavioral data contradicts stated preferences (most valuable)
3. **Insight Hierarchy** (rank by actionability):
   - **Act Now**: High confidence + high impact + clear action
   - **Investigate Further**: High impact but low confidence
   - **Monitor**: Low impact but interesting pattern
   - **Archive**: Low confidence + low impact
4. **Persona Validation/Revision** — do existing personas hold? What changed?
5. **Journey Map Updates** — new pain points, moments of truth, emotional peaks/valleys
6. **Research Debt** — unanswered questions for next research cycle

### Verdict Summary Table

| Role | Top Insight | Confidence | Product Implication |
|------|------------|------------|---------------------|
| Behavioral Scientist | ... | ... | ... |
| UX Researcher | ... | ... | ... |
| Accessibility Specialist | ... | ... | ... |
| Data Analyst | ... | ... | ... |
| Product Strategist | ... | ... | ... |

### Deliverables

| Artifact | Format | Audience |
|----------|--------|----------|
| Research Report | lore `knowledge --sub-type research` doc | Product team |
| Insight Cards | 1 insight per card: observation → insight → recommendation → confidence | Design + Eng |
| Updated Personas | Behavioral personas (not demographic) | All teams |
| Updated Journey Map | Emotional journey with pain points + opportunities | Design |
| Research Backlog | Unanswered questions prioritized | Next research cycle |

## Phase 4: Activation & Next Steps

### Research → Action Bridge
- Map each "Act Now" insight to: existing PRD update OR new PRD needed OR design change
- For each recommendation, identify: owner, timeline, success metric
- Schedule follow-up research to validate changes

### Recommend one of:
- **Opportunity mapping** (`/lore-product opportunity`) — research surfaced customer needs; turn them into an OST rather than straight into requirements. A pattern needs ≥3 independent sources to become an opportunity
- **Validate** (`/lore-product validate`) — research surfaced a testable bet; run the cheapest disproving experiment
- **Update PRD** (`/lore-product prd`) — research reveals gaps in existing requirements
- **New Discovery** (`/lore-product discovery`) — research reveals new opportunity
- **Design Iteration** — findings are UX-specific, route to design skill
- **More Research** — insufficient data, design next study
- **No Action** — findings confirm current direction (document as validation)

📎 Interview instrument (question wording, 30-min script, commitment-currency ask, evidence tiering of findings): [interview-protocol.md](interview-protocol.md).

## Research Rigor Checklist

| Check | Requirement |
|-------|-------------|
| Sample | Diverse participants representing target segments (not just easy-to-recruit) |
| Bias | Confirmation, survivorship, recency, selection bias acknowledged and mitigated |
| Validity | Triangulation: ≥2 methods or data sources corroborate key findings |
| Ethics | Informed consent, data anonymization, fair compensation, right to withdraw |
| Limitations | Explicitly stated: what this study can and cannot tell us |
| Reproducibility | Study plan detailed enough for another researcher to replicate |

## Research Ethics (MANDATORY)

- **Informed consent**: Participants know purpose, data usage, and can withdraw
- **Data minimization**: Collect only what the research questions require
- **Anonymization**: Strip PII before analysis and sharing
- **Vulnerable populations**: Extra scrutiny for minors, elderly, people with disabilities
- **Compensation**: Fair, not coercive (doesn't bias participation toward desperate participants)
- **Dark patterns audit**: Never use research to optimize manipulative design

## Persona Requirements
Must: specific behaviors, motivations, frustrations, decision-making process, JTBD statements
Avoid: generic/demographic-only personas, assumption-based, >4 personas

## Journey Map Requirements
Must: emotional journey, specific pain points, actionable opportunity areas, moments of truth
Avoid: happy-path-only, no emotions, generic touchpoints, no data backing

## lore Protocol (MANDATORY)

1. **Create**: `lore create knowledge --parent <spec or prd it concerns> --sub-type research --title '{topic} UX Research' --fields-file f.yaml` (skeleton: `lore template show knowledge --kind research --blank`)
2. **Link**: `lore link <research> <prd-or-discovery-doc> --type=relates-to`
3. **Status flow**: `draft` → `in-review` (peer check methodology) → `approved`

## Exit Criteria

Research is complete when:
- [ ] All research questions have evidence-backed answers (or explicitly marked unanswerable)
- [ ] Insights are ranked by confidence and actionability
- [ ] Each "Act Now" insight has an assigned owner and next step
- [ ] Research limitations are documented
- [ ] Findings are persisted in the lore corpus with upstream/downstream links
- [ ] Cross-cutting concerns checklist passed (see cross-cutting-concerns.md)

## Triggers
"Create persona", "Map user journey", "Synthesize research", "Understand our users",
"User research plan", "Usability study", "Interview users", "Research synthesis"
