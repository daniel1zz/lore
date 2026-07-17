# Typed Errors with Context Payload

> Errors are values, not control-flow side effects. Their type names a failure mode; their payload carries the diagnostic data the next session needs to act on them.

## Why this matters

A `throw new Error("something failed")` is, from the next AI session's perspective, a sealed envelope. It says nothing about:

- **Which** failure mode this is (transient vs permanent? user error vs system bug?).
- **Where** the failure happened in the data flow.
- **What** input triggered it.
- **What** the caller can do about it.

When the caller's `catch (e: unknown)` runs, the only safe operation is `String(e)` — log it and pray. The next session inheriting the codebase has no signal to:

- Decide whether to retry.
- Translate the error to a user-facing message.
- Match the error in a `switch` to route handling.

The fix: every thrown value is an instance of a **named class** carrying a **structured payload**. The class identifies the failure mode; the payload identifies the specific occurrence.

## ⛔ Core rules

1. **No bare `throw new Error(...)`** in `src/` business logic. Test files and CLI scripts are exempt.
2. **Every error class extends a domain base class** (project-defined), not `Error` directly.
3. **The payload is structured** — an object with named fields, never a stringified blob.
4. **The constructor takes the payload as an object** — `new InvalidPayloadError({ field, value, reason })`, never positional args.
5. **The original cause is preserved** via the `cause` option — `new MyError({ ... }, { cause: e })`.
6. **The class name encodes the failure mode** — see naming below.

## Naming convention

`<Domain><Action>Error` — read aloud as a sentence.

| ✅ Good | ❌ Bad | Why |
|---|---|---|
| `InvalidOrderPayloadError` | `OrderError` | "OrderError" — doing what to the order? failing how? |
| `VenueUnreachableError` | `NetworkError` | Generic name forces caller to inspect payload to learn the cause |
| `DuplicateClientOrderIdError` | `DuplicateError` | Domain qualifies the duplicate (client order id, not user id) |
| `OrderAlreadyFilledError` | `IllegalStateError` | Names the specific illegal transition |
| `RiskLimitExceededError` | `RiskError` | "Exceeded" tells the caller exactly what went wrong |
| `LlmSchemaViolationError` | `ParseError` | Names the source (LLM) and the failure (violated the schema) |

Rule of thumb: the class name should be **catchable in a `switch`** without further inspection. If the catch block has to look at the payload to know what to do, the name is too generic.

## The base class

Define one project-wide base class. All domain errors extend it. This gives you a single catch-all when you need it (telemetry, top-level boundary), while named subclasses give you precise handling everywhere else.

```typescript
// src/errors/base.ts
/**
 * Base for all operational errors in this codebase.
 *
 * - `code` is a stable string identifier — safe to log, safe to use in metrics labels.
 * - `context` is structured diagnostic data; never PII, never secrets.
 * - `cause` (inherited from Error) carries the wrapped error if any.
 *
 * Programmer errors (bugs — assertion failures, illegal state we believed unreachable)
 * MUST NOT extend this class — throw the runtime's native Error so they crash loudly.
 */
export abstract class AppError extends Error {
  abstract readonly code: string
  readonly context: Readonly<Record<string, unknown>>

  constructor(
    message: string,
    context: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = this.constructor.name
    this.context = Object.freeze(context)
  }
}
```

### Operational vs programmer errors

- **Operational** — expected failure modes: validation, network, permission denied, resource exhausted, conflict. These extend `AppError`. The caller is expected to handle them.
- **Programmer** — bugs: `assert(false)`, "unreachable" branches hit, type-safety violations at runtime. These should NOT extend `AppError`; they should be plain `Error` (or framework `AssertionError`) so they crash and surface in monitoring.

Conflating these is the #1 reason error handling decays — a try/catch that catches "everything" silently swallows real bugs.

## Defining a concrete error

```typescript
// src/orders/errors.ts
import { AppError } from '@/errors/base'

/**
 * The order payload failed schema validation.
 * Retryable: NO (client must fix and resubmit).
 */
export class InvalidOrderPayloadError extends AppError {
  readonly code = 'INVALID_ORDER_PAYLOAD'

  constructor(context: {
    issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>
    receivedKeys: ReadonlyArray<string>
  }, options?: { cause?: unknown }) {
    super(`Order payload failed validation (${context.issues.length} issue(s))`, context, options)
  }
}

/**
 * The venue's WebSocket connection has been down longer than the freshness threshold.
 * Retryable: MAYBE — caller may retry after reconnection (see `retryAfterMs` in context).
 */
export class VenueUnreachableError extends AppError {
  readonly code = 'VENUE_UNREACHABLE'

  constructor(context: {
    venue: string
    lastSeenAt: Date
    downtimeMs: number
    retryAfterMs: number
  }, options?: { cause?: unknown }) {
    super(`Venue ${context.venue} unreachable for ${context.downtimeMs}ms`, context, options)
  }
}
```

The constructor signature is its own documentation: the next session reads `new InvalidOrderPayloadError({ issues, receivedKeys })` and knows exactly what to provide.

## Throwing — what the call site looks like

```typescript
const result = OrderSchema.safeParse(input)
if (!result.success) {
  throw new InvalidOrderPayloadError({
    issues: result.error.issues,
    receivedKeys: Object.keys(input as object),
  })
}
```

```typescript
try {
  await ws.sendOrder(order)
} catch (e) {
  throw new VenueUnreachableError(
    {
      venue: order.venue,
      lastSeenAt: ws.lastHeartbeatAt,
      downtimeMs: Date.now() - ws.lastHeartbeatAt.getTime(),
      retryAfterMs: 5000,
    },
    { cause: e },  // preserve the underlying WS error
  )
}
```

## Catching — handle the kinds you know

```typescript
try {
  await routeOrder(order)
} catch (e) {
  if (e instanceof InvalidOrderPayloadError) {
    return res.status(400).json({ code: e.code, issues: e.context.issues })
  }
  if (e instanceof VenueUnreachableError) {
    return res.status(503).json({ code: e.code, retryAfterMs: e.context.retryAfterMs })
  }
  // Unknown error — log structured, return 500. Do NOT swallow.
  logger.error({ err: e }, 'unhandled error in /order/route')
  throw e  // re-throw so the top-level boundary sees it
}
```

The `instanceof` checks are exhaustive in intent — the catch block lists exactly the failure modes this endpoint handles. Anything else escapes upward, which is correct.

## Result types — when to prefer `Result<T, E>` over throw

Throwing is idiomatic in TypeScript and integrates with `try/catch`, async/await, and stack traces. It is the right default.

`Result<T, E>` (or `Either<E, T>`) is preferable when:

- The error is **expected** as a routine outcome, not exceptional. (Login validation returning "wrong password" is a result, not an exception.)
- You want the **type system to force** the caller to handle the error case. (Throwing relies on convention; Result enforces.)
- You're in a **pure-functional core** where exceptions break referential transparency.

```typescript
// Result example — when the caller MUST handle both outcomes
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function parseLogin(input: unknown): Result<LoginInput, InvalidLoginPayloadError> {
  const parsed = LoginSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: new InvalidLoginPayloadError({ issues: parsed.error.issues }) }
  }
  return { ok: true, value: parsed.data }
}

// Caller cannot ignore the error case — it's in the type
const r = parseLogin(input)
if (!r.ok) return res.status(400).json({ code: r.error.code })
const login = r.value
```

The trade-off: `Result` is viral — every layer that touches it must either handle the error or propagate the Result type. Don't introduce it lightly. A useful rule: **throw for unexpected, Result for expected**.

## Error chain — preserve `cause`

When you wrap a lower-level error in a higher-level one, attach the original via the standard `cause`:

```typescript
try {
  await db.users.create({ data: user })
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new DuplicateEmailError({ email: user.email }, { cause: e })
  }
  throw new DatabaseError({ operation: 'users.create' }, { cause: e })
}
```

A structured logger that unwraps `cause` chains can render the full failure trail. The next session debugging a production incident reads:

```
DuplicateEmailError: email=alice@example.com
  caused by: PrismaClientKnownRequestError: P2002 unique constraint violation on (email)
```

…and knows in one read both the domain meaning ("duplicate email") and the underlying cause ("unique constraint on `email`").

## What goes in the `context` payload

**Include**:
- Field names, type expectations, observed types/values (for validation errors).
- Resource identifiers — venue, user id, order id, request id, correlation id.
- Timing — `lastSeenAt`, `attemptCount`, `retryAfterMs`.
- Source — schema name, version, ADR ref.

**Exclude**:
- **Secrets** — passwords, tokens, API keys, full credit card numbers.
- **PII** — full email/SSN/etc unless your logging policy explicitly permits.
- **Large payloads** — log a SHA or first N chars, not megabytes of LLM output.
- **Stack traces as strings** — `error.stack` is on the error itself; the logger handles it.

The next session reads the context. If you log secrets in error context, those secrets land in monitoring. Treat context like log lines.

## ❌ Bad examples

```typescript
// 1. Bare Error — opaque
throw new Error('Validation failed')

// 2. String concatenation as payload
throw new Error(`Order ${order.id} on ${order.venue} failed: ${reason}`)

// 3. Positional constructor — what's the third argument?
throw new VenueError(order.venue, 5000, lastSeen)

// 4. Catch + silent rethrow as new Error — original cause lost
} catch (e) {
  throw new Error('Operation failed')  // where did the real error go?
}

// 5. Catch + return null — caller has no idea what went wrong
} catch (e) {
  return null
}

// 6. Class name is too generic
class AppError extends Error {}  // caught with `instanceof AppError` — tells you nothing
```

## ✅ Good examples

```typescript
// 1. Named class + structured payload
throw new InvalidOrderPayloadError({ issues: result.error.issues, receivedKeys: ... })

// 2. Original cause preserved
} catch (e) {
  throw new VenueUnreachableError(
    { venue, lastSeenAt, downtimeMs, retryAfterMs: 5000 },
    { cause: e },
  )
}

// 3. Catch only what you handle
} catch (e) {
  if (e instanceof InvalidOrderPayloadError) { ... }
  if (e instanceof VenueUnreachableError) { ... }
  throw e  // re-throw unknowns
}
```

## Boundary translation

At each architectural boundary, translate domain errors into the boundary's error vocabulary. Domain → HTTP, domain → IPC, domain → CLI exit code.

```typescript
// HTTP boundary
function toHttpResponse(e: AppError): { status: number; body: object } {
  if (e instanceof InvalidOrderPayloadError) return { status: 400, body: { code: e.code, issues: e.context.issues } }
  if (e instanceof DuplicateClientOrderIdError) return { status: 409, body: { code: e.code } }
  if (e instanceof VenueUnreachableError) return { status: 503, body: { code: e.code, retryAfterMs: e.context.retryAfterMs } }
  if (e instanceof RiskLimitExceededError) return { status: 422, body: { code: e.code, ...e.context } }
  // Unknown — never leak details
  return { status: 500, body: { code: 'INTERNAL_ERROR' } }
}
```

The mapping is the boundary's *contract* with consumers. Keep it in one place.

## Grep oracles

```bash
# No bare Error in business code (tests, scripts may use them)
grep -rn 'throw new Error(' src/ | grep -v test | grep -v __tests__
# Expect 0 results in src/<business>

# Every error class extends AppError (project base), not Error directly
grep -rn 'extends Error' src/ | grep -v AppError | grep -v abstract
# Expect 0 results — the only thing extending Error directly should be AppError itself

# Every throw uses an object payload (not positional)
grep -rn 'throw new [A-Z][A-Za-z]*Error(' src/ | grep -v '({' | grep -v '()'
# Hits = positional constructor calls — flag for review
```

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| `throw new Error("...")` in `src/` | What's the typed class? What's the payload? |
| `catch (e) { return null }` | What does `null` mean to the caller? If it's "not found" — fine, but document. If it's "something broke" — throw a typed error. |
| `catch (e) { throw new Error("...") }` | You just erased the cause chain. Use `{ cause: e }`. |
| Defining a new error class | Does the name describe the failure mode in 3-4 words? |
| Adding a field to an error payload | Is it secret-free? PII-free? Useful to a future debugger? |
| Catching at a boundary | Is your `instanceof` list exhaustive for handled cases, with explicit re-throw for unknowns? |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "A typed error class is overkill for one throw" | The next session will catch it. Give them a name to switch on. |
> | "I'll just put the details in the message string" | Strings aren't structured. The next session that wants the failing field has to parse your sentence. Structured payload wins. |
> | "Returning null is simpler" | Simpler at the throw site, far harder at the catch site. "What did null mean?" is unanswerable without context. |
> | "The original error is fine to wrap silently" | Lose `cause` and you lose the trail to root cause. Production debugging becomes archaeology. |
> | "I'll add the typed errors later as a refactor" | The longer untyped throws survive, the more catch sites build up around them. Add the typed error at the first throw site, not the tenth. |
