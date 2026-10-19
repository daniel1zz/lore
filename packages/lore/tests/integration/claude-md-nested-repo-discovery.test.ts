// @spawns packages/lore/src/index.ts
/**
 * RED-phase tests for AC-STR-10 of
 * `spec-claude-md-root-section-structure-check-and-adoption-mode`:
 * memory-file discovery must stop at nested git repositories (a non-root
 * directory that has its own `.git`, as a directory OR as a gitfile like a
 * submodule), so another project's over-ceiling CLAUDE.md is never linted as
 * a module of THIS repo (issue #24: untracked nested repo `everything-workspace/`
 * was linted as a module).
 *
 * Every scenario spawns the real CLI (`lore status --check-claude-md --json`)
 * against a `mkdtemp` git repo with a config-only `.lore/` pinning
 * `adoption: enforce` explicitly (absent key = warn, which would make the
 * exit-code assertions vacuous). This repo's own `.lore/` is never touched.
 *
 * Coverage: HAPPY (nested repo skipped, exit EXACTLY 0) / NEGATIVE (nested
 * path absent from findings, advisory AND headroom) / BOUNDARY (`.git`
 * directory vs gitfile) / STATE (root `.git` never stops the walk) /
 * REGRESSION (control: ordinary subdir with no `.git` IS reported, exit 3 —
 * guards against a "fix" that skips every subdirectory).
 *
 * @spec_ref spec-claude-md-root-section-structure-check-and-adoption-mode
 * @ac_ref AC-STR-10
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** MOCK RISK: none — spawns the real CLI from source, same as status-claude-md.test.ts. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function runGit(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

interface PathItem {
  kind?: string;
  path: string;
  role?: string;
}

interface CheckJson {
  data?: {
    claude_md?: {
      findings?: PathItem[];
      advisory?: PathItem[];
      headroom?: PathItem[];
      adoption?: { mode?: string };
    };
  };
}

function runCheck(cwd: string): { result: RunResult; parsed: CheckJson } {
  const result = runLore(["status", "--check-claude-md", "--json"], cwd);
  let parsed: CheckJson;
  try {
    parsed = JSON.parse(result.stdout) as CheckJson;
  } catch (error) {
    throw new Error(
      `non-JSON stdout (exit ${result.exitCode}): ${error instanceof Error ? error.message : String(error)}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return { result, parsed };
}

/** Every path the check reported, across findings, advisory and headroom. */
function allPaths(parsed: CheckJson): string[] {
  const c = parsed.data?.claude_md;
  return [...(c?.findings ?? []), ...(c?.advisory ?? []), ...(c?.headroom ?? [])].map((p) => p.path);
}

const SECTIONS =
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((name) => `## ${name}\n\nbody of ${name}\n`)
    .join("\n") + "\n";

/** `lineCount` non-empty lines — 400 exceeds both root (300) and module ceilings. */
function nLineBody(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) lines.push(`Line ${i}: standing discipline entry.`);
  return lines.join("\n") + "\n";
}

function makeHostRepo(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lore-claude-md-nested-${label}-`));
  runGit(["init", "-q"], dir);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  patchLoreConfig(dir, "context:\n  memory_files:\n    adoption: enforce\n");
  writeFileSync(join(dir, "CLAUDE.md"), SECTIONS);
  return dir;
}

function writeOversizedAt(dir: string, rel: string): void {
  mkdirSync(join(dir, rel), { recursive: true });
  writeFileSync(join(dir, rel, "CLAUDE.md"), nLineBody(400));
}

describe("memory-file discovery stops at nested git repositories", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeHostRepo("main");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("nested repo with a .git DIRECTORY: no finding/advisory/headroom path under vendor/other/", () => {
    writeOversizedAt(tmpDir, "vendor/other");
    runGit(["init", "-q"], join(tmpDir, "vendor", "other"));

    const { parsed } = runCheck(tmpDir);

    expect(allPaths(parsed).filter((p) => p.startsWith("vendor/other/"))).toEqual([]);
  });

  it("nested repo with a .git DIRECTORY: exit is EXACTLY 0 under explicit adoption enforce", () => {
    writeOversizedAt(tmpDir, "vendor/other");
    runGit(["init", "-q"], join(tmpDir, "vendor", "other"));

    const { result, parsed } = runCheck(tmpDir);

    expect(parsed.data?.claude_md?.adoption?.mode).toBe("enforce");
    expect(result.exitCode).toBe(0);
  });

  it("nested repo with a .git FILE (submodule gitdir: shape): no path under vendor/other/", () => {
    writeOversizedAt(tmpDir, "vendor/other");
    writeFileSync(join(tmpDir, "vendor", "other", ".git"), "gitdir: ../../.git/modules/other\n");

    const { parsed } = runCheck(tmpDir);

    expect(allPaths(parsed).filter((p) => p.startsWith("vendor/other/"))).toEqual([]);
  });

  it("nested repo with a .git FILE: exit is EXACTLY 0 under explicit adoption enforce", () => {
    writeOversizedAt(tmpDir, "vendor/other");
    writeFileSync(join(tmpDir, "vendor", "other", ".git"), "gitdir: ../../.git/modules/other\n");

    const { result, parsed } = runCheck(tmpDir);

    expect(parsed.data?.claude_md?.adoption?.mode).toBe("enforce");
    expect(result.exitCode).toBe(0);
  });

  it("control: an ordinary subdirectory (no .git) with a 400-line CLAUDE.md IS reported as max_lines at pkg/CLAUDE.md", () => {
    writeOversizedAt(tmpDir, "pkg");

    const { parsed } = runCheck(tmpDir);

    const hit = (parsed.data?.claude_md?.findings ?? []).filter(
      (f) => f.path === "pkg/CLAUDE.md" && f.kind === "max_lines",
    );
    expect(hit).toHaveLength(1);
  });

  it("control: an ordinary subdirectory over-ceiling file makes enforce exit EXACTLY 3", () => {
    writeOversizedAt(tmpDir, "pkg");

    const { result } = runCheck(tmpDir);

    expect(result.exitCode).toBe(3);
  });

  it("mixed: nested repo skipped while sibling ordinary dir is still reported (discriminates skip-all-subdirs)", () => {
    writeOversizedAt(tmpDir, "vendor/other");
    runGit(["init", "-q"], join(tmpDir, "vendor", "other"));
    writeOversizedAt(tmpDir, "pkg");

    const { result, parsed } = runCheck(tmpDir);

    const paths = allPaths(parsed);
    expect(paths.some((p) => p === "pkg/CLAUDE.md")).toBe(true);
    expect(paths.some((p) => p.startsWith("vendor/other/"))).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("the host repo's own root .git never stops the walk: root CLAUDE.md headroom entry present", () => {
    const { parsed } = runCheck(tmpDir);

    const roots = (parsed.data?.claude_md?.headroom ?? []).filter((h) => h.path === "CLAUDE.md" && h.role === "root");
    expect(roots).toHaveLength(1);
  });

  it("the host repo's own root .git never stops the walk: an ordinary module two levels deep is still discovered", () => {
    mkdirSync(join(tmpDir, "a", "b"), { recursive: true });
    writeFileSync(join(tmpDir, "a", "b", "CLAUDE.md"), "# small module\n");

    const { parsed } = runCheck(tmpDir);

    expect((parsed.data?.claude_md?.headroom ?? []).some((h) => h.path === "a/b/CLAUDE.md")).toBe(true);
  });

  it("nested repo's CLAUDE.md is absent from headroom while an ordinary sibling module is present", () => {
    mkdirSync(join(tmpDir, "vendor", "other"), { recursive: true });
    writeFileSync(join(tmpDir, "vendor", "other", "CLAUDE.md"), "# small nested\n");
    runGit(["init", "-q"], join(tmpDir, "vendor", "other"));
    mkdirSync(join(tmpDir, "pkg"), { recursive: true });
    writeFileSync(join(tmpDir, "pkg", "CLAUDE.md"), "# small ordinary\n");

    const { parsed } = runCheck(tmpDir);

    const paths = (parsed.data?.claude_md?.headroom ?? []).map((h) => h.path);
    expect(paths).toContain("pkg/CLAUDE.md");
    expect(paths).not.toContain("vendor/other/CLAUDE.md");
  });
});
