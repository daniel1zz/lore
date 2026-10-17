// @reads packages/core/src/index.ts
// @reads packages/core/src/node.ts
// @reads packages/dashboard/vite.config.ts
// @reads packages/lore/tsconfig.json
// @reads tsconfig.base.json
// @reads vitest.shared.ts
// @reads workspace-aliases.ts
/**
 * task-skill-implement-tg-20-worktrees-resolve-their-own-lore.
 *
 * A git worktree under `<main>/.claude/worktrees/agent-*` has NO node_modules, so a bare
 * `@lore/core` import walks up to the MAIN checkout's `node_modules/@lore/core` (a symlink to
 * main's `packages/core`). A worktree that changed `packages/core` was then silently tested
 * against main's core. This suite builds that exact topology in a throwaway repo (mkdtemp, never
 * the real repo), changes a marker export in the worktree's own packages/core, and proves every
 * runner sees the WORKTREE's marker:
 *   bun runtime, `bun test`, vitest (aliases from the real workspace-aliases.ts), tsc, bun bundler.
 *
 * The config under test is the REAL `tsconfig.base.json`, `packages/lore/tsconfig.json` and
 * `workspace-aliases.ts`, copied byte-for-byte into the fixture. The negative control builds the
 * same topology with the workspace `paths` stripped (today's pre-fix setup) and proves the same
 * runners then DO see main's marker — so a green run here cannot be a harness that sees nothing.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAIN_MARKER = "LORE_MARKER_FROM_MAIN_CHECKOUT";
const WORKTREE_MARKER = "LORE_MARKER_FROM_WORKTREE";
const TEST_BUDGET_MS = 120_000;

/** Directory holding the installed third-party packages (vitest, typescript, bun-types...). */
function realNodeModules(): string {
  const vitestPackageJson = createRequire(import.meta.url).resolve("vitest/package.json");
  return dirname(dirname(vitestPackageJson));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function run(cwd: string, command: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 100_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

interface Fixture {
  readonly tmpRoot: string;
  readonly worktree: string;
  readonly loreDir: string;
}

/** A temp main checkout (with an installed-looking node_modules) plus an agent worktree of it. */
function buildFixture(options: { readonly keepWorkspacePaths: boolean }): Fixture {
  const tmpRoot = mkdtempSync(join(tmpdir(), "lore-wt-resolution-"));
  const main = join(tmpRoot, "main");
  mkdirSync(main);

  // Real config under test, copied verbatim (except the control's stripped paths).
  const baseConfig = JSON.parse(readFileSync(join(REAL_ROOT, "tsconfig.base.json"), "utf8")) as {
    compilerOptions: { paths?: unknown };
  };
  if (!options.keepWorkspacePaths) delete baseConfig.compilerOptions.paths;
  write(join(main, "tsconfig.base.json"), JSON.stringify(baseConfig, null, 2));
  write(join(main, "workspace-aliases.ts"), readFileSync(join(REAL_ROOT, "workspace-aliases.ts"), "utf8"));
  write(join(main, "packages/lore/tsconfig.json"), readFileSync(join(REAL_ROOT, "packages/lore/tsconfig.json"), "utf8"));

  write(join(main, "package.json"), JSON.stringify({ name: "fixture", private: true, type: "module", workspaces: ["packages/*"] }));
  write(
    join(main, "packages/core/package.json"),
    JSON.stringify({ name: "@lore/core", type: "module", main: "src/index.ts", exports: { ".": "./src/index.ts", "./node": "./src/node.ts" } }),
  );
  write(join(main, "packages/core/src/index.ts"), `export const MARKER = "${MAIN_MARKER}";\n`);
  write(join(main, "packages/core/src/node.ts"), `export const NODE_MARKER = "${MAIN_MARKER}";\n`);
  write(join(main, "packages/lore/package.json"), JSON.stringify({ name: "@lore/lore", type: "module" }));
  write(
    join(main, "packages/lore/src/probe.ts"),
    `import { MARKER } from "@lore/core";\nimport { NODE_MARKER } from "@lore/core/node";\nconsole.log("SEEN=" + MARKER + "," + NODE_MARKER);\n`,
  );
  write(
    join(main, "packages/lore/src/typed.ts"),
    // tsc oracle: exits 0 only when the resolved @lore/core exports the WORKTREE literal type.
    `import { MARKER } from "@lore/core";\nexport const typed: "${WORKTREE_MARKER}" = MARKER;\n`,
  );
  write(
    join(main, "packages/lore/tests/seen.bun.test.ts"),
    `import { test } from "bun:test";\nimport { MARKER } from "@lore/core";\ntest("seen", () => { console.log("SEEN=" + MARKER); });\n`,
  );
  write(
    join(main, "packages/lore/tests/seen.test.ts"),
    `import { test } from "vitest";\nimport { MARKER } from "@lore/core";\ntest("seen", () => { console.log("SEEN=" + MARKER); });\n`,
  );
  write(
    join(main, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";\nimport { fileURLToPath } from "node:url";\nimport { workspaceAliases } from "./workspace-aliases";\n` +
      `export default defineConfig({ resolve: { alias: workspaceAliases(fileURLToPath(new URL(".", import.meta.url))) } });\n`,
  );
  // The control must not import the (fail-loud) alias module; it is today's alias-free config.
  if (!options.keepWorkspacePaths) {
    write(join(main, "vitest.config.ts"), `import { defineConfig } from "vitest/config";\nexport default defineConfig({});\n`);
  }
  write(join(main, ".gitignore"), "node_modules\n");

  // "bun install" topology: third-party symlinked, @lore/* relative links into MAIN's packages.
  const nodeModules = join(main, "node_modules");
  mkdirSync(join(nodeModules, "@lore"), { recursive: true });
  for (const entry of readdirSync(realNodeModules())) {
    if (entry === "@lore") continue;
    symlinkSync(join(realNodeModules(), entry), join(nodeModules, entry));
  }
  symlinkSync("../../packages/core", join(nodeModules, "@lore", "core"));
  symlinkSync("../../packages/lore", join(nodeModules, "@lore", "lore"));

  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  git(main, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixture"]);
  const worktree = join(main, ".claude", "worktrees", "agent-fixture");
  git(main, ["worktree", "add", "-q", "-b", "wt", worktree]);

  // The change under test: only the worktree's own packages/core differs.
  write(join(worktree, "packages/core/src/index.ts"), `export const MARKER = "${WORKTREE_MARKER}";\n`);
  write(join(worktree, "packages/core/src/node.ts"), `export const NODE_MARKER = "${WORKTREE_MARKER}";\n`);
  expect(existsSync(join(worktree, "node_modules"))).toBe(false);
  return { tmpRoot, worktree, loreDir: join(worktree, "packages/lore") };
}

function runners(fixture: Fixture): Record<string, () => { status: number | null; output: string }> {
  const nm = realNodeModules();
  return {
    "bun run (runtime)": () => run(fixture.loreDir, "bun", ["run", "src/probe.ts"]),
    "bun test": () => run(fixture.loreDir, "bun", ["test", "tests/seen.bun.test.ts"]),
    vitest: () =>
      run(fixture.worktree, process.execPath, [join(nm, "vitest/vitest.mjs"), "run", "packages/lore/tests/seen.test.ts"]),
    "tsc (tsconfig paths)": () => run(fixture.worktree, process.execPath, [join(nm, "typescript/bin/tsc"), "--noEmit", "-p", "packages/lore/tsconfig.json"]),
    "bun build (bundler)": () => {
      const outFile = join(fixture.tmpRoot, "bundle.js");
      const built = run(fixture.loreDir, "bun", ["build", "src/probe.ts", "--target=bun", `--outfile=${outFile}`]);
      return { status: built.status, output: `${built.output}${existsSync(outFile) ? readFileSync(outFile, "utf8") : ""}` };
    },
  };
}

describe("worktree resolves @lore/* to its own packages (fix in place)", () => {
  let fixture: Fixture;
  beforeAll(() => {
    fixture = buildFixture({ keepWorkspacePaths: true });
  }, TEST_BUDGET_MS);
  afterAll(() => {
    if (fixture !== undefined) rmSync(fixture.tmpRoot, { recursive: true, force: true });
  });

  for (const name of ["bun run (runtime)", "bun test", "vitest", "bun build (bundler)"]) {
    it(`AC-TG20 ${name} sees the worktree's marker and never main's`, () => {
      const result = runners(fixture)[name]!();
      expect(result.output).toContain(WORKTREE_MARKER);
      expect(result.output).not.toContain(MAIN_MARKER);
      expect(result.status).toBe(0);
    }, TEST_BUDGET_MS);
  }

  it("AC-TG20 tsc type-checks the worktree's @lore/core (exit 0 only when the worktree's literal type is seen)", () => {
    const result = runners(fixture)["tsc (tsconfig paths)"]!();
    expect(result.output).not.toContain("TS2322");
    expect(result.status).toBe(0);
  }, TEST_BUDGET_MS);
});

describe("negative control: without workspace paths a worktree silently reads main (today's setup)", () => {
  let fixture: Fixture;
  beforeAll(() => {
    fixture = buildFixture({ keepWorkspacePaths: false });
  }, TEST_BUDGET_MS);
  afterAll(() => {
    if (fixture !== undefined) rmSync(fixture.tmpRoot, { recursive: true, force: true });
  });

  for (const name of ["bun run (runtime)", "bun test", "vitest", "bun build (bundler)"]) {
    it(`control ${name} sees MAIN's marker (the defect the fix removes)`, () => {
      const result = runners(fixture)[name]!();
      expect(result.output).toContain(MAIN_MARKER);
      expect(result.output).not.toContain(WORKTREE_MARKER);
    }, TEST_BUDGET_MS);
  }

  it("control tsc fails because it type-checks against main's core", () => {
    const result = runners(fixture)["tsc (tsconfig paths)"]!();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("TS2322");
  }, TEST_BUDGET_MS);
});

describe("the real checkout wires the same resolution", () => {
  it("tsconfig.base.json declares @lore/core and @lore/core/node paths that exist", () => {
    const base = JSON.parse(readFileSync(join(REAL_ROOT, "tsconfig.base.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    for (const specifier of ["@lore/core", "@lore/core/node"]) {
      const target = base.compilerOptions.paths[specifier]?.[0];
      expect(target, specifier).toBeDefined();
      expect(existsSync(resolve(REAL_ROOT, target!)), `${specifier} -> ${target}`).toBe(true);
    }
  });

  it("every vite/vitest config that resolves @lore/* derives it from workspaceAliases", () => {
    // vitest.shared.ts holds the one config body (TG-23); vitest.config.ts / vitest.node.config.ts only pick files.
    for (const config of ["vitest.shared.ts", "packages/dashboard/vite.config.ts"]) {
      expect(readFileSync(join(REAL_ROOT, config), "utf8"), config).toContain("workspaceAliases(");
    }
  });
});
