// SPEC-078 D5/R-16 — ESLint flat config enforcing the "one factory seam" rule
// for backend requests: no module under packages/dashboard/src is allowed to
// write a raw "/api/" string or template literal, EXCEPT `src/lib/project-api.ts`
// itself (the ONE module that owns that literal, per its own module doc
// comment). DX review flagged grep-based enforcement as fragile (silently
// stops catching new call sites); this rule makes the invariant mechanical.
//
// `dashboard-local/no-raw-api-literal` is a small inline custom rule (not the
// generic core `no-restricted-syntax`) so lint failures name a dedicated,
// greppable rule id — see `tests/fixtures/eslint/raw-api-literal.fixture.ts`
// and the `lint:api-factory-fixture` script (package.json) that proves this
// rule actually fires on a deliberate violation.
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

/** @type {import("eslint").Rule.RuleModule} */
const noRawApiLiteralRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban raw '/api/' string and template literals outside the project-api factory module (SPEC-078 D5).",
    },
    schema: [],
    messages: {
      rawApiLiteral:
        "Raw '/api/' literal found outside the project-api factory module (SPEC-078 D5). " +
        "Route this request through apiFetch()/queryKeys from '@/lib/project-api' instead.",
    },
  },
  create(context) {
    /**
     * Flags a literal whose text STARTS WITH "/api/" — an absolute backend
     * request path. Deliberately anchored (not a bare `.includes("/api/")`)
     * because `@/api/mutations` — the path-alias import specifier for
     * `src/api/mutations.ts`, used throughout this package — contains the
     * substring "/api/" without being a request path at all; an unanchored
     * check false-positives on every such import statement.
     *
     * @param {import("estree").Node} node
     * @param {unknown} raw
     */
    function checkLiteral(node, raw) {
      if (typeof raw === "string" && raw.startsWith("/api/")) {
        context.report({ node, messageId: "rawApiLiteral" });
      }
    }
    return {
      Literal(node) {
        checkLiteral(node, node.value);
      },
      TemplateElement(node) {
        checkLiteral(node, node.value.raw);
      },
    };
  },
};

const dashboardLocalPlugin = {
  rules: { "no-raw-api-literal": noRawApiLiteralRule },
};

export default [
  {
    // reason: matched broadly (not scoped to `src/**`) so the SAME production
    // rule also applies to `tests/fixtures/eslint/*` when explicitly targeted
    // by the `lint:api-factory-fixture` script — the negative fixture must be
    // caught by the real rule, not a fixture-only reimplementation of it.
    // The `lint` script (`eslint src`) never walks `tests/`, so normal lint
    // stays clean regardless of this broader match.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "src/lib/project-api.ts",
      "node_modules/**",
      "dist/**",
      "src/routeTree.gen.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "dashboard-local": dashboardLocalPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "dashboard-local/no-raw-api-literal": "error",
      // reason: deliberately narrowed to the classic hooks-correctness pair
      // (not `reactHooks.configs.flat["recommended-latest"]`, which as of
      // v7 also bundles ~15 React-Compiler-derived rules — static-components,
      // purity, immutability, set-state-in-effect, etc. — that were never
      // evaluated against this codebase). Registering only these two closes
      // the pre-existing "Definition for rule 'react-hooks/exhaustive-deps'
      // was not found" gap (the plugin was never registered, so every
      // `// eslint-disable-next-line react-hooks/exhaustive-deps` comment in
      // this package failed to resolve) without adopting an unreviewed rule
      // set as a side effect.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
