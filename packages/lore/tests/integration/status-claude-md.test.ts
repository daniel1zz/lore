/**
 * RED-phase TDD tests for `lore status --check-claude-md` (SPEC-project-claude-md-
 * content-contract, task-skill-implement-lore-status-check-claude-md-config-only —
 * the paired implementation task; this file is the paired RED test).
 *
 * The flag does NOT exist yet on `lore status` — no source change for it has
 * landed in this worktree (confirmed empirically: `packages/lore/src/service/
 * claude-md-check.ts` does not exist, and `@lore/core`'s `config.ts` declares no
 * `contextConfigSchema`/`memory_files` key as of this file's authoring).
 *
 * Current failure mode (before impl), confirmed empirically against this
 * worktree's `src/index.ts` before writing this file:
 *   `lore status --check-claude-md` → SPEC-051/073's strict-flag seam rejects the
 *   undeclared flag BEFORE `status.ts`'s run handler is ever reached:
 *     stderr: "Error: Unknown option: --check-claude-md"
 *     exit code: 2
 *   This is uniform across every fixture below (oversized/conformant/disabled-
 *   via-config) — every scenario therefore currently fails on the SAME
 *   discriminator (exit 2, not the SPEC-required 0/3), which is the intended RED
 *   signal for this file. Assertions below target the SPEC-required FUTURE
 *   behavior (per the spec's Module Boundary + D3 defaults: root 300 lines /
 *   30720 bytes; `context.memory_files.enabled: false` disables the check
 *   entirely), not the current exit-2 baseline — so this suite is RED now and
 *   GREEN once the paired implementation task lands.
 *
 * Module Boundary invariant (spec `## Module Boundary`, Invariant 2 — "No
 * store/DB dependency anywhere in the check path"): `lore status --check-claude-md`
 * must run in a directory with NO `.lore/` at all (proven by scenario 1) and must
 * still work when `.lore/` exists as a bare config file with no SQLite DB
 * (proven by scenario 3) — i.e. it must NEVER reach `loadLoreApp`/`bun:sqlite`.
 * That structural invariant is pinned independently at the source-file level in
 * the last `describe` block below (import-graph walk over the future
 * `packages/lore/src/service/claude-md-check.ts` module), mirroring this repo's
 * existing import-graph oracle convention (see
 * `packages/lore/tests/unit/core/barrel-isolation.test.ts`).
 *
 * Coverage dimensions exercised: HAPPY (conformant → exit 0) / BOUNDARY (root
 * ceiling breach → exit 3, finding names the file) / STATE (config disables the
 * check without touching content) / STRUCTURAL (import-graph never reaches the
 * DB layer).
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";

// ─── Path setup (mirrors tests/integration/cli/check-tree.test.ts) ─────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const LORE_SRC = join(PACKAGE_ROOT, "src");
const CLAUDE_MD_CHECK_MODULE = join(LORE_SRC, "service", "claude-md-check.ts");

// ─── RunResult type ───────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — spawns the real CLI, same pattern as check-tree.test.ts /
 * prd-budget-check.bun.test.ts. `CLAUDECODE=1` puts the surface into "agent"
 * mode (AI default off) — irrelevant to this deterministic, non-AI check, kept
 * for parity with the repo's established fixture convention.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      EDITOR: "true",
      CLAUDECODE: "1",
    },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lore-status-claude-md-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** A CLAUDE.md body of exactly `lineCount` non-empty lines (root ceiling is 300 lines, D3). */
function nLineBody(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    lines.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  }
  return lines.join("\n") + "\n";
}

// ─── Scenario 1 (BOUNDARY): oversized CLAUDE.md, NO .lore/ — corpus-less ────

describe("lore status --check-claude-md: corpus-less operation (no .lore/ at all)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("oversized-corpusless");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 3 and the finding names CLAUDE.md when the root file breaches the 300-line ceiling, with NO .lore/ present", () => {
    // Deliberately proves corpus-less operation: no `lore init` was ever run in
    // this fixture — no .lore/ directory, no DB, nothing.
    expect(existsSync(join(tmpDir, ".lore"))).toBe(false);

    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(400));

    const result = runLore(["status", "--check-claude-md"], tmpDir);

    expect(result.exitCode).toBe(3);
    const output = (result.stdout + result.stderr).toLowerCase();
    expect(output).toContain("claude.md");
  });
});

// ─── Scenario 2 (HAPPY): conformant temp repo — exit 0, zero findings ──────

describe("lore status --check-claude-md: conformant fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("conformant");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 0 and reports zero findings for a small, well-within-ceiling CLAUDE.md", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(10));

    const result = runLore(["status", "--check-claude-md"], tmpDir);

    expect(result.exitCode).toBe(0);
  });

  it("--json reports an empty findings array on the conformant fixture", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(10));

    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data?: { claude_md?: { findings?: unknown[] } };
    };
    expect(parsed.data?.claude_md?.findings).toEqual([]);
  });
});

// ─── Scenario 3 (STATE): context.memory_files.enabled: false, .lore/ WITHOUT a DB ──

describe("lore status --check-claude-md: disabled via context.memory_files.enabled=false (config-only .lore/, no DB)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("disabled-config-only");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("exits 0 when the config disables the check, even though the CLAUDE.md file itself breaches the ceiling", () => {
    // .lore/ exists as a BARE config file — deliberately no `lore init`, no
    // .lore/lore.db. If the check-claude-md branch ever touched loadLoreApp/
    // the store, this fixture would surface that as a crash/wrong-exit-code
    // rather than the SPEC-required exit 0.
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".lore", "config.yaml"),
      "context:\n  memory_files:\n    enabled: false\n",
    );
    expect(existsSync(join(tmpDir, ".lore", "lore.db"))).toBe(false);

    // Deliberately oversized — proves the config knob suppresses the check
    // rather than the fixture happening to already be compliant.
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(400));

    const result = runLore(["status", "--check-claude-md"], tmpDir);

    expect(result.exitCode).toBe(0);
  });
});

// ─── Scenario 4 (STRUCTURAL): Module Boundary Invariant 2 import-graph pin ──

/** Matches `from "specifier"` / `from 'specifier'` in `import`/`export * from` statements. */
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s+["']([^"']+)["']/g;

/**
 * Recursively collects the transitive closure of RELATIVE-import source files
 * reachable from `entryFile` within `packages/lore/src`, plus the set of every
 * BARE (non-relative) import specifier encountered anywhere in that closure.
 * Mirrors `packages/lore/tests/unit/core/barrel-isolation.test.ts`'s
 * `collectImportClosure` (same "intra-package relative specifiers always end
 * in .js and map 1:1 to a .ts source file" convention, documented in this
 * package's root CLAUDE.md under "Import style (monorepo)").
 */
function collectImportClosure(entryFile: string): {
  visitedFiles: Set<string>;
  bareSpecifiers: Set<string>;
} {
  const visitedFiles = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const stack = [entryFile];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visitedFiles.has(file)) continue;
    if (!existsSync(file)) {
      throw new Error(`claude-md-check import-graph scan: cannot resolve import target "${file}"`);
    }
    visitedFiles.add(file);

    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1]!;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const resolved = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
        stack.push(resolved);
      } else {
        bareSpecifiers.add(specifier);
      }
    }
  }

  return { visitedFiles, bareSpecifiers };
}

describe("Module Boundary Invariant 2: claude-md-check.ts never reaches loadLoreApp/bun:sqlite", () => {
  it("packages/lore/src/service/claude-md-check.ts exists (RED until the paired implement task lands)", () => {
    expect(existsSync(CLAUDE_MD_CHECK_MODULE)).toBe(true);
  });

  it("its transitive import closure never reaches bun:sqlite", () => {
    const { bareSpecifiers } = collectImportClosure(CLAUDE_MD_CHECK_MODULE);
    expect(bareSpecifiers.has("bun:sqlite")).toBe(false);
  });

  it("its transitive import closure never includes adapters/cli/loader.ts (the loadLoreApp module)", () => {
    const { visitedFiles } = collectImportClosure(CLAUDE_MD_CHECK_MODULE);
    const relativePaths = [...visitedFiles].map((f) => f.replace(LORE_SRC + "/", ""));
    expect(relativePaths).not.toContain("adapters/cli/loader.ts");
  });
});
