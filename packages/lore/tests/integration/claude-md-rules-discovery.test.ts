// @spawns packages/lore/src/index.ts
/**
 * RED-phase tests for AC-RULES-1 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (N7/N8: a
 * third `MemoryFileRole` ("rules") plus `.claude/rules/**\/*.md` discovery
 * — the paired implementation task is a sibling in the same plan/phase).
 * ⛔ Bound by the spec's own coverage contract ("every WIRING/discovery AC
 * drives the CLI subprocess, never the unit function directly") — this
 * file never imports `discoverMemoryFiles` or `real-memory-file-probe.ts`;
 * every scenario spawns the real CLI (`lore status --check-claude-md
 * --json`) against a `mkdtemp` fixture and reads the JSON payload, mirroring
 * `claude-md-wiring.test.ts`'s established harness in this same directory.
 *
 * RED baseline, confirmed empirically against this worktree before writing
 * this file:
 *   - `MemoryFileRole` (`packages/lore/src/service/claude-md-findings.ts`)
 *     is `"root" | "module"` — no `"rules"` member exists yet.
 *   - `real-memory-file-probe.ts`'s `EXCLUDED_DIR_NAMES` contains a bare
 *     `".claude"` entry, matched by directory basename at ANY depth — the
 *     discovery walk never descends into `.claude/` at all, so
 *     `.claude/rules/**\/*.md` files are never found (not merely mis-roled).
 *   Together these mean `lore status --check-claude-md --json`'s
 *   `data.claude_md.headroom` array can never contain a `role: "rules"`
 *   entry today — every scenario below asserting one appears therefore
 *   fails on capability absence, not a test bug.
 *
 * ⛔ Two-condition trap this suite is written to catch (see this task's
 * dispatch context): a test asserting ONLY "rules files are found" would
 * ALSO pass if a broken fix deleted the `.claude` exclusion OUTRIGHT
 * instead of narrowing it — `.claude/worktrees/w/CLAUDE.md` would then be
 * discovered too (as a `role: "module"` match, since its basename is
 * "CLAUDE.md"), double-counting a worktree's own memory-file copies
 * against the SAME repo's budget, which is exactly what the existing
 * exclusion's own header says it exists to prevent. Every scenario in this
 * file therefore asserts BOTH halves together: rules files counted AND
 * zero headroom entries (of ANY role) whose path is sourced from
 * `.claude/worktrees/`.
 *
 * Coverage dimensions: HAPPY (the AC's own literal fixture: two rules files
 * plus a worktree CLAUDE.md copy, both conditions asserted together) /
 * NEGATIVE (no `.claude/rules/` directory at all yields zero `role:
 * "rules"` entries; an empty `.claude/rules/` directory yields zero,
 * without crashing) / BOUNDARY (three-level-deep nesting under
 * `.claude/rules/`; `paths:` YAML frontmatter present on one rules file,
 * absent on another — discovery must not choke on either) / ERROR (the
 * CLI never crashes and always emits parseable JSON across every fixture
 * below) / STATE (rules files coexist with a real root + module CLAUDE.md
 * without perturbing their own `role: "root"`/`role: "module"` headroom
 * entries or the exit code) / REGRESSION (the exact two-condition fixture
 * — rules counted AND worktree copies excluded — is the falsifiable
 * pairing the spec calls out by name).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-RULES-1
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup (mirrors tests/integration/claude-md-wiring.test.ts) ───────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── CLI subprocess harness (mirrors claude-md-wiring.test.ts verbatim) ────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — spawns the real CLI, same pattern as
 * `claude-md-wiring.test.ts`/`status-claude-md.test.ts`. `CLAUDECODE=1`
 * puts the surface into "agent" mode (AI default off) — irrelevant to this
 * deterministic, non-AI, corpus-free check (`--check-claude-md` dispatches
 * before `loadLoreApp`, spec §D9/N14), kept for parity with the repo's
 * established fixture convention.
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
  return mkdtempSync(join(tmpdir(), `lore-claude-md-rules-${label}-`));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ─── --json payload shape (deliberately partial — mirrors
// claude-md-wiring.test.ts's own convention: an assertion helper, never a
// mirror of HeadroomReport, which stays owned by the service layer) ───────

interface HeadroomEntryJson {
  path: string;
  role: string;
}

interface CheckClaudeMdJson {
  data?: {
    claude_md?: {
      headroom?: HeadroomEntryJson[];
    };
  };
}

function runCheckClaudeMdJson(cwd: string): { result: RunResult; parsed: CheckClaudeMdJson } {
  const result = runLore(["status", "--check-claude-md", "--json"], cwd);
  let parsed: CheckClaudeMdJson;
  try {
    parsed = JSON.parse(result.stdout) as CheckClaudeMdJson;
  } catch (error) {
    throw new Error(
      `--check-claude-md --json produced non-JSON stdout (exit ${result.exitCode}): ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return { result, parsed };
}

function headroomEntries(parsed: CheckClaudeMdJson): HeadroomEntryJson[] {
  return parsed.data?.claude_md?.headroom ?? [];
}

function rulesEntries(parsed: CheckClaudeMdJson): HeadroomEntryJson[] {
  return headroomEntries(parsed).filter((h) => h.role === "rules");
}

/** Zero entries (of ANY role) whose path is sourced from `.claude/worktrees/` — the double-count guard. */
function worktreeSourcedEntries(parsed: CheckClaudeMdJson): HeadroomEntryJson[] {
  return headroomEntries(parsed).filter((h) => h.path.includes(".claude/worktrees"));
}

// ─── Fixture builders ───────────────────────────────────────────────────────

/** One `.claude/rules/a.md` WITH `paths:` YAML frontmatter (BOUNDARY: frontmatter present). */
function writeRulesFileWithFrontmatter(tmpDir: string): void {
  mkdirSync(join(tmpDir, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".claude", "rules", "a.md"),
    "---\npaths:\n  - \"src/**/*.ts\"\n---\n# Example path-scoped rule\n\nApplies only under src/.\n",
  );
}

/** One `.claude/rules/nested/b.md` WITHOUT frontmatter (BOUNDARY: frontmatter absent, one level of nesting). */
function writeRulesFileWithoutFrontmatter(tmpDir: string): void {
  mkdirSync(join(tmpDir, ".claude", "rules", "nested"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".claude", "rules", "nested", "b.md"),
    "# Nested rule (no frontmatter)\n\nApplies to every session — no `paths:` scoping block.\n",
  );
}

/** A worktree's own CLAUDE.md copy under `.claude/worktrees/` — must NEVER be counted. */
function writeWorktreeClaudeMdCopy(tmpDir: string): void {
  mkdirSync(join(tmpDir, ".claude", "worktrees", "w"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".claude", "worktrees", "w", "CLAUDE.md"),
    "# Worktree copy\n\nThis is a linked worktree's own memory file and must not be double-counted.\n",
  );
}

// ─── AC-RULES-1's own literal fixture ───────────────────────────────────────

describe("rules discovery — counted while worktree copies stay excluded", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("happy");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("HAPPY + REGRESSION: exactly two role:'rules' headroom entries, zero entries sourced from .claude/worktrees/ (the AC's own literal fixture)", () => {
    writeRulesFileWithFrontmatter(tmpDir);
    writeRulesFileWithoutFrontmatter(tmpDir);
    writeWorktreeClaudeMdCopy(tmpDir);

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(rulesEntries(parsed)).toHaveLength(2);
    expect(worktreeSourcedEntries(parsed)).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("BOUNDARY: identifies the exact two rules files by path, not merely a count (a.md and nested/b.md)", () => {
    writeRulesFileWithFrontmatter(tmpDir);
    writeRulesFileWithoutFrontmatter(tmpDir);
    writeWorktreeClaudeMdCopy(tmpDir);

    const { parsed } = runCheckClaudeMdJson(tmpDir);

    const paths = rulesEntries(parsed)
      .map((h) => h.path)
      .sort();
    expect(paths).toEqual([".claude/rules/a.md", ".claude/rules/nested/b.md"].sort());
  });

  it("BOUNDARY: discovers a rules file nested three levels deep", () => {
    mkdirSync(join(tmpDir, ".claude", "rules", "deep", "nesting", "here"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".claude", "rules", "deep", "nesting", "here", "c.md"),
      "# Deeply nested rule\n",
    );
    writeWorktreeClaudeMdCopy(tmpDir);

    const { parsed } = runCheckClaudeMdJson(tmpDir);

    expect(rulesEntries(parsed).map((h) => h.path)).toContain(".claude/rules/deep/nesting/here/c.md");
    expect(worktreeSourcedEntries(parsed)).toHaveLength(0);
  });

  it("NEGATIVE: no .claude/rules/ directory at all yields zero role:'rules' entries (discovery invents nothing)", () => {
    writeWorktreeClaudeMdCopy(tmpDir);

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(rulesEntries(parsed)).toHaveLength(0);
    expect(worktreeSourcedEntries(parsed)).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("ERROR (no crash): an empty .claude/rules/ directory yields zero entries and valid JSON", () => {
    mkdirSync(join(tmpDir, ".claude", "rules"), { recursive: true });

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(rulesEntries(parsed)).toHaveLength(0);
  });

  it("STATE: rules files coexist with a real root AND module CLAUDE.md without perturbing their own role entries or the exit code", () => {
    writeFileSync(
      join(tmpDir, "CLAUDE.md"),
      ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
        .map((name) => `## ${name}\n\nStanding discipline only.\n`)
        .join("\n"),
    );
    mkdirSync(join(tmpDir, "packages", "widget"), { recursive: true });
    writeFileSync(
      join(tmpDir, "packages", "widget", "CLAUDE.md"),
      "# Module memory file\n\nStanding discipline only.\n",
    );
    writeRulesFileWithFrontmatter(tmpDir);
    writeRulesFileWithoutFrontmatter(tmpDir);
    writeWorktreeClaudeMdCopy(tmpDir);

    const { result, parsed } = runCheckClaudeMdJson(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(rulesEntries(parsed)).toHaveLength(2);
    expect(headroomEntries(parsed).filter((h) => h.role === "root")).toHaveLength(1);
    expect(headroomEntries(parsed).filter((h) => h.role === "module")).toHaveLength(1);
    expect(worktreeSourcedEntries(parsed)).toHaveLength(0);
  });
});
