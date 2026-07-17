# Backend Layering

> Layer architecture, dependency direction, API/DB/reliability conventions for backend code.
> Read when: writing handlers/services/repositories/middleware, designing data access, or wiring API endpoints.

## Layer Architecture

- MUST choose layer count by domain complexity:
  - Simple CRUD > 2-layer (Controller + Repository)
  - Moderate > 3-layer (Controller + Service + Repository)
  - Complex domain > DDD (Controller + AppService + Domain + Repository)
- MUST NOT skip layers: controllers MUST NOT call repositories directly when a service layer exists

## Dependency Direction

- MUST point dependencies inward: infra > application > domain
- MUST NOT import from infrastructure in domain layer (no DB, no HTTP, no message queues)
- MUST NOT expose ORM types to domain layer — map at repository boundary
- MUST define repository interfaces in domain, implement in infrastructure

## API Conventions

- MUST validate all input at API boundary with Zod
- MUST return consistent error format: `{ error: { code, message } }`
- MUST NOT return stack traces or internal IDs in error responses

## Database

- MUST use ORM migrations for schema changes — MUST NOT use manual DDL in production
- MUST wrap multi-step writes in transactions
- MUST index foreign keys and frequently filtered/sorted columns
- SHOULD use soft delete unless storage constraints require hard delete

## Reliability

- MUST handle SIGTERM for graceful shutdown (close connections cleanly)
- MUST use structured logging (pino/winston) with request ID propagation
- MUST NOT hand-roll auth, rate limiting, or crypto — use established libraries
- SHOULD use retry with exponential backoff for transient external failures
