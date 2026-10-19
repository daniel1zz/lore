// @spawns packages/lore/src/index.ts
/**
 * AC-ST-8: `lore run tasks` and the helper-scope judgment of `lore session trail-review`.
 *
 * @spec_ref AC-ST-8 (spec-session-trail-a-session-local-record-of-what-each-run-4: Consumers/Helper scope, Run -> tasks, D9)
 *
 * Drives the REAL CLI (`bun run packages/lore/src/index.ts`) against a mkdtemp corpus created with
 * `lore init`, a mkdtemp HOME and a fixture trail under `CLAUDE_STATE_BASE_OVERRIDE` — never this
 * repo's `.lore/` or the real `~/.claude`.
 *
 * Coverage: HAPPY (released + archived claims listed; outside-anchors finding) / NEGATIVE (unknown run,
 * no claimed task) / BOUNDARY (directory anchor, helper that changed nothing, judged helper skipped) /
 * ERROR (no .lore directory) / STATE (file named only by an edit record, outside the working copy).
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(PACKAGE_ROOT, "src", "index.ts");
const SESSION = "scope-s1";
const MAIN_RUN = `cc:${SESSION}`;

let dir: string;
let stateBase: string;
let planSlug: string;

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function lore(args: string[], opts: { run?: string; cwd?: string } = {}): CliResult {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // reason: DCL-1 (b) — the archived task below needs a state-bound attested pass, which needs a CLEAN git tree:
    // HOME (bun's cache) must lie outside the fixture repository.
    HOME: FIXTURE_HOME_OUTSIDE_REPO,
    CLAUDECODE: "1",
    CLAUDE_STATE_BASE_OVERRIDE: stateBase,
    CLAUDE_CODE_SESSION_ID: "scope-author",
  };
  for (const name of ["LORE_ACTOR", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS"]) delete env[name];
  const argv = opts.run === undefined ? args : ["--harness-run", opts.run, ...args];
  const proc = spawnSync("bun", ["run", ENTRY, ...argv], { cwd: opts.cwd ?? dir, env, encoding: "utf8" });
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status ?? 1 };
}

function must(args: string[], opts: { run?: string; cwd?: string } = {}): CliResult {
  const r = lore(args, opts);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function registerRun(session: string, agent?: string): void {
  must(["run", "register", "--harness", "claude-code", "--session", session, ...(agent ? ["--agent-id", agent, "--agent-type", "lore-implementer"] : [])]);
}

let taskCounter = 0;
/** A task with `anchors`, claimed by helper `agent` of the main session; optionally released or archived. */
function claimedTask(agent: string, anchors: string[], after: "release" | "archive" | "keep" = "release"): string {
  taskCounter += 1;
  const slug = slugOf(
    must(["create", "task", "--title", `Scope task ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai", ...anchors.flatMap((a) => ["--anchor", a])]).stdout,
  );
  const run = `${MAIN_RUN}:${agent}`;
  // reason: the fixture is a git repository now (see beforeAll), where a claim must record its worktree. One working
  // copy carries one unlanded task (BR-1337), so each task claims its own branch.
  const branch = `scope-branch-${taskCounter}`;
  const made = spawnSync("git", ["branch", branch, "main"], { cwd: dir, encoding: "utf8" });
  if (made.status !== 0) throw new Error(`git branch ${branch} failed: ${made.stderr}`);
  must(["claim", slug, "--worktree", branch], { run });
  if (after === "release") must(["release", slug], { run });
  if (after === "archive") {
    must(["release", slug], { run });
    // archival needs the landing `lore integrate` records (BR-1291); the branch holds nothing past main, so it is
    // found already integrated and the landing is recorded on its claimant
    must(["integrate", branch, "--session", "scope-integrate"]);
    // `set --status archived` applies the `lore done` floors (DCL-1 (b)): a runner-captured pass first.
    must(["evidence", slug, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"]);
    must(["set", slug, "--status", "archived"]);
  }
  return slug;
}

interface HelperFixture {
  readonly agent: string;
  readonly endCount?: number;
  readonly judged?: number;
  readonly workingCopy?: string;
  readonly files?: string[];
  readonly unmeasured?: boolean;
}

function writeHelper(h: HelperFixture): void {
  const helpers = join(stateBase, "sessions", SESSION, "helpers");
  mkdirSync(helpers, { recursive: true });
  const run = `${MAIN_RUN}:${h.agent}`;
  const record = {
    run,
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:01:00.000Z",
    end_count: h.endCount ?? 1,
    working_copy: h.workingCopy ?? join(dir, "wt", h.agent),
    isolated: true,
    changes: h.unmeasured
      ? { measured: false, reason: "not isolated" }
      : { measured: true, value: { base: "abc", files: (h.files ?? []).map((path) => ({ path, status: "M", lines: 1, source: { kind: "run", run } })) } },
  };
  writeFileSync(join(helpers, `${h.agent}.json`), JSON.stringify(record));
  if (h.judged !== undefined) writeFileSync(join(helpers, `${h.agent}.judged.json`), JSON.stringify({ judged_end_count: h.judged }));
}

function writeEdit(agent: string, file: string): void {
  const turn = join(stateBase, "sessions", SESSION, "turn-1");
  mkdirSync(turn, { recursive: true });
  appendFileSync(join(turn, "edited-files.jsonl"), `${JSON.stringify({ file, ts: 1, agent_id: agent, agent_type: "lore-implementer" })}\n`);
}

interface Finding {
  readonly kind: string;
  readonly helper: string;
  readonly file?: string;
  readonly tasks?: string[];
  readonly message: string;
}

function review(cwd?: string): { result: CliResult; findings: Finding[] } {
  const result = lore(["session", "trail-review", "--turn", "turn-1", "--json"], { run: MAIN_RUN, ...(cwd ? { cwd } : {}) });
  expect(result.exitCode, result.stderr + result.stdout).toBe(0);
  const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { findings: Finding[] } };
  expect(parsed.ok).toBe(true);
  return { result, findings: parsed.data.findings };
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "trail-review-scope-")));
  stateBase = join(dir, "state");
  makeCleanTreeRepo(dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), "state/\n.claude/\n"); // `lore integrate` keeps its worktree under .claude/
  must(["init"]);
  appendFileSync(join(dir, ".lore", "config.yaml"), ["workflow:", "  gates:", "    task-claim:", "      enabled: false", "  integrate:", '    floor_command: "true"', ""].join("\n"));
  const prd = slugOf(must(["create", "prd", "--title", "Scope PRD", "--content", "root", "--no-ai"]).stdout);
  planSlug = slugOf(must(["create", "plan", "--title", "Scope Plan", "--parent", prd, "--content", "x", "--no-ai"]).stdout);
  registerRun(SESSION);
  for (const agent of ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"]) registerRun(SESSION, agent);
  mkdirSync(join(stateBase, "sessions", SESSION, "turn-1"), { recursive: true });
  writeFileSync(join(stateBase, "sessions", SESSION, "session.json"), JSON.stringify({ started_at: "2026-01-01T00:00:00.000Z" }));
}, 300_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-ST-8 lore run tasks", () => {
  it("AC-ST-8 lists a task the run claimed then released, with its anchors", () => {
    const slug = claimedTask("H1", ["src/a/", "docs/x.md"], "release");
    const r = lore(["run", "tasks", `${MAIN_RUN}:H1`, "--json"]);
    expect(r.exitCode, r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { tasks: Array<{ slug: string; file_anchors: string[] }> } }).data;
    expect(data.tasks.map((t) => t.slug)).toEqual([slug]);
    expect(data.tasks[0]!.file_anchors).toEqual(["src/a/", "docs/x.md"]);
  }, 120_000);

  it("AC-ST-8 lists a task the run claimed that is now archived", () => {
    const slug = claimedTask("H2", ["src/arch.ts"], "archive");
    const r = lore(["run", "tasks", `${MAIN_RUN}:H2`, "--json"]);
    expect(r.exitCode, r.stderr).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { tasks: Array<{ slug: string; status: string; file_anchors: string[] }> } }).data;
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({ slug, status: "archived", file_anchors: ["src/arch.ts"] });
  }, 120_000);

  it("AC-ST-8 an unregistered run id exits 4 naming it", () => {
    const r = lore(["run", "tasks", "cc:never-registered:Z9", "--json"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("cc:never-registered:Z9");
  }, 60_000);
});

describe("AC-ST-8 trail-review helper scope", () => {
  it("AC-ST-8 a helper file outside its task anchors is a finding naming helper, task and file", () => {
    const slug = claimedTask("H3", ["src/a.ts"], "keep");
    writeHelper({ agent: "H3", files: ["src/a.ts", "src/other.ts"] });
    const { findings } = review();
    const f = findings.filter((x) => x.helper === "H3");
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("outside-anchors");
    expect(f[0]!.message).toContain("H3");
    expect(f[0]!.message).toContain(slug);
    expect(f[0]!.message).toContain("src/other.ts");
    expect(f[0]!.message).not.toContain("src/a.ts ");
  }, 120_000);

  it("AC-ST-8 no finding when directory anchor src/ covers src/a/b.ts", () => {
    claimedTask("H4", ["src/"], "release");
    writeHelper({ agent: "H4", files: ["src/a/b.ts"] });
    expect(review().findings.filter((x) => x.helper === "H4")).toEqual([]);
  }, 120_000);

  it("AC-ST-8 a helper that wrote by absolute path into the main checkout is a finding", () => {
    claimedTask("H5", ["src/"], "keep");
    writeHelper({ agent: "H5", workingCopy: join(dir, "wt", "H5"), files: [] });
    writeEdit("H5", join(dir, "src", "leak.ts"));
    const f = review().findings.filter((x) => x.helper === "H5");
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("outside-working-copy");
    expect(f[0]!.message).toContain(join(dir, "src", "leak.ts"));
  }, 120_000);

  it("AC-ST-8 changed files with no claimed task are a finding", () => {
    writeHelper({ agent: "H6", files: ["src/x.ts"] });
    const f = review().findings.filter((x) => x.helper === "H6");
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("no-claimed-task");
    expect(f[0]!.message).toContain("H6");
  }, 120_000);

  it("AC-ST-8 a helper that changed nothing has no finding, claimed task or not", () => {
    writeHelper({ agent: "H7", files: [] });
    writeHelper({ agent: "H8", unmeasured: true });
    const findings = review().findings;
    expect(findings.filter((x) => x.helper === "H7" || x.helper === "H8")).toEqual([]);
  }, 120_000);

  it("AC-ST-8 an already judged helper end is not judged again", () => {
    writeHelper({ agent: "H6", files: ["src/x.ts"], endCount: 2, judged: 2 });
    expect(review().findings.filter((x) => x.helper === "H6")).toEqual([]);
  }, 120_000);

  it("AC-ST-8 no .lore directory: exit 0 and no finding", () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "trail-review-bare-")));
    try {
      writeHelper({ agent: "H6", files: ["src/x.ts"], endCount: 3, judged: 0 });
      const { findings } = review(bare);
      expect(findings).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  }, 120_000);
});
