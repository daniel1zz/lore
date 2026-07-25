// Deliberate NEGATIVE fixture for the `dashboard-local/no-raw-api-literal`
// ESLint rule (SPEC-078 D5/R-16, eslint.config.js). This file is NOT part of
// `packages/dashboard/src` (so the ordinary `lint` script, `eslint src`,
// never touches it) — it exists ONLY to prove the rule fires on a raw
// "/api/" template literal, via the `lint:api-factory-fixture` npm script
// (package.json), which expects `eslint` to FAIL against this exact file.
// If this fixture ever lints clean, the rule has regressed silently.
export const badPath = `/api/docs`;
