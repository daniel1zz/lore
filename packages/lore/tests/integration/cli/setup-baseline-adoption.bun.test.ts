// @spawns packages/lore/src/index.ts
// @reads assets/**
// @reads packages/lore/package.json
// @reads packages/lore/src/generated/assets-manifest.ts
/**
 * End-to-end test that `lore setup --project` seeds baseline adoption (Baseline slice 3a, BL-8, AC-BLS3-7), driven
 * through the real CLI in a throwaway git repo.
 *
 * Spec: spec-baseline-slice-3a-architecture-tree-baseline-root, Design "Distribution (BL-8)":
 *   `lore setup --project` writes `workflow.gates.ac-cite.mode: report` only when absent; ships
 *   `assets/skills/lore-baseline/` (the authoring skill) and node templates; assets manifest parity holds.
 *
 * CONTRACT (the spec leaves these open; the simplest reading consistent with the Design text is pinned here):
 *   C1. Seeding mirrors the existing `context.memory_files.adoption` step in setup-project-flow.ts: write only when the
 *       key is ABSENT, never overwrite an explicit value (off | report | enforce), never touch `armed_branches` or any
 *       other config key. Re-baselined by BR-987 / AC-FIP-3: a real seed IS an audited adoption (one
 *       `baseline_adopt` row, actor = the setup caller); a kept explicit mode writes no row.
 *   C2. The skill and templates live in the assets SSOT as `assets/skills/lore-baseline/SKILL.md` and
 *       `assets/skills/lore-baseline/templates/<name>.md` (at least one template) and are embedded in the generated
 *       assets manifest under `skills/lore-baseline/...`.
 *   C3. `lore setup --project` installs every `skills/lore-baseline/**` asset into the repo at
 *       `.claude/<asset path>` (so `.claude/skills/lore-baseline/SKILL.md`), byte-identical to the asset, and lists
 *       each in the project ledger `.lore/.lore-project-manifest.json` `entries[]` as
 *       { path: ".claude/skills/lore-baseline/...", kind: "skill", sha256: <sha256 of the installed bytes> }.
 *
 * Dimensions: HAPPY (absent -> report; skill + templates installed and ledgered), NEGATIVE (explicit off / enforce /
 * report is never changed; other keys untouched), STATE (a hand-edit after setup survives a second setup),
 * REGRESSION (the pre-existing adoption step and ledger entries remain; manifest parity),
 * BOUNDARY (armed_branches present while mode is absent -> mode seeded, armed_branches untouched).
 *
 * @spec_ref AC-BLS3-7
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";

setDefaultTimeout(300_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ASSETS_ROOT = join(REPO_ROOT, "assets");
const ACTOR = "agent:setup-adopt-test";
const SKILL_REL = "skills/lore-baseline/SKILL.md";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** MOCK RISK: none; HOME is redirected into the fixture so setup can never reach the real ~/.claude. */
function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

interface Ledger {
  entries: { path: string; kind: string; sha256: string }[];
}

let scratch: string[] = [];

/** A temp git repo with `lore init` done; `preConfig` mutates the parsed config.yaml before setup runs. */
function makeRepo(preConfig?: (cfg: Record<string, any>) => void): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sba-repo-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "sba@example.invalid"]);
  git(dir, ["config", "user.name", "sba test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  if (preConfig) {
    const cfg = readConfig(dir);
    preConfig(cfg);
    writeFileSync(join(dir, ".lore", "config.yaml"), yaml.stringify(cfg));
  }
  return dir;
}

const readConfig = (dir: string): Record<string, any> => yaml.parse(readFileSync(join(dir, ".lore", "config.yaml"), "utf8")) ?? {};
const citeOf = (dir: string): { mode?: string; armed_branches?: string[] } | undefined => readConfig(dir).workflow?.gates?.["ac-cite"];
const readLedger = (dir: string): Ledger => JSON.parse(readFileSync(join(dir, ".lore", ".lore-project-manifest.json"), "utf8")) as Ledger;

function setupProject(dir: string): RunResult {
  return runLore(["setup", "--project", "--yes"], dir);
}

let fresh = "";
let freshRun: RunResult;

beforeAll(() => {
  fresh = makeRepo();
  freshRun = setupProject(fresh);
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe("setup seeds baseline adoption (BL-8)", () => {
  it("setup --project succeeds in the temp repo (fixture sanity: exit 0)", () => {
    expect(freshRun.stderr + freshRun.stdout).not.toContain("Error");
    expect(freshRun.exitCode).toBe(0);
  });

  it("with workflow.gates.ac-cite.mode absent, setup writes mode report", () => {
    expect(citeOf(fresh)?.mode).toBe("report");
  });

  it("seeding writes only the mode: no armed_branches appear", () => {
    expect(citeOf(fresh)).toEqual({ mode: "report" });
  });

  it("the pre-existing adoption seed is still written (regression control)", () => {
    expect(readConfig(fresh).context?.memory_files?.adoption).toBeDefined();
  });

  it.each(["off", "enforce", "report"] as const)("an existing mode %s is never changed", (mode) => {
    const dir = makeRepo((cfg) => {
      cfg.workflow = { gates: { "ac-cite": { mode } } };
    });
    expect(setupProject(dir).exitCode).toBe(0);
    expect(citeOf(dir)).toEqual({ mode });
  });

  it("an existing enforce mode keeps its armed_branches and other workflow keys untouched", () => {
    const dir = makeRepo((cfg) => {
      cfg.workflow = { claim_ttl_minutes: 77, gates: { "task-claim": { enabled: false }, "ac-cite": { mode: "enforce", armed_branches: ["br-one", "br-two"] } } };
    });
    expect(setupProject(dir).exitCode).toBe(0);
    const cfg = readConfig(dir);
    expect(cfg.workflow.gates["ac-cite"]).toEqual({ mode: "enforce", armed_branches: ["br-one", "br-two"] });
    expect(cfg.workflow.gates["task-claim"]).toEqual({ enabled: false });
    expect(cfg.workflow.claim_ttl_minutes).toBe(77);
  });

  it("armed_branches present but mode absent: mode is seeded to report and armed_branches are untouched", () => {
    const dir = makeRepo((cfg) => {
      cfg.workflow = { gates: { "ac-cite": { armed_branches: ["br-one"] } } };
    });
    expect(setupProject(dir).exitCode).toBe(0);
    expect(citeOf(dir)).toEqual({ mode: "report", armed_branches: ["br-one"] });
  });

  it("a mode hand-edited after the first setup survives a second setup", () => {
    const dir = makeRepo();
    expect(setupProject(dir).exitCode).toBe(0);
    expect(citeOf(dir)?.mode).toBe("report");
    const cfg = readConfig(dir);
    cfg.workflow.gates["ac-cite"].mode = "enforce";
    writeFileSync(join(dir, ".lore", "config.yaml"), yaml.stringify(cfg));
    expect(setupProject(dir).exitCode).toBe(0);
    expect(citeOf(dir)?.mode).toBe("enforce");
  });
});

describe("setup seeds baseline adoption (BL-8): authoring skill and templates", () => {
  const assetSkill = join(ASSETS_ROOT, SKILL_REL);

  it("the lore-baseline skill exists in the assets SSOT with a non-empty body", () => {
    expect(existsSync(assetSkill)).toBe(true);
    expect(readFileSync(assetSkill, "utf8").trim().length).toBeGreaterThan(200);
  });

  it("the assets SSOT ships at least one node template under skills/lore-baseline/templates/", () => {
    const manifest = readEmbeddedManifestPaths();
    expect(manifest.filter((p) => p.startsWith("skills/lore-baseline/templates/") && p.endsWith(".md")).length).toBeGreaterThan(0);
  });

  it("setup installs the skill at .claude/skills/lore-baseline/SKILL.md byte-identical to the asset", () => {
    const installed = join(fresh, ".claude", SKILL_REL);
    expect(existsSync(installed)).toBe(true);
    expect(sha256(readFileSync(installed))).toBe(sha256(readFileSync(assetSkill)));
  });

  it("the setup ledger lists the skill with kind skill and the sha256 of the installed bytes", () => {
    const entry = readLedger(fresh).entries.find((e) => e.path === `.claude/${SKILL_REL}`);
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("skill");
    expect(entry!.sha256).toBe(sha256(readFileSync(join(fresh, ".claude", SKILL_REL))));
  });

  it("every skills/lore-baseline/** asset is installed byte-identical AND listed in the ledger", () => {
    const wanted = readEmbeddedManifestPaths().filter((p) => p.startsWith("skills/lore-baseline/"));
    expect(wanted.length).toBeGreaterThanOrEqual(2); // SKILL.md + >= 1 template
    const ledgerPaths = new Set(readLedger(fresh).entries.map((e) => e.path));
    for (const rel of wanted) {
      const installed = join(fresh, ".claude", rel);
      expect(existsSync(installed)).toBe(true);
      expect(sha256(readFileSync(installed))).toBe(sha256(readFileSync(join(ASSETS_ROOT, rel))));
      expect(ledgerPaths.has(`.claude/${rel}`)).toBe(true);
    }
  });

  it("the pre-existing ledger entries are still present (regression control: hooks, tree blueprint, CLAUDE.md)", () => {
    const paths = readLedger(fresh).entries.map((e) => e.path);
    expect(paths).toContain("hooks/pre-push");
    expect(paths).toContain("lore.tree.yaml");
    expect(paths).toContain("CLAUDE.md");
  });
});

describe("setup seeds baseline adoption (BL-8): assets manifest parity", () => {
  it("the generated manifest embeds the skill with the sha256 of the SSOT file", () => {
    const entry = readEmbeddedManifest().entries.find((e) => e.path === SKILL_REL);
    expect(entry).toBeDefined();
    expect(entry!.sha256).toBe(sha256(readFileSync(join(ASSETS_ROOT, SKILL_REL))));
  });

  it("the generated manifest's tree digest equals a fresh walk of assets/ (manifest not stale)", async () => {
    const script = join(REPO_ROOT, "scripts", "embed-assets-manifest.mjs");
    const specifier = script; // variable specifier: resolved at runtime, no static module graph edge
    const mod = (await import(specifier)) as { buildManifest: (assetsRoot: string, repoRoot: string) => { tree_digest: string; entries: { path: string; sha256: string }[] } };
    const fresh = mod.buildManifest(ASSETS_ROOT, REPO_ROOT);
    expect(readEmbeddedManifest().tree_digest).toBe(fresh.tree_digest);
  });
});

interface EmbeddedManifestShape {
  tree_digest: string;
  entries: { path: string; sha256: string }[];
}

/** Reads the generated manifest source as text and evaluates its exported object literal (no TS import graph). */
function readEmbeddedManifest(): EmbeddedManifestShape {
  const src = readFileSync(join(REPO_ROOT, "packages", "lore", "src", "generated", "assets-manifest.ts"), "utf8");
  const start = src.indexOf("export const EMBEDDED_ASSETS_MANIFEST");
  const open = src.indexOf("{", src.indexOf("=", start));
  // The literal is JSON-shaped (generated with JSON.stringify); find its balanced end.
  let depth = 0;
  let end = -1;
  let inStr = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("could not delimit EMBEDDED_ASSETS_MANIFEST literal");
  // reason: the generated literal is a TypeScript object literal (unquoted keys, a `LORE_BINARY_VERSION` identifier),
  // NOT JSON as first assumed; evaluating it with that identifier bound parses it without a TS import graph.
  return new Function("LORE_BINARY_VERSION", `return ${src.slice(open, end + 1)}`)("embedded") as EmbeddedManifestShape;
}

const readEmbeddedManifestPaths = (): string[] => readEmbeddedManifest().entries.map((e) => e.path);
