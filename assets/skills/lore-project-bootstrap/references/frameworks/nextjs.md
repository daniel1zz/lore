# Next.js Conventions

## Platform Type
SSR Web Application (App Router)

## Architecture
- App Router (`app/`) over Pages Router
- Server Components by default — add `'use client'` only when needed (state, effects, browser APIs)
- Route groups `(group)` for layout organization without URL impact
- Parallel routes `@slot` for complex layouts
- Intercepting routes `(.)path` for modals

## Data Fetching
- Server Components fetch data directly (no useEffect)
- `fetch()` with Next.js caching: `{ cache: 'force-cache' }` default, `{ next: { revalidate: N } }` for ISR
- Server Actions for mutations (`'use server'` functions)
- `useActionState` for form state management
- Never fetch in Client Components if Server Component can pass data as props

## File Organization
```
app/
  (auth)/layout.tsx          # Route group for auth pages
  (main)/layout.tsx          # Route group for main app
  api/                       # API routes (minimal — prefer Server Actions)
  globals.css
lib/                         # Shared utilities, types, constants
  actions/                   # Server Actions
  db/                        # Database client and queries
components/
  ui/                        # Generic UI components
  features/                  # Feature-specific components
```

## Error Handling
- `error.tsx` at each route segment for granular error boundaries
- `not-found.tsx` for 404 handling
- `loading.tsx` for Suspense boundaries
- `global-error.tsx` at root for unhandled errors

## Performance
- Dynamic imports `next/dynamic` for heavy client components
- Image optimization via `next/image` — never raw `<img>`
- Font optimization via `next/font`
- Metadata API for SEO (`generateMetadata`)

## Testing
- Vitest for unit/integration tests
- Playwright for E2E
- `@testing-library/react` for component tests

## Required Permissions
```json
{
  "allow": [
    "Bash(npm run dev)",
    "Bash(npm run build)",
    "Bash(npx next)",
    "Bash(npx tsc --noEmit)",
    "Bash(npx vitest)",
    "Bash(npx playwright)"
  ]
}
```

## CLAUDE.md Section Template

```markdown
## Next.js (App Router)
- Server Components by default, 'use client' only for state/effects/browser APIs
- Server Actions for mutations, fetch() in Server Components for data
- Route groups for layout organization, error.tsx/loading.tsx per segment
- next/image for images, next/font for fonts, generateMetadata for SEO
- Vitest + @testing-library/react for tests, Playwright for E2E
```
