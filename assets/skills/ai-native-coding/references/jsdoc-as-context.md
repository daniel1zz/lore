# JSDoc as Context Anchor

> The single most underused tool for AI-native code. In a TypeScript file, JSDoc is not redundant with types — it carries **why**, **invariants**, **examples**, and **lifecycle** that types cannot express.

## Why this matters

The TypeScript compiler verifies *shapes*. It cannot verify:

- **Why** this function exists (which spec / ADR / user story drove it).
- **Invariants** the function preserves (`balance never negative`, `array always sorted`, `id is UUID v7`).
- **Side effects** (writes to DB, mutates argument, throws on cycle).
- **Lifecycle** of the returned value (caller owns disposal? cached? stable identity?).
- **Failure modes** (which errors are thrown, what they mean, how to recover).
- **Worked examples** of how to call it correctly.

A human developer absorbs these from team conversation, code review, and git archaeology. **The next AI session has none of that.** JSDoc is the durable channel that survives session boundaries.

When a future agent opens a file and sees only signatures, it must reverse-engineer intent from call sites — a process that is slow, error-prone, and often produces plausible-but-wrong changes. JSDoc collapses that to a 5-second read.

## When JSDoc is mandatory

| Scope | JSDoc required? |
|---|---|
| `export` from a module | ⛔ MUST |
| Public class methods (non-private) | ⛔ MUST |
| File-level (module header) | ⛔ MUST |
| Internal helpers | SHOULD when the function preserves a non-obvious invariant |
| Local block-scope variables | NO (let names speak) |
| One-line getters / pass-throughs | NO unless they encode an invariant |
| Generated code | NO (the generator's source has the docs) |

## Module-level header (every `.ts` file)

Place at the very top of the file, above imports.

```typescript
/**
 * @module trading/order-router
 *
 * Routes signed orders to the appropriate exchange adapter and tracks fill state.
 *
 * Public surface:
 *  - `routeOrder(order)`         — entry point; idempotent on `clientOrderId`
 *  - `subscribeFills(handler)`   — fill event subscription
 *
 * Invariants:
 *  - Every accepted order has a `clientOrderId` (UUID v7), guaranteed unique per (account, day).
 *  - The router NEVER retries a partially-filled order — the partial fill is final.
 *  - State transitions: `pending → routed → (filled | rejected | partial)`. No other paths.
 *
 * Side-effect class: STATEFUL — holds an in-memory order book mirror; writes to `orders` table.
 *
 * Related: docs/decisions/ADR-014-no-retry-on-partial.md
 */
```

The module header is the AI's **first read** when it opens the file. If the header is missing, the agent has to scan every export to reconstruct what the module is for. With a header, the agent knows in 10 seconds whether this file is the right place to make the requested change.

## Exported function template

```typescript
/**
 * Routes an order to the exchange adapter selected by `order.venue`.
 *
 * @param order - A signed, validated order. The caller MUST have run `OrderSchema.parse(...)` first.
 * @returns The routing result. `routed` means handed to the exchange — NOT filled.
 *
 * @throws {VenueUnreachableError} when the venue's WS connection has been down >5s.
 * @throws {DuplicateClientOrderIdError} when an order with the same `clientOrderId` was routed today.
 *
 * @invariant Idempotent on `clientOrderId` — calling twice with the same id returns the cached result.
 * @sideeffect Writes one row to `orders`. Emits one `order.routed` event on the fill bus.
 *
 * @example
 *   const result = await routeOrder({
 *     clientOrderId: 'b9a4...',
 *     venue: 'binance-spot',
 *     side: 'buy',
 *     symbol: 'BTCUSDT',
 *     qty: 0.01,
 *   })
 *   // result.kind === 'routed'
 *
 * @see ADR-014 for the no-retry-on-partial rule
 */
export async function routeOrder(order: SignedOrder): Promise<RoutingResult> { ... }
```

### Tags that pull their weight

| Tag | When to use | Why it matters to the next AI |
|---|---|---|
| `@param name - explanation` | When the type alone doesn't communicate constraints | Next agent doesn't have to grep call sites to learn "must be validated first" |
| `@returns description` | When the return semantics are non-obvious | `routed ≠ filled` is impossible to infer from types |
| `@throws {ErrorClass} when ...` | EVERY error this function can throw | Next agent can pattern-match catch blocks instead of guessing |
| `@invariant <statement>` | Properties this function preserves | Tells next agent what a refactor must NOT break |
| `@sideeffect <what>` | DB writes, events, file IO, mutation of argument | Pure/effectful is a critical safety distinction (see `naming-as-index.md`) |
| `@example <code>` | A copy-pasteable usage | Eliminates "is this how I'm supposed to call it?" |
| `@deprecated <reason + replacement>` | Soft removal path | Next agent won't accidentally extend dead code |
| `@internal` | Visible to the module's package but not the outside world | Tells next agent "you can change this, just not its public callers" |
| `@see <link>` | Pointer to ADR / spec / issue | The "why" trail outlives any single session |

### Tags to avoid

- `@author`, `@since`, `@version` — git already knows.
- `@param x x` — restating the name with no information.
- `@returns Returns the result` — meta-tautology.
- Long-form prose that paraphrases the type signature.

The test: would removing this tag cause a next-session AI to make a worse decision? If not, delete it.

## Exported class template

```typescript
/**
 * In-memory order book mirror for a single symbol on a single venue.
 *
 * Lifecycle:
 *  1. `new` — empty book, not yet subscribed
 *  2. `await book.start()` — opens WS subscription, hydrates from REST snapshot
 *  3. `book.start()` returns when book is hot (`level === 'L2' && lastUpdateAge < 200ms`)
 *  4. `await book.stop()` — closes WS, releases listeners
 *
 * Thread/concurrency: single-threaded; ALL methods MUST be called from the same async context.
 * Constructing two instances for the same (venue, symbol) is undefined behavior.
 *
 * @invariant After `start()` resolves, `bestBid() < bestAsk()` always holds.
 * @invariant `lastUpdateId` is monotonically increasing.
 */
export class OrderBook { ... }
```

A class's lifecycle is the #1 thing that gets refactored incorrectly across sessions. Encode it.

## Branded types

Branded types (also called nominal types or opaque types) are types that look like a primitive but are not assignable from one. They are how you stop `accountId` from being passed where `userId` was expected.

```typescript
/**
 * Globally unique account identifier. UUID v7 — first 48 bits are the creation timestamp.
 *
 * Construct only via `parseAccountId(string)` (Zod-validated) or `newAccountId()` (factory).
 * Direct `as AccountId` casts are forbidden — see ai-anti-patterns.md §"Type assertion abuse".
 *
 * @brand
 */
export type AccountId = string & { readonly __brand: 'AccountId' }

/**
 * Parses an unknown string as an AccountId.
 * @throws {InvalidAccountIdError} when the string is not a valid UUID v7.
 */
export const parseAccountId = (s: string): AccountId => { ... }
```

Without the JSDoc, the next agent sees `string & { __brand: 'AccountId' }` and thinks "weird, looks safe to cast." With the JSDoc, they know there is a parser and the cast is forbidden.

## Functions whose name needs disambiguation

If you cannot rename a function (e.g., framework hook, external API contract) and its name is ambiguous, the JSDoc is the only place to disambiguate.

```typescript
/**
 * NextJS server component lifecycle hook.
 * Called ONCE per request, on the server, BEFORE rendering children.
 *
 * Do NOT use for: client-side state, browser APIs, mutations.
 *
 * If you need to call this from a client component, you have the wrong abstraction —
 * see ADR-021 "client vs server boundary in NextJS".
 */
export default async function Page(...) { ... }
```

## ❌ Bad — what the next AI sees

```typescript
export async function process(order: Order): Promise<Result> {
  // ... 80 lines ...
}
```

Next agent must:
1. Read 80 lines to understand what `process` does.
2. Grep call sites to learn the semantics of `Result`.
3. Trace error flows to learn what can throw.
4. Make a 50/50 guess about side effects.

## ✅ Good — what the next AI sees

```typescript
/**
 * Validates a signed order, checks risk limits, and routes it to the venue.
 *
 * @throws {RiskLimitExceededError} when account exposure would exceed configured cap.
 * @throws {VenueUnreachableError} when the venue WS has been down >5s.
 * @sideeffect Writes one `orders` row; emits `order.routed`.
 * @invariant Idempotent on `clientOrderId`.
 * @see ADR-014
 */
export async function routeOrder(order: SignedOrder): Promise<RoutingResult> {
  // ... 80 lines ...
}
```

Next agent reads 8 lines and is done.

## Anti-patterns

### 1. JSDoc that paraphrases the type
```typescript
// ❌
/**
 * @param userId The user id string.
 * @returns The user object.
 */
export function getUser(userId: string): User { ... }
```
The type already says this. Either remove the JSDoc or add information the type does not carry:
```typescript
// ✅
/**
 * @returns null when the user is soft-deleted (see `deleted_at` column).
 * @throws {DBConnectionError} on transient connection failure (retry-safe).
 */
export function getUser(userId: UserId): User | null { ... }
```

### 2. JSDoc that lies
JSDoc that has drifted from the implementation is **worse** than no JSDoc — the next agent will trust it.

Mitigation: when changing function behavior, the diff MUST update the JSDoc. Reviewers SHOULD flag JSDoc-less changes to documented functions.

### 3. `@returns void` / `@param x` with no description
Empty tag = noise. Remove it.

### 4. Module header with no invariants
```typescript
// ❌
/**
 * @module user-service
 * User service.
 */
```
Either say what the invariants are, or omit the header — but if you omit it, the file better be obviously simple from the imports alone.

## Grep oracles (subagent runs before commit)

```bash
# Every exported symbol has a JSDoc block immediately above it
FILE="src/foo.ts"
EXPORTS=$(grep -c '^export ' "$FILE")
DOCS=$(grep -B1 '^export ' "$FILE" | grep -c '\*/')
echo "exports: $EXPORTS, docs above exports: $DOCS"
# If DOCS < EXPORTS → some exports are undocumented

# Module header exists (file starts with /** or has it before first import)
head -20 "$FILE" | grep -q '@module' && echo "module header: present" || echo "module header: MISSING"

# @throws coverage — every function that throws has @throws in its JSDoc
THROWS_IN_CODE=$(grep -c 'throw new ' "$FILE")
THROWS_DOCUMENTED=$(grep -c '@throws' "$FILE")
echo "throws in code: $THROWS_IN_CODE, @throws in JSDoc: $THROWS_DOCUMENTED"
```

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| `export function`, `export class`, `export const <fn>` | Did you write the JSDoc block first? |
| Add a new error type to a function | Did you add `@throws {NewErrorClass} when ...`? |
| Change a function's return semantics | Did you update `@returns` and `@example`? |
| Encode a new invariant in code | Did you add `@invariant` so the next session knows not to break it? |
| Create a new module file | Does it have a `@module` header with public surface + invariants? |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "The function name is self-explanatory" | "Self-explanatory" is your context, not the next session's. JSDoc is the durable channel. |
> | "JSDoc is verbose and bloats the file" | A 6-line JSDoc above a 60-line function is 10% overhead. The cost of one wrong refactor is 100x. |
> | "Types already describe the parameters" | Types describe shape. JSDoc describes meaning, invariants, side effects, and failure modes. |
> | "I'll add the JSDoc later" | You won't. Coverage decays. Write it with the function or never. |
> | "The implementation is small enough to read" | Reading 80 lines costs the next session attention budget that should go to the change, not the comprehension. |
