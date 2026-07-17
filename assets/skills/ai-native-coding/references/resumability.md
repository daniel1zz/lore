# Resumability — Code That Survives the Next Session

> The next AI session that touches this code may have zero memory of why anything is the way it is. Encode the "why" of every non-obvious line *in the code*, with pointers to deeper context when the inline budget is too small.

## Why this matters

A human developer who returns to a file after six months sometimes has to dig through git log, Slack history, and old design docs to recover the rationale for a strange-looking piece of code. They can do this — slowly, but they can. They share continuity with the team that wrote it.

An AI agent has *no* continuity. Every session starts fresh. The git history is searchable but slow. Slack and design docs may not be in the working directory at all. The code itself is the only durable carrier of intent across sessions.

Resumability is the property that **a stranger reading this file can make safe modifications without breaking unrelated invariants**. The stranger is the next session of you, or a different model, or a teammate dispatched as a subagent.

Concretely, this means:

- Code that *looks* simplifiable but is intentionally structured a certain way carries a `// reason:` comment.
- Code that depends on a non-obvious external fact (a bug in a library, a regulatory constraint, a race condition) carries a comment with the source.
- The first time a decision is made, an ADR captures it; the code points at the ADR.
- "Fences" (code that looks unused or pointless) are explicitly labeled as fences with the trigger that would justify removal.

## ⛔ Core rules

1. **Any line that looks "wrong" but is right** carries a comment explaining why. The bar is: "would a future session plausibly delete or 'fix' this?" If yes, comment.
2. **The comment is a sentence, not a label.** "// FIXME: hack" tells the next session nothing. "// reason: provider X returns dates as ISO without TZ; we coerce to UTC here so downstream comparisons work — see ADR-019" tells them everything.
3. **Architectural decisions live in ADRs** (`docs/decisions/`), not inline. The inline comment is a pointer.
4. **Chesterton's Fence comments** mark code that should not be removed without specific verification, with the verification step spelled out.
5. **No TODO/FIXME for unfinished work.** Either finish it or open a tracked issue and link the issue from a typed `@deprecated` JSDoc tag.
6. **Workarounds for known bugs** include a link to the bug report and a verification step that would prove the bug is fixed (so future sessions know when the workaround can come out).

## What deserves a comment

Use the "next-session test": *would a reasonable AI session, with no prior context, plausibly change or remove this code as part of a refactor?* If yes, leave a comment.

### Worth commenting on

- **Counterintuitive ordering**: "Save before logging — see incident-2024-03-12; logger fails on disk-full and we lose the data otherwise."
- **Workarounds for upstream bugs**: "Reset signal after `abort()` — Node 20.5 bug, fixed in 20.10. Remove this line once we're past Node 20.10 in production."
- **Regulatory / business constraints**: "Hold for 24h before purge — GDPR Art. 17 §3(b) — see compliance/data-retention.md."
- **Performance-driven structure**: "Manual loop instead of `.map().filter()` — hot path, benchmarked 3x in our load tests; do not 'simplify'."
- **Subtle invariants**: "`balance` must be updated BEFORE the event emits — observers expect the new value when they re-read state."
- **Suppressed warnings / lint exceptions**: "// eslint-disable-next-line — see ADR-012 (intentional shadowing for the public API)."
- **`as` casts** (when the type system genuinely can't see what we know): "// Cast safe because the schema parser above guarantees this shape."

### Not worth commenting on

- Standard idioms (`array.map`, `await fetch`, etc.).
- Type information that's already in the JSDoc.
- Restatement of what the next line does.
- "Why did I name it X" — the name should explain itself; if it doesn't, rename.

## The `// reason:` convention

A scannable prefix tells the next session "this comment is a fence — read it before changing the code."

```typescript
// reason: provider returns ISO timestamps without TZ marker; we treat them as UTC
//   to match historical data. See ADR-019.
const ts = new Date(`${raw.timestamp}Z`)
```

Other useful prefixes:

- `// reason: <why>` — explain a non-obvious design choice
- `// fence: <invariant>` — Chesterton's Fence (see below)
- `// workaround: <upstream bug> — remove when <condition>` — temporary code with a removal trigger
- `// invariant: <statement>` — assert a property the surrounding code depends on
- `// perf: <measurement>` — performance-driven structure

These prefixes let a session grep for `fence:` or `workaround:` and see every "watch out" point in the file.

## Chesterton's Fence — the explicit form

The principle: don't remove a fence until you understand why it's there. The AI-native form: write the explanation on the fence.

```typescript
// fence: this `await new Promise(r => setTimeout(r, 0))` looks pointless, but it
//   yields the event loop so any pending microtasks (specifically the connection
//   state machine's transitions) complete before we read `socket.state`. Without
//   it, `socket.state` returns the *previous* state on Node 20+.
//   To remove: verify that socket.state returns the up-to-date value in all
//   transitions with this line removed; run integration tests under load.
await new Promise(r => setTimeout(r, 0))
```

A future session looking at that line sees:

1. It looks pointless.
2. There is a comment with a fence prefix.
3. The comment explains the constraint AND the verification step that would justify removal.

Now the next session has three choices: leave the fence (safe), do the verification (informed), or break things (their fault, not yours).

## ADR pointers

For decisions whose rationale doesn't fit in 5 lines, write an Architecture Decision Record and point at it from code.

```
docs/decisions/ADR-019-utc-timestamp-coercion.md
```

Inline:

```typescript
// reason: see ADR-019
const ts = new Date(`${raw.timestamp}Z`)
```

The ADR template (per project preference, but generally):

```markdown
# ADR-019: UTC Timestamp Coercion

## Status
Accepted, 2024-04-15

## Context
Provider X returns ISO timestamps without timezone markers. Our database
stores in UTC. Comparison with timezone-aware times was producing 7-hour offsets.

## Decision
At the parsing boundary, append "Z" to provider X's timestamps before
constructing a Date. This treats them as UTC, which matches the provider's
documented (but not formatted) intent.

## Consequences
- Correct for all observed cases.
- If provider X starts returning timezone-aware timestamps, this code will
  produce wrong results (double conversion). The schema parser MUST then strip
  the suffix or this coercion must be removed.

## See also
- src/integrations/x/parse-timestamp.ts (the implementation)
- Bug report 2024-04-12-tz-offset.md
```

The ADR carries the long-form reasoning. The code carries the pointer. Together they survive any session boundary.

## No TODO / FIXME for unfinished work

The pattern that decays codebases:

```typescript
// TODO: handle partial fills
// FIXME: retry on rate limit
// XXX: this is broken if quantity > 1000
```

These are notes-to-self that drift further from the code's actual state every commit. A future session reads them and:

1. Doesn't know if they're still relevant.
2. Doesn't know who wrote them or when.
3. Doesn't know whether to address them as part of the current change or defer.

The fix: either complete the work *now*, or surface it through a typed mechanism:

```typescript
/**
 * Routes an order, ignoring partial-fill semantics.
 *
 * @deprecated Pending support for partial fills — see issue #142. Once #142
 *   ships, replace callers with `routeOrderWithPartialFills`.
 */
export function routeOrder(...) { ... }
```

```typescript
// pending: ADR-022 (partial fill handling) — remove this branch once partial
//   fills are first-class.
if (event.kind === 'fill' && event.qty < orderQty) {
  throw new UnsupportedPartialFillError({ orderId, filledQty: event.qty })
}
```

Both forms (the `@deprecated` JSDoc and the `pending:` comment) point at a tracked artifact (issue / ADR). The next session can verify the artifact's status — "is #142 closed?" — and act with confidence.

## Workarounds with removal triggers

When you write code that exists only because of an upstream bug, encode the conditions under which it can come out:

```typescript
// workaround: Node 20.5–20.9 returns wrong state from socket.state in concurrent
//   transitions (nodejs/node#XXXXX). Yield to drain microtasks first.
//   Remove this line once minimum Node version in production is 20.10+.
//   Verification: rm this line, run integration suite on Node 20.10.
await new Promise(r => setTimeout(r, 0))
```

The next session can:

1. Check what Node version production is on.
2. If 20.10+, do the verification and remove the workaround.
3. If still <20.10, leave the workaround.

Without the comment, the workaround stays forever, even after Node fixes the bug.

## Module-level "history" sections — optional, valuable for legacy modules

For modules with significant historical context, a `@history` section in the module header can be invaluable:

```typescript
/**
 * @module integrations/x/order-router
 *
 * Routes orders to provider X.
 *
 * @history
 *   2024-04 (ADR-019): UTC timestamp coercion added.
 *   2024-05 (ADR-022): Partial-fill rejection added; partial fills are not
 *           yet supported end-to-end — see issue #142.
 *   2024-07 (incident-2024-07-03): Disabled idempotency cache (was returning
 *           stale results under high concurrency). Re-evaluate with #198.
 */
```

This is not a changelog — git has that. This is a *map of the surprises* in the module. A future session glancing at this header has the lay of the land.

## ❌ Bad

```typescript
// TODO: fix this
result.value = result.value || 0

// hack
const x = data?.foo?.bar ?? null

// don't change this
await new Promise(r => setTimeout(r, 0))

if (value > 1000) {
  // sometimes
  return null
}
```

None of these survive a session boundary. Each is a stub of context that decays into superstition.

## ✅ Good

```typescript
// reason: provider X returns null `value` on first poll before warmup; default
//   to 0 to avoid downstream NaN. After warmup completes (~5s), real values come.
//   See ADR-019.
result.value = result.value ?? 0

// fence: this `setTimeout(0)` yields the event loop so pending state transitions
//   complete before we read socket.state. Removing it breaks reconnect tests on Node 20+.
//   To remove: verify socket.state reflects post-transition state with this line gone.
await new Promise(r => setTimeout(r, 0))

if (value > LARGE_ORDER_THRESHOLD) {
  // reason: large orders go through manual review queue, not the auto-routing path.
  //   See compliance/ADR-027.
  return null
}
```

Each comment carries enough information that a future session can make an informed decision.

## Grep oracles

```bash
# Find TODO/FIXME/XXX/HACK — should not exist in src/
grep -rnE '(TODO|FIXME|XXX|HACK)' src/
# Expect 0; if hits, convert to tracked issue + @deprecated / pending: comment

# Find fence/workaround/reason comments — these are deliberate, count them
grep -rcE '// (reason|fence|workaround|pending|invariant|perf):' src/

# Find `as` casts without a justification comment within 2 lines
grep -rnB2 ' as [A-Z]' src/ | grep -v reason | grep -v fence
# Each `as` cast SHOULD have a nearby justification

# ADR pointers — every ADR in docs/decisions/ SHOULD have at least one code reference
for adr in docs/decisions/ADR-*.md; do
  id=$(basename "$adr" | grep -oE 'ADR-[0-9]+')
  count=$(grep -rc "$id" src/ | grep -v ':0' | wc -l)
  echo "$id: $count file(s) reference"
done
```

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| Write code that "looks weird" but is right | Add a `// reason:` or `// fence:` comment. |
| Add a workaround for an upstream bug | What's the removal trigger? Comment it. |
| Suppress a lint warning / use `@ts-expect-error` | Why is the suppression correct? Comment. |
| Use `as <Type>` | Why is the cast safe? Comment. |
| Write `// TODO` or `// FIXME` | Open an issue. Use `@deprecated` JSDoc OR `// pending: <issue>` instead. |
| Encode a non-obvious invariant | Comment with `// invariant: <statement>`. |
| Make an architectural decision that doesn't fit in 5 lines | Write an ADR. Point at it from code. |
| Modify a fenced piece of code | Read the fence comment. Do the verification it asks for. Update the fence if you proceed. |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "The code is obvious enough" | Obvious to you, opaque to the next session. The comment costs 30 seconds. |
> | "I'll write an ADR later" | The decision happens once. Either capture it now or lose it. |
> | "TODO is fine, we know we'll get back to it" | Several sessions later, the TODO has neither author, nor date, nor priority. It's noise. |
> | "The fence comment is redundant — the test will catch it" | The test catches behavior, not intent. The next session might "improve" code in a way that passes tests but reintroduces a subtle bug. |
> | "ADRs are overhead" | An ADR is a 200-word file. It compounds. A codebase with ADRs is navigable in years; a codebase without them is folklore. |
