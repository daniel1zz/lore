/**
 * @spec_ref AC-RID-10
 *
 * RED (TDD role) for `lore run show <id>` — spec
 * spec-run-identity-slice-1-harness-attested-runs-attested §Public interface, BR-1038.
 * `lore run` does not exist yet, so every test fails on the missing command.
 *
 * Contract pinned (the implementer MUST match it):
 *   lore run show <run id> [--json]
 *   - text: stdout names kind, parent run id, session, branch, and every composition
 *     fragment id (each verbatim).
 *   - --json: `{ok:true,data:<RunRecord>}` with camelCase RunRecord fields: id, kind,
 *     sessionRef, parentRunId, branch, agentType, composition.fragments[{id,sha256}] ...
 *   - an unregistered id: exit code 3 (DOC_NOT_FOUND/SLUG_NOT_FOUND family, per the exit-code
 *     table in src/adapters/cli/CLAUDE.md) and stderr names the id; stdout empty.
 *   Registration flags are those pinned in run-register.bun.test.ts.
 *
 * Isolation: mkdtemp HOME/XDG + throwaway `lore init` corpus; never the repo's `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const NOT_FOUND_EXIT = 3;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let root: string;
let corpus: string;

function runLore(args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd: corpus,
    env: {
      ...process.env,
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      EDITOR: "true",
      CLAUDECODE: "1",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

interface RunRecord {
  id: string;
  kind: string;
  sessionRef: string;
  agentRef: string | null;
  agentType: string | null;
  parentRunId: string | null;
  branch: string | null;
  composition: { schemaVersion: number; fragments: { id: string; sha256: string }[] };
}

const SESSION = "sess-show-77";
const MAIN_ID = `cc:${SESSION}`;
const SUB_ID = `cc:${SESSION}:agent-S1`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-run-show-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const fixtures = [
    ["run", "register", "--harness", "claude-code", "--session", SESSION, "--branch", "show-main-branch"],
    [
      "run", "register", "--harness", "claude-code", "--session", SESSION,
      "--agent-id", "agent-S1", "--agent-type", "lore-implementer", "--branch", "show-sub-branch",
    ],
  ];
  for (const args of fixtures) {
    const r = runLore(args);
    if (r.exitCode !== 0) throw new Error(`fixture register failed (${r.exitCode}): ${r.stderr}`);
  }
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function showJson(id: string): RunRecord {
  const r = runLore(["run", "show", id, "--json"]);
  expect(r.exitCode).toBe(0);
  return (JSON.parse(r.stdout) as { ok: boolean; data: RunRecord }).data;
}

describe("AC-RID-10: lore run show prints kind, parent, session, branch and composition", () => {
  it("HAPPY (json): a subagent run shows kind, parent, session, branch and fragments", () => {
    const run = showJson(SUB_ID);
    expect(run.id).toBe(SUB_ID);
    expect(run.kind).toBe("subagent");
    expect(run.parentRunId).toBe(MAIN_ID);
    expect(run.sessionRef).toBe(SESSION);
    expect(run.branch).toBe("show-sub-branch");
    expect(run.agentType).toBe("lore-implementer");
    expect(run.composition.schemaVersion).toBe(1);
    // lore-implementer receives at least the shipped agent-rules fragment
    expect(run.composition.fragments.length).toBeGreaterThan(0);
    for (const f of run.composition.fragments) {
      expect(f.id.length).toBeGreaterThan(0);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 120_000);

  it("HAPPY (json): the main run shows kind main, no parent, its own branch", () => {
    const run = showJson(MAIN_ID);
    expect(run.kind).toBe("main");
    expect(run.parentRunId).toBeNull();
    expect(run.sessionRef).toBe(SESSION);
    expect(run.branch).toBe("show-main-branch");
  }, 120_000);

  it("HAPPY (text): stdout names kind, parent run, session, branch and every fragment id", () => {
    const text = runLore(["run", "show", SUB_ID]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("subagent");
    expect(text.stdout).toContain(MAIN_ID); // parent
    expect(text.stdout).toContain(SESSION);
    expect(text.stdout).toContain("show-sub-branch");
    const ids = showJson(SUB_ID).composition.fragments.map((f) => f.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(text.stdout).toContain(id);
  }, 120_000);

  it("HAPPY: different runs show different content (not a canned answer)", () => {
    const text = runLore(["run", "show", MAIN_ID]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("show-main-branch");
    expect(text.stdout).not.toContain("show-sub-branch");
  }, 120_000);

  it("NEGATIVE: an unknown run id exits with the not-found code 3 and names the id on stderr", () => {
    const r = runLore(["run", "show", "cc:no-such-session:no-such-agent"]);
    expect(r.exitCode).toBe(NOT_FOUND_EXIT);
    expect(r.stderr).toContain("cc:no-such-session:no-such-agent");
    expect(r.stdout.trim()).toBe("");
  }, 120_000);

  it("NEGATIVE: an unknown id under --json also exits 3 (not a success envelope) and names the id", () => {
    const r = runLore(["run", "show", "cc:ghost", "--json"]);
    expect(r.exitCode).toBe(NOT_FOUND_EXIT);
    expect(r.stdout + r.stderr).toContain("cc:ghost");
  }, 120_000);

  it("BOUNDARY: an unregistered subagent id of a registered session is not found (prefix match is not enough)", () => {
    const r = runLore(["run", "show", `${MAIN_ID}:agent-never-registered`]);
    expect(r.exitCode).toBe(NOT_FOUND_EXIT);
  }, 120_000);
});
