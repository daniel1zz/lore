/**
 * Vite alias entries and a mock-redirect plugin that route `fs`, `fs/promises` and `child_process` (with or without the `node:`
 * prefix) to the recorder wrappers (task-skill-implement-tg-13, AC-TG-7).
 *
 * Purpose: single place that names the alias targets; consumed by vitest.shared.ts `createConfig`.
 * Why an alias and not a monkey patch: see the Mechanism paragraph of scripts/test-read-log.ts.
 * `vi.mock("node:fs")` and its siblings are keyed by the builtin's own name, while an aliased import
 * resolves to the wrapper file (measured: with the alias alone the mock never applies, in both the
 * static and the dynamic import form). `readRecorderMockRedirect` rewrites the literal module name in
 * `vi.mock` / `vi.doMock` / `vi.unmock` / `vi.doUnmock` calls to the wrapper path so mock and import agree
 * (one test mocks node:fs today: tests/integration/cli-stdout-truncation.test.ts).
 * Public surface: readRecorderAliases, readRecorderMockRedirect, RECORDED_MODULES. Side-effect class: pure.
 */
import { join } from "node:path";

/** The modules the recorder wraps, as the bare names tests and repo code import them by. */
export const RECORDED_MODULES = [
  { name: "fs", wrapper: "scripts/test-recorded-fs.ts" },
  { name: "fs/promises", wrapper: "scripts/test-recorded-fs-promises.ts" },
  { name: "child_process", wrapper: "scripts/test-recorded-child-process.ts" },
] as const;

/** Alias entries (regex `find`, absolute `replacement`) for `resolve.alias`, rooted at `repoRoot`. */
export function readRecorderAliases(repoRoot: string): { find: RegExp; replacement: string }[] {
  return RECORDED_MODULES.map(({ name, wrapper }) => ({
    find: new RegExp(`^(?:node:)?${name.replace("/", "\\/")}$`),
    replacement: join(repoRoot, wrapper),
  }));
}

const MOCK_CALL_RE = /\bvi\.(mock|doMock|unmock|doUnmock)\(\s*(["'])(?:node:)?(fs|fs\/promises|child_process)\2/g;

/** A vite plugin (structurally typed; no vite import needed) that points `vi.mock("node:fs")`-style calls at the recorder wrapper. */
export function readRecorderMockRedirect(repoRoot: string): {
  name: string;
  enforce: "pre";
  transform: (code: string) => { code: string; map: null } | null;
} {
  const wrapperByName = new Map<string, string>(RECORDED_MODULES.map(({ name, wrapper }) => [name, join(repoRoot, wrapper)]));
  return {
    name: "lore-read-recorder-mock-redirect",
    enforce: "pre",
    transform(code) {
      if (!code.includes("vi.") || !MOCK_CALL_RE.test(code)) return null;
      MOCK_CALL_RE.lastIndex = 0;
      const rewritten = code.replace(MOCK_CALL_RE, (_match, fn: string, quote: string, name: string) => {
        const wrapper = wrapperByName.get(name);
        if (wrapper === undefined) throw new Error(`readRecorderMockRedirect: no wrapper registered for "${name}"`);
        return `vi.${fn}(${quote}${wrapper}${quote}`;
      });
      return { code: rewritten, map: null };
    },
  };
}
