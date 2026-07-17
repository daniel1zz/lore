# NestJS Conventions

## Platform Type
Backend API (REST / GraphQL)

## Architecture
- Module-based organization: each domain feature is a module
- Dependency Injection everywhere — never `new Service()` directly
- Controller → Service → Repository layering
- DTOs (class-validator) at API boundary, domain entities internally
- Guards for auth, Interceptors for transforms, Pipes for validation

## File Organization
```
src/
  modules/
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      auth.guard.ts
      dto/login.dto.ts
      entities/user.entity.ts
    orders/
      orders.module.ts
      orders.controller.ts
      orders.service.ts
      orders.repository.ts
      dto/create-order.dto.ts
      entities/order.entity.ts
  common/
    decorators/               # Custom decorators
    filters/                  # Exception filters
    interceptors/             # Response transform, logging
    pipes/                    # Custom validation pipes
    guards/                   # Auth guards
  config/                     # Configuration module (ConfigService)
  app.module.ts
  main.ts
```

## Patterns
- `ConfigModule.forRoot()` for environment config — never raw `process.env`
- Repository pattern: interface in domain, implementation in infrastructure
- Custom decorators for cross-cutting (e.g., `@CurrentUser()`, `@Public()`)
- Exception filters for consistent error response format
- Swagger decorators on all DTOs and controllers

## Error Handling
- `HttpException` subclasses for API errors
- Domain exceptions mapped to HTTP via exception filters
- Never throw raw `Error` — always typed exceptions
- Global exception filter as catch-all

## Testing
- Vitest (or Jest) with `@nestjs/testing`
- `Test.createTestingModule()` for isolated unit tests
- Override providers with mocks via `.overrideProvider()`
- Supertest for E2E controller tests

## Required Permissions
```json
{
  "allow": [
    "Bash(npm run start:dev)",
    "Bash(npm run build)",
    "Bash(npx nest *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest)",
    "Bash(npx jest)"
  ]
}
```

## CLAUDE.md Section Template

```markdown
## NestJS
- Module-per-feature, DI everywhere, never direct instantiation
- Controller → Service → Repository layering
- DTOs with class-validator at API boundary, domain entities internally
- ConfigModule for env, custom decorators for cross-cutting
- Guards for auth, Interceptors for transforms, Exception Filters for errors
- Vitest + @nestjs/testing for unit, Supertest for E2E
```
