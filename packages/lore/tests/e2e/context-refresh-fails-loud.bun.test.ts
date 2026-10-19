// @reads assets/**
/**
 * In-process e2e for `lore context refresh` failing loud (baseline-refresh-the-managed-part BR-883, BR-889, BR-881):
 * exit codes and named texts through the real CLI entry, over a throwaway corpus (never the repo's `.lore/`).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   task-refresh-fails-loud-on-a-malformed-package-file-refuses
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CLAUDE_MD_MARKER_END, CLAUDE_MD_MARKER_START } from "@lore/core";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, home: join(sb.root, "home"), env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-refresh-loud-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  const sb: Sandbox = { root, corpus, env };
  for (const step of [["init"], ["context", "init", "--no-ai"]]) {
    const run = await lore(sb, ...step);
    if (run.code !== 0) throw new Error(`harness: lore ${step.join(" ")} failed in fixture setup: ${run.stderr}`);
  }
  return sb;
}

const claudeMd = (sb: Sandbox): string => readFileSync(join(sb.corpus, "CLAUDE.md"), "utf8");

describe("lore context refresh refuses options it does not use (BR-889)", () => {
  it("--force exits 4 naming --force", async () => {
    const sb = await makeSandbox();
    const run = await lore(sb, "context", "refresh", "--force");
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("does not use --force");
  });

  it("--ai and --no-ai exit 4 naming the option", async () => {
    const sb = await makeSandbox();
    const ai = await lore(sb, "context", "refresh", "--ai");
    expect(ai.code).toBe(4);
    expect(ai.stderr).toContain("--ai");
    const noAi = await lore(sb, "context", "refresh", "--no-ai");
    expect(noAi.code).toBe(4);
    expect(noAi.stderr).toContain("--no-ai");
  });

  it("naming several unused options names them all", async () => {
    const sb = await makeSandbox();
    const run = await lore(sb, "context", "refresh", "--force", "--no-ai");
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("--force, --no-ai");
  });

  it("REGRESSION: the other context subcommands still take their own options; plain refresh still exits 0", async () => {
    const sb = await makeSandbox();
    expect((await lore(sb, "context", "refresh")).code).toBe(0);
    expect((await lore(sb, "context", "refresh", "--check")).code).toBe(0);
    expect((await lore(sb, "context", "init", "--force", "--no-ai")).code).toBe(0);
    expect((await lore(sb, "context", "list", "--json")).code).toBe(0);
  });
});

describe("lore context refresh on a broken package file (BR-883)", () => {
  it("invalid JSON exits 4 naming package.json and the parse error; CLAUDE.md untouched", async () => {
    const sb = await makeSandbox();
    const before = claudeMd(sb);
    writeFileSync(join(sb.corpus, "package.json"), "{ nope");
    const run = await lore(sb, "context", "refresh");
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("package.json is not valid JSON");
    expect(claudeMd(sb)).toBe(before);
  });

  it("a malformed scripts list exits 4 naming package.json and the schema error", async () => {
    const sb = await makeSandbox();
    writeFileSync(join(sb.corpus, "package.json"), JSON.stringify({ scripts: { build: 1 } }));
    const run = await lore(sb, "context", "refresh");
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("package.json has an invalid shape");
    expect(run.stderr).toContain("scripts.build");
  });

  it("a missing package.json refreshes and the commands section says there is no package file", async () => {
    const sb = await makeSandbox();
    const run = await lore(sb, "context", "refresh");
    expect(run.code).toBe(0);
    expect(claudeMd(sb)).toContain("This project has no package.json");
  });
});

describe("lore context refresh on an older-lore managed part (BR-881)", () => {
  it("exits 4 naming the repair and leaves CLAUDE.md as it was", async () => {
    const sb = await makeSandbox();
    const legacy = `# Mine\n\n${CLAUDE_MD_MARKER_START}\nold prose, no fingerprint\n${CLAUDE_MD_MARKER_END}\n`;
    writeFileSync(join(sb.corpus, "CLAUDE.md"), legacy);
    const run = await lore(sb, "context", "refresh");
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("carries no fingerprint");
    expect(run.stderr).toContain("Repair: delete the zone");
    expect(claudeMd(sb)).toBe(legacy);
  });
});
