# Naming as LSP / Grep Index Key

> A name is not a label. It is the index entry by which every future AI session will find this code. Names that are not grep-friendly do not exist.

## Why this matters

The next AI session locates code primarily through three operations:

1. **Grep** for a literal string ("where is the order router?").
2. **LSP `find_symbol` / `find_references`** for a symbol by exact name.
3. **Semantic search** over identifiers and JSDoc.

All three rely on the *same* property: the name must be **predictable from intent**. If the agent guesses `routeOrder` and the symbol is named `processOrderRouting`, the search fails. If two modules use `process` for unrelated operations, the search returns noise.

Human developers absorb naming conventions from team review and codebase reading. An AI agent landing cold in a session has no such absorption time. The naming convention must be **encoded in the names themselves**.

Three properties make a name AI-native:

1. **Predictable** — derivable from the domain term plus the action.
2. **Unique** — no two unrelated things share a name.
3. **Diagnostic** — reading the name tells you what category of operation it is (query? command? IO? pure?).

## ⛔ Core rules

1. **No abbreviations in exported symbols.** `user`, not `usr`. `manager`, not `mgr`. `request`, not `req` (parameter names in narrow scopes are the only exception, see below).
2. **One concept, one name, project-wide.** If the domain term is "account", every layer (DB, service, UI) uses `account`. Never `account` here, `customer` there, `user` in a third place.
3. **Verb prefix carries side-effect class.** `get*` / `find*` / `is*` / `has*` / `compute*` = pure query, no observable side effects. `create*` / `update*` / `delete*` / `send*` / `sync*` / `apply*` = command, mutates state or performs IO.
4. **Names match across files.** The function is `routeOrder`. The test file is `route-order.test.ts`. The fixture is `routeOrderFixture`. The error is `RouteOrderError`. Grep for `routeOrder` returns everything related; grep for `process` returns 200 unrelated things.

## CQS verb table

Following Command-Query Separation:

| Prefix | Side effects | Returns | Example |
|---|---|---|---|
| `get*` | None — direct lookup, may throw if not found | The thing | `getUser(id)` — throws if not found |
| `find*` | None — direct lookup | The thing or `null` | `findUser(id)` — returns null if missing |
| `list*` / `search*` | None — read query, may return many | Array | `listOrders(filter)`, `searchUsers(query)` |
| `is*` / `has*` | None — predicate | `boolean` | `isValid(x)`, `hasPermission(user, action)` |
| `compute*` / `calculate*` / `derive*` | None — pure computation | The computed value | `computeRiskScore(position)` |
| `parse*` | None — pure, but throws on bad input | Validated value | `parseUserId(string)` |
| `format*` / `serialize*` / `render*` | None — pure transformation | Transformed value | `formatCurrency(money)` |
| `create*` | Allocates / inserts | The new thing or its id | `createOrder(input) → order` |
| `update*` | Modifies | The updated thing or `void` | `updateUserEmail(id, email)` |
| `delete*` / `remove*` | Removes | `void` or `boolean` | `deleteSession(id)` |
| `send*` / `dispatch*` / `emit*` | External IO / event | Acknowledgement or `void` | `sendEmail(to, body)` |
| `sync*` | External IO, both directions | The new state | `syncOrderBook(symbol)` |
| `apply*` | Mutation via state transition | New state or `void` | `applyEvent(state, event)` |
| `with*` | Pure, returns new value (immutability) | New value | `withRole(user, 'admin')` |

The categorization is informative — when the next agent sees `getUser`, it knows it can call it in a tight loop without worrying about side effects. When it sees `syncOrderBook`, it knows there's a network round-trip and to think about rate limits.

### Pure vs effectful — the most important signal

If you do nothing else, get this right: a function name should tell the reader whether calling it is **safe** (pure, idempotent, no observable side effects) or **costly** (IO, state mutation, network).

```typescript
// ✅ Name tells you: pure
function computeFee(order: Order): Money { ... }

// ✅ Name tells you: writes to DB
async function recordOrder(order: Order): Promise<void> { ... }

// ❌ Name hides the cost
async function order(o: Order): Promise<void> { ... }  // does this submit? validate? both?

// ❌ Name lies — sounds pure, does IO
function getUserSettings(id: UserId): UserSettings {
  return cache.get(id) ?? fetchAndCache(id)  // hidden network fetch!
}
```

## Ubiquitous language across layers

The domain term must be the **same word** at every layer. If the domain calls it `position`, the database table is `positions`, the model is `Position`, the schema is `PositionSchema`, the route is `/positions`, the file is `position.ts`, the test is `position.test.ts`. No synonyms.

| Layer | Use the term | NOT |
|---|---|---|
| Domain model | `Position` | `Holding`, `Asset` |
| DB table | `positions` | `holdings`, `user_assets` |
| Repository | `PositionRepository` | `HoldingsRepo` |
| Schema | `PositionSchema` | `AssetSchema` |
| Route | `/api/positions` | `/api/holdings` |
| File | `position.ts` | `asset.ts` |
| Variable | `const position = ...` | `const holding = ...` |

This is plain Domain-Driven Design's "ubiquitous language" rule, but the AI-native reason is sharper: every synonym is a grep miss. If a session searches for `Position` and the file uses `Asset`, the work doubles.

When a name change is needed (the domain term evolved), update **every** layer in one commit. Half-migrated names are worse than the old name.

## Abbreviations — when allowed

- **Loop counters and short-lived locals**: `i`, `j` in a 3-line loop is fine.
- **Established conventions in scope**: `req`, `res`, `ctx`, `err`, `e` (in catch), `id` are acceptable parameter names within a handler / middleware. They are NOT acceptable as exported symbol names (`export function processReq` — no).
- **Universally understood acronyms**: `URL`, `HTTP`, `API`, `JSON`, `UUID`, `JWT`, `DB`, `IO`. These read as words.
- **NEVER**: `mgr`, `svc`, `ctrl`, `repo` (the abbreviation, not the word), `obj`, `arr`, `usr`, `pwd`, `auth` as a substring (write `authenticate` or `authorize`).

Test for "is this abbreviation OK": say it aloud. If you would naturally say "manager" instead of "MGR", spell it out.

## File and directory naming

- **Kebab-case files** for code: `route-order.ts`, `order-book.ts`. (The default TS/JS ecosystem norm; matches URL paths in many frameworks.)
- **Test files mirror source**: `route-order.test.ts` lives next to `route-order.ts`.
- **PascalCase for component files** in React/Vue/Svelte projects where the framework convention requires it: `OrderCard.tsx`.
- **Directories match domain terms**: `src/orders/`, `src/risk/`, NOT `src/utils/order-stuff/`.
- **`utils/` is a code smell**: if it's truly cross-cutting (`assertNever`, `isDefined`), put it in `shared/` or `lib/`. If it's domain-specific, put it in that domain's directory.

## Branded types and value objects

When two values share a primitive shape but different semantics — both are `string`, but one is a user id and the other an account id — name them distinctly *and* brand them.

```typescript
// ✅ Distinct names + brands
export type UserId = string & { readonly __brand: 'UserId' }
export type AccountId = string & { readonly __brand: 'AccountId' }

function transferTo(from: AccountId, to: AccountId, amount: Money): void { ... }

// Compile error: cannot pass UserId where AccountId expected
const u: UserId = ...
transferTo(u, u, ...)  // ❌ type error
```

A grep for `AccountId` returns every use site of the account-id concept. A grep for `string` returns the entire codebase.

## Anti-patterns

### `process` / `handle` / `do` / `manage` / `execute`
Generic verbs that say nothing about the operation. If you wrote `processOrder`, the next session has to read the body to know whether it validates, routes, fills, or all three. Rename to the actual verb: `validateOrder`, `routeOrder`, `fillOrder`.

### `Manager` / `Service` / `Helper` / `Util` suffix on classes
These are noise. A class doing things is by definition a "manager" of something. Use a concrete verb: `OrderRouter`, `RiskCalculator`, `EmailSender`. (`Service` is the most defensible of these — it's a recognized DDD term — but specific verbs are still better.)

### Different names for the same concept
```typescript
// db layer
type DbUser = { ... }
// service layer
type UserModel = { ... }
// api layer
type UserDto = { ... }
```
If they have the same fields, they're the same shape — one name, derived where needed (`type UserDto = Omit<User, 'passwordHash'>`). Different names suggest different shapes; if they actually differ, name them by their *purpose* (`PublicUser`, `User`), not their layer.

### Names that lie about side effects
```typescript
// ❌ Sounds like a getter, does IO
function getUserPreferences(id: UserId): UserPreferences

// ✅ Honest
async function fetchUserPreferences(id: UserId): Promise<UserPreferences>
```

### `data` / `info` / `result` / `value` as the only word
```typescript
// ❌
const data = await fetch(...)
function handle(data: Data): Result

// ✅
const orderBook = await fetchOrderBook(symbol)
function routeOrder(order: Order): RoutingResult
```

### Boolean names without `is` / `has` / `should`
```typescript
// ❌
if (user.admin) { ... }     // is admin a property? a method? a role check?
if (order.fillable) { ... } // fillable in what sense?

// ✅
if (user.isAdmin) { ... }
if (order.isFillable()) { ... }  // a method — invokes some logic
```

## When to mark side effects in the name (defensively)

Most pure functions don't need a marker — `compute*` / `format*` / `parse*` already imply purity. But for code paths where the distinction is critical and could be mistaken, add a suffix:

```typescript
// In a hot path where IO would be catastrophic
function getPriceUnsafe(symbol: Symbol): Money {
  // pure cache read — but cache may be stale; caller must know
}

// In a module that's mostly pure but has one IO function
async function persistUnsafe(state: State): Promise<void> {
  // writes to disk — name reminds the reader this is the one IO function in this module
}
```

This is for the edge case where the operation's nature is non-obvious from name alone. Don't sprinkle `Unsafe` everywhere — it loses meaning.

## Grep oracles

```bash
# Forbidden generic verb prefixes on exported functions
grep -nE '^export (async )?function (process|handle|doStuff|manage)' src/
# Expect 0 results

# `Manager` / `Helper` / `Util` class names
grep -rn 'class [A-Z][A-Za-z]*\(Manager\|Helper\|Util\)' src/
# Expect 0 results

# Abbreviation usage in exports
grep -rnE '^export.*\b(mgr|svc|ctrl|usr|pwd|repo[^s])\b' src/
# Expect 0 results

# Boolean fields without is/has/should prefix
grep -rnE ': boolean' src/ | grep -vE '\b(is|has|should|can|will|did)[A-Z]'
# Manual review of hits
```

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| Name a function with `process` / `handle` / `manage` / `do` | What's the actual verb? Use it. |
| Add a class with `Manager` / `Helper` / `Util` suffix | Is there a more specific role? |
| Use an abbreviation in an exported name | Spell it out. |
| Introduce a synonym for an existing domain term | Reuse the existing term. If the new term is genuinely different, justify it. |
| Add a `boolean` field without `is`/`has`/`should` prefix | Rename. |
| Create a function that does both query + command | Split into two functions, each with a clear verb. (CQS principle.) |

## When in doubt

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "Short names are more readable" | Short names are predictable only inside your context. Cross-session, predictable means *derivable from intent* — which requires fully spelled domain words. |
> | "Everyone in our team knows `mgr` means manager" | The next AI session is not on your team. |
> | "Generic names are flexible" | Flexible = unpredictable to grep. The name's job is to be one specific thing. |
> | "Renaming would break things" | LSP rename refactors are mechanical. The cost of one bad name compounds over every future session. |
> | "Two different names for the same thing makes the layers feel cleaner" | The layers may look cleaner; the grep is broken. Pick one term. |
