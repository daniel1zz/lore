# FastAPI Conventions

## Platform Type
Backend API (REST)

## Architecture
- Router-based organization: one router per domain feature
- Dependency Injection via `Depends()` — never global singletons
- Pydantic models for request/response schemas
- SQLAlchemy (async) or similar ORM for data access
- Repository pattern for database operations

## File Organization
```
src/
  app/
    main.py                  # FastAPI app creation + router inclusion
    config.py                # Settings via pydantic-settings
    dependencies.py          # Shared dependencies (get_db, get_current_user)
  modules/
    auth/
      router.py              # API endpoints
      service.py             # Business logic
      repository.py          # Data access
      schemas.py             # Pydantic request/response models
      models.py              # SQLAlchemy models
      dependencies.py        # Module-specific dependencies
    orders/
      router.py
      service.py
      schemas.py
      models.py
  common/
    exceptions.py            # Custom exception classes
    middleware.py             # CORS, logging, etc.
    responses.py             # Standard response envelope
tests/
  conftest.py                # Fixtures (async client, test db)
  modules/
    auth/test_router.py
    orders/test_service.py
```

## Patterns
- `pydantic-settings` for config: `class Settings(BaseSettings)` with `.env` source
- Response envelope: `{"success": true, "data": ..., "error": null, "meta": {}}`
- `Depends()` chain for auth: `get_current_user` → `require_admin`
- Background tasks via `BackgroundTasks` parameter
- Lifespan events for startup/shutdown (DB pool, cache warmup)

## Error Handling
- Custom `HTTPException` subclasses with consistent error codes
- Exception handlers registered on app for domain exceptions
- Never return raw 500 — always structured error response
- Validation errors auto-handled by FastAPI (422)

## Async
- `async def` for all route handlers and service methods
- `asyncio.gather()` for concurrent I/O in services
- Async SQLAlchemy sessions (`AsyncSession`)
- `httpx.AsyncClient` for external API calls

## Testing
- pytest + pytest-asyncio
- `httpx.AsyncClient` with `ASGITransport` for integration tests
- Factory fixtures for test data
- Separate test database with auto-rollback

## Required Permissions
```json
{
  "allow": [
    "Bash(python -m uvicorn *)",
    "Bash(uvicorn *)",
    "Bash(pytest *)",
    "Bash(python -m pytest *)",
    "Bash(mypy *)",
    "Bash(ruff *)",
    "Bash(pip install *)",
    "Bash(uv *)"
  ]
}
```

## CLAUDE.md Section Template

```markdown
## FastAPI
- Router-per-feature, Depends() for DI, never global singletons
- Pydantic models at API boundary, SQLAlchemy models for persistence
- pydantic-settings for config (BaseSettings + .env), never raw os.environ
- Response envelope: {success, data, error, meta}
- async def everywhere, asyncio.gather for concurrent I/O
- pytest + pytest-asyncio + httpx AsyncClient for tests
```
