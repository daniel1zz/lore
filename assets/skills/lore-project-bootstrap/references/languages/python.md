# Python Conventions

## Type System
- Type hints on all function signatures (params + return)
- `from __future__ import annotations` for forward references
- `mypy --strict` or `pyright` in CI
- Prefer `TypeAlias` and `TypeVar` for generic patterns

## Data Boundaries
- Pydantic `BaseModel` at all system boundaries (API input, config, external data)
- `model_validator` for cross-field validation
- Internal code trusts types — no runtime checks in domain layer
- `TypeAdapter` for validating non-model types (lists, dicts)

## Immutability
- Pydantic models with `frozen=True` by default
- `tuple` over `list` for fixed collections
- `@dataclass(frozen=True)` for simple value objects
- Never mutate function arguments

## Error Handling
- Custom exception hierarchy: `DomainError` → `NotFoundError`, `ValidationError`, etc.
- Domain functions raise domain exceptions, never generic `Exception`
- `try/except` only at boundary (API handlers, CLI entry)
- Never bare `except:` or `except Exception:` without re-raise

## Async
- `async/await` for I/O-bound operations
- `asyncio.gather()` for concurrent I/O
- Never mix sync and async in the same module
- `httpx.AsyncClient` over `requests` for async contexts

## Import Conventions
- Absolute imports over relative
- Group: stdlib → third-party → local (enforced by isort/ruff)
- `from module import Class` over `import module` for frequently used names

## Naming
- `snake_case` for functions/variables/modules
- `PascalCase` for classes
- `UPPER_SNAKE_CASE` for constants
- `_private` prefix for module-internal symbols

## File Organization
- One class per file for domain models
- Co-locate tests in `tests/` mirroring `src/` structure
- Max 400 lines typical, 800 absolute max

## CLAUDE.md Section Template

```markdown
## Python
- Type hints on all signatures, mypy --strict in CI
- Pydantic BaseModel (frozen=True) at system boundaries
- Immutable by default: frozen dataclasses, tuples, no argument mutation
- Custom exception hierarchy for domain errors
- async/await for I/O, asyncio.gather for concurrency
- Absolute imports, isort/ruff enforced grouping
```
