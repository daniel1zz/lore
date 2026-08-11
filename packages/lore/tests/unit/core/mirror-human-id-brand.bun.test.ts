/**
 * AC-MIS-6 negative control (SPEC-mirror-identifier-ssot D3) — proves the
 * `MirrorHumanId` nominal brand (`packages/core/src/ordinal.ts`) actually bites
 * at COMPILE time, not merely that `bun run typecheck` happens to exit 0 today.
 *
 * Every case here drives this checkout's OWN pinned `typescript` compiler
 * (`<repo>/node_modules/.bin/tsc`, resolved via `import.meta.url` — never
 * `process.cwd()`, so the test is CWD-independent, and never `bunx tsc`, which
 * downloads its own TypeScript into a temp lockfile and can silently measure a
 * DIFFERENT version than the one this repo actually compiles with — exactly the
 * mistake this AC's own text was corrected for, 2026-08-11, citing
 * `node_modules/typescript/lib/_tsc.js`) against a fresh, ISOLATED `mkdtemp`
 * project — its own `tsconfig.json` + `src/` — so a broken fixture `.ts` file
 * NEVER lands inside any real typechecked glob (`scripts/**`,
 * `packages/*​/src/**`, `packages/lore/tests/**`), which would redden every
 * concurrent `bun run typecheck` in this checkout for the duration of the test.
 *
 * Measured directly against this repo's `tsc` 5.9.3 before writing the
 * assertions below (probe transcript, 2026-08-11): under the `--noEmit: true`
 * shape `bun run typecheck` actually uses, BOTH a genuine `TS2322` type error
 * AND an empty-`include` `TS18003` config fatal exit **2** — there is no
 * exit-1 case in this compiler configuration. That makes an exit-code
 * comparison alone unable to distinguish "the compiler checked the fixture and
 * found the brand violation" from "the compiler never checked anything" — the
 * discriminator is the ERROR CODE IN THE OUTPUT, so every violation case below
 * asserts BOTH the exit code AND the specific `TSxxxx` token (plus the reverse
 * control: an empty-include project exits 2 too, but with `TS18003` and
 * explicitly WITHOUT `TS2322`, proving the two are actually distinguishable and
 * not merely two names for the same thing).
 *
 * Coverage:
 *   HAPPY   — a brand-safe fixture (the branded value is produced via a
 *     properly-typed helper, never a bare string literal) compiles clean
 *     (exit 0) — the control proving the isolated project setup itself is not
 *     inherently broken, so the violation case below is attributable to the
 *     plain-string assignment and nothing else.
 *   NEGATIVE — assigning a plain `string` literal to the branded type is a
 *     genuine `TS2322`, exit exactly 2, output naming both `TS2322` and
 *     `MirrorHumanId`.
 *   BOUNDARY/REVERSE CONTROL — an empty-`include` project is ALSO exit 2, but
 *     with `TS18003` and NOT `TS2322` — proving the assertion above is
 *     discriminating a real detection from a config-level fatal, not just
 *     echoing "exit 2" twice.
 *   ERROR — a config-fatal project's stdout+stderr is asserted to be genuinely
 *     absent of the violation token, never merely "didn't check for it."
 *   STATE — the violation fixture is written fresh per test (mkdtemp,
 *     cleaned up in `afterEach`) — no shared mutable fixture between cases.
 *   REGRESSION — the exact exit code (2, not "truthy"/"nonzero") is pinned,
 *     so a future TypeScript upgrade that changes this compiler's `--noEmit`
 *     exit-code contract fails this test loudly instead of the assertion
 *     silently degrading to "any error".
 *
 * @spec_ref SPEC-mirror-identifier-ssot D3, D6 (AC-MIS-6); task-make-mirrorhumanid-a-nominal-type-on
 */

import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// packages/lore/tests/unit/core -> repo root is 5 levels up (mirrors
// barrel-isolation.test.ts's "-> packages/core/src (4 levels up + core/src)"
// sibling comment in this same directory).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");

/** Exit codes measured directly against this repo's own pinned tsc (2026-08-11 probe). */
const EXIT_CHECKED = 2; // both a real TS2322 AND a config-fatal TS18003 land here under --noEmit
const TS2322 = "TS2322";
const TS18003 = "TS18003";
const BRAND_TYPE_NAME = "MirrorHumanId";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh, empty mkdtemp directory this test owns and cleans up. */
function makeScratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mirror-human-id-brand-"));
  scratchDirs.push(dir);
  return dir;
}

/** The same `--noEmit`/`strict` shape `bun run typecheck`'s per-package tsconfigs use. */
const BASE_COMPILER_OPTIONS = {
  target: "ESNext",
  module: "ESNext",
  moduleResolution: "bundler",
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

/**
 * Writes an isolated, self-contained TypeScript project (own `tsconfig.json` +
 * `src/index.ts`) and returns its absolute root. `srcBody` is the ENTIRE
 * contents of `src/index.ts` — the caller supplies the brand declaration
 * itself, so each case controls exactly what the compiler sees.
 *
 * @param srcBody - full text of `src/index.ts`.
 * @param includeGlob - `tsconfig.json`'s `include` array; a glob matching
 *   nothing (never a literal `[]`, which some tsc versions treat differently)
 *   is what the reverse-control case uses to force `TS18003`.
 */
function makeIsolatedProject(srcBody: string, includeGlob: string[] = ["src/**/*.ts"]): string {
  const root = makeScratchDir();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), srcBody, "utf8");
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: BASE_COMPILER_OPTIONS, include: includeGlob }, null, 2),
    "utf8",
  );
  return root;
}

/** Runs THIS repo's own pinned `tsc -p <root>/tsconfig.json` and returns `{status, output}`. */
function runTsc(projectRoot: string): { status: number | null; output: string } {
  const result = spawnSync(TSC_BIN, ["-p", join(projectRoot, "tsconfig.json")], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** The branded type declaration under test — mirrors `packages/core/src/ordinal.ts`'s
 *  `MirrorHumanId` shape (a `unique symbol`-tagged phantom property) without importing
 *  that module (an isolated mkdtemp project can't resolve workspace packages). */
const BRAND_DECLARATION = `type ${BRAND_TYPE_NAME} = string & { readonly __mirrorHumanIdBrand: unique symbol };\n`;

describe("MirrorHumanId brand — compile-time negative control (AC-MIS-6)", () => {
  it("HAPPY (control): a brand-safe fixture — narrowed via a typed helper, never a bare string literal — compiles clean (exit 0)", () => {
    const src =
      `${BRAND_DECLARATION}` +
      `function brand(value: string): ${BRAND_TYPE_NAME} {\n` +
      `  return value as ${BRAND_TYPE_NAME};\n` +
      `}\n` +
      `const ok: ${BRAND_TYPE_NAME} = brand("SPEC-021");\n` +
      `console.log(ok);\n`;
    const root = makeIsolatedProject(src);
    const { status, output } = runTsc(root);

    // Control: proves the isolated project SETUP itself is not inherently broken —
    // if this failed, the NEGATIVE case below would be unattributable.
    expect(status).toBe(0);
    expect(output).not.toContain(TS2322);
  });

  it("NEGATIVE: assigning a plain string literal to MirrorHumanId is TS2322 at exit EXACTLY 2, naming the brand", () => {
    const src = `${BRAND_DECLARATION}const bad: ${BRAND_TYPE_NAME} = "SPEC-021";\nconsole.log(bad);\n`;
    const root = makeIsolatedProject(src);
    const { status, output } = runTsc(root);

    expect(status).toBe(EXIT_CHECKED); // exactly 2, not "truthy" — see module header
    expect(output).toContain(TS2322);
    expect(output).toContain(BRAND_TYPE_NAME);
  });

  it("REVERSE CONTROL: an empty-include project is ALSO exit 2, but with TS18003 and explicitly WITHOUT TS2322 — proving exit 2 alone cannot discriminate a real detection from a config fatal", () => {
    const root = makeIsolatedProject(`${BRAND_DECLARATION}`, ["nonexistent/**/*.ts"]);
    const { status, output } = runTsc(root);

    expect(status).toBe(EXIT_CHECKED); // same exit code as the NEGATIVE case above
    expect(output).toContain(TS18003);
    expect(output).not.toContain(TS2322); // the discriminating fact this AC exists to pin
  });

  it("ERROR: the reverse control's output never mentions the brand name either — a fatal never partially checked the fixture", () => {
    const root = makeIsolatedProject(`${BRAND_DECLARATION}`, ["nonexistent/**/*.ts"]);
    const { output } = runTsc(root);
    expect(output).not.toContain(BRAND_TYPE_NAME);
  });
});
