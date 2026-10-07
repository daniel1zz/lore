/**
 * RED-phase real-binary pre-push trip for the root CLAUDE.md section-structure
 * check (`spec-claude-md-root-section-structure-check-and-adoption-mode`
 * AC-STR-3; task `task-skill-test-contract-section-parity-real-binary-pre-push`).
 *
 * Drives `assets/project/pre-push` (the SHIPPING copy) with the REAL compiled
 * binary (copied aside into `realBinDir`, as in AC-BFI-3's suite) — never the
 * always-exit-0 shim. The fixture is a consumer repo with its own history
 * (provenance step skips) and a clean tree/audit/prd-budget baseline, so the
 * CLAUDE.md structure step is the only variable.
 *
 * ⛔ Exit code alone is not evidence: every red assertion pairs the exit code
 * with the output naming `section_missing` and the missing section.
 * ⛔ Never touches the repo's own `.lore/` — fixtures live under mkdtemp.
 *
 * Coverage:
 *   HAPPY:      conformant root + enforce → exit 0 (control; the trip is not a blanket failure).
 *   NEGATIVE:   enforce + root missing '## Commands' → non-zero, names section_missing + Commands.
 *   BOUNDARY:   a different missing section (Module Index) names that section — not hardcoded.
 *   STATE:      same repo with adoption warn → exit 0.
 *   ERROR:      failure text does not advise only trimming.
 *
 * @spec_ref AC-STR-3
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIST_BINARY = join(REPO_ROOT, "dist", "lore");
const HOOK_PATH = join(REPO_ROOT, "assets", "project", "pre-push");

interface RunResult {
  readonly exitCode: number;
  readonly combined: string;
}

const ALL_SECTIONS = ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"] as const;

let tempRoot = "";
let realBinDir = "";

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([join(realBinDir, "lore"), ...args], { cwd, env: { ...process.env, HOME: cwd } });
  return { exitCode: proc.exitCode ?? 1, combined: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

function runHook(cwd: string): RunResult {
  const proc = Bun.spawnSync(["sh", HOOK_PATH], {
    cwd,
    env: { ...process.env, HOME: cwd, PATH: `${realBinDir}:${process.env["PATH"] ?? ""}` },
  });
  if (proc.exitCode === null) throw new Error("the hook was killed by a signal — no exit code to assert");
  return { exitCode: proc.exitCode, combined: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

/** Clean tree/drift/audit/prd-budget baseline: real init + one PRD + matching blueprint. */
function buildFixture(label: string, adoption: "enforce" | "warn", sections: readonly string[]): string {
  const dir = mkdtempSync(join(tempRoot, `${label}-`));
  const git = Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  if (git.exitCode !== 0) throw new Error(`git init failed: ${git.stderr.toString()}`);
  const init = runLore(["init", "--name", "fixture", "--author", "fixture"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.combined}`);
  const prd = runLore(["create", "prd", "--title", "Fixture Root", "--content", "Root PRD for the structure trip fixture.", "--no-ai"], dir);
  if (prd.exitCode !== 0) throw new Error(`lore create prd failed: ${prd.combined}`);
  writeFileSync(join(dir, "lore.tree.yaml"), "version: 1\nroot:\n  type: prd\n  children: []\n");
  const configPath = join(dir, ".lore", "config.yaml");
  writeFileSync(configPath, `${readFileSync(configPath, "utf8")}\ncontext:\n  memory_files:\n    adoption: ${adoption}\n`);
  const body = sections.map((s) => `## ${s}\n\nContent for ${s}.\n`).join("\n");
  writeFileSync(join(dir, "CLAUDE.md"), `# Fixture\n\n${body}`);
  return dir;
}

beforeAll(() => {
  assertFreshBinary(DIST_BINARY, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  tempRoot = mkdtempSync(join(tmpdir(), "lore-str3-hook-"));
  realBinDir = join(tempRoot, "real-bin");
  mkdirSync(realBinDir, { recursive: true });
  if (!existsSync(DIST_BINARY)) throw new Error("dist/lore missing");
  copyFileSync(DIST_BINARY, join(realBinDir, "lore"));
  chmodSync(join(realBinDir, "lore"), 0o755);
}, 300_000);

afterAll(() => {
  if (tempRoot.length > 0) rmSync(tempRoot, { recursive: true, force: true });
});

const withoutCommands = ALL_SECTIONS.filter((s) => s !== "Commands");

describe("AC-STR-3: pre-push trips on root section structure with the REAL binary", () => {
  it("HAPPY (control): a conformant root under adoption enforce exits 0", () => {
    const dir = buildFixture("conformant", "enforce", ALL_SECTIONS);
    const result = runHook(dir);
    expect({ exitCode: result.exitCode, out: result.exitCode === 0 ? "" : result.combined }).toEqual({ exitCode: 0, out: "" });
  });

  it("NEGATIVE: enforce + root missing '## Commands' exits non-zero", () => {
    const dir = buildFixture("enforce-missing", "enforce", withoutCommands);
    expect(runHook(dir).exitCode).not.toBe(0);
  });

  it("NEGATIVE: the output names section_missing", () => {
    const dir = buildFixture("enforce-names-kind", "enforce", withoutCommands);
    expect(runHook(dir).combined).toContain("section_missing");
  });

  it("NEGATIVE: the output names the missing section 'Commands'", () => {
    const dir = buildFixture("enforce-names-section", "enforce", withoutCommands);
    expect(runHook(dir).combined).toContain("Commands");
  });

  it("BOUNDARY: a different missing section (Module Index) is named instead — not a hardcoded 'Commands'", () => {
    const dir = buildFixture("enforce-missing-index", "enforce", ALL_SECTIONS.filter((s) => s !== "Module Index"));
    const result = runHook(dir);
    expect({ nonZero: result.exitCode !== 0, kind: result.combined.includes("section_missing"), name: result.combined.includes("Module Index") }).toEqual({
      nonZero: true,
      kind: true,
      name: true,
    });
  });

  it("STATE: the same missing-'Commands' repo under adoption warn exits 0", () => {
    const dir = buildFixture("warn-missing", "warn", withoutCommands);
    const result = runHook(dir);
    expect({ exitCode: result.exitCode, out: result.exitCode === 0 ? "" : result.combined }).toEqual({ exitCode: 0, out: "" });
  });

  it("ERROR: the failure text does not tell the user only to 'trim' over-ceiling files", () => {
    const dir = buildFixture("enforce-text", "enforce", withoutCommands);
    const result = runHook(dir);
    // Must be a real structure failure first, else this passes vacuously on a wrong-reason exit.
    expect(result.combined).toContain("section_missing");
    expect(result.combined).not.toMatch(/trim the over-ceiling file\(s\)/);
  });
});
