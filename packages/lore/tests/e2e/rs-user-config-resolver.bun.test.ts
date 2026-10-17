// @reads assets/**
/**
 * Compiled-binary e2e for the shared user-config-dir resolver
 * (spec-rule-store-git-tracked-fragment-selection-on-demand-skill, Scope 7, AC-RS-15, BR-1065;
 * task task-rs-t10-context-list-add-remove-verbs-and-skill-refresh-via).
 *
 * Contract: with LORE_CONFIG_HOME set, `lore context refresh --scope user` and `lore fragments check`
 * both read that folder's `context/` fragments and `context/selection.yaml`, and ignore the XDG folder.
 *
 * Isolation: mkdtemp HOME + XDG + LORE_CONFIG_HOME; never touches the repo's `.lore/` or the real HOME.
 *
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill AC-RS-15
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Sandbox {
  readonly home: string;
  readonly corpus: string;
  readonly xdgContextDir: string;
  readonly loreHomeContextDir: string;
  readonly env: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<Run> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-rs-resolver-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const loreHome = join(root, "lore-home");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, loreHome, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["LORE_CONFIG_HOME"] = loreHome;
  env["CLAUDECODE"] = "1";
  const sb: Sandbox = {
    home,
    corpus,
    xdgContextDir: join(xdg, "lore", "context"),
    loreHomeContextDir: join(loreHome, "context"),
    env,
  };
  for (const step of [["init"], ["context", "init", "--no-ai"], ["context", "refresh"]]) {
    const run = await lore(sb, ...step);
    if (run.code !== 0) throw new Error(`harness: lore ${step.join(" ")} failed in fixture setup: ${run.stderr}`);
  }
  return sb;
}

function writeRulesFragment(dir: string, id: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const front = ["---", `id: ${id}`, `title: fixture ${id}`, 'audience: ["main"]', "mode: static", "---", ""].join("\n");
  writeFileSync(join(dir, `${id}.md`), `${front}${body}\n`, "utf8");
}

const userRules = (sb: Sandbox, id: string): string => join(sb.home, ".claude", "rules", `lore-${id}.md`);

describe("AC-RS-15 LORE_CONFIG_HOME is the one user config dir", () => {
  it("refresh --scope user reads fragments from LORE_CONFIG_HOME/context, not from the XDG folder", async () => {
    const sb = await makeSandbox();
    writeRulesFragment(sb.loreHomeContextDir, "fixture-lorehome-rule", "Line from the LORE_CONFIG_HOME folder.");
    writeRulesFragment(sb.xdgContextDir, "fixture-xdg-rule", "Line from the XDG folder.");
    const run = await lore(sb, "context", "refresh", "--scope", "user");
    expect(run.code).toBe(0);
    expect(existsSync(userRules(sb, "fixture-lorehome-rule"))).toBe(true);
    expect(existsSync(userRules(sb, "fixture-xdg-rule"))).toBe(false);
  });

  it("refresh --scope user honours LORE_CONFIG_HOME/context/selection.yaml", async () => {
    const sb = await makeSandbox();
    writeRulesFragment(sb.loreHomeContextDir, "fixture-keep-rule", "Kept line.");
    writeRulesFragment(sb.loreHomeContextDir, "fixture-off-rule", "Disabled line.");
    writeFileSync(join(sb.loreHomeContextDir, "selection.yaml"), "schemaVersion: 1\ndisable:\n  - fixture-off-rule\n", "utf8");
    const run = await lore(sb, "context", "refresh", "--scope", "user");
    expect(run.code).toBe(0);
    expect(existsSync(userRules(sb, "fixture-keep-rule"))).toBe(true);
    expect(existsSync(userRules(sb, "fixture-off-rule"))).toBe(false);
  });

  it("fragments check reads LORE_CONFIG_HOME/context/selection.yaml: an unknown id there exits 4 naming it", async () => {
    const sb = await makeSandbox();
    mkdirSync(sb.loreHomeContextDir, { recursive: true });
    writeFileSync(join(sb.loreHomeContextDir, "selection.yaml"), "schemaVersion: 1\ndisable:\n  - fixture-ghost-id\n", "utf8");
    const bad = await lore(sb, "fragments", "check");
    expect(bad.code).toBe(4);
    expect(bad.stderr).toContain("fixture-ghost-id");
    writeFileSync(join(sb.loreHomeContextDir, "selection.yaml"), "schemaVersion: 1\ndisable: []\n", "utf8");
    expect((await lore(sb, "fragments", "check")).code).toBe(0);
  });

  it("fragments check reads LORE_CONFIG_HOME/context fragments: a duplicate line against the project layer exits 4", async () => {
    const sb = await makeSandbox();
    const dup = "Always run the resolver fixture linter before committing.";
    writeRulesFragment(sb.loreHomeContextDir, "fixture-lorehome-dup", dup);
    writeRulesFragment(join(sb.corpus, ".lore", "context"), "fixture-project-dup", dup);
    const bad = await lore(sb, "fragments", "check");
    expect(bad.code).toBe(4);
    expect(bad.stderr).toContain("[duplicate_line]");
  });
});
