// @spawns packages/lore/src/index.ts
/**
 * `lore status --check-claude-md` enforces the root section structure and ceilings with no project setting
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, AC-STR-2; the adoption mode it describes was
 * retired by task-memory-file-limits-are-always-enforced-the-warn-adoption, rule BR-427).
 *
 * Every scenario spawns the real CLI against a `mkdtemp` fixture with a config-only `.lore/` (or none).
 *
 * Coverage: HAPPY (a conforming file exits 0, no health noise) / NEGATIVE (a missing section exits exactly 3 naming
 * the section) / BOUNDARY (an over-ceiling file with every section exits 3) / REGRESSION (no `adoption` block, no
 * `downgraded` advisory, no WARN line, no matter the config: the retired default `warn` exited 0).
 *
 * @spec_ref AC-STR-2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

const ALL_SECTIONS = ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"] as const;

function rootFile(sections: readonly string[], extraLines = 0): string {
  const body = sections.map((s) => `## ${s}\n\nbody of ${s}\n`).join("\n");
  const filler: string[] = [];
  for (let i = 1; i <= extraLines; i++) filler.push(`Filler line ${i}: standing discipline entry.`);
  return `# Project\n\n${body}\n${filler.join("\n")}\n`;
}

interface CheckJson {
  data?: {
    claude_md?: {
      findings?: Array<{ kind: string; reference?: string; path: string; message: string }>;
      advisory?: Array<{ kind: string }>;
      adoption?: unknown;
    };
  };
}

function check(dir: string): { run: RunResult; json: CheckJson } {
  const run = runLore(["status", "--check-claude-md", "--json"], dir);
  let json: CheckJson = {};
  try {
    json = JSON.parse(run.stdout) as CheckJson;
  } catch {
    // leave empty: assertions on the parsed shape then fail loudly
  }
  return { run, json };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-status-enforced-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const MISSING_COMMANDS = ALL_SECTIONS.filter((s) => s !== "Commands");

describe("status --check-claude-md enforces with no setting", () => {
  it("NEGATIVE: missing '## Commands' exits EXACTLY 3", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), rootFile(MISSING_COMMANDS));
    expect(check(tmpDir).run.exitCode).toBe(3);
  });

  it("NEGATIVE: missing '## Commands' reports a deterministic section_missing finding for 'Commands'", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), rootFile(MISSING_COMMANDS));
    const f = (check(tmpDir).json.data?.claude_md?.findings ?? []).find((x) => x.kind === "section_missing");
    expect(f?.reference).toBe("Commands");
  });

  it("HAPPY: a conforming root file exits 0 with zero findings", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), rootFile(ALL_SECTIONS));
    const { run, json } = check(tmpDir);
    expect(run.exitCode).toBe(0);
    expect(json.data?.claude_md?.findings).toEqual([]);
  });

  it("BOUNDARY: an over-ceiling file that has every section still exits 3 with a max_lines finding", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), rootFile(ALL_SECTIONS, 400));
    const { run, json } = check(tmpDir);
    expect(run.exitCode).toBe(3);
    expect((json.data?.claude_md?.findings ?? []).map((f) => f.kind)).toContain("max_lines");
  });

  it("REGRESSION: the report carries no adoption block and no downgraded advisory, and the human output no WARN line", () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), rootFile(MISSING_COMMANDS));
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption).toBeUndefined();
    expect((json.data?.claude_md?.advisory ?? []).some((a) => a.kind === "downgraded")).toBe(false);
    const human = runLore(["status", "--check-claude-md"], tmpDir);
    expect(`${human.stdout}${human.stderr}`).not.toMatch(/WARN adoption=warn/);
  });
});
