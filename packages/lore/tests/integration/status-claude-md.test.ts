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
 * ─── Headroom reporting addendum (task-lore-status-check-claude-md-reports-
 * a-saturated-file-as) ───────────────────────────────────────────────────
 * RED baseline empirically confirmed against this worktree's pre-task HEAD
 * (`git stash` of the config.ts/claude-md-check.ts/status.ts implementation
 * diff, then a live `bunx vitest run` of this exact file): a fixture at
 * EXACTLY 5 bytes under the root byte ceiling (24571/24576 — the real
 * incident's own numbers) produced `--json` output whose `data.claude_md`
 * carried ONLY `{ findings: [] }` — no `headroom` key, no `warnings` key,
 * `--check-claude-md`'s non-JSON stdout printed the single line
 * `CLAUDE.md: within budget (0 findings).` with no margin shown anywhere.
 * The new scenarios below assert the FIXED behavior: `headroom` numbers on
 * every run (control-group scenario proves this stays silent-safe, never
 * "always warns"), a `headroom_warning` advisory once a metric crosses
 * `context.memory_files.warn_threshold_fraction`, exit code UNCHANGED (a
 * warning is never a breach), and that the threshold is read from config
 * (not a hardcoded fraction).
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

/**
 * A CLAUDE.md body of exactly `byteCount` UTF-8 bytes (via `Buffer.byteLength`)
 * and a small, ceiling-safe line count — pads the final line with single-byte
 * ASCII filler, mirroring `claude-md-headroom.test.ts`'s `buildFixture`. Used
 * to reproduce the incident's own exact numbers (24571/24576 bytes).
 */
function nByteBody(byteCount: number): string {
  const base = nLineBody(20);
  const baseBytes = Buffer.byteLength(base, "utf8");
  if (baseBytes > byteCount) {
    throw new Error(`nByteBody: base content (${baseBytes} bytes) already exceeds requested byteCount (${byteCount})`);
  }
  const deficit = byteCount - baseBytes;
  return base.slice(0, -1) + "x".repeat(deficit) + "\n";
}

interface HeadroomMetricJson {
  used: number;
  ceiling: number;
  remaining: number;
  warn: boolean;
}

interface HeadroomReportJson {
  path: string;
  role: string;
  lines: HeadroomMetricJson;
  bytes: HeadroomMetricJson;
}

interface CheckClaudeMdJson {
  data?: {
    claude_md?: {
      findings?: unknown[];
      headroom?: HeadroomReportJson[];
      warnings?: Array<{ kind: string; measured: number; message: string }>;
    };
  };
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

// ─── Scenario 5 (THE INCIDENT): fixture 5 bytes under the root ceiling ──────
// task-lore-status-check-claude-md-reports-a-saturated-file-as

describe("lore status --check-claude-md: headroom reporting (the incident fixture, 5 bytes remaining)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("headroom-incident");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("--json reports headroom.bytes.remaining=5, warn=true, and a headroom_warning — exit code stays 0 (not a breach)", () => {
    // Root byte ceiling default is 30720 (D3) — 5 bytes under it, mirroring
    // the exact reproduction (24571/24576 in the repo's own real ceiling).
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(30720 - 5));

    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;
    expect(parsed.data?.claude_md?.findings).toEqual([]);

    const headroom = parsed.data?.claude_md?.headroom ?? [];
    expect(headroom).toHaveLength(1);
    expect(headroom[0]?.path).toBe("CLAUDE.md");
    expect(headroom[0]?.bytes.used).toBe(30720 - 5);
    expect(headroom[0]?.bytes.ceiling).toBe(30720);
    expect(headroom[0]?.bytes.remaining).toBe(5);
    expect(headroom[0]?.bytes.warn).toBe(true);

    const warnings = parsed.data?.claude_md?.warnings ?? [];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.kind === "headroom_warning" && w.message.includes("CLAUDE.md"))).toBe(true);
  });

  it("non-JSON stdout names the remaining count and an approaching-ceiling advisory, without changing the exit code", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(30720 - 5));

    const result = runLore(["status", "--check-claude-md"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("5 remaining");
    expect(result.stdout.toLowerCase()).toContain("approaching ceiling");
  });
});

// ─── Scenario 6 (CONTROL): comfortably-small file -> zero warnings ─────────

describe("lore status --check-claude-md: headroom CONTROL (comfortably-small file never warns)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("headroom-control");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("--json reports headroom numbers but an EMPTY warnings array for a small, well-within-ceiling file", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(10));

    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;

    const headroom = parsed.data?.claude_md?.headroom ?? [];
    expect(headroom).toHaveLength(1);
    expect(headroom[0]?.bytes.warn).toBe(false);
    expect(headroom[0]?.lines.warn).toBe(false);
    expect(headroom[0]?.bytes.remaining).toBeGreaterThan(0);
    expect(headroom[0]?.lines.remaining).toBeGreaterThan(0);

    // The CONTROL assertion: the near-ceiling band must not degrade into
    // "always warns" — a comfortably-small file's warnings array is empty.
    expect(parsed.data?.claude_md?.warnings).toEqual([]);
  });
});

// ─── Scenario 7 (CONFIGURATION): warn_threshold_fraction is read from config,
// never hardcoded — proven in BOTH directions ─────────────────────────────

describe("lore status --check-claude-md: warn_threshold_fraction is a config knob, not a hardcoded number", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("headroom-config");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("a threshold raised to 0.999999 silences the warning on the incident fixture (99.98% used, below the raised threshold)", () => {
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".lore", "config.yaml"),
      "context:\n  memory_files:\n    warn_threshold_fraction: 0.999999\n",
    );
    writeFileSync(join(tmpDir, "CLAUDE.md"), nByteBody(30720 - 5));

    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;
    expect(parsed.data?.claude_md?.warnings).toEqual([]);
    // Headroom numbers themselves are still reported — only the warn flag moved.
    expect(parsed.data?.claude_md?.headroom?.[0]?.bytes.remaining).toBe(5);
  });

  it("a threshold lowered to 0.01 makes even the CONTROL (comfortably-small) fixture warn", () => {
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    writeFileSync(join(tmpDir, ".lore", "config.yaml"), "context:\n  memory_files:\n    warn_threshold_fraction: 0.01\n");
    writeFileSync(join(tmpDir, "CLAUDE.md"), nLineBody(10));

    const result = runLore(["status", "--check-claude-md", "--json"], tmpDir);

    expect(result.exitCode).toBe(0); // still advisory-only, never a breach
    const parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;
    expect((parsed.data?.claude_md?.warnings ?? []).length).toBeGreaterThan(0);
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
