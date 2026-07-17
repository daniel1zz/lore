# Nuxt Conventions

## Platform Type
SSR Web Application (Nuxt 3)

## Architecture
- Auto-imports for composables, components, and utils
- Server routes in `server/` directory (Nitro engine)
- Hybrid rendering: SSR by default, `routeRules` for per-route strategy
- Nuxt modules for third-party integrations

## File Organization
```
app/                         # (Nuxt 4 convention, or root for Nuxt 3)
  pages/                     # File-based routing
    index.vue
    users/[id].vue
  components/                # Auto-imported components
    ui/                      # Generic UI
    features/                # Feature-specific
  composables/               # Auto-imported composables (useAuth, useFetch wrappers)
  layouts/                   # Layout components
  middleware/                # Route middleware
  plugins/                   # Nuxt plugins
server/
  api/                       # API routes (Nitro)
  middleware/                # Server middleware
  utils/                     # Server-only utilities
utils/                       # Shared utilities (auto-imported)
types/                       # TypeScript type definitions
```

## Data Fetching
- `useFetch` / `useAsyncData` for SSR-safe data fetching
- Never raw `fetch()` in components — loses SSR hydration benefits
- `$fetch` in server routes and event handlers
- `useLazyFetch` for non-blocking data

## Patterns
- `defineNuxtConfig` for type-safe config
- `definePageMeta` for page-level metadata (layout, middleware)
- `useState` for SSR-safe reactive shared state
- `useRuntimeConfig` for env vars (never `process.env` in client)

## Error Handling
- `createError` for throwing typed errors
- `error.vue` at root for error page
- `NuxtErrorBoundary` component for granular error catching

## Testing
- Vitest for unit/integration
- `@nuxt/test-utils` for Nuxt-aware testing
- Playwright for E2E

## Required Permissions
```json
{
  "allow": [
    "Bash(npm run dev)",
    "Bash(npm run build)",
    "Bash(npx nuxi *)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest)",
    "Bash(npx playwright)"
  ]
}
```

## CLAUDE.md Section Template

```markdown
## Nuxt 3
- Auto-imports for composables, components, utils — no manual imports needed
- useFetch/useAsyncData for SSR-safe data, never raw fetch() in components
- Server routes in server/api/ (Nitro), useRuntimeConfig for env vars
- definePageMeta for page metadata, useState for SSR-safe shared state
- createError for typed errors, error.vue + NuxtErrorBoundary for handling
- Vitest + @nuxt/test-utils for tests, Playwright for E2E
```
