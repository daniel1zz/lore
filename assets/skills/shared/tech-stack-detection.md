# Tech Stack Detection

Detect project tech stack from `package.json` and load SDK playbooks.

## Package Categories

| Category | Packages |
|----------|----------|
| Framework | next, nuxt, react, vue, svelte, @angular/core, astro, remix |
| Backend | express, fastify, @nestjs/core, hono, elysia, koa |
| State mgmt | zustand, redux, @reduxjs/toolkit, jotai, recoil, mobx, valtio, pinia, vuex |
| Data fetching | @tanstack/react-query, swr, @apollo/client, urql, axios, ky |
| Styling | tailwindcss, styled-components, @emotion/react, sass |
| Forms | react-hook-form, formik, @tanstack/react-form, vee-validate |
| Validation | zod, yup, joi, class-validator, valibot |
| ORM/DB | prisma, drizzle-orm, typeorm, sequelize, mongoose, kysely |
| Auth | next-auth, @auth/core, passport, jsonwebtoken, lucia |
| UI components | @radix-ui/*, @headlessui/*, @shadcn/ui, @chakra-ui/*, @mui/material, antd |
| Mobile | react-native, expo, @react-navigation/* |

## SDK Playbook Lookup
1. `lore search "{sdk_name}" --type knowledge --json` (sub_type: research/reference) — lore corpus first
2. If missing → `context7.resolve-library-id` + `query-docs` / `mcp-deepwiki.ask_question`
3. If valuable findings → `lore create knowledge --parent <spec or prd it concerns> --sub-type reference --title '{sdk_name} playbook' --content '...'` to persist (draft status by default)

### Name Normalization
`@reduxjs/toolkit` → "redux", `@tanstack/react-query` → "tanstack-query", `@prisma/client` → "prisma", `next-auth`/`@auth/core` → "auth-js"

## Combination Detection
When ≥2 SDKs in scope: search for integration playbook → if missing, query external docs → create combination playbook if valuable → link to individual playbooks.

## Priority
- **HIGH** (must have playbook): state mgmt, data fetching, ORM/DB — affects architecture
- **MEDIUM**: forms, validation, auth — affects UX/security
- **LOW**: utilities (lodash, date-fns, axios) — straightforward usage
