// @reads assets/**
/**
 * D27 — `lore fragments check` covers user-scope and project agents, subagent audiences named by
 * fragments, and user-scope rules-file drift, over a throwaway HOME + project (never the repo's
 * `.lore/` or the real `~/.claude`), through the real CLI entry in-process.
 *
 * @spec_ref spec-defect-clusters-round-2-part-d-store-selection-runs
 */

import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, home: sb.home, env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

/** Temp HOME with a user agent, a user-layer ghost-audience fragment and a user-layer main rules fragment; project with one agent. */
async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-dc2-fragcheck-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  const userContext = join(xdg, "lore", "context");
  for (const d of [join(home, ".claude", "agents"), join(corpus, ".claude", "agents"), userContext]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, ".claude", "agents", "tester.md"), "# tester\n");
  writeFileSync(join(corpus, ".claude", "agents", "res.md"), "# res\n");
  writeFileSync(
    join(userContext, "ghost-note.md"),
    '---\nid: ghost-note\ntitle: "Ghost note"\ninject: [subagent-start]\nagents: [ghost]\n---\nGhost helpers read this.\n',
  );
  writeFileSync(
    join(userContext, "user-note.md"),
    '---\nid: user-note\ntitle: "User note"\ninject: [launch]\n---\nUser-scope main rule.\n',
  );
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  const sb: Sandbox = { root, home, corpus, env };
  const init = await lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

/** Writes the user-scope lore rules files from the user-layer fragments. */
async function refreshUser(sb: Sandbox): Promise<void> {
  const run = await lore(sb, "context", "refresh", "--scope", "user");
  expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
}

interface CheckJson {
  readonly data: { readonly agentTypes: readonly string[]; readonly findings: readonly { readonly kind: string; readonly message: string }[] };
}

async function check(sb: Sandbox): Promise<{ code: number; json: CheckJson | null; stderr: string }> {
  const run = await lore(sb, "fragments", "check", "--json");
  let json: CheckJson | null = null;
  try {
    json = JSON.parse(run.stdout) as CheckJson;
  } catch {
    json = null;
  }
  return { code: run.code, json, stderr: run.stderr };
}

const SHIPPED_AGENTS = readdirSync(join(REPO_ROOT, "assets", "agents"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -".md".length));

describe("spec-defect-clusters-round-2-part-d-store-selection-runs#AC-DC2-27", () => {
  it(
    "spec-defect-clusters-round-2-part-d-store-selection-runs#AC-DC2-27 (a) check enumerates user, project, shipped and fragment-audience agents",
    async () => {
      const sb = await makeSandbox();
      // writes the user-scope rules file so the clean baseline is exit 0
      await refreshUser(sb);
      const run = await check(sb);
      expect(run.json, run.stderr).not.toBeNull();
      expect(run.code, JSON.stringify(run.json?.data.findings)).toBe(0);
      const types = run.json?.data.agentTypes ?? [];
      for (const expected of ["tester", "res", "ghost", "subagent:*", ...SHIPPED_AGENTS]) expect(types).toContain(expected);
      expect(SHIPPED_AGENTS.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "spec-defect-clusters-round-2-part-d-store-selection-runs#AC-DC2-27 (b) drift in a user-scope lore rules file exits 4 and names it; restoring returns 0",
    async () => {
      const sb = await makeSandbox();
      await refreshUser(sb);
      const rulesDir = join(sb.home, ".claude", "rules");
      const userFiles = existsSync(rulesDir) ? readdirSync(rulesDir).filter((f) => /^lore-user-.*\.md$/.test(f)) : [];
      expect(userFiles.length).toBeGreaterThan(0);
      const target = join(rulesDir, userFiles[0] as string);
      const original = readFileSync(target, "utf8");

      appendFileSync(target, "hand-edited line\n");
      const drifted = await check(sb);
      expect(drifted.code).toBe(4);
      const finding = drifted.json?.data.findings.find((f) => f.kind === "rules_drift" && f.message.includes(target));
      expect(finding, JSON.stringify(drifted.json?.data.findings)).toBeDefined();

      writeFileSync(target, original);
      expect((await check(sb)).code).toBe(0);
    },
    120_000,
  );

  it(
    "spec-defect-clusters-round-2-part-d-store-selection-runs#AC-DC2-27 (control) a freshly refreshed user scope is clean, so (b)'s exit 4 comes from the edit alone",
    async () => {
      const sb = await makeSandbox();
      await refreshUser(sb);
      const missing = await check(sb);
      expect(missing.code).toBe(0);
    },
    120_000,
  );
});
