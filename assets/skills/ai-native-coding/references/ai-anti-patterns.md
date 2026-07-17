# AI-Specific Anti-Patterns

> Patterns AI agents reliably produce when generating code unsupervised. Reviewers grep for them. Implementers self-check before committing.

## Why these are AI-specific

These patterns are not unique to AI — humans write them too. But AI agents produce them at a much higher rate than humans because:

- Defaulting to "make the type checker / runtime happy" is a strong gradient. Silencing an error with `?? null` or `as any` succeeds at compile-time, which feels like progress.
- Pattern-matching from training data produces plausible-looking code that misses domain-specific subtleties (e.g. generic error catches that swallow rare failures).
- Without external oracle pressure, agents converge toward minimal-effort fixes (one-line workarounds) over root-cause solutions.
- Speculative abstractions arise from "what if we need this later" reasoning, which is a hallucinated requirement.

Each pattern below comes with a grep oracle so reviewers and pre-commit hooks can detect them mechanically. **AI self-review is unreliable** — the same agent that wrote the anti-pattern is biased to justify it. Use the grep.

---

## P1: Silent Fallback on Required Data

**Symptom**: `?? <default>`, `|| <default>`, or `catch { return null }` applied to data that is logically required. Errors are erased; downstream code receives a "default" that's indistinguishable from real data.

```typescript
// ❌
function getUserName(user: User | undefined): string {
  return user?.name ?? 'Anonymous'  // 'Anonymous' looks like a valid name to callers
}

const config = JSON.parse(raw) ?? {}  // empty object is not a config

try {
  return parseOrder(input)
} catch {
  return null  // caller gets null for both "invalid input" and "parser bug"
}
```

**Why agents produce it**: makes the type system happy. `User | undefined` becomes `User`. The error goes away.

**Why it's wrong**: it converts a "this should not happen" into "this happened and we don't know." The next session debugging weird downstream behavior cannot tell whether the data was missing, malformed, or successfully defaulted.

**Grep**:
```bash
# Catch + return null/undefined/empty
grep -rnE 'catch\s*(\([^)]*\))?\s*\{\s*return\s+(null|undefined|\[\]|\{\}|""|0)\s*;?\s*\}' src/

# ?? applied to result of risky operations (heuristic)
grep -rnE '(JSON\.parse|process\.env|parseInt|parseFloat).*\?\?' src/

# || used as nullish-fallback on non-boolean expressions (often a bug — '0' || 1 = 1)
# Manual review — too many false positives for grep alone
```

**Fix**: fail loud at the boundary.

```typescript
// ✅
function getUserName(user: User): string {
  return user.name  // type makes user mandatory
}

// At the boundary:
const config = ConfigSchema.parse(JSON.parse(raw))

try {
  return parseOrder(input)
} catch (e) {
  if (e instanceof InvalidOrderPayloadError) {
    throw e  // expected — propagate
  }
  throw e  // unexpected — propagate (and log at top boundary)
}
```

`??` is acceptable when the field is *truly* optional with a documented default. The discipline is to default deliberately, not reflexively.

---

## P2: Dual-Source Types — Interface + Schema for the Same Shape

**Symptom**: `interface Foo` and `const FooSchema = z.object({...})` both exist for the same shape. They drift.

```typescript
// ❌
interface User {
  id: string
  email: string
  role: 'admin' | 'member'
}

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'member', 'viewer']),  // drift!
})
```

**Why agents produce it**: the schema feels like "extra" — the interface is "the real type."

**Why it's wrong**: see `zod-as-ssot.md`. One shape, one definition.

**Grep**:
```bash
# Find Name + NameSchema pairs
grep -rnE '^(export )?interface ([A-Z][A-Za-z]+)\b' src/ | awk -F: '{print $3}' | awk '{print $NF}' > /tmp/interfaces.txt
grep -rnE '(const |export const )([A-Z][A-Za-z]+)Schema = z\.' src/ | awk -F: '{print $3}' | sed -E 's/.* ([A-Z][A-Za-z]+)Schema.*/\1/' > /tmp/schemas.txt
# A name in both files is a candidate for dual-source
sort /tmp/interfaces.txt | uniq > /tmp/i.txt
sort /tmp/schemas.txt | uniq > /tmp/s.txt
comm -12 /tmp/i.txt /tmp/s.txt
# Each hit is a potential dual-source — manual review
```

**Fix**: schema first, type via `z.infer`.

```typescript
// ✅
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
})
export type User = z.infer<typeof UserSchema>
```

---

## P3: Type Assertion Abuse (`as`, `as any`, `as unknown as`)

**Symptom**: `as <Type>` to silence a type error without verifying the runtime shape matches.

```typescript
// ❌
const user = JSON.parse(raw) as User       // not validated
const id = req.params.id as UserId         // brand bypassed
const cfg = data as unknown as Config      // belt-and-suspenders bypass
const u: User = response as any            // total escape hatch
```

**Why agents produce it**: type errors block progress; `as` removes them; the code "works."

**Why it's wrong**: `as` is a *claim* about runtime shape, not a check. The first time the runtime shape disagrees, you get a `TypeError` deep in the call stack with no useful trace.

**Grep**:
```bash
# All `as` casts in src/
grep -rnE '\bas (any|unknown|[A-Z][A-Za-z]*)\b' src/

# `as unknown as` — almost always a smell
grep -rn 'as unknown as' src/

# `as any` — total escape hatch
grep -rn 'as any\b' src/
```

**Allowed uses** (rare):

1. **At a validated boundary**: after `schema.parse(raw)`, the result is already validated; if you need to widen for downstream use, `as` is OK but a comment explaining why is required.
2. **Bridging to a third-party library** with a known-narrow but mistyped signature — comment with the upstream issue link.
3. **`satisfies` not applicable**: `satisfies` is preferred; reach for `as` only when the use case demands it.

**Fix**:

```typescript
// ✅
const user = UserSchema.parse(JSON.parse(raw))          // validated
const id = parseUserId(req.params.id)                    // branded
const cfg = ConfigSchema.parse(data)                     // single parse
const u = UserSchema.parse(response)                     // checked
```

For genuine boundary widening, add a justification:

```typescript
// reason: `parse` above guarantees this shape; the wider type is needed for
//   compatibility with the legacy renderer. Remove with #245.
return parsed as LegacyUser
```

---

## P4: Generic Verb Function Names

**Symptom**: `process`, `handle`, `do<X>`, `manage`, `execute` as the verb in an exported function name. The function does an opaque mix of things.

```typescript
// ❌
export function processOrder(o: Order)
export function handleRequest(req: Request)
export function doSync()
export function manageState()
```

**Why agents produce it**: training data has lots of `processX` / `handleY`. They're plausible names.

**Why it's wrong**: see `naming-as-index.md`. The name should tell the next session whether it's a query or a command, pure or effectful, fast or slow. Generic verbs say nothing.

**Grep**:
```bash
grep -rnE '^export (async )?function (process|handle|do[A-Z]|manage|execute|run[A-Z])' src/
# Each hit: rename to the actual verb.
```

**Fix**: replace with a verb that names the actual operation.

```typescript
// ✅
export function validateOrder(o: Order): ValidationResult
export function routeOrder(o: Order): RoutingResult
export function authenticateRequest(req: Request): AuthContext
export async function syncOrderBook(symbol: Symbol): Promise<OrderBook>
export function applyStateEvent(state: State, event: Event): State
```

---

## P5: Time Coupling Without Type Enforcement

**Symptom**: a class or object has methods that MUST be called in a specific order, but the type system doesn't enforce it. The constraint lives in JSDoc, comments, or developer memory.

```typescript
// ❌
class FileUploader {
  setSource(path: string) { ... }
  setBucket(name: string) { ... }
  upload() {
    if (!this.source) throw new Error('call setSource first')
    if (!this.bucket) throw new Error('call setBucket first')
    // ...
  }
}
```

**Why agents produce it**: builder-like APIs feel natural; runtime checks "work."

**Why it's wrong**: the constraint is not type-checked. The next session can call `upload()` directly, hit the runtime error, and "fix" by removing the check.

**Grep**:
```bash
# Classes with multiple methods that throw "call X first"
grep -rnE 'throw new Error\(.*(call|invoke).*first' src/
# Each hit: refactor toward typestate or builder pattern.
```

**Fix**: typestate. The compiler enforces the sequence.

```typescript
// ✅
type Uninitialized = { kind: 'uninit' }
type SourceSet = { kind: 'src'; source: string }
type Ready = { kind: 'ready'; source: string; bucket: string }

function setSource(_: Uninitialized, source: string): SourceSet { ... }
function setBucket(s: SourceSet, bucket: string): Ready { ... }
async function upload(r: Ready): Promise<UploadResult> { ... }

// Caller cannot call upload without going through setSource → setBucket
let state: Uninitialized = { kind: 'uninit' }
const r = setBucket(setSource(state, '/path'), 'my-bucket')
await upload(r)
```

See `state-as-data.md` for the full typestate pattern.

---

## P6: Premature / Speculative Abstraction

**Symptom**: a generic interface, type parameter, or helper introduced "for future flexibility" with one current use site.

```typescript
// ❌
interface UserProvider<T extends UserBase = User> {
  findById<K extends keyof T>(id: K): Promise<T | null>
  // ...
}

// Used in exactly one place, with no plan for a second.
class DbUserProvider implements UserProvider<User> { ... }
```

**Why agents produce it**: "extensibility" / "flexibility" reads as good design.

**Why it's wrong**: every layer of abstraction has a cost — comprehension, refactor difficulty, name churn. With one use site, the abstraction is *more* code AND it predicts a future that may never come. When the second use case arrives, the abstraction is likely wrong for it (the second case never fits the first one's mold) and has to be re-done.

**Rule of Three**: don't abstract until you have three concrete use cases.

**Grep**:
```bash
# Type parameters on classes/functions with only one type argument supplied across the codebase
# (Hard to grep mechanically — manual review of new abstractions in PRs.)

# Interfaces with only one implementation
grep -rnE '^(export )?interface ([A-Z][A-Za-z]+)' src/ | awk -F: '{print $3}' | awk '{print $2}' > /tmp/ifaces.txt
while read iface; do
  count=$(grep -rcE "implements +${iface}\b" src/ | grep -v ':0' | wc -l)
  if [ "$count" = "1" ]; then echo "$iface: 1 impl"; fi
done < /tmp/ifaces.txt
# Hits = candidates to inline (delete the interface, use the class directly)
```

**Fix**: write the concrete code first. Wait for the third use case. Then extract.

```typescript
// ✅
async function findUserById(id: UserId): Promise<User | null> {
  return db.query.users.findFirst({ where: eq(users.id, id) })
}
// When a second use case (cached lookup) appears, copy-paste-modify.
// When the third appears, extract the common shape.
```

---

## P7: Hidden IO in a Pure-Looking Name

**Symptom**: a function whose name suggests pure computation actually performs IO.

```typescript
// ❌
function getUserSettings(id: UserId): UserSettings {
  return cache.get(id) ?? fetchFromAPI(id)  // network call hidden
}

function calculateTax(order: Order): Money {
  const rate = db.query.taxRates.findFirst({ where: eq(taxRates.country, order.country) }).rate
  // DB call!
  return order.subtotal.times(rate)
}
```

**Why agents produce it**: focuses on the *return value* (a settings object, a Money amount) and names by that, not by the operation.

**Why it's wrong**: callers assume `get*` and `calculate*` are cheap. They don't think about caching, error handling, or rate limiting. Production surprises follow.

**Grep**: hard to grep mechanically (no syntactic marker). Heuristic:

```bash
# Functions named get/find/calculate that contain await, fetch, db., or http.
grep -rn 'function (get\|find\|calculate\|compute)' src/ -A 20 | grep -E '(await|fetch\(|db\.|http\.|axios\.)'
# Each hit: either rename (to fetch/load/sync) or remove the IO (lift to caller).
```

**Fix**: rename to reflect the operation, or restructure so the IO is in the caller.

```typescript
// ✅ Option A: rename
async function fetchUserSettings(id: UserId): Promise<UserSettings> { ... }
async function loadTaxRate(country: Country): Promise<TaxRate> { ... }
function calculateTax(order: Order, rate: TaxRate): Money { ... }

// Option B: lift the IO out
const rate = await loadTaxRate(order.country)
const tax = calculateTax(order, rate)  // now pure
```

---

## P8: Catch-Everything Boundary

**Symptom**: a `try/catch` at a high level that catches `unknown` and logs/swallows it without distinguishing failure modes.

```typescript
// ❌
async function handleRequest(req: Request) {
  try {
    return await businessLogic(req)
  } catch (e: unknown) {
    logger.error('something failed', { e })
    return { status: 500, body: 'Internal Server Error' }
  }
}
```

**Why agents produce it**: it's an obvious "be safe at the boundary" reflex.

**Why it's wrong**: it conflates all failure modes. A 400-class user error gets a 500. A 503-class venue outage gets a 500. A bug gets a 500. Clients can't tell what to do. Telemetry has one bucket: "things broke."

**Grep**:
```bash
# Catch-all that returns a generic 500
grep -rnE 'catch.*\{[^}]*5[0-9]{2}' src/
# Each hit: replace with typed-error switch (see typed-errors.md).
```

**Fix**: route by error type. Unknown errors re-throw (top-level handler logs + 500s).

```typescript
// ✅
async function handleRequest(req: Request) {
  try {
    return await businessLogic(req)
  } catch (e) {
    if (e instanceof InvalidPayloadError) return res(400, { code: e.code, issues: e.context.issues })
    if (e instanceof NotFoundError)       return res(404, { code: e.code })
    if (e instanceof RateLimitedError)    return res(429, { code: e.code, retryAfterMs: e.context.retryAfterMs })
    if (e instanceof VenueUnreachableError) return res(503, { code: e.code })
    // Unknown — re-throw so top-level boundary logs and returns 500.
    throw e
  }
}
```

See `typed-errors.md` for the boundary translation pattern.

---

## Audit Commands — Run Before Commit

```bash
#!/usr/bin/env bash
# AI anti-pattern scan for src/

FAIL=0
check() {
  local name="$1"
  local cmd="$2"
  local count
  count=$(eval "$cmd" | wc -l | tr -d ' ')
  if [ "$count" != "0" ]; then
    echo "❌ $name: $count hit(s)"
    eval "$cmd"
    FAIL=1
  else
    echo "✅ $name: 0"
  fi
}

check "P1a: catch returns null/empty"            "grep -rnE 'catch\\s*(\\([^)]*\\))?\\s*\\{\\s*return\\s+(null|undefined|\\[\\]|\\{\\}|\"\"|0)' src/"
check "P3a: as any"                              "grep -rn 'as any\\b' src/"
check "P3b: as unknown as"                       "grep -rn 'as unknown as' src/"
check "P4: generic verb function names"          "grep -rnE '^export (async )?function (process|handle|do[A-Z]|manage|execute)' src/"
check "P5: throw 'call X first'"                 "grep -rnE 'throw new Error\\(.*(call|invoke).*first' src/"
check "TODO/FIXME/XXX in src"                    "grep -rnE '(TODO|FIXME|XXX|HACK)' src/"
check "console.log in src"                       "grep -rn 'console\\.\\(log\\|error\\|warn\\)' src/ | grep -v 'CLI surface'"
check "throw new Error directly in business"     "grep -rn 'throw new Error(' src/ | grep -v test"

if [ "$FAIL" = "1" ]; then
  echo
  echo "Anti-pattern check FAILED — fix the items above before committing."
  exit 1
fi
echo "✅ All anti-pattern checks passed"
```

Drop this script into `scripts/ai-anti-pattern-scan.sh` and run it as a pre-commit hook (or have the reviewer subagent run it).

## Reviewer subagent prompt fragment

When dispatching a code review subagent, include:

> Run `scripts/ai-anti-pattern-scan.sh`. For each hit, classify as: (a) genuine violation — request fix; (b) intentional with documented reason — verify a `// reason:` or `// fence:` comment is present; (c) false positive — explain why.

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "The fallback is safer than throwing" | Silent fallbacks turn one bug into ten — every downstream check has to re-discover the missing data. |
> | "`as` is fine here, the type is obviously correct" | "Obvious" is your context. The runtime doesn't see types. Verify with a parser. |
> | "`processOrder` is a fine name, the body explains what it does" | Names are the grep index. The body is the implementation. Index the operation, not the noun. |
> | "Speculative generality is good engineering" | Speculative generality is a prediction. Most predictions are wrong. Write the second concrete case, then extract. |
> | "The catch-all is defensive programming" | It defends the runtime from crashing AND blinds the operator to what went wrong. |
> | "TODO is fine, I'll get to it" | TODOs older than 30 days have a 100% chance of being abandoned and a 50% chance of being misleading. |
