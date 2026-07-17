# Jobs-to-be-Done (JTBD) Framework

> Operationalized JTBD methodology — not just format, but interview techniques, analysis tools, and integration points.

## Core Concept

Users don't buy products. They hire them to make progress in their lives. Understanding the **job** (not the user, not the feature) is the unit of analysis.

## Job Statement Format

```
When [situation/trigger],
I want to [motivation/progress],
so I can [desired outcome].
```

**Quality check**: A good job statement is:
- Situation-specific (not generic "as a user")
- Solution-agnostic (no product/feature names)
- Progress-oriented (movement from current state to better state)
- Stable over time (jobs don't change as fast as solutions)

## Switch Interviews

The most powerful JTBD research technique. Interviews people who recently **switched** to or from a product.

### Interview Protocol

**Recruit**: People who switched in the last 90 days (memory decay beyond that).

**Timeline technique** — walk backwards from the switch moment:

1. **First thought**: "When did you first think about switching?" What triggered it?
2. **Passive looking**: "Did you start noticing alternatives?" How long?
3. **Active looking**: "When did you start actively searching?" What did you look for?
4. **Deciding**: "What made you finally choose?" What almost stopped you?
5. **Consuming**: "What was your first experience like?" Did it match expectations?
6. **Satisfaction**: "How do you feel about the switch now?" What's better/worse?

### Key Questions per Phase
- "What was going on in your life when...?" (context, not demographics)
- "What did you try before this?" (competing solutions)
- "What almost made you NOT switch?" (anxieties)
- "What did you think you'd lose?" (habit of the present)

### Interview Anti-Patterns
- Asking "would you use X?" (hypothetical, useless)
- Asking about features (solution space, not job space)
- Leading questions ("don't you think X is better?")
- Interviewing non-switchers (no switching energy to analyze)

## Forces of Progress

Every switch decision has 4 forces. Map each from interview data:

```
            PUSH toward new ──────────────── PULL of new solution
          (frustration with current)        (attraction of new)
                    ↓ SWITCH ↑
          ANXIETY of new ──────────────── HABIT of current
          (fear of change)                (comfort with status quo)
```

**Switch happens when**: Push + Pull > Anxiety + Habit

### Force Analysis Template

| Force | Evidence from Interviews | Strength (1-5) |
|-------|------------------------|-----------------|
| **Push** (current pain) | "I was frustrated because..." | |
| **Pull** (new attraction) | "I was excited about..." | |
| **Anxiety** (fear of new) | "I was worried that..." | |
| **Habit** (comfort of old) | "I was used to..." | |

**Product implications**:
- Push > Pull → market the problem, not the solution
- Anxiety high → reduce onboarding friction, offer trials/guarantees
- Habit high → provide migration tools, maintain familiar patterns
- Pull low → product messaging problem, not product problem

## Outcome Statements

Precise format for measuring how well a job gets done:

```
[Direction] + [metric] + [object of control] + [context]
```

**Direction**: Minimize, Increase, Reduce, Maximize
**Examples**:
- "Minimize the time it takes to identify the root cause of a production error"
- "Reduce the likelihood of deploying a breaking change to production"
- "Minimize the effort required to understand a new codebase"

### Outcome-Driven Innovation (ODI) Scoring

For each outcome statement, survey users:

| Question | Scale |
|----------|-------|
| How **important** is this outcome? | 1-5 |
| How **satisfied** are you with current solutions? | 1-5 |

**Opportunity Score** = Importance + max(Importance - Satisfaction, 0)
- Score > 12: **Underserved** — high opportunity
- Score 10-12: **Appropriately served** — competitive
- Score < 10: **Overserved** — don't invest here

## Job Map (Job-Step Analysis)

Break the main job into functional steps:

| Step | Description | Key Outcomes |
|------|-------------|-------------|
| 1. **Define** | Determine what needs to be done | Minimize time to clarify objectives |
| 2. **Locate** | Find inputs and resources needed | Minimize effort to find required information |
| 3. **Prepare** | Set up for execution | Reduce likelihood of missing prerequisites |
| 4. **Confirm** | Verify readiness | Minimize risk of starting with wrong inputs |
| 5. **Execute** | Perform the core task | Minimize time/effort while maximizing quality |
| 6. **Monitor** | Track progress and issues | Minimize likelihood of missing problems |
| 7. **Modify** | Adjust as needed | Minimize effort to make corrections |
| 8. **Conclude** | Finish and hand off | Minimize effort to finalize and verify |

Each step generates outcome statements. Innovation opportunity lives in steps with high importance + low satisfaction.

## Integration Points

### JTBD → Discovery Mode
- Switch interviews identify competing solutions → feed competitive analysis
- Forces of progress → validate market pain intensity
- Job statements → frame the discovery brief

### JTBD → PRD Mode
- Outcome statements → become success metrics
- Job map steps → generate functional requirements
- Forces analysis → inform non-goals (don't increase anxiety/break habits)

### JTBD → UX Research Mode
- Switch interviews are a UX research method (listed in study types)
- Persona creation uses job performers (not demographics)
- Journey maps align to job map steps

### JTBD → Ideation Mode
- Job statements frame the brainstorm brief
- Underserved outcomes (ODI score >12) identify innovation targets
- Forces of progress reveal where to focus ideation energy

## When to Use

| Situation | JTBD Tool |
|-----------|-----------|
| "Who are our users?" | Job performer analysis (not demographics) |
| "What should we build?" | Outcome-driven innovation scoring |
| "Why did users switch/churn?" | Switch interviews + forces analysis |
| "How do we position this?" | Job statement as positioning anchor |
| "What's our competition?" | Competing solutions per job (not per category) |
| "How do we measure success?" | Outcome statements as metrics |

## Triggers
"Jobs to be done", "Why do users switch", "User motivation", "What job does this solve",
"Switch interview", "Outcome-driven", "Forces of progress"
