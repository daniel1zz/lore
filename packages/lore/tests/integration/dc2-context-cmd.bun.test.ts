// @reads assets/**
/**
 * D26 — `lore context` says what it did and never calls AI for a refused init, over a throwaway corpus
 * (never the repo's `.lore/`), through the real CLI entry in-process.
 *
 * @spec_ref spec-defect-clusters-round-2-part-d-store-selection-runs
 */

import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
  /** Log written by the fake `claude` on PATH; one line per invocation. Absent/empty = never called. */
  readonly fakeLog: string;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, home: join(sb.root, "home"), env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

/** Fresh lore project with a logging fake `claude` first on PATH; no `context init` has run yet. */
async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-dc2-context-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  const bin = join(root, "bin");
  for (const d of [home, xdg, corpus, bin]) mkdirSync(d, { recursive: true });
  const fakeLog = join(root, "fake-claude.log");
  const fake = join(bin, "claude");
  writeFileSync(fake, `#!/bin/sh\necho "invoked $*" >> "${fakeLog}"\necho "A generated narrative."\n`);
  chmodSync(fake, 0o755);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  env["PATH"] = `${bin}:${env["PATH"] ?? ""}`;
  const sb: Sandbox = { root, corpus, env, fakeLog };
  const init = await lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

const claudeMd = (sb: Sandbox): string => readFileSync(join(sb.corpus, "CLAUDE.md"), "utf8");
const fakeCalls = (sb: Sandbox): string => (existsSync(sb.fakeLog) ? readFileSync(sb.fakeLog, "utf8") : "");

describe("spec-defect-clusters-round-2-part-d-store-selection-runs#AC-DC2-26", () => {
  it(
    "(a) refresh after a hand-edited managed section reports no change and names the skipped section",
    async () => {
      const sb = await makeSandbox();
      expect((await lore(sb, "context", "init", "--no-ai")).code).toBe(0);
      const edited = claudeMd(sb).replace("Specs are not filed in this document", "Specs are NOT filed in this document");
      expect(edited).not.toBe(claudeMd(sb));
      writeFileSync(join(sb.corpus, "CLAUDE.md"), edited);

      const run = await lore(sb, "context", "refresh");
      expect(run.code).toBe(0);
      expect(claudeMd(sb)).toBe(edited);
      expect(run.stdout).toContain("No change to CLAUDE.md");
      expect(run.stdout).toContain("skipped (diverged): spec-discovery-pointer");
      expect(run.stdout).not.toContain("Wrote");
    },
    60_000,
  );

  it(
    "(a, control) a refresh that really changes CLAUDE.md still says Wrote",
    async () => {
      const sb = await makeSandbox();
      expect((await lore(sb, "context", "init", "--no-ai")).code).toBe(0);
      writeFileSync(join(sb.corpus, "package.json"), JSON.stringify({ scripts: { build: "x" }, lore: { documentedScripts: { build: "Build it" } } }));
      const run = await lore(sb, "context", "refresh");
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("Wrote CLAUDE.md");
      expect(run.stdout).not.toContain("No change");
    },
    60_000,
  );

  it(
    "(b) init --no-ai says AI is disabled, not that no provider is usable",
    async () => {
      const sb = await makeSandbox();
      const run = await lore(sb, "context", "init", "--no-ai");
      expect(run.code).toBe(0);
      expect(run.stderr).toContain("AI disabled (--no-ai)");
      expect(run.stderr).not.toContain("no usable AI provider");
      expect(fakeCalls(sb)).toBe("");
    },
    60_000,
  );

  it(
    "(c) init --ai on an existing CLAUDE.md exits 4 and the fake claude is never invoked",
    async () => {
      const sb = await makeSandbox();
      writeFileSync(join(sb.corpus, "CLAUDE.md"), "# Mine\n");
      const run = await lore(sb, "context", "init", "--ai");
      expect(run.code).toBe(4);
      expect(run.stderr).toContain("already exists");
      expect(claudeMd(sb)).toBe("# Mine\n");
      // the stub records every call: an empty log proves no AI call was spent before the refusal
      expect(fakeCalls(sb)).toBe("");
    },
    60_000,
  );

  it(
    "(c, stub is live) init --ai on a fresh project DOES reach the fake claude — so an empty log means something",
    async () => {
      const sb = await makeSandbox();
      const run = await lore(sb, "context", "init", "--ai");
      expect(run.code).toBe(0);
      expect(fakeCalls(sb)).toContain("invoked");
    },
    60_000,
  );
});
