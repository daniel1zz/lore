/**
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and AC-CV-4 (D6, BR-1097)
 *
 * RED: installed skills must carry lore facts filled in at install time.
 * Spawns the real CLI (`bun packages/lore/src/index.ts setup --yes`) with
 * HOME=<mkdtemp> (default claude dir = <HOME>/.claude), then checks:
 *   HAPPY:      installed lore skill contains String(CAPTURE_TAIL_CHARS), no '{{lore:'.
 *   STATE:      the immediately following `setup --check --json` reports zero
 *               outdated / diverged / missing entries.
 *   NEGATIVE:   no installed skill/agent/hook file anywhere keeps '{{lore:'.
 *   REGRESSION: the shipped SOURCE skill still carries the placeholder (so the
 *               test cannot pass by the source having been hardcoded).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPTURE_TAIL_CHARS } from "@lore/core";

import { cleanupHealthyGhStubDir, healthyGhStubDir } from "../../integration/helpers/healthy-gh-stub.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SOURCE_SKILL = join(REPO_ROOT, "assets", "skills", "lore", "SKILL.md");

function resolveBun(): string {
  const found = spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim();
  if (found === "") throw new Error("asset-install-variables.test.ts: bun not found on PATH");
  return found;
}
const BUN = resolveBun();

let home: string;
let cwd: string;
let installExit: number | null;

function runSetup(args: string[], pathEnv: string) {
  const proc = spawnSync(BUN, [INDEX_TS, "setup", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: pathEnv },
    timeout: 120_000,
  });
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "lore-asset-install-home-"));
  cwd = mkdtempSync(join(tmpdir(), "lore-asset-install-cwd-"));
  // PATH="" keeps the install from reaching a real `claude` CLI (MCP registration fails, file writes still land).
  installExit = runSetup(["--yes"], "").exitCode;
}, 150_000);

afterAll(() => {
  cleanupHealthyGhStubDir();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("AC-CV-4 installed assets carry expanded lore facts", () => {
  it("setup wrote files under <HOME>/.claude (install actually ran)", () => {
    expect(existsSync(join(home, ".claude", "skills", "lore", "SKILL.md")), `setup exit ${String(installExit)}`).toBe(true);
  });

  it("source skill still carries {{lore:capture_tail_chars}} (guards against a hardcoded source)", () => {
    expect(readFileSync(SOURCE_SKILL, "utf8")).toContain("{{lore:capture_tail_chars}}");
  });

  it("installed lore skill contains String(CAPTURE_TAIL_CHARS) and no '{{lore:'", () => {
    expect(typeof CAPTURE_TAIL_CHARS).toBe("number");
    const installed = readFileSync(join(home, ".claude", "skills", "lore", "SKILL.md"), "utf8");
    expect(installed).toContain(String(CAPTURE_TAIL_CHARS));
    expect(installed).not.toContain("{{lore:");
  });

  it("no installed skill, agent or hook file keeps a '{{lore:' placeholder", () => {
    const offenders: string[] = [];
    for (const sub of ["skills", "agents", "hooks"]) {
      const dir = join(home, ".claude", sub);
      if (!existsSync(dir)) continue;
      for (const file of walk(dir)) {
        if (readFileSync(file, "utf8").includes("{{lore:")) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("setup --check --json right after install reports zero outdated, diverged and missing", () => {
    const check = runSetup(["--check", "--json"], healthyGhStubDir());
    const parsed = JSON.parse(check.stdout) as { data: { files: Record<string, unknown[]> } };
    expect(parsed.data.files, check.stdout.slice(0, 1500)).toBeDefined();
    expect(parsed.data.files.outdated).toEqual([]);
    expect(parsed.data.files.diverged).toEqual([]);
    expect(parsed.data.files.missing).toEqual([]);
  });
});
