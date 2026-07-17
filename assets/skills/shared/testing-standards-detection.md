# Testing Standards Detection

Detect project testing stack from `package.json` and map to standards.

## Package Categories

| Category | Packages |
|----------|----------|
| Test runner | vitest, jest, mocha, ava |
| Component | @testing-library/react, @testing-library/vue, @vue/test-utils, enzyme |
| E2E | playwright, @playwright/test, cypress, puppeteer |
| Mocking | msw, sinon, nock (vitest/jest have built-in) |
| Coverage | @vitest/coverage-v8, @vitest/coverage-istanbul, nyc, c8 |
| API testing | supertest, pactum |

## Detection Steps
1. Read `package.json` → categorize testing deps
2. Glob `**/*.test.{ts,tsx}`, `**/*.spec.{ts,tsx}`, `**/__tests__/**` → detect naming/structure conventions
3. For each detected tool, search the lore corpus: `lore search "{tool}" --type knowledge --json` (sub_type: research/reference)
4. If missing + high priority → generate via context7/deepwiki research + project analysis

## Priority
- **HIGH** (must have playbook): test runners (vitest, jest), E2E (playwright, cypress)
- **MEDIUM**: component testing (@testing-library/*), API mocking (msw)
- **LOW**: utilities (supertest, nock)

## Standards to Extract
Naming conventions, file organization, test patterns, mocking strategies, assertion styles, coverage thresholds.
