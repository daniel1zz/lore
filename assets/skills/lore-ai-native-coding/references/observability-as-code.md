# Observability as Code

> Logs, spans, and metrics are first-class outputs of the code, written deliberately at design time — not sprinkled on later when something breaks.

## Why this matters

A bug surfaces in production. The next AI session is asked to diagnose. It has:

- The error message.
- A stack trace (sometimes).
- Whatever logs exist.

If the code emitted only `console.log("foo")` and `console.log("bar")`, the session has no signal beyond "execution reached this line." It must reverse-engineer state from the surrounding code, run the failing path locally (if reproducible), and add new logs to investigate — an entire iteration cycle.

If the code emitted **structured events at decision points** with **context payloads**, the session reads:

```
{"level":"warn","event":"order.route.skipped","reason":"risk_limit_exceeded","accountId":"...","exposure":12500,"limit":10000,"ts":"..."}
```

…and knows the failure mode, the offending account, the numbers, and the time — in one line. No reproduction needed.

The same principle that drives JSDoc and typed errors applies here: **encode the diagnostic signal in the code at the moment of writing it.** Don't defer to "we'll add logs when we need them" — by then, the moment is gone.

## ⛔ Core rules

1. **No `console.log` / `console.error` / `console.warn` in `src/`.** Use a structured logger. (CLI entrypoints under `bin/` or `scripts/` may use `console` if there is no logger available; mark with `// CLI surface`.)
2. **Logs are structured, not interpolated.** `logger.info({ orderId, venue }, 'order routed')` — NOT `logger.info(\`order \${orderId} routed to \${venue}\`)`.
3. **Log at decision points**, not every line. The pattern: "we considered X and chose Y because Z."
4. **Errors are logged with the error object as a field** (`{ err: e }`), not concatenated into a string. The logger handles stack rendering.
5. **No secrets / no PII in log payloads.** The same redaction rules as `typed-errors.md` apply.
6. **Tracing spans wrap async operations** that cross a boundary (DB query, HTTP call, queue publish, IPC). Latency and error rate per operation become free.
7. **Log levels mean something**:
   - `error` — operation failed, requires investigation
   - `warn` — operation succeeded but degraded, OR a heuristic / fallback fired
   - `info` — significant business event (order routed, user signed up)
   - `debug` — fine-grained traceability, disabled in prod by default
   - `trace` — every-call diagnostics, never enabled in prod

## Pick one logger, expose it from one module

```typescript
// src/lib/logger.ts
import pino from 'pino'
import { env } from '@/env'

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'order-router', env: env.NODE_ENV },
  redact: ['*.password', '*.token', '*.apiKey', '*.creditCard.number', 'authorization'],
  // In dev, pretty-print; in prod, JSON for the log aggregator.
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
})

export type Logger = typeof logger
```

Now anywhere in the codebase, `import { logger } from '@/lib/logger'`. There is one logger. It is configured once. Its output format does not depend on call site.

Pino is one good choice in Node; the principle applies to any structured logger (winston, bunyan, zap in Go, slog in Go, structlog in Python). The discipline is the choice; the library is implementation detail.

## Logging — the call pattern

```typescript
// ✅ Structured — the message is a constant; the data is in the object
logger.info({ orderId, venue, latencyMs }, 'order.routed')

// ✅ Errors — pass the error as a field, NOT concatenated
} catch (e) {
  logger.error({ err: e, orderId, venue }, 'order.route.failed')
  throw e  // log doesn't replace re-throw
}

// ✅ Warnings — when a fallback or heuristic fires
if (!cached) {
  logger.warn({ symbol, cacheMissReason }, 'order.book.cache_miss')
  cached = await refetchOrderBook(symbol)
}
```

### Event name convention

Log message strings are **stable event names**, not human prose. Patterns:

- `dotted.path.to.event` — `order.routed`, `order.route.failed`, `auth.login.success`, `auth.login.rate_limited`
- Past tense for "this happened" events
- Action-failed pattern for failures
- The same event name across all instances — DO NOT vary the wording

A query like `level=error AND event=order.route.failed` works only if the event name is stable. Free-form prose breaks queries.

### What goes in the payload

Include data that supports answering the diagnostic questions:

- **Which entity** (order id, user id, account id — IDs only, never PII)
- **Which operation** (venue, symbol, action)
- **Which timing** (latencyMs, attemptCount, retryAfterMs)
- **Which outcome** (filledQty, errorCode)

Exclude:

- Full PII (use IDs or hashes)
- Secrets, tokens, credentials
- Large blobs (log a SHA-256 prefix or first 200 chars)
- Pretty-printed multi-line strings (defeats the JSON-line format)

## Tracing — wrap boundaries

When the code crosses a boundary that may be slow or fail (DB, HTTP, queue, IPC, external API), wrap it in a span. The tracer records start time, end time, status, and any attributes you attach.

```typescript
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('order-router')

export async function routeOrder(order: SignedOrder): Promise<RoutingResult> {
  return tracer.startActiveSpan('order.route', async (span) => {
    span.setAttribute('order.venue', order.venue)
    span.setAttribute('order.symbol', order.symbol)

    try {
      const result = await venues[order.venue].submit(order)
      span.setAttribute('order.result.kind', result.kind)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (e) {
      span.recordException(e as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message })
      throw e
    } finally {
      span.end()
    }
  })
}
```

The next session asked "why is order routing slow today" opens the trace dashboard and sees latency p50/p95/p99 per venue, per symbol, per result kind. No code change needed to investigate.

For projects without an OpenTelemetry setup, even a minimal "timer + log" pattern is useful:

```typescript
const t0 = performance.now()
try {
  const result = await venues[order.venue].submit(order)
  logger.info({ venue: order.venue, latencyMs: performance.now() - t0, kind: result.kind }, 'order.route.success')
  return result
} catch (e) {
  logger.error({ err: e, venue: order.venue, latencyMs: performance.now() - t0 }, 'order.route.failed')
  throw e
}
```

## What to instrument

A useful default set, organized by purpose:

| Concern | Pattern |
|---|---|
| Every inbound request | `request.received` (route, method, requestId) + `request.completed` (status, latencyMs) |
| Every business decision | `<domain>.<action>.<outcome>` with the inputs that drove the choice |
| Every retry | `<op>.retry` with attempt number and reason |
| Every fallback / heuristic | `<op>.fallback` with which fallback and why |
| Every external call | Span wrap, status, latency |
| Every cron / scheduled task | `cron.<name>.start` + `cron.<name>.completed` (counts, durations) |
| Every state transition in a non-trivial state machine | `<machine>.transition` (from, to, event) |

What NOT to instrument:

- Every line of a tight loop (too noisy)
- Pure computation that never fails (no signal)
- Every function entry/exit (use the tracer, not log lines)

## Error context — link to `typed-errors.md`

Typed errors already carry a context payload. When you log an error, the structured logger should automatically unwrap the error's properties.

```typescript
try {
  await routeOrder(order)
} catch (e) {
  // The typed error's `context` payload is already in `e.context`.
  // A good logger captures `err` and renders its enumerable properties.
  logger.error({ err: e, orderId: order.clientOrderId }, 'order.route.failed')
  throw e
}
```

Pino (and most structured loggers) will render `err` with its message, stack, AND any custom properties. Your error's `context` payload becomes searchable log fields with no extra plumbing.

## ❌ Bad

```typescript
// 1. console.log
console.log('order routed')

// 2. Interpolated message
logger.info(`order ${order.id} routed to ${order.venue} in ${ms}ms`)

// 3. Error concatenated into the message
logger.error(`order failed: ${e.message}`)

// 4. Logging for the developer, not the system
logger.info('about to enter the loop')
logger.info('inside the loop')
logger.info('exiting the loop')

// 5. Logging secrets
logger.info({ user, password }, 'login attempt')  // password!
```

## ✅ Good

```typescript
// 1. Structured logger with stable event name
logger.info({ orderId: order.id, venue: order.venue, latencyMs }, 'order.routed')

// 2. Error as field
logger.error({ err: e, orderId: order.id }, 'order.route.failed')

// 3. Decision points only — not every line
function routeOrder(order: Order) {
  if (order.qty > LIMITS.large) {
    logger.warn({ orderId: order.id, qty: order.qty, limit: LIMITS.large }, 'order.large')
  }
  const venue = pickVenue(order)
  logger.info({ orderId: order.id, venue }, 'order.venue_selected')
  // ...
}
```

## When `console` is acceptable

- **CLI scripts and entrypoints** — a `bin/` or `scripts/` directory script that runs once and exits is allowed to `console.log` for its human-facing output. Mark the surface with a comment.
- **REPL / debugging scratch** — never committed; `console.log` is fine while iterating.
- **Test diagnostics** — but prefer `expect()` failure messages; if you need extra output, the test framework usually has a logger.

In production application code (handlers, services, repositories, domain), `console.*` is a smell.

## Grep oracles

```bash
# No console.log in src/ (except marked CLI surfaces)
grep -rn 'console\.\(log\|error\|warn\|info\|debug\)' src/ | grep -v 'CLI surface'
# Expect 0

# Logger calls use structured form (object first, message string second)
grep -rn "logger\.\(info\|warn\|error\|debug\)('" src/
# Hits = calls starting with a string literal — likely missing the structured payload

# Error logging passes the error as a field
grep -rn 'logger\.error.*\${' src/
# Hits = string interpolation — error context lost
```

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| Add a `console.log` for diagnostics | Use the structured logger. Pick a stable event name. |
| Log an error | Pass `{ err: e, ...context }`, NOT a string. |
| Make a decision based on a heuristic / fallback | Log it at `warn` so the rate is observable. |
| Wrap an external call | Should this be a tracing span? If the call can be slow or fail, yes. |
| Catch + swallow an error | At minimum log `{ err: e }` at `error`. Better: don't swallow. |
| Introduce a retry | Log each retry with attempt number and reason. |
| Add a config-driven branch | Log the chosen branch when the value differs from default. |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "I'll add observability when something breaks" | The break has no logs to read. Instrument at write time. |
> | "console.log is fine for this one place" | "One place" multiplies. The codebase is now inconsistent and the log aggregator misses these. |
> | "The error message is enough" | The error message tells you WHAT. The payload tells you WHICH and WHY. The next session needs both. |
> | "Tracing is heavy infrastructure" | One `startSpan` per boundary is a few lines. The visibility ROI is enormous. |
> | "Logging everything is safe" | High-cardinality fields and large blobs cost real money in log storage. Be deliberate. |
> | "I'll use `info` for everything to be safe" | Levels exist so dashboards can filter. `info` everywhere = the dashboard shows everything = the dashboard shows nothing. |
