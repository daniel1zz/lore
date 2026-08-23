/**
 * Template pointer — `.claude/rules/` reaches consumers via `lore setup
 * --project` (spec-claude-md-governance-content-dimension-checks-wire-the,
 * AC-TEMPLATE-1). The RED half of a paired red/green task
 * (task-skill-implement-contract-prose-rules-section-reworded).
 *
 * AC-TEMPLATE-1's own text: "An asset edit with no installed-output
 * assertion is the same capability-without-wiring failure this spec exists
 * to close — in miniature." So this suite never stops at reading the
 * template asset off disk — it also spawns the real CLI
 * (`bun run <index.ts> setup --project --yes`) against a fresh `mkdtemp` git
 * repo and reads the CLAUDE.md that install actually produced, mirroring
 * `tests/integration/cli/setup.test.ts`'s AC-060-T5.S2 real-fs round-trip
 * fixture (git init + config, then `--project --yes`) and
 * `tests/integration/claude-md-wiring.test.ts`'s subprocess-harness
 * conventions (this file lives in the same directory).
 *
 * ⛔ NEVER touches this repo's own `.lore/` or `.claude/` — every fixture is
 * a throwaway `mkdtempSync` git repo, installed into and torn down in
 * `afterAll` (see root CLAUDE.md's "Never write to the repo's own `.lore/`
 * corpus from tests" rule).
 *
 * Written RED-FIRST: at authoring time `assets/project/CLAUDE.md.template`
 * carries no `.claude/rules/` pointer at all, so every HAPPY case below is
 * expected to fail until the paired asset edit lands (recorded via `lore
 * evidence ... --result expected-fail` before that edit was made).
 *
 * Coverage:
 *   HAPPY:      the template asset itself carries the `.claude/rules/`
 *               pointer line, AND a real `lore setup --project --yes`
 *               install into a fresh mkdtemp git repo produces a CLAUDE.md
 *               carrying that SAME line — the capability-plus-wiring pair
 *               AC-TEMPLATE-1 requires.
 *   NEGATIVE:   a positive control (a heading known to already exist) proves
 *               `toContain` genuinely reads file content; a fabricated
 *               string proves the same check can fail.
 *   BOUNDARY:   the template's managed marker pair is well-formed (start
 *               index precedes end index), and the new pointer line falls
 *               INSIDE that managed section — a pointer left outside the
 *               managed markers would never reach an install.
 *   ERROR:      the real `setup --project --yes` subprocess actually exits
 *               0 and actually produces a CLAUDE.md on disk — every
 *               downstream content assertion would otherwise be reading a
 *               leftover or nonexistent file and silently passing vacuously.
 *   STATE:      the installed CLAUDE.md carries the SAME managed-marker
 *               pair as the template (proving it derives from the shipped
 *               template, not some other source).
 *   REGRESSION: the template's pre-existing governance pointer ("This
 *               file's content contract ... `lore governance claude-md`")
 *               survives in BOTH the template asset and the installed
 *               output — the fix is additive, never a replacement of the
 *               existing pointer.
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-TEMPLATE-1
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Path setup (mirrors tests/integration/claude-md-wiring.test.ts, same directory) ──

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const TEMPLATE_PATH = join(REPO_ROOT, "assets", "project", "CLAUDE.md.template");

const MANAGED_START_MARKER = "# ─── lore governance (managed) ───";
const MANAGED_END_MARKER = "# ─── end lore governance ───";
const RULES_POINTER_TEXT = "Instructions that should not load every session belong in `.claude/rules/*.md`";
const EXISTING_GOVERNANCE_POINTER_TEXT = "This file's content contract";

/**
 * Resolves the real `bun` binary's absolute path via the test runner's own
 * inherited PATH (mirrors `tests/integration/cli/setup.test.ts`'s own
 * documented reason: `bunx vitest` runs this file under node, and every
 * mutating call below sets the child's `PATH` deliberately).
 */
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();
if (!BUN_BIN) {
  throw new Error("claude-md-template-pointer.test.ts: could not resolve `bun` via `command -v bun`");
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> setup ...args` in `cwd`, PATH emptied (never touches a real `claude` CLI). */
function runSetup(args: string[], cwd: string): RunResult {
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

let repoDir = "";
let setupResult: RunResult;
let installedClaudeMdPath = "";
let templateContent = "";

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "lore-claude-md-template-pointer-"));
  spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: repoDir, encoding: "utf8" });

  setupResult = runSetup(["--project", "--yes"], repoDir);
  installedClaudeMdPath = join(repoDir, "CLAUDE.md");
  templateContent = readFileSync(TEMPLATE_PATH, "utf8");
}, 30_000);

afterAll(() => {
  if (repoDir) {
    try {
      rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe("template asset — `.claude/rules/` pointer (AC-TEMPLATE-1)", () => {
  it("NEGATIVE (positive control): a heading known to already exist is actually read", () => {
    expect(templateContent).toContain("## Module Index");
  });

  it("NEGATIVE: a fabricated string is NOT present (the toContain oracle can fail)", () => {
    expect(templateContent).not.toContain("this exact sentence was never written into the template");
  });

  it("HAPPY: the template asset carries the `.claude/rules/` pointer line", () => {
    expect(templateContent).toContain(RULES_POINTER_TEXT);
  });

  it("BOUNDARY: the managed marker pair is well-formed before scanning between them", () => {
    const startIdx = templateContent.indexOf(MANAGED_START_MARKER);
    const endIdx = templateContent.indexOf(MANAGED_END_MARKER);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
  });

  it("BOUNDARY: the pointer line falls INSIDE the managed section, not outside the markers", () => {
    const startIdx = templateContent.indexOf(MANAGED_START_MARKER);
    const endIdx = templateContent.indexOf(MANAGED_END_MARKER);
    const managedSection = templateContent.slice(startIdx, endIdx);
    expect(managedSection).toContain(RULES_POINTER_TEXT);
  });

  it("REGRESSION: the template's pre-existing governance pointer survives verbatim", () => {
    expect(templateContent).toContain(EXISTING_GOVERNANCE_POINTER_TEXT);
  });
});

describe("installed output — `lore setup --project --yes` into a fresh mkdtemp (AC-TEMPLATE-1)", () => {
  it("ERROR: the real setup subprocess actually exits 0", () => {
    expect(setupResult.exitCode).toBe(0);
  });

  it("ERROR: a CLAUDE.md actually exists on disk after install (never a leftover/absent-file false pass)", () => {
    expect(existsSync(installedClaudeMdPath)).toBe(true);
  });

  it("HAPPY: the installed CLAUDE.md carries the SAME `.claude/rules/` pointer line", () => {
    const installed = readFileSync(installedClaudeMdPath, "utf8");
    expect(installed).toContain(RULES_POINTER_TEXT);
  });

  it("STATE: the installed CLAUDE.md carries the same managed-marker pair as the template", () => {
    const installed = readFileSync(installedClaudeMdPath, "utf8");
    expect(installed).toContain(MANAGED_START_MARKER);
    expect(installed).toContain(MANAGED_END_MARKER);
  });

  it("REGRESSION: the installed CLAUDE.md still carries the pre-existing governance pointer", () => {
    const installed = readFileSync(installedClaudeMdPath, "utf8");
    expect(installed).toContain(EXISTING_GOVERNANCE_POINTER_TEXT);
  });
});
