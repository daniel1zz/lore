# EARS Spec Generation

Formalize requirements into EARS-structured feature-spec before implementation.

## When to Generate
- **YES**: New functionality, behavior change, user-facing changes
- **SKIP**: Pure refactor, docs-only, config/infra with no user impact
- **Check first**: `lore search "{keywords}" --type spec --json` (kind: feature) — if exists, load it
- **Check upstream**: `lore search "{feature}" --type prd --json` — extract goals/AC as constraints

## Complexity Scaling
| Level | Trigger | REQs | ACs |
|-------|---------|------|-----|
| Lightweight | Bug fix, narrow behavioral surface, low ambiguity | 2-4 | 1-3 |
| Standard | New feature, moderate behavioral surface | 4-8 | 3-6 |
| Comprehensive | Cross-module, wide behavioral surface, high ambiguity | 6-12 | 5-10 |

## EARS Patterns
| Pattern | Template | Typical Use |
|---------|----------|-------------|
| Ubiquitous | The system shall {behavior} | Always-true defaults |
| Event-driven | When {trigger}, the system shall {response} | UI interactions |
| State-driven | While {state}, the system shall {behavior} | Conditional behaviors |
| Unwanted | If {error}, then the system shall {recovery} | Validation, error handling |
| Optional | Where {feature enabled}, the system shall {behavior} | Feature flags, preferences |
| Quality | The system shall achieve {metric} {threshold} under {condition} | Performance, scalability, reliability |

## EARS → Gherkin Mapping

Each EARS step MUST produce at least one Gherkin scenario. Use this conversion table:

| EARS Pattern | Given (precondition) | When (trigger) | Then (outcome) |
|-------------|---------------------|----------------|----------------|
| Ubiquitous | _(system is running)_ | _(any state)_ | {behavior} |
| Event-driven | {relevant state} | {trigger event} | {response} |
| State-driven | {state is active} | {action attempted} | {behavior} |
| Unwanted | {normal operation} | {error condition} | {recovery action} |
| Optional | {feature is enabled} | {trigger} | {behavior} |
| Quality | {normal operation} | {load/stress condition} | {metric within threshold} |

Scenario naming convention: `[{Path}/{Step N}] {description}`
- Path = Happy / Alt / Error (matches feature-spec section)
- Step N = step number within that path
- Example: `Scenario: [Happy/Step 1] User submits valid form`

## Workflow
1. Extract intent → list discrete behaviors from user request + ANALYZE block
2. Classify each behavior to an EARS pattern
3. For each EARS step, derive paired Gherkin scenario(s):
   `Given {precondition} | When {action} | Then {result} | Priority: must/should/could`
4. Output scenario map:
   ```
   [SCENARIO_MAP]
   | Step | EARS Pattern | Scenario | Priority |
   |------|-------------|----------|----------|
   | Happy/1 | Event-driven | [Happy/Step 1] ... | must |
   | Error/1 | Unwanted | [Error/Step 1] ... | must |
   ```
5. Define boundaries (comprehensive only): always / ask_first / never
6. Save: `lore create spec --kind feature --title '<title>' --parent <prd> --content '...'` (run `lore feed spec-create --parent <prd>` first) → output `[SPEC_GENERATED]`
7. Link upstream: `lore link <spec> <prd> --type=implements` if PRD found
