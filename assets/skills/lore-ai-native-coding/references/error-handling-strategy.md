# Error Handling Strategy

> Cross-cutting error policy: classification, boundary translation, recovery patterns.
> Companion to `typed-errors.md` (which covers naming and payload structure for a single throw site).

## Classification

- MUST classify every error by three axes before handling:
  - **Recoverability**: Recoverable (retry/fallback) vs Fatal (fail fast)
  - **Source**: User (input) / System (infra) / Domain (business rule)
  - **Duration**: Transient (retry) vs Permanent (don't retry)
- MUST NOT use a generic catch-all without classification

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "A generic catch is fine here" | Generic catches hide bugs. Classify: recoverable/fatal, source, duration. |
> | "This error can't happen" | "Can't happen" is the prefix of every production incident. Handle it. |
> | "I'll add proper error handling later" | Error handling is the feature, not a polish step. |

## Boundary Design

- MUST translate errors at each architectural boundary — never leak implementation details upward
- MUST NOT expose: stack traces, SQL errors, internal IDs, or infra details to users
- MUST carry correlation IDs through all layers for debugging
- Domain layer: MUST use domain-specific error types (not HTTP codes)
- Application layer: MUST catch domain + infra errors, translate to app-level results
- Presentation layer: MUST map to user-facing responses, sanitize all output

## Error Hierarchy

- MUST extend project's existing error base class if one exists — MUST NOT create parallel hierarchies
- MUST distinguish operational errors (expected) from programmer errors (bugs)
- SHOULD include error code, message, and isOperational flag

## Recovery Patterns

- MUST use library-based retry (p-retry/async-retry) with exponential backoff for transient errors — max 3 attempts
- MUST use circuit breaker pattern for external service calls to prevent cascading failures
- SHOULD prefer fail-fast over silent degradation when data integrity is at risk

## Decision Rule

- When in doubt > fail fast. Silent failures are worse than crashes.
- MUST log all caught errors with full context (structured logging, correlation ID)
