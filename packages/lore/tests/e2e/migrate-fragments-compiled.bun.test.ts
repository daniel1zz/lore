// @spawns dist/lore
/**
 * Compiled-binary e2e for `lore migrate fragments` and the automatic migration inside `lore setup`
 * (spec-fragment-injection-timing-one-inject-enum-a-per-turn, Migration mapping, D9, BR-1376): AC-IT-5.
 *
 * One fixture per old shape; user layer (`--scope user`, temp HOME / XDG, no corpus) and project layer
 * (`--scope project`, throwaway `lore init` corpus). Never touches the repo's `.lore/` or the real HOME.
 *
 * Concurrent-change case: the compiled binary is interleaved through the production seam
 * `LORE_MIGRATE_FRAGMENTS_SYNC_DIR` (the flow writes `<dir>/reached` between its read and its precondition re-read, then
 * waits for `<dir>/go`); the flow's own unit test covers the same case through the injected `beforeWrite` dep.
 *
 * @spec_ref spec-fragment-injection-timing-one-inject-enum-a-per-turn AC-IT-5
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parse as parseYaml } from "yaml";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

let BIN_DIR = "";
let NODE_DIR = "";

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const node = Bun.which("node");
  if (node === null) throw new Error("harness: `node` not found on PATH");
  NODE_DIR = dirname(node);
  BIN_DIR = realpathSync(mkdtempSync(join(tmpdir(), "lore-mf-bin-")));
  symlinkSync(LORE_BIN, join(BIN_DIR, "lore"));
  const claudeStub = join(BIN_DIR, "claude");
  writeFileSync(claudeStub, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(claudeStub, 0o755);
});

const roots: string[] = [];
afterAll(() => {
  if (BIN_DIR !== "") rmSync(BIN_DIR, { recursive: true, force: true });
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly userCtx: string;
  readonly projectCtx: string;
  readonly env: Record<string, string>;
}
interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(sb: Sandbox, cwd: string, args: string[], extraEnv: Record<string, string> = {}): Run {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env: { ...sb.env, ...extraEnv } });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-mf-e2e-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  roots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LORE_SETUP_NO_CHECK", "LORE_MIGRATE_FRAGMENTS_SYNC_DIR"]) {
    delete env[k];
  }
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  env["PATH"] = [BIN_DIR, NODE_DIR, "/usr/bin", "/bin"].join(":");
  const sb: Sandbox = { root, corpus, userCtx: join(xdg, "lore", "context"), projectCtx: join(corpus, ".lore", "context"), env };
  const init = run(sb, corpus, ["init"]);
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

// ─── fixtures: one per old shape ────────────────────────────────────────────

interface Fixture {
  readonly id: string;
  /** Old-format frontmatter lines between `id`/`title` and `---`. */
  readonly old: readonly string[];
  /** Expected new `inject` (undefined = refused). */
  readonly inject?: readonly string[];
  readonly agents?: readonly string[];
  readonly description?: string;
}

const FIXTURES: readonly Fixture[] = [
  { id: "mf-main-rules", old: ["audience: [main]", "mode: static", "delivery: rules"], inject: ["launch"] },
  { id: "mf-main-skill", old: ["audience: [main]", "delivery: skill", "description: Use when migrating"], inject: ["on-demand"], description: "Use when migrating" },
  { id: "mf-sub-any", old: ["audience: [subagent:*]"], inject: ["subagent-start"] },
  { id: "mf-sub-list", old: ["audience:", "  - subagent:lore-implementer", "  - subagent:lore-reader"], inject: ["subagent-start"], agents: ["lore-implementer", "lore-reader"] },
  { id: "mf-main-sub", old: ["audience: [main, subagent:lore-implementer]", "mode: static"], inject: ["launch", "subagent-start"], agents: ["lore-implementer"] },
  { id: "mf-dyn-helper", old: ["audience: [subagent:*]", "mode: dynamic"], inject: ["subagent-start"] },
  { id: "mf-dyn-main", old: ["audience: [main]", "mode: dynamic"] },
  { id: "mf-skill-helper", old: ["audience: [main, subagent:lore-implementer]", "delivery: skill", "description: Split me"] },
];
const REFUSED_IDS = ["mf-dyn-main", "mf-skill-helper"];

function bodyOf(id: string): string {
  // reason: every line names the id — `fragments check` refuses an exact duplicate line across fragments read together.
  return `Body of ${id}, kept byte for byte.\n\n  indented line of ${id}\nlast line of ${id} without trailing newline`;
}

function fixtureText(f: Fixture): string {
  return ["---", `id: ${f.id}`, `title: "Fixture ${f.id}"`, ...f.old, "---", bodyOf(f.id)].join("\n");
}

function writeFixtures(dir: string, only?: readonly string[]): Map<string, string> {
  mkdirSync(dir, { recursive: true });
  const written = new Map<string, string>();
  for (const f of FIXTURES) {
    if (only !== undefined && !only.includes(f.id)) continue;
    const path = join(dir, `${f.id}.md`);
    writeFileSync(path, fixtureText(f), "utf8");
    written.set(path, fixtureText(f));
  }
  return written;
}

function snapshot(dir: string): Map<string, string> {
  return new Map(readdirSync(dir).map((n) => [join(dir, n), readFileSync(join(dir, n), "utf8")]));
}

/** Frontmatter object and the byte-exact text after the closing fence. */
function splitFile(text: string): { fm: Record<string, unknown>; fmText: string; rest: string } {
  const close = text.indexOf("\n---\n", 4);
  expect(close).toBeGreaterThan(0);
  const fmText = text.slice(4, close);
  return { fm: parseYaml(fmText) as Record<string, unknown>, fmText, rest: text.slice(close) };
}

const lineFor = (r: Run, path: string): string => r.stdout.split("\n").find((l) => l.startsWith(`${path}: `)) ?? "";

// ─── AC-IT-5 ────────────────────────────────────────────────────────────────

describe("AC-IT-5 lore migrate fragments", () => {
  for (const scope of ["user", "project"] as const) {
    describe(`--scope ${scope}`, () => {
      const dirOf = (sb: Sandbox): string => (scope === "user" ? sb.userCtx : sb.projectCtx);
      const cwdOf = (sb: Sandbox): string => (scope === "user" ? sb.root : sb.corpus);

      it("omitting --scope exits exactly 2", () => {
        const sb = makeSandbox();
        const r = run(sb, sb.corpus, ["migrate", "fragments"]);
        expect(r.code).toBe(2);
        expect(r.stderr).toContain("--scope");
      });

      it("preview writes nothing and prints one line per file", () => {
        const sb = makeSandbox();
        const written = writeFixtures(dirOf(sb));
        const r = run(sb, cwdOf(sb), ["migrate", "fragments", "--scope", scope]);
        expect(r.code).toBe(4);
        expect(snapshot(dirOf(sb))).toEqual(written);
        for (const path of written.keys()) expect(lineFor(r, path)).not.toBe("");
        expect(r.stdout.split("\n").filter((l) => l.includes(".md: ")).length).toBe(FIXTURES.length);
        expect(lineFor(r, join(dirOf(sb), "mf-main-rules.md"))).toContain("audience: [main]");
        expect(lineFor(r, join(dirOf(sb), "mf-main-rules.md"))).toContain("-> inject: [launch]");
      });

      it("--apply maps every shape, keeps body bytes, refuses exactly the two hand-fix shapes with exit 4, then is idempotent and check-clean", () => {
        const sb = makeSandbox();
        const before = writeFixtures(dirOf(sb));
        const r = run(sb, cwdOf(sb), ["migrate", "fragments", "--scope", scope, "--apply"]);
        expect(r.code).toBe(4);

        for (const f of FIXTURES) {
          const path = join(dirOf(sb), `${f.id}.md`);
          const after = readFileSync(path, "utf8");
          if (f.inject === undefined) {
            expect(after).toBe(before.get(path));
            expect(lineFor(r, path)).toContain("refused:");
            continue;
          }
          const { fm, rest } = splitFile(after);
          expect(fm["inject"]).toEqual(f.inject);
          expect(fm["agents"]).toEqual(f.agents);
          expect(fm["description"]).toEqual(f.description);
          for (const retired of ["audience", "mode", "delivery"]) expect(fm[retired]).toBeUndefined();
          // inject sits right after the title line
          expect(after.split("\n")[3]?.startsWith("inject: [")).toBe(true);
          // body bytes identical
          expect(rest).toBe(splitFile(before.get(path) ?? "").rest);
        }
        for (const id of REFUSED_IDS) expect(r.stderr + r.stdout).toContain(`${id}.md`);

        for (const id of REFUSED_IDS) rmSync(join(dirOf(sb), `${id}.md`));
        expect(run(sb, sb.corpus, ["context", "init"]).code).toBe(0);
        // check compares both layers' rules files, so both are refreshed (user rules land in the sandbox HOME).
        for (const refreshScope of ["project", "user"]) {
          const refreshed = run(sb, sb.corpus, ["context", "refresh", "--scope", refreshScope]);
          expect(refreshed.code, refreshed.stdout + refreshed.stderr).toBe(0);
        }
        const checked = run(sb, sb.corpus, ["fragments", "check"]);
        expect(checked.code, checked.stdout + checked.stderr).toBe(0);

        const second = run(sb, cwdOf(sb), ["migrate", "fragments", "--scope", scope, "--apply"]);
        expect(second.code).toBe(0);
        const lines = second.stdout.split("\n").filter((l) => l.includes(".md: "));
        expect(lines.length).toBe(FIXTURES.length - REFUSED_IDS.length);
        for (const l of lines) expect(l.endsWith(": unchanged")).toBe(true);
      });
    });
  }

  it("--scope project outside a lore project exits 4", () => {
    const sb = makeSandbox();
    const r = run(sb, sb.root, ["migrate", "fragments", "--scope", "project"]);
    expect(r.code).toBe(4);
  });

  it("a file modified between read and write makes --apply exit exactly 5 and keeps the concurrent writer's bytes", async () => {
    const sb = makeSandbox();
    const syncDir = join(sb.root, "sync");
    mkdirSync(syncDir, { recursive: true });
    writeFixtures(sb.userCtx, ["mf-main-rules"]);
    const path = join(sb.userCtx, "mf-main-rules.md");
    const proc = Bun.spawn([LORE_BIN, "migrate", "fragments", "--scope", "user", "--apply"], {
      cwd: sb.root,
      env: { ...sb.env, LORE_MIGRATE_FRAGMENTS_SYNC_DIR: syncDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const deadline = Date.now() + 20_000;
    while (!existsSync(join(syncDir, "reached"))) {
      if (Date.now() > deadline) throw new Error("migrate never reached its write step");
      await Bun.sleep(20);
    }
    const concurrent = `${fixtureText(FIXTURES[0] as Fixture)}\nedited by someone else\n`;
    writeFileSync(path, concurrent, "utf8");
    writeFileSync(join(syncDir, "go"), "", "utf8");
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    expect(code).toBe(5);
    expect(out).toContain("conflict");
    expect(readFileSync(path, "utf8")).toBe(concurrent);
  });

  describe("lore setup migrates automatically", () => {
    it("--project: migratable user and project files become inject with rules files, the dynamic-main file is named and setup exits exactly 4; without it a second setup exits 0", () => {
      const sb = makeSandbox();
      // `lore setup --project` refuses a repo whose main has no commit yet.
      const gitEnv = { ...sb.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
      for (const args of [["init", "-q", "-b", "main"], ["commit", "-q", "--allow-empty", "-m", "init"]]) {
        expect(Bun.spawnSync(["git", ...args], { cwd: sb.corpus, env: gitEnv }).exitCode).toBe(0);
      }
      writeFixtures(sb.userCtx, ["mf-sub-any", "mf-main-sub"]);
      writeFixtures(sb.projectCtx, ["mf-main-rules", "mf-sub-list", "mf-dyn-main"]);

      const r = run(sb, sb.corpus, ["setup", "--project", "--yes"]);
      expect(r.code).toBe(4);
      expect(r.stderr + r.stdout).toContain("mf-dyn-main.md");
      expect(splitFile(readFileSync(join(sb.userCtx, "mf-sub-any.md"), "utf8")).fm["inject"]).toEqual(["subagent-start"]);
      expect(splitFile(readFileSync(join(sb.projectCtx, "mf-main-rules.md"), "utf8")).fm["inject"]).toEqual(["launch"]);
      expect(existsSync(join(sb.corpus, ".claude", "rules", "lore-mf-main-rules.md")), r.stdout + r.stderr).toBe(true);

      rmSync(join(sb.projectCtx, "mf-dyn-main.md"));
      const second = run(sb, sb.corpus, ["setup", "--project", "--yes"]);
      expect(second.code).toBe(0);
    });

    it("global setup: a refused user file is named and setup exits exactly 4 after installing", () => {
      const sb = makeSandbox();
      writeFixtures(sb.userCtx, ["mf-main-rules", "mf-dyn-main"]);
      const r = run(sb, sb.root, ["setup", "--yes"]);
      expect(r.code).toBe(4);
      expect(r.stderr + r.stdout).toContain("mf-dyn-main.md");
      expect(splitFile(readFileSync(join(sb.userCtx, "mf-main-rules.md"), "utf8")).fm["inject"]).toEqual(["launch"]);
    });
  });
});
