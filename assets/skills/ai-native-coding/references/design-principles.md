# Design Principles — SOLID, DDD, Composition

> SoC, SOLID, DDD value objects/aggregates, composition over inheritance, response envelope, repository pattern.
> AI-native lens: these principles minimize the modification radius and oracle-verifiability of any single change.

## Design Principles

### Separation of Concerns

- MUST give each module/class/function a single, well-defined responsibility
- MUST separate I/O (network, DB, filesystem) from pure business logic
- MUST NOT mix presentation, business logic, and data access in the same module
- SHOULD use the Ports & Adapters pattern: domain core defines interfaces, infrastructure implements them

### SOLID

- **SRP** — one reason to change per class/module. Split when responsibilities diverge
- **OCP** — extend behavior via composition/strategy, not by modifying existing code
- **LSP** — subtypes MUST be substitutable for their base type without breaking callers
- **ISP** — prefer small, focused interfaces over large ones. Clients MUST NOT depend on methods they don't use
- **DIP** — depend on abstractions (interfaces), not concretions. High-level modules MUST NOT import low-level modules directly

```typescript
// DIP example
interface UserRepository {
  findById(id: string): Promise<User | null>
}

// High-level service depends on the interface
class UserService {
  constructor(private readonly repo: UserRepository) {}
}

// Low-level implementation provided at composition root
class PrismaUserRepository implements UserRepository {
  async findById(id: string) { /* ... */ }
}
```

### Domain-Driven Design (when complexity warrants)

- MUST keep domain entities free of framework/infrastructure dependencies
- MUST use Value Objects for concepts with equality by value (Money, Email, DateRange)
- MUST encapsulate business rules inside domain entities/services, not in controllers or UI
- SHOULD use Aggregates to enforce invariants across related entities
- SHOULD express domain events for cross-boundary side effects

```typescript
// Value Object — immutable, equality by value
class Money {
  constructor(
    readonly amount: number,
    readonly currency: string
  ) {}

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error('Currency mismatch')
    }
    return new Money(this.amount + other.amount, this.currency)
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency
  }
}
```

### Composition Over Inheritance

- MUST prefer composition and delegation over deep inheritance hierarchies
- MUST NOT exceed 2 levels of inheritance (base → concrete is fine; base → mid → concrete is the max)
- SHOULD use mixins or strategy pattern for shared behavior across unrelated types

## API Response Format

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}
```

## Custom Hooks Pattern

```typescript
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}
```

## Repository Pattern

```typescript
interface Repository<T> {
  findAll(filters?: Filters): Promise<T[]>
  findById(id: string): Promise<T | null>
  create(data: CreateDto): Promise<T>
  update(id: string, data: UpdateDto): Promise<T>
  delete(id: string): Promise<void>
}
```

## Skeleton Projects — Foundation for New Modules

When implementing new functionality, prefer to build on a battle-tested foundation rather than from scratch.

1. **Search** for skeleton / starter projects in the same domain (e.g. `create-t3-app`, `create-next-app`, framework-official starters, top-starred GitHub templates).
2. **Evaluate options in parallel** via subagents along four axes:
   - Security assessment — known CVEs, supply chain, secret handling defaults
   - Extensibility — composability, plugin points, abstraction depth (Rule of Three: not premature)
   - Relevance — does it match our domain / scale / team conventions
   - Implementation plan — concrete adoption steps + delta from our target shape
3. **Clone the best match** as the foundation; do NOT start with an empty repo when a proven one exists.
4. **Iterate within the proven structure** — adopt its conventions, only deviate when measurably better.

Anti-pattern: writing scaffolding code from scratch "because we want to understand it." Understanding is fine in study time; production time should start from a known-good base.
