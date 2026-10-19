// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D4 — AC-DC2-4
 *   (BR-837, BR-834, BR-845, BR-840): a project uninstall reverses everything the project
 *   setup did — the earlier `core.hooksPath`, the earlier reply-language value, and the
 *   lore-owned rules files (and only those).
 *
 * Every case runs the REAL CLI in a throwaway git repo (never this repo's `.lore`, `.claude`
 * or git config). SIMPLEST GREEN-BUT-BROKEN case: a repo with no prior hooksPath and no user
 * rules file, where an uninstall that only unsets looks right. The main fixture therefore has
 * a PRIOR hooksPath (`.husky`), a USER rules file (`mine.md`) and a PRIOR language (`en`); a
 * control repo with no prior hooksPath must end with the setting unset.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = Bun.which("bun") ?? (() => { throw new Error("bun not found"); })();
const SPEC = "spec-defect-clusters-round-2-part-a-sessions-seats-setup-init";
const LEDGER = join(".lore", ".lore-project-manifest.json");
const USER_RULES = "# my own rules\n\nKeep me byte for byte.\n";
const CASE_TIMEOUT_MS = 180_000;

interface RunResult { stdout: string; stderr: string; exitCode: number }

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dc2-4-repo-"));
  scratch.push(dir);
  for (const args of [["init"], ["config", "user.email", "t@example.com"], ["config", "user.name", "T"]]) {
    const proc = Bun.spawnSync(["git", ...args], { cwd: dir });
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return dir;
}

function git(repo: string, args: string[]): RunResult {
  const proc = Bun.spawnSync(["git", ...args], { cwd: repo });
  return { stdout: proc.stdout.toString().trim(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function setupProject(repo: string, extra: string[] = []): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", "--project", ...extra, "--yes"], { cwd: repo, env: { ...process.env } });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function expectOk(result: RunResult, what: string): void {
  if (result.exitCode !== 0) throw new Error(`${what} exited ${result.exitCode}\n${result.stdout}\n${result.stderr}`);
}

/** Scaffolds once so `.lore/config.yaml` exists, then sets the project reply language (the config is created by setup itself). */
function configureProjectLanguage(repo: string, code: string): void {
  const configPath = join(repo, ".lore", "config.yaml");
  const config = readFileSync(configPath, "utf8");
  // The seeded template carries a `context:` block (memory_files); the language key joins it.
  if (!/^context:\n/m.test(config)) throw new Error("fixture assumption broken: config.yaml has no context: block");
  writeFileSync(configPath, config.replace(/^context:\n/m, `context:\n  language: ${code}\n`));
}

function loreRulesFiles(repo: string): string[] {
  const dir = join(repo, ".claude", "rules");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("lore-")) : [];
}

function readLanguage(repo: string): unknown {
  const file = join(repo, ".claude", "settings.local.json");
  return (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)["language"];
}

describe(`${SPEC}#AC-DC2-4 project uninstall reverses everything the project setup wrote`, () => {
  it(
    `${SPEC}#AC-DC2-4 restores the prior hooksPath and language, removes lore rules files only, leaves mine.md byte-identical`,
    () => {
      const repo = makeRepo();
      expect(git(repo, ["config", "core.hooksPath", ".husky"]).exitCode).toBe(0);
      mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
      writeFileSync(join(repo, ".claude", "rules", "mine.md"), USER_RULES);

      // First run creates `.lore/config.yaml`; the project language is set, the earlier settings value planted, then setup runs again.
      expectOk(setupProject(repo), "first setup --project");
      configureProjectLanguage(repo, "zh");
      writeFileSync(join(repo, ".claude", "settings.local.json"), `${JSON.stringify({ language: "en", keep: 1 }, null, 2)}\n`);
      expectOk(setupProject(repo), "second setup --project");

      // Setup really changed all three things — otherwise the restore below proves nothing.
      expect(git(repo, ["config", "--get", "core.hooksPath"]).stdout).toBe(join(repo, "hooks"));
      expect(readLanguage(repo)).toBe("Chinese");
      expect(loreRulesFiles(repo).length).toBeGreaterThan(0);

      const uninstall = setupProject(repo, ["--uninstall"]);
      expect(uninstall.exitCode, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);

      expect(git(repo, ["config", "--get", "core.hooksPath"]).stdout).toBe(".husky");
      expect(loreRulesFiles(repo)).toEqual([]);
      expect(readFileSync(join(repo, ".claude", "rules", "mine.md"), "utf8")).toBe(USER_RULES);
      expect(readLanguage(repo)).toBe("en");
      expect(JSON.parse(readFileSync(join(repo, ".claude", "settings.local.json"), "utf8"))).toEqual({ language: "en", keep: 1 });
      expect(existsSync(join(repo, LEDGER))).toBe(false);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    `${SPEC}#AC-DC2-4 control: with no prior hooksPath the uninstall leaves the setting unset and removes a settings file lore created`,
    () => {
      const repo = makeRepo();
      expect(git(repo, ["config", "--get", "core.hooksPath"]).exitCode).toBe(1);
      mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
      writeFileSync(join(repo, ".claude", "rules", "mine.md"), USER_RULES);

      expectOk(setupProject(repo), "first setup --project");
      configureProjectLanguage(repo, "zh");
      expectOk(setupProject(repo), "second setup --project");
      expect(readLanguage(repo)).toBe("Chinese");

      const uninstall = setupProject(repo, ["--uninstall"]);
      expect(uninstall.exitCode, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);

      expect(git(repo, ["config", "--get", "core.hooksPath"]).exitCode).toBe(1);
      expect(loreRulesFiles(repo)).toEqual([]);
      expect(readFileSync(join(repo, ".claude", "rules", "mine.md"), "utf8")).toBe(USER_RULES);
      expect(existsSync(join(repo, ".claude", "settings.local.json"))).toBe(false);
    },
    CASE_TIMEOUT_MS,
  );
});
