// @reads assets/**
// @spawns packages/lore/src/index.ts
/**
 * AC-MI-1 / AC-MI-2 / AC-MI-3 (throwaway half) of
 * spec-module-index-lists-only-folders-with-a-memory-file-managed (task MI-T1).
 *
 * Harness: runs the real CLI in-process (`runLoreInProcess`) against `mkdtemp` throwaway projects with
 * HOME pointed at the project dir, never this repository's `.lore/`, CLAUDE.md or `~/.claude`.
 *
 * Coverage: HAPPY (index lists memory-file folders only; headings kept; --check 0 after refresh),
 * BOUNDARY (no Purpose section; hidden / ignored folders), NEGATIVE (--check on a stale file exits 1
 * naming it and writes nothing), STATE (legacy blocks migrate once; second refresh is a no-op),
 * REGRESSION (hand text outside legacy blocks byte-preserved).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

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

/** Throwaway git repo with an initialised corpus. */
async function makeProject(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "lore-module-index-"));
  scratch.push(dir);
  const git = spawnSync("git", ["init", "-q", dir]);
  if (git.status !== 0) throw new Error(`git init failed: ${String(git.stderr)}`);
  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");

/** The lines of the `## Module Index` managed section (heading to the next fingerprint comment / end marker). */
function moduleIndexLines(claudeMd: string): string[] {
  const start = claudeMd.indexOf("## Module Index");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = claudeMd.slice(start);
  const end = rest.search(/\n<!-- lore:managed|\n# ─── end lore governance/);
  return (end === -1 ? rest : rest.slice(0, end)).split("\n");
}

describe("AC-MI-1: module index lists only folders with a memory file, nothing dropped silently", () => {
  it("AC-MI-1 HAPPY: 3 memory-file folders and 40 without -> exactly 3 index lines (link + first Purpose sentence) and one count line", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    put(dir, "svc/alpha/CLAUDE.md", "# Alpha\n\n## Purpose\n\nAlpha does the first thing. It also does more.\n\n## Other\n\nx\n");
    put(dir, "svc/beta/CLAUDE.md", "# Beta\n\n## Purpose\nBeta owns persistence.\n");
    put(dir, "lib/gamma/CLAUDE.md", "# Gamma\n\n## Purpose\n\nGamma parses input. Second sentence.\n");
    for (let i = 0; i < 40; i += 1) put(dir, `bulk/m${String(i)}/file.ts`, "export {};\n");

    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);

    const lines = moduleIndexLines(read(dir, "CLAUDE.md"));
    const entries = lines.filter((l) => l.startsWith("- ["));
    expect(entries).toHaveLength(3);
    const byPath = (p: string) => entries.find((l) => l.includes(`](${p}/CLAUDE.md)`));
    expect(byPath("svc/alpha")).toContain("Alpha does the first thing.");
    expect(byPath("svc/alpha")).not.toContain("It also does more");
    expect(byPath("svc/beta")).toContain("Beta owns persistence.");
    expect(byPath("lib/gamma")).toContain("Gamma parses input.");
    // the folders that only group the memory-file folders (svc, lib, bulk) have no memory file either: they are
    // counted, never listed. 40 bulk/mN + bulk + svc + lib = 43 discovered without.
    // D5 (spec-prose-about-code-is-bound-to-what-it-describes-one): the count is no longer in the committed
    // section; `refresh --check` reports it.
    expect(lines.filter((l) => /no memory file/i.test(l))).toHaveLength(0);
    const check = await runLore(["context", "refresh", "--check"], dir);
    expect(check.stdout).toMatch(/\b43 folders have no memory file/);
    expect(lines.join("\n")).not.toContain("bulk/m0");
  });

  it("AC-MI-1 BOUNDARY: refresh --check names exactly 40 when 40 folders have no memory file (not in the committed section)", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n");
    put(dir, "a/CLAUDE.md", "# A\n\n## Purpose\n\nA is a.\n");
    put(dir, "b/CLAUDE.md", "# B\n\n## Purpose\n\nB is b.\n");
    put(dir, "c/CLAUDE.md", "# C\n\n## Purpose\n\nC is c.\n");
    for (let i = 0; i < 40; i += 1) put(dir, `m${String(i)}/file.ts`, "export {};\n");
    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const lines = moduleIndexLines(read(dir, "CLAUDE.md"));
    expect(lines.filter((l) => l.startsWith("- ["))).toHaveLength(3);
    expect(lines.filter((l) => /no memory file/i.test(l))).toHaveLength(0);
    const check = await runLore(["context", "refresh", "--check"], dir);
    expect(check.stdout).toMatch(/\b40 folders have no memory file/);
  });

  it("AC-MI-1 BOUNDARY: a memory file without a Purpose section is listed with its link and 'no Purpose section'", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n");
    put(dir, "svc/CLAUDE.md", "# Svc\n\n## Notes\n\nNo purpose heading here.\n");
    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const entries = moduleIndexLines(read(dir, "CLAUDE.md")).filter((l) => l.startsWith("- ["));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("](svc/CLAUDE.md)");
    expect(entries[0]).toContain("no Purpose section");
  });

  it("AC-MI-1 REGRESSION (context walk hygiene): a hidden or gitignored folder holding a memory file is not listed", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n");
    put(dir, ".gitignore", "ignored/\n");
    put(dir, ".hidden/CLAUDE.md", "# H\n\n## Purpose\n\nHidden.\n");
    put(dir, "ignored/CLAUDE.md", "# I\n\n## Purpose\n\nIgnored.\n");
    put(dir, "real/CLAUDE.md", "# R\n\n## Purpose\n\nReal.\n");
    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const entries = moduleIndexLines(read(dir, "CLAUDE.md")).filter((l) => l.startsWith("- ["));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("](real/CLAUDE.md)");
  });
});

describe("AC-MI-2: managed zone keeps the template headings; legacy auto blocks migrate once", () => {
  it("AC-MI-2 HAPPY: after lore setup --project, refresh keeps both template headings and the section check reports no section_missing", async () => {
    const dir = await makeProject();
    const setup = await runLore(["setup", "--project", "--yes"], dir);
    expect(setup.exitCode, setup.stderr + setup.stdout).toBe(0);
    const before = read(dir, "CLAUDE.md");
    expect(before).toContain("## Module Index");
    expect(before).toContain("## Finding Live Project State");

    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const after = read(dir, "CLAUDE.md");
    expect(after).toContain("## Module Index");
    expect(after).toContain("## Finding Live Project State");

    const health = await runLore(["status", "--check-claude-md"], dir);
    expect(health.exitCode, health.stdout + health.stderr).toBe(0);
    expect(health.stdout + health.stderr).not.toContain("section_missing");
  });

  it("AC-MI-2 STATE: legacy auto:module-index / auto:dynamic-context blocks become one managed zone, reported by name, hand text byte-identical", async () => {
    const dir = await makeProject();
    const head = "# Proj\n\nhand text before.\n\n";
    const mid = "\nhand text between.\n\n";
    const tail = "\nhand text after.\n";
    const legacy =
      head +
      "<!-- auto:module-index -->\n## Module Index\n- [`old`](old/CLAUDE.md) — stale\n<!-- /auto:module-index -->\n" +
      mid +
      "<!-- auto:dynamic-context -->\n## Finding Live Project State\nold stuff\n<!-- /auto:dynamic-context -->\n" +
      tail;
    put(dir, "CLAUDE.md", legacy);
    put(dir, "svc/CLAUDE.md", "# Svc\n\n## Purpose\n\nSvc serves.\n");

    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    expect(refreshed.stdout).toContain("auto:module-index");
    expect(refreshed.stdout).toContain("auto:dynamic-context");

    const after = read(dir, "CLAUDE.md");
    expect(after.match(/^## Module Index$/gm)).toHaveLength(1);
    expect(after.match(/^## Finding Live Project State$/gm)).toHaveLength(1);
    expect(after).not.toContain("auto:module-index");
    expect(after).not.toContain("auto:dynamic-context");
    expect(after).not.toContain("old stuff");
    // every byte of hand-written text outside the blocks survives, in order
    for (const handText of [head, mid, tail]) expect(after).toContain(handText);
    expect(after.indexOf(head)).toBeLessThan(after.indexOf(mid));
    expect(after.indexOf(mid)).toBeLessThan(after.indexOf(tail));

    // migrate once: a second refresh reports no migration and changes nothing
    const second = await runLore(["context", "refresh"], dir);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(second.stdout).not.toContain("auto:module-index");
    expect(read(dir, "CLAUDE.md")).toBe(after);
  });
});

describe("MI-T3 refresh --check labels each finding by its own kind", () => {
  it("MI-T3 NEGATIVE: a CLAUDE.md lacking required sections exits 1 printing section_missing, never labelled 'ceiling:'", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text only\n");
    const before = read(dir, "CLAUDE.md");
    const check = await runLore(["context", "refresh", "--check"], dir);
    const out = check.stdout + check.stderr;
    expect(check.exitCode, out).toBe(1);
    expect(out).toContain("section_missing:");
    expect(out).not.toMatch(/ceiling:/i);
    expect(read(dir, "CLAUDE.md")).toBe(before);
  });
});

describe("refresh --check: context refresh --check computes, writes nothing, exits 0 only when refreshed", () => {
  it("refresh --check NEGATIVE: a stale CLAUDE.md -> exit exactly 1 naming it, bytes unchanged; after a real refresh -> exit 0", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    put(dir, "svc/CLAUDE.md", "# Svc\n\n## Purpose\n\nSvc serves.\n");
    const before = read(dir, "CLAUDE.md");

    const stale = await runLore(["context", "refresh", "--check"], dir);
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout + stale.stderr).toContain("CLAUDE.md");
    expect(read(dir, "CLAUDE.md")).toBe(before);

    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);

    const fresh = await runLore(["context", "refresh", "--check"], dir);
    expect(fresh.exitCode, fresh.stdout + fresh.stderr).toBe(0);
  });

  it("refresh --check BOUNDARY: a refreshed file over the configured ceiling -> exit exactly 1 naming the ceiling, nothing written", async () => {
    const dir = await makeProject();
    put(dir, "CLAUDE.md", "# Proj\n\nhand text\n");
    const refreshed = await runLore(["context", "refresh"], dir);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    // grow hand text (outside the managed zone) past the default root ceiling
    const grown = read(dir, "CLAUDE.md") + Array.from({ length: 400 }, (_, i) => `line ${String(i)}\n`).join("");
    put(dir, "CLAUDE.md", grown);
    const check = await runLore(["context", "refresh", "--check"], dir);
    expect(check.exitCode, check.stdout + check.stderr).toBe(1);
    expect((check.stdout + check.stderr).toLowerCase()).toContain("ceiling");
    expect(read(dir, "CLAUDE.md")).toBe(grown);
  });
});
