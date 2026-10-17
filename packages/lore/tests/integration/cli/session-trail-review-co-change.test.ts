// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
// @spawns packages/lore/src/index.ts
// @reads .lore/config.yaml
/**
 * AC-ST-7: co-change rules (`workflow.turn_end.co_change`) judged by `lore session trail-review`, and relayed by
 * the turn-end hook.
 *
 * @spec_ref AC-ST-7 (spec-session-trail-a-session-local-record-of-what-each-run-4: Consumers/Co-change, Config failure, D8)
 *
 * CLI cases drive the REAL CLI (`bun run packages/lore/src/index.ts`) against a mkdtemp corpus made by `lore init`,
 * a mkdtemp HOME and a fixture trail under `CLAUDE_STATE_BASE_OVERRIDE`. Hook cases run the real Stop hook with a
 * PATH-stub `lore` (trail-review-stub.ts) in a throwaway git repo. Never this repo's `.lore/` (the last case only
 * READS it) or the real `~/.claude`.
 *
 * Coverage: HAPPY (helper finding, main-run finding, manifest present) / NEGATIVE (no rule, vcs ignored) /
 * BOUNDARY (unknown group, one finding per rule and run) / ERROR (invalid rule, malformed YAML, hook exit non-zero) /
 * STATE (invalid settings next to a helper-scope finding, not-measured line beside a block) / REGRESSION (repo config).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CoChangeRulesSchema } from "@lore/core";
import { makeFixture, parseBlock, startTurn, writeRepoFile } from "../hooks/turn-review-harness";
import { makeLoreStub, stopTurnWithStub } from "../hooks/trail-review-stub";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const ENTRY = join(PACKAGE_ROOT, "src", "index.ts");
const SESSION = "cochange-s1";
const MAIN_RUN = `cc:${SESSION}`;
const MANIFEST = "packages/lore/src/generated/assets-manifest.ts";
const RULE = ["      - name: assets-manifest", '        when: ["assets/**"]', `        require: ["${MANIFEST}"]`];

let dir: string;
let stateBase: string;
let baseConfig: string;
let turnCounter = 0;
let agentCounter = 0;

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function lore(args: string[], run?: string): CliResult {
  const env: Record<string, string | undefined> = { ...process.env, HOME: dir, CLAUDECODE: "1", CLAUDE_STATE_BASE_OVERRIDE: stateBase, CLAUDE_CODE_SESSION_ID: "cochange-author" };
  for (const name of ["LORE_ACTOR", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS"]) delete env[name];
  const argv = run === undefined ? args : ["--harness-run", run, ...args];
  const proc = spawnSync("bun", ["run", ENTRY, ...argv], { cwd: dir, env, encoding: "utf8" });
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status ?? 1 };
}

function must(args: string[]): CliResult {
  const r = lore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

/** Replaces the project's config with the `lore init` text plus `snippet` (the turn_end block, or raw text). */
function setConfig(snippet: string): void {
  writeFileSync(join(dir, ".lore", "config.yaml"), `${baseConfig}\n${snippet}\n`);
}

function turnEnd(...lines: string[]): string {
  return ["workflow:", "  turn_end:", ...lines].join("\n");
}

const rulesConfig = (): string => turnEnd("    co_change:", ...RULE);

interface ChangeFixture {
  readonly path: string;
  readonly source: { kind: "run"; run: string } | { kind: "vcs" } | { kind: "unknown" };
}

/** A fresh turn with a changes.json; returns its id. */
function writeTurn(changes: ChangeFixture[]): string {
  turnCounter += 1;
  const id = `turn-c${turnCounter}`;
  const turnDir = join(stateBase, "sessions", SESSION, id);
  mkdirSync(turnDir, { recursive: true });
  const value = changes.map((c) => ({ path: c.path, status: "M", lines: 1, source: c.source }));
  writeFileSync(join(turnDir, "changes.json"), JSON.stringify({ turn: id, at: "2026-01-01T00:00:00.000Z", shared_working_copy: false, changes: { measured: true, value } }));
  return id;
}

/** An unjudged, isolated helper that changed `files`; returns its agent id and run id. */
function writeHelper(files: string[]): { agent: string; run: string } {
  agentCounter += 1;
  const agent = `K${agentCounter}`;
  const run = `${MAIN_RUN}:${agent}`;
  const helpers = join(stateBase, "sessions", SESSION, "helpers");
  mkdirSync(helpers, { recursive: true });
  const record = {
    run,
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:01:00.000Z",
    end_count: 1,
    working_copy: join(dir, "wt", agent),
    isolated: true,
    changes: { measured: true, value: { base: "abc", files: files.map((path) => ({ path, status: "M", lines: 1, source: { kind: "run", run } })) } },
  };
  writeFileSync(join(helpers, `${agent}.json`), JSON.stringify(record));
  return { agent, run };
}

/** Marks every helper written so far as judged so a case sees only the helpers it writes next. */
function judgeAllHelpers(): void {
  for (let n = 1; n <= agentCounter; n++) writeFileSync(join(stateBase, "sessions", SESSION, "helpers", `K${n}.judged.json`), JSON.stringify({ judged_end_count: 1 }));
}

interface Finding {
  readonly kind: string;
  readonly message: string;
  readonly rule?: string;
  readonly run?: string;
  readonly group?: string;
  readonly files?: string[];
}
interface CoChange {
  readonly measured: boolean;
  readonly reason?: string;
  readonly findings?: Finding[];
}

function review(turn: string): { findings: Finding[]; coChange: CoChange; notMeasured: string[]; result: CliResult } {
  const result = lore(["session", "trail-review", "--turn", turn, "--json"], MAIN_RUN);
  expect(result.exitCode, result.stderr + result.stdout).toBe(0);
  const data = (JSON.parse(result.stdout) as { data: { findings: Finding[]; co_change: CoChange; not_measured: string[] } }).data;
  return { findings: data.findings, coChange: data.co_change, notMeasured: data.not_measured, result };
}

const coChangeFindings = (findings: Finding[]): Finding[] => findings.filter((f) => f.kind === "co-change");

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "trail-review-cochange-")));
  stateBase = join(dir, "state");
  must(["init"]);
  baseConfig = readFileSync(join(dir, ".lore", "config.yaml"), "utf8");
  for (const agent of ["", ...Array.from({ length: 12 }, (_, i) => `K${i + 1}`)]) {
    must(["run", "register", "--harness", "claude-code", "--session", SESSION, ...(agent ? ["--agent-id", agent, "--agent-type", "lore-implementer"] : [])]);
  }
  mkdirSync(join(stateBase, "sessions", SESSION), { recursive: true });
  writeFileSync(join(stateBase, "sessions", SESSION, "session.json"), JSON.stringify({ started_at: "2026-01-01T00:00:00.000Z" }));
}, 300_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-ST-7 co-change judgment in trail-review", () => {
  it("AC-ST-7 a helper run that changed assets/x.md only is a finding naming rule, run and file", () => {
    setConfig(rulesConfig());
    const { run } = writeHelper(["assets/x.md"]);
    const { findings, coChange } = review(writeTurn([]));
    expect(coChange.measured).toBe(true);
    const f = coChangeFindings(findings);
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toBe("assets-manifest");
    expect(f[0]!.run).toBe(run);
    expect(f[0]!.files).toEqual(["assets/x.md"]);
    expect(f[0]!.message).toContain("assets-manifest");
    expect(f[0]!.message).toContain(run);
    expect(f[0]!.message).toContain("assets/x.md");
    judgeAllHelpers();
  }, 120_000);

  it("AC-ST-7 no finding when the run also changed the manifest", () => {
    setConfig(rulesConfig());
    writeHelper(["assets/x.md", MANIFEST]);
    expect(coChangeFindings(review(writeTurn([])).findings)).toEqual([]);
    judgeAllHelpers();
  }, 120_000);

  it("AC-ST-7 unknown-source assets/y.md is one finding for the unknown group", () => {
    setConfig(rulesConfig());
    const { findings } = review(writeTurn([{ path: "assets/y.md", source: { kind: "unknown" } }, { path: "assets/z.md", source: { kind: "unknown" } }]));
    const f = coChangeFindings(findings);
    expect(f).toHaveLength(1);
    expect(f[0]!.group).toBe("unknown");
    expect(f[0]!.run).toBeUndefined();
    expect(f[0]!.files).toEqual(["assets/y.md", "assets/z.md"]);
    expect(f[0]!.message).toContain("assets-manifest");
    expect(f[0]!.message).toContain("assets/y.md");
  }, 120_000);

  it("AC-ST-7 the unknown group is one group: a manifest change from an unknown source satisfies the rule", () => {
    setConfig(rulesConfig());
    const { findings } = review(writeTurn([{ path: "assets/y.md", source: { kind: "unknown" } }, { path: MANIFEST, source: { kind: "unknown" } }]));
    expect(coChangeFindings(findings)).toEqual([]);
  }, 120_000);

  it("AC-ST-7 the main run is judged from changes.json; a vcs change is never judged", () => {
    setConfig(rulesConfig());
    const turn = writeTurn([
      { path: "assets/m.md", source: { kind: "run", run: MAIN_RUN } },
      { path: "assets/merged.md", source: { kind: "vcs" } },
    ]);
    const f = coChangeFindings(review(turn).findings);
    expect(f).toHaveLength(1);
    expect(f[0]!.run).toBe(MAIN_RUN);
    expect(f[0]!.files).toEqual(["assets/m.md"]);
  }, 120_000);

  it("AC-ST-7 no rule configured: no co-change finding and co_change is measured", () => {
    setConfig(turnEnd("    main_session_source_edits: off"));
    writeHelper(["assets/x.md"]);
    const { findings, coChange } = review(writeTurn([{ path: "assets/y.md", source: { kind: "unknown" } }]));
    expect(coChange.measured).toBe(true);
    expect(coChangeFindings(findings)).toEqual([]);
    judgeAllHelpers();
  }, 120_000);

  it("AC-ST-7 a rule missing require exits 0 with co_change measured:false naming the key path, and the helper scope finding is still reported", () => {
    setConfig(turnEnd("    co_change:", "      - name: broken", '        when: ["assets/**"]'));
    const { agent } = writeHelper(["assets/x.md"]); // claims no task: a helper-scope finding
    const { findings, coChange, notMeasured } = review(writeTurn([]));
    expect(coChange.measured).toBe(false);
    expect(coChange.reason).toContain("workflow.turn_end.co_change[0].require");
    expect(coChangeFindings(findings)).toEqual([]);
    expect(findings.some((f) => f.kind === "no-claimed-task" && f.message.includes(agent))).toBe(true);
    expect(notMeasured.join("\n")).toContain("workflow.turn_end.co_change[0].require");
    judgeAllHelpers();
  }, 120_000);

  it("AC-ST-7 malformed YAML in the config reports co_change not measured and still exits 0", () => {
    setConfig("workflow: [unclosed");
    const { coChange } = review(writeTurn([]));
    expect(coChange.measured).toBe(false);
    expect(coChange.reason).toContain("config.yaml");
  }, 120_000);

  it("AC-ST-7 an empty when list is invalid and names its key path", () => {
    setConfig(turnEnd("    co_change:", "      - name: r", "        when: []", '        require: ["a"]'));
    const { coChange } = review(writeTurn([]));
    expect(coChange.measured).toBe(false);
    expect(coChange.reason).toContain("workflow.turn_end.co_change[0].when");
  }, 120_000);
});

describe("AC-ST-7 turn-end hook relay", () => {
  const finding = { kind: "co-change", rule: "assets-manifest", run: MAIN_RUN, files: ["assets/x.md"], message: "Co-change rule assets-manifest: run cc:S changed assets/x.md but none of packages/lore/src/generated/assets-manifest.ts" };

  function hookFixture(sid: string) {
    const f = makeFixture(sid);
    const stub = makeLoreStub();
    mkdirSync(join(f.repo, ".lore"), { recursive: true });
    writeFileSync(join(f.repo, ".lore", "config.yaml"), `${turnEnd("    co_change:", ...RULE)}\n`);
    return { f, stub, cleanup: () => [f.repo, f.base, stub.binDir].forEach((p) => rmSync(p, { recursive: true, force: true })) };
  }

  it("AC-ST-7 a relayed co-change finding is in the single block", () => {
    const { f, stub, cleanup } = hookFixture("cochange-h1");
    try {
      stub.reply({ stdout: JSON.stringify({ ok: true, data: { helpers: [], findings: [finding], co_change: { measured: true, findings: [finding] }, not_measured: [] } }) });
      startTurn(f);
      writeRepoFile(f.repo, "notes.txt", "x\n");
      const block = parseBlock(stopTurnWithStub(f, stub));
      expect(block.decision).toBe("block");
      expect(block.reason).toContain("Co-change rule assets-manifest");
      expect(stub.reviewCalls()).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("AC-ST-7 a non-zero trail-review prints one not-measured line and exits 0", () => {
    const { f, stub, cleanup } = hookFixture("cochange-h2");
    try {
      stub.reply({ exit: 5, stdout: "" });
      startTurn(f);
      const r = stopTurnWithStub(f, stub);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr.split("\n").filter((l) => l.includes("not measured"))).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("AC-ST-7 the not-measured line for invalid settings is printed alongside a block when one exists", () => {
    const { f, stub, cleanup } = hookFixture("cochange-h3");
    try {
      const reason = "co_change not measured: workflow.turn_end.co_change[0].require is required";
      stub.reply({ stdout: JSON.stringify({ ok: true, data: { helpers: [], findings: [{ kind: "outside-anchors", message: "Helper A1 changed src/x.ts outside anchors" }], co_change: { measured: false, reason }, not_measured: [reason] } }) });
      startTurn(f);
      const r = stopTurnWithStub(f, stub);
      const block = parseBlock(r);
      expect(block.decision).toBe("block");
      expect(block.reason).toContain("Helper A1 changed src/x.ts");
      expect(block.reason).toContain("workflow.turn_end.co_change[0].require");
      expect(r.stderr).toContain("workflow.turn_end.co_change[0].require");
    } finally {
      cleanup();
    }
  });
});

describe("AC-ST-7 this repo's own rule", () => {
  it("AC-ST-7 .lore/config.yaml declares the assets-manifest rule and it passes the core schema", () => {
    const config = parseYaml(readFileSync(join(REPO_ROOT, ".lore", "config.yaml"), "utf8")) as { workflow?: { turn_end?: { co_change?: unknown } } };
    const parsed = CoChangeRulesSchema.safeParse(config.workflow?.turn_end?.co_change);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual([{ name: "assets-manifest", when: ["assets/**"], require: [MANIFEST] }]);
  });
});
