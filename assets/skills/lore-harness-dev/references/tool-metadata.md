# Tool Metadata — 6-Dimension Decision Guide

Every `defineTool` requires explicit metadata. Omitting it triggers pessimistic defaults (danger=high, cloudSafe=false) which guards will block.

## Dimension Decision Trees

### category
What system resource does the tool interact with?

- Runs shell commands → `shell`
- Makes HTTP/API calls → `network`
- Reads/writes files → `filesystem`
- Renders UI components → `ui`
- Queries/mutates databases → `data`
- Pure computation, no I/O → `compute`
- Delegates to another agent → `agent`

### access
Does it read, write, or both?

- Only retrieves information → `read`
- Only creates/modifies/deletes → `write`
- Does both in one call → `read-write`

### danger
What's the worst-case outcome of a misuse?

- No side effects, fully reversible → `safe`
- Minor side effects, easy to undo → `low`
- Meaningful side effects, possible data change → `medium`
- Destructive, costly, or security-sensitive → `high`

### reversibility
Can the action be undone?

- Can be trivially rolled back → `reversible`
- Can be undone with effort (soft delete, backup restore) → `soft-irreversible`
- Cannot be undone (send email, delete production data) → `irreversible`

### idempotency
Does calling it twice with the same input produce the same outcome?

- Yes, no additional side effects → `idempotent`
- No, each call changes state further → `non-idempotent`

### cost
What's the operational cost per invocation?

- Zero marginal cost → `free`
- Negligible (pennies, local I/O) → `cheap`
- Noticeable (API calls with metering) → `moderate`
- Significant (expensive API, heavy compute) → `expensive`

## Common Tool Metadata Presets

| Tool Pattern | category | access | danger | reversibility | idempotency | cost | cloudSafe |
|---|---|---|---|---|---|---|---|
| Read file | filesystem | read | safe | reversible | idempotent | free | false |
| Write file | filesystem | write | high | soft-irreversible | non-idempotent | free | false |
| HTTP GET | network | read | low | reversible | idempotent | cheap | true |
| HTTP POST | network | read-write | medium | soft-irreversible | non-idempotent | cheap | true |
| Shell exec | shell | read-write | high | irreversible | non-idempotent | moderate | false |
| DB query | data | read | safe | reversible | idempotent | cheap | true |
| DB mutation | data | write | high | soft-irreversible | non-idempotent | cheap | true |
| LLM call | compute | read | safe | reversible | idempotent | expensive | true |
| Send email | network | write | high | irreversible | non-idempotent | cheap | true |

## cloudSafe Flag

`cloudSafe: true` means the tool can safely execute in a cloud subagent worker (no local filesystem access, no local network). Set `false` for tools that need local resources.
