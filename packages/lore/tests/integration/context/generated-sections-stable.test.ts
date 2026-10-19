// @reads assets/**
// @spawns packages/lore/src/index.ts
/**
 * AC-BIND-5 of spec-prose-about-code-is-bound-to-what-it-describes-one (D4, D5; task BIND-P3).
 *
 * D5: adding a folder WITHOUT a memory file must not change committed CLAUDE.md after `lore context refresh`;
 *     the without-memory-file count is reported by `refresh --check` (plain text and --json) instead.
 * D4: `package.json` `lore.documentedScripts` is a map name -> one-line description; the command table renders
 *     name, command and description. A name with no script fails loud; a non-map shape fails loud.
 *
 * Harness: real CLI in-process against `mkdtemp` throwaway projects (never this repo's `.lore/` or CLAUDE.md).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

async function runLore(args: string[], cwd: string) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: cwd, CLAUDECODE: "1" };
  delete env["ANTHROPIC_API_KEY"];
  delete env["OPENAI_API_KEY"];
  delete env["LORE_AI_DEFAULT"];
  return runLoreInProcess(args, { cwd, home: cwd, env });
}

function put(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

async function makeProject(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "lore-stable-sections-"));
  scratch.push(dir);
  const git = spawnSync("git", ["init", "-q", dir]);
  if (git.status !== 0) throw new Error(`git init failed: ${String(git.stderr)}`);
  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");

const PKG = {
  scripts: { build: "bun run scripts/build.ts", test: "vitest run" },
  lore: { documentedScripts: { build: "Compile the binary to dist/lore.", test: "Run every test file." } },
};

describe("AC-BIND-5 D5: a folder without a memory file leaves CLAUDE.md byte-identical", () => {
  it("AC-BIND-5 HAPPY: add a folder with no memory file -> refresh keeps CLAUDE.md bytes, --check exits 0 and reports the count", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    put(dir, "svc/alpha/CLAUDE.md", "# Alpha\n\n## Purpose\n\nAlpha does the first thing.\n");
    put(dir, "bulk/one/file.ts", "export {};\n");
    expect((await runLore(["context", "refresh"], dir)).exitCode).toBe(0);
    const before = read(dir, "CLAUDE.md");
    expect(before).not.toMatch(/no memory file/i);

    put(dir, "bulk/two/file.ts", "export {};\n");
    const again = await runLore(["context", "refresh"], dir);
    expect(again.exitCode, again.stderr).toBe(0);
    expect(read(dir, "CLAUDE.md")).toBe(before);

    // folders without a memory file: svc (groups alpha), bulk, bulk/one, bulk/two = 4
    const check = await runLore(["context", "refresh", "--check"], dir);
    expect(check.exitCode, check.stdout + check.stderr).toBe(0);
    expect(check.stdout).toMatch(/\b4 folders have no memory file and are not listed/);
    const json = await runLore(["context", "refresh", "--check", "--json"], dir);
    expect(JSON.parse(json.stdout).data.check.modulesWithoutMemoryFile).toBe(4);
  });

  it("AC-BIND-5 REGRESSION: a folder WITH a memory file still changes the index (--check exits 1)", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    expect((await runLore(["context", "refresh"], dir)).exitCode).toBe(0);
    put(dir, "svc/beta/CLAUDE.md", "# Beta\n\n## Purpose\n\nBeta owns persistence.\n");
    const check = await runLore(["context", "refresh", "--check"], dir);
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain("would change: CLAUDE.md");
  });
});

describe("AC-BIND-5 D4: the command table renders each documented script's description", () => {
  it("AC-BIND-5 HAPPY: name, command and description come from package.json", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    put(dir, "package.json", JSON.stringify(PKG));
    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const md = read(dir, "CLAUDE.md");
    expect(md).toContain("- `build`: `bun run scripts/build.ts` — Compile the binary to dist/lore.");
    expect(md).toContain("- `test`: `vitest run` — Run every test file.");
  });

  it("AC-BIND-5 ERROR: a documented name with no script fails loud", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    put(dir, "package.json", JSON.stringify({ scripts: { build: "x" }, lore: { documentedScripts: { build: "Builds.", gone: "Missing." } } }));
    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode).not.toBe(0);
    expect(refreshed.stderr).toContain('"gone"');
  });

  it("AC-BIND-5 NEGATIVE: the retired array shape and an empty description fail loud, never degrade to an empty table", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    put(dir, "package.json", JSON.stringify({ scripts: { build: "x" }, lore: { documentedScripts: ["build"] } }));
    const arr = await runLore(["context", "refresh"], dir);
    expect(arr.exitCode).not.toBe(0);
    expect(arr.stderr).toContain("documentedScripts");
    put(dir, "package.json", JSON.stringify({ scripts: { build: "x" }, lore: { documentedScripts: { build: "" } } }));
    const empty = await runLore(["context", "refresh"], dir);
    expect(empty.exitCode).not.toBe(0);
    expect(empty.stderr).toContain("documentedScripts");
  });
});
