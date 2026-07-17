# Event Storming — AI-Assisted Workshop Methodology

**Purpose**: Discover domain events, commands, aggregates, and bounded context boundaries through systematic event-driven analysis. Adapted from Alberto Brandolini's Event Storming for AI-assisted codebase exploration.

## Sticky-Note Taxonomy

| Color | Element | Definition | Code Signals |
|-------|---------|------------|--------------|
| **Orange** | Domain Event | Something that happened (past tense) | `*Event.*`, `*Published`, `emit(*)`, `on(*)`, state transitions, audit logs |
| **Blue** | Command | Action that triggers an event | `*Command`, `*Handler`, `create*`, `update*`, `delete*`, API endpoints, form submissions |
| **Yellow** | Actor | Who/what issues the command | User roles, system crons, external webhooks, saga/policy triggers |
| **Lilac** | Policy | Reactive rule ("when X happens, do Y") | Event handlers, subscribers, `@On*`, saga steps, `if event then command` patterns |
| **Green** | Read Model | Data view that supports a decision | Query handlers, projections, dashboard components, report generators |
| **Pale Yellow** | Aggregate | Consistency boundary that processes commands and emits events | Entity clusters with shared transaction, repository roots |
| **Pink** | External System | Outside service involved | HTTP clients, SDK calls, third-party integrations, message queue producers/consumers |
| **Red** | Hotspot | Unresolved question, conflict, or complexity | TODO comments, complex branching, error-prone code, team disagreements |

## AI-Assisted Workshop Flow

### Step 1: Event Discovery (chaotic exploration)

Collect ALL domain events without ordering. Sources:

```
serena: search_for_pattern → "*Event", "emit(", "publish(", "dispatch("
serena: search_for_pattern → past-tense method names: "created", "updated", "completed", "failed"
serena: search_for_pattern → state transitions: status/state enum changes
Grep: audit/log patterns → "log.*action", "track.*event"
lore: `lore search "<term>" --type prd` over PRDs/user-stories for business outcomes
```

For each event, capture: `{name}` (past tense, UL term), `{source}` (code location), `{data}` (payload fields).

**Naming rule**: Events MUST be past-tense domain language. Not `handleOrder` but `OrderPlaced`. Not `processPayment` but `PaymentProcessed`.

### Step 2: Timeline Ordering

Arrange events chronologically along business process timelines:

1. Identify **entry points**: user registration, order creation, session start
2. Trace forward: what event follows what? Use `find_referencing_symbols` to follow event → handler → next event chains
3. Group into **swimlanes** by business process (e.g., order lifecycle, user lifecycle, payment lifecycle)
4. Mark **parallel tracks**: events that happen concurrently in different domains

Output format:
```
Timeline: {Process Name}
  → {Event1} → {Event2} → {Event3}
       ↓ (triggers policy)
       → {Event4} → {Event5}
```

### Step 3: Command & Actor Identification

For each event, ask: "What command caused this?" and "Who/what issued it?"

```
serena: find_referencing_symbols on event → trace back to handler → trace to API/trigger
```

Map: `Actor → Command → Event` triples.

### Step 4: Policy Discovery

Policies are the reactive glue: "When {Event} happens, execute {Command}."

```
serena: search_for_pattern → event handler/subscriber implementations
serena: search_for_pattern → saga/process manager patterns
Grep: "addEventListener", "subscribe", "@EventHandler", "@Saga"
```

Policies often reveal **cross-domain interactions** — a policy that reacts to Domain A's event by issuing Domain B's command indicates a context boundary.

### Step 5: Aggregate Clustering

Group commands + events around consistency boundaries:

1. Which commands MUST be processed atomically?
2. Which events MUST be emitted within the same transaction?
3. What invariants must hold between command acceptance and event emission?

→ Each cluster = candidate Aggregate. See [aggregate-design.md](aggregate-design.md) for boundary rules.

### Step 6: Hotspot Identification

Mark areas that are:
- **Contentious**: multiple possible interpretations of business logic
- **Complex**: deeply nested conditionals, many edge cases
- **Coupled**: events/commands that span too many aggregates
- **Missing**: business events that should exist but code doesn't emit them

Hotspots → prioritized investigation items. Use `Sequential Thinking` for complex hotspots.

### Step 7: Pivotal Events

Identify events that represent major phase transitions in the domain:
- Events where the "language changes" (pre-order vs post-order terminology)
- Events that transfer responsibility between teams/systems
- Events after which different rules apply

**Pivotal events often mark bounded context boundaries.**

## Output Artifacts

1. **Event Storm Map**: Timeline-based diagram of events, commands, actors, policies, aggregates
2. **Aggregate Candidates**: List of aggregate clusters with their invariants
3. **Hotspot Register**: Unresolved questions requiring stakeholder input
4. **Pivotal Event List**: Phase-transition events suggesting context boundaries
5. Persist to: `docs/domain/{domain}/event-storm.md` → register in lore (`lore create knowledge --sub-type reference`)

## Integration with Other Skill Steps

- Event Storm → feeds **Aggregate Design** (references/aggregate-design.md)
- Pivotal Events → feeds **Context Mapping** (references/context-mapping.md)
- Events + Commands → feeds **Ubiquitous Language** glossary
- Hotspots → feeds Expert Lenses (scenarios, red_flags)
- Policies → feeds Business Scenarios (cross-domain dimension)
