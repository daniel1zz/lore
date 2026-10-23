// @spawns dist/lore
/**
 * Compiled-binary e2e oracles for the `inject` frontmatter re-key
 * (spec-fragment-injection-timing-one-inject-enum-a-per-turn): AC-IT-7 (shipped set and refresh/check on it),
 * AC-IT-9 (`lore context list` text and JSON).
 *
 * Isolation: every sandbox is a mkdtemp tree holding HOME, XDG_CONFIG_HOME and a throwaway `lore init` corpus (cwd);
 * PATH resolves `lore` to THIS worktree's dist/lore. Never touches the repo's `.lore/` or the real `~/.claude`.
 *
 * Six-dimension coverage: HAPPY (shipped set clean, list shows inject), NEGATIVE (agent-rules gets no rules file,
 * no `delivery` key), BOUNDARY (multi-timing fragment prints comma-joined, no space), REGRESSION (agents values name real agent files).
 *
 * @spec_ref AC-IT-7 AC-IT-9
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parse as parseYaml } from "yaml";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const CONTEXT_DIR = join(REPO_ROOT, "assets", "context");
const AGENTS_DIR = join(REPO_ROOT, "assets", "agents");

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sandboxes: string[] = [];
let NODE_DIR = "";

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const node = Bun.which("node");
  if (node === null) throw new Error("harness: `node` not found on PATH");
  NODE_DIR = dirname(node);
});

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

function lore(sb: Sandbox, ...args: string[]): Run {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd: sb.corpus, env: sb.env });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-inject-e2e-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxes.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LORE_SETUP_NO_CHECK"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  env["PATH"] = [NODE_DIR, "/usr/bin", "/bin"].join(":");
  const sb: Sandbox = { root, corpus, env };
  const init = lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

interface ShippedFragment {
  readonly id: string;
  readonly inject: readonly string[];
  readonly agents: readonly string[] | undefined;
}

function shippedFragments(): ShippedFragment[] {
  return readdirSync(CONTEXT_DIR)
    .filter((n) => n.endsWith(".md"))
    .map((name) => {
      const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(CONTEXT_DIR, name), "utf8"));
      if (m === null) throw new Error(`shipped fragment ${name} has no frontmatter`);
      const fm = parseYaml(m[1] as string) as { id: string; inject: string[]; agents?: string[] };
      return { id: fm.id, inject: fm.inject, agents: fm.agents };
    });
}

describe("AC-IT-7 shipped set uses inject and refreshes/checks clean", () => {
  it("AC-IT-7 every shipped fragment names inject and every agents value is the name of a shipped agent file", () => {
    const agentNames = readdirSync(AGENTS_DIR).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
    expect(agentNames.length).toBeGreaterThan(0);
    for (const fragment of shippedFragments()) {
      expect(Array.isArray(fragment.inject) && fragment.inject.length > 0, fragment.id).toBe(true);
      for (const agent of fragment.agents ?? []) expect(agentNames, `${fragment.id} names agent ${agent}`).toContain(agent);
    }
  });

  it("AC-IT-7 lore context refresh writes a rules file for every shipped launch fragment and none for agent-rules; fragments check exits 0", () => {
    const sb = makeSandbox();
    const refresh = lore(sb, "context", "refresh");
    expect({ code: refresh.code, err: refresh.stderr }).toEqual({ code: 0, err: refresh.stderr });
    const rulesDir = join(sb.corpus, ".claude", "rules");
    const written = existsSync(rulesDir) ? readdirSync(rulesDir).filter((n) => n.startsWith("lore-")) : [];
    const launch = shippedFragments().filter((f) => f.inject.includes("launch"));
    expect(launch.length).toBeGreaterThan(0);
    for (const fragment of launch) expect(written, fragment.id).toContain(`lore-${fragment.id}.md`);
    expect(written).not.toContain("lore-agent-rules.md");

    const check = lore(sb, "fragments", "check");
    expect({ code: check.code, err: check.stderr }).toEqual({ code: 0, err: "" });
  });
});

describe("AC-IT-9 lore context list shows inject timings", () => {
  function writeProjectFragment(sb: Sandbox): void {
    const dir = join(sb.corpus, ".lore", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "it9-probe.md"),
      "---\nid: it9-probe\ntitle: it9 probe\ninject: [launch, subagent-start]\nagents: [lore-reader]\n---\nProbe line for AC-IT-9.\n",
      "utf8",
    );
  }

  it("AC-IT-9 text rows read (<layer>, <inject comma-joined>, N chars) with no rules/skill delivery word", () => {
    const sb = makeSandbox();
    writeProjectFragment(sb);
    const r = lore(sb, "context", "list");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("(project, launch,subagent-start, ");
    expect(r.stdout.split("\n").filter((line) => line.includes(", rules,") || line.includes(", skill,"))).toEqual([]);
  });

  it("AC-IT-9 --json rows carry inject as an array and no delivery key", () => {
    const sb = makeSandbox();
    writeProjectFragment(sb);
    const r = lore(sb, "context", "list", "--json");
    expect(r.code).toBe(0);
    const rows = (JSON.parse(r.stdout) as { data: Record<string, unknown>[] }).data;
    const probe = rows.find((row) => row["id"] === "it9-probe");
    expect(probe?.["inject"]).toEqual(["launch", "subagent-start"]);
    for (const row of rows) expect(Object.keys(row)).not.toContain("delivery");
  });
});
