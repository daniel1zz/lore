# State as Data — Discriminated Unions and Typestate

> Represent state as a closed set of named cases, not a bag of booleans. The compiler becomes the proof that illegal states are unreachable.

## Why this matters

The classic "boolean bag" anti-pattern:

```typescript
interface FetchState<T> {
  isLoading: boolean
  isError: boolean
  data: T | null
  error: Error | null
}
```

This type permits 2⁴ = 16 combinations. How many are valid? Usually 4: `idle`, `loading`, `success`, `error`. The other 12 are nonsense: `{ isLoading: true, isError: true, data: someValue, error: someError }` — what does that even mean?

For a human reader, "obviously" only the 4 valid combinations occur in practice. But the type system permits all 16. A function consuming this state must defensively check every combination *or* implicitly trust that "no one would do that." Both are bad: the first is bloat, the second is a bug waiting for a refactor.

For an AI agent making changes, the boolean bag is a trap:

- It cannot tell which combinations are intended from the type alone.
- It cannot tell what transitions are valid.
- A "fix" that adds a 5th boolean (`isStale`) silently widens the illegal-state space to 32 combinations.

The fix: a **discriminated union**. The type explicitly enumerates the valid cases, and the compiler will reject any access of `data` on the `error` case.

## ⛔ Core rules

1. **3 or more booleans describing one concept = discriminated union.** Refactor.
2. **The discriminator is a literal type field**, conventionally named `kind`, `status`, `type`, or `tag`.
3. **Every branch carries only the fields valid for that branch.**
4. **Pattern matches MUST be exhaustive** — use a `never` check on the default branch so adding a new case is a compile error in every consumer.
5. **State transitions are functions**, not free mutations. `apply<Event>(state, event) → newState`. (See `coding-style.md` immutability rule.)

## The pattern

```typescript
type FetchState<T> =
  | { kind: 'idle' }
  | { kind: 'loading'; startedAt: Date }
  | { kind: 'success'; data: T; fetchedAt: Date }
  | { kind: 'error'; error: AppError; failedAt: Date }
```

Now:

- 4 cases, no nonsense combinations possible.
- `data` only exists on `success`. Accessing it on any other case is a compile error.
- `startedAt`, `fetchedAt`, `failedAt` carry timing — actually useful, and impossible to forget because they're required by the type.

## Consuming — exhaustive match

```typescript
function renderFetchState<T>(state: FetchState<T>): string {
  switch (state.kind) {
    case 'idle':    return 'Ready'
    case 'loading': return `Loading… (since ${state.startedAt.toLocaleTimeString()})`
    case 'success': return `Got ${JSON.stringify(state.data)}`
    case 'error':   return `Error: ${state.error.message}`
    default: {
      // Exhaustiveness check — if a new case is added to FetchState
      // and this switch isn't updated, this line is a compile error.
      const _exhaustive: never = state
      throw new Error(`Unhandled state: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
```

The `_exhaustive: never` line is the key. When a future session adds a fifth case to `FetchState` (say, `{ kind: 'stale'; ... }`), every switch over `FetchState` that lacks a `case 'stale':` becomes a compile error. The compiler points the next session at every consumer to update — no missed updates.

## Helper: `assertNever`

Define once, use everywhere:

```typescript
// src/lib/assert.ts

/**
 * Compile-time exhaustiveness assertion.
 *
 * Use in the default branch of a switch over a discriminated union to ensure
 * every case is handled. If a new case is added to the union, every call site
 * of assertNever for that union becomes a compile error — surfacing the
 * incomplete switches before the missed case ships.
 *
 * @throws Always. The throw is unreachable at compile time but defends at runtime.
 */
export function assertNever(x: never): never {
  throw new Error(`Unreachable: ${JSON.stringify(x)}`)
}
```

Use:

```typescript
switch (state.kind) {
  case 'idle':    ...
  case 'loading': ...
  case 'success': ...
  case 'error':   ...
  default:        assertNever(state)
}
```

## Typestate — making invalid operations a compile error

A typestate is a discriminated union where the *operations* on each case are different, encoded in the type. The classic example: a connection.

```typescript
// ❌ Without typestate — runtime check needed
class Connection {
  private connected = false
  connect() { this.connected = true }
  send(msg: string) {
    if (!this.connected) throw new Error('not connected')
    // ...
  }
}

// ✅ With typestate — compile error
type Disconnected = { kind: 'disconnected' }
type Connected = { kind: 'connected'; socket: WebSocket }

type Connection = Disconnected | Connected

function connect(c: Disconnected): Connected { ... }
function send(c: Connected, msg: string): void { ... }
function close(c: Connected): Disconnected { ... }

// Caller:
let c: Connection = { kind: 'disconnected' }
// send(c, 'hi')  // ❌ compile error — c may be Disconnected
c = connect(c)
send(c, 'hi')    // ✅ ok — c narrowed to Connected
```

The invalid sequence `send` before `connect` is impossible to write. No runtime check, no test for the illegal path needed — the compiler proved it.

Typestate is heavier than a plain discriminated union (you need fresh references after each transition), so use it where the sequencing is the *primary* correctness concern: connection lifecycles, builder patterns, multi-step wizards, state machines with non-trivial invariants.

## State machines — table form

For workflows with many states and transitions, write a transition function from `(state, event) → state`. This is essentially a finite state machine.

```typescript
type OrderState =
  | { kind: 'draft' }
  | { kind: 'submitted'; submittedAt: Date }
  | { kind: 'routed'; venue: string; routedAt: Date }
  | { kind: 'filled'; fillPrice: Money; filledAt: Date }
  | { kind: 'partially_filled'; filledQty: number; remainingQty: number; lastFillAt: Date }
  | { kind: 'rejected'; reason: string; rejectedAt: Date }
  | { kind: 'cancelled'; cancelledAt: Date }

type OrderEvent =
  | { kind: 'submit' }
  | { kind: 'route'; venue: string }
  | { kind: 'fill'; price: Money; qty: number }
  | { kind: 'reject'; reason: string }
  | { kind: 'cancel' }

export function applyOrderEvent(state: OrderState, event: OrderEvent, now: Date): OrderState {
  switch (state.kind) {
    case 'draft':
      if (event.kind === 'submit') return { kind: 'submitted', submittedAt: now }
      if (event.kind === 'cancel') return { kind: 'cancelled', cancelledAt: now }
      throw new InvalidTransitionError({ from: state.kind, event: event.kind })

    case 'submitted':
      if (event.kind === 'route')  return { kind: 'routed', venue: event.venue, routedAt: now }
      if (event.kind === 'reject') return { kind: 'rejected', reason: event.reason, rejectedAt: now }
      throw new InvalidTransitionError({ from: state.kind, event: event.kind })

    case 'routed':
      if (event.kind === 'fill' && event.qty === FULL_QTY) {
        return { kind: 'filled', fillPrice: event.price, filledAt: now }
      }
      if (event.kind === 'fill') {
        return {
          kind: 'partially_filled',
          filledQty: event.qty,
          remainingQty: FULL_QTY - event.qty,
          lastFillAt: now,
        }
      }
      if (event.kind === 'cancel') return { kind: 'cancelled', cancelledAt: now }
      throw new InvalidTransitionError({ from: state.kind, event: event.kind })

    case 'partially_filled':
      if (event.kind === 'fill') { /* recurse / accumulate / etc. */ }
      throw new InvalidTransitionError({ from: state.kind, event: event.kind })

    case 'filled':
    case 'rejected':
    case 'cancelled':
      // Terminal states — no transitions out
      throw new InvalidTransitionError({ from: state.kind, event: event.kind })

    default:
      assertNever(state)
  }
}
```

A future session reading this file sees the entire state machine in one screen. Adding a new state means adding a case AND updating `applyOrderEvent` — the compiler enforces the latter. The diagram is the code.

## Pairing with Zod

```typescript
const OrderStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draft') }),
  z.object({ kind: z.literal('submitted'), submittedAt: z.coerce.date() }),
  z.object({ kind: z.literal('routed'), venue: z.string(), routedAt: z.coerce.date() }),
  z.object({ kind: z.literal('filled'), fillPrice: MoneySchema, filledAt: z.coerce.date() }),
  // ...
])
type OrderState = z.infer<typeof OrderStateSchema>
```

State coming from the DB, an event stream, or a snapshot file is validated by the *same* schema that the type derives from. Drift is impossible.

## Sum types for results

Replace `T | null` with explicit success/absent kinds when the caller must distinguish:

```typescript
// Less informative
async function findUser(id: UserId): Promise<User | null>

// More informative if the caller cares why
type FindUserResult =
  | { kind: 'found'; user: User }
  | { kind: 'not_found' }
  | { kind: 'soft_deleted'; deletedAt: Date }

async function findUser(id: UserId): Promise<FindUserResult>
```

Use the explicit union when the cases require different downstream handling. Don't use it for trivial "exists / not" cases — `User | null` is fine there.

## ❌ Bad — boolean bag

```typescript
class FormStore {
  isLoading = false
  isError = false
  isSubmitted = false
  data: FormData | null = null
  errorMessage: string | null = null

  submit() {
    this.isLoading = true
    this.isError = false  // forgot to reset errorMessage — bug
    // ...
  }
}
```

Sixteen possible combinations of the three booleans; the developer "knows" only some are valid. Any future change risks the others.

## ✅ Good — discriminated union

```typescript
type FormState =
  | { kind: 'editing'; data: FormData }
  | { kind: 'submitting'; data: FormData; startedAt: Date }
  | { kind: 'submitted'; data: FormData; result: SubmitResult }
  | { kind: 'failed'; data: FormData; error: AppError }

class FormStore {
  state: FormState = { kind: 'editing', data: emptyForm() }

  submit() {
    if (this.state.kind !== 'editing') return
    this.state = { kind: 'submitting', data: this.state.data, startedAt: new Date() }
    // ...
  }
}
```

The transition rules are explicit. Adding a fifth state is a localized change. The compiler enforces consumer updates.

## ❌ Bad — sentinel values

```typescript
function getStatusCode(): number {
  if (success) return 200
  if (notFound) return 404
  if (serverError) return 500
  return -1  // sentinel for "no status yet"
}
```

The sentinel `-1` is a runtime convention. A consumer that forgets to check for `-1` treats it as a valid HTTP code.

## ✅ Good — explicit absence

```typescript
function getStatusCode(): number | null {
  if (success) return 200
  // ...
  return null  // explicit; consumer must handle null
}

// or, more informatively:
type Status =
  | { kind: 'pending' }
  | { kind: 'completed'; code: number }
```

## Grep oracles

```bash
# Find functions with 3+ boolean parameters or fields — refactor candidates
grep -rnE 'is[A-Z][a-zA-Z]*: boolean.*is[A-Z][a-zA-Z]*: boolean.*is[A-Z][a-zA-Z]*: boolean' src/

# Find switches without exhaustiveness check
grep -rn 'switch (' src/ -A 30 | grep -L 'assertNever\|: never =' | head
# Each switch over a discriminated union should have either assertNever or a never assignment
```

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| Add a `boolean` to a struct that already has 2+ booleans describing the same concept | Refactor to discriminated union. |
| Write `if (state.isX && state.isY)` to check a combination | The combination should be a named case, not a conjunction. |
| Return `T \| null \| undefined` from a function | Use `T \| null` (pick one) or an explicit sum type. |
| `switch` over a union without a `default: assertNever(...)` | Add it. |
| Add a new case to a union type | Compile errors will guide you to every consumer. Fix all of them in the same commit. |
| Use sentinel values (`-1`, `""`, `0` for "absent") | Use `null` or an explicit sum type. |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "Booleans are simpler than a union" | They look simpler. They permit illegal states. The union closes them. |
> | "I'll just add a `default:` that does nothing" | The silent default lets a new case ship without handling. Every future bug starts there. |
> | "Typestate is overkill for this lifecycle" | If you've ever written `if (!this.initialized) throw ...`, the compiler could be doing that work for free. |
> | "The state machine is too complex to encode in types" | It's complex regardless. Encoding it makes the complexity visible and verifiable, instead of distributing it across runtime checks. |
> | "Sum types make consumers more verbose" | They make incomplete handling impossible. The verbosity is the correctness. |
