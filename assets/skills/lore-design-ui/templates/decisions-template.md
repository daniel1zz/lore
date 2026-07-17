# Architecture Decision Records

> **Maintained by design skill (all modes)**
> Purpose: auditable history of design decisions with quality attribute traceability.
> One ADR per significant trade-off or technology choice.

## How to Use
- One decision per section. Newest first.
- MUST include quality attributes affected and validation plan.
- Link to quality attribute scenarios from architecture mode where applicable.

---

## Template

## ADR-{N}: {DATE} - {TITLE}

**Status**: proposed | accepted | deprecated | superseded by ADR-{M}
**Mode**: architecture | api | database | system | module | ui
**Stakeholders**: {who is affected}

### Context
- What problem or decision point?
- What forces/constraints exist?
- What quality attributes are at stake?

### Decision
- What was decided?

### Quality Attributes Affected
| Attribute | Impact (+/-/neutral) | Scenario Reference |
|-----------|---------------------|-------------------|
| Performance | | QA-{N} or N/A |
| Security | | |
| Maintainability | | |
| Availability | | |

### Alternatives Considered
| Option | Pros | Cons | Why Rejected |
|--------|------|------|-------------|
| {chosen} | | | **Selected** |
| {alt 1} | | | |
| {alt 2} | | | |

### Consequences
- **Easier**: What becomes simpler?
- **Harder**: What becomes more difficult?
- **Risks**: What new risks are introduced?

### Validation Plan
- How will we verify this decision was correct?
- What metrics/signals indicate it's working?
- When should we revisit? (time trigger or signal trigger)

### References
- Related docs/PRs/issues
