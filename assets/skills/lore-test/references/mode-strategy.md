# Mode: strategy - Multi-Perspective Test Strategy Design

**Purpose**: Parallel risk-based test strategy planning from different failure mode perspectives

## Phase 1: Context (single agent)

1. lore corpus: Load PRD acceptance criteria, existing test-plan knowledge docs, feature-spec AC
2. Codebase scan: modules, complexity hotspots, change frequency, existing test coverage
3. Detect stack from `package.json` / config files → load project conventions
4. Query official docs (context7; fallback: deepwiki) for framework testing patterns

Output: **Strategy Brief** — modules list, current coverage, AC items, stack info.

## Phase 2: Multi-Perspective Risk Assessment

Launch **5 parallel subagents**, each assessing test needs from a different risk perspective.
Use `Agent` tool — send ALL 5 in a single message for true parallel execution.

### Risk Perspective Matrix

| # | Perspective | Identity Prompt | Focus |
|---|------------|----------------|-------|
| 1 | **User Risk Analyst** | "You assess risk from the end user's perspective. What failures would users see and feel?" | Broken user journeys? Empty states? Form validation gaps? Accessibility failures? Error messages that confuse? Critical paths untested? |
| 2 | **Data Integrity Analyst** | "You assess data corruption and consistency risks. Think about what happens to user data." | Data loss scenarios? Inconsistent state? Migration gaps? Concurrent modification? Orphaned records? Missing validation at boundaries? |
| 3 | **Security Risk Analyst** | "You assess security vulnerabilities that could be caught by testing." | Auth bypass paths? Injection points? Sensitive data in logs/errors? CSRF/XSS vectors? Privilege escalation? API abuse? |
| 4 | **Performance Risk Analyst** | "You assess performance degradation risks under real-world conditions." | N+1 queries at scale? Memory leaks over time? Slow page loads? Unbounded list rendering? Missing caching? Resource exhaustion? |
| 5 | **Integration Risk Analyst** | "You assess risks at system boundaries — APIs, databases, third-party services." | API contract drift? Schema migration breaks? Third-party service failures? Webhook delivery? Queue processing errors? Version incompatibility? |

### Subagent Prompt Template

Each subagent receives:

```
## Risk Perspective
{Identity Prompt}

## Strategy Brief
**Modules**: {module list with complexity indicators}
**Current Coverage**: {existing test coverage stats}
**Acceptance Criteria**: {AC items from spec/PRD}
**Stack**: {test framework, runner, assertion library}

## Your Task
Assess the system's test needs from your risk perspective.

Provide:
1. **Risk Areas** (3-5): Specific modules/features most at risk from your perspective. Rate each: Critical / High / Medium / Low.
2. **Test Gaps**: What's NOT tested that should be? Be specific (module + scenario).
3. **Recommended Test Types**: Which test types (unit/integration/e2e/contract/performance) address your risks?
4. **Priority Tests** (top 3): If we could only write 3 tests from your perspective, which 3?
5. **Coverage Dimensions**: Which of these matter most for your risks?
   □ Happy path  □ Edge/boundary  □ Error paths  □ Concurrency
   □ Idempotency  □ State transitions  □ Permission  □ Time/timezone
   □ Resource cleanup  □ Regression  □ Retry/timeout

Keep output concise (300 words max). Be specific about files/modules, not abstract.
```

## Phase 3: Synthesis & Test Plan

After all 5 agents return, synthesize into unified test strategy:

### Synthesis Framework

1. **Risk Heat Map** — overlay all perspectives to find highest-risk areas:

| Module/Feature | User | Data | Security | Performance | Integration | Overall Risk |
|---------------|------|------|----------|-------------|-------------|-------------|
| {module} | H/M/L | H/M/L | H/M/L | H/M/L | H/M/L | Critical/High/Medium/Low |

2. **Test Type Allocation** — map risks to test pyramid:

| Test Type | % Allocation | Covers Risks | Priority Modules |
|-----------|-------------|-------------|-----------------|
| Unit | ~70% | Logic, data validation, edge cases | ... |
| Integration | ~20% | API contracts, data flow, service boundaries | ... |
| E2E | ~10% | User journeys, critical paths | ... |
| Contract | as needed | API drift, schema changes | ... |
| Performance | as needed | Scale risks, memory leaks | ... |

3. **Cross-Perspective Priority** — tests recommended by 3+ perspectives → highest priority
4. **Coverage Gaps** — untested areas flagged by any perspective

### Test Plan Output

```markdown
# Test Plan: {feature/system name}

## Risk Assessment
[Heat map table from synthesis]

## Test Allocation
[Pyramid allocation table]

## Priority Test Cases
### P0 (must have before ship)
- [ ] {test description} — covers: {risk perspectives}

### P1 (should have)
- [ ] {test description} — covers: {risk perspectives}

### P2 (nice to have)
- [ ] {test description} — covers: {risk perspectives}

## Quality Gates
| Gate | Threshold |
|------|-----------|
| All tests pass | 100% |
| Line coverage | {project config or 80%} |
| Branch coverage | {project config or 70%} |
| No flaky tests | 0 |

## Coverage Dimensions Checklist
[Aggregated from all perspectives]
```

## Phase 4: Persist

- `lore create knowledge --parent <spec or prd it concerns> --sub-type reference --title "Test Plan: <feature>" --content ...` with full test plan
- Link to PRD/feature-spec via `lore link <test-plan-slug> <spec-slug> --type=relates-to`
- Output linked tasks for each test mode needed
