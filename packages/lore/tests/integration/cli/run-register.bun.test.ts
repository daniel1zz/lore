// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-RID-1
 *
 * RED (TDD role) for `lore run register` — spec
 * spec-run-identity-slice-1-harness-attested-runs-attested, D2 + BR-1027/BR-1029.
 * `lore run` does not exist yet, so every test here fails on the missing command.
 *
 * ## CLI CONTRACT THIS FILE PINS (the implementer MUST match it)
 *
 *   lore run register --harness <name> --session <session_id>
 *                     [--agent-id <agent_id> --agent-type <type>]
 *                     [--parent <run id>] [--branch <name>] [--json]
 *
 *   - `--harness claude-code` (the only harness in slice 1; any other value is refused).
 *   - Without `--agent-id` the run is the MAIN run, id `cc:<session>`, kind "main".
 *   - With `--agent-id` the run is a SUBAGENT, id `cc:<session>:<agent_id>`, kind
 *     "subagent", `--agent-type` is stored as its agent type, and its parent is the
 *     session's main run `cc:<session>` (derived, D2).
 *   - `--parent` / `--branch` are optional caller-supplied hints. `--branch` is stored as the
 *     run's branch on FIRST registration. A second registration of the same id is a no-op
 *     (first wins, BR-1029): exit 0, no stored column changes, whatever `--parent` / `--branch`
 *     it carries.
 *   - Registration exits 0 and prints the registered run id on stdout (text) or
 *     `{ok:true,data:<RunRecord>}` with `--json`.
 *   - Stored rows are read back through `lore run show <id> --json`, whose envelope is
 *     `{ok:true,data:<RunRecord>}` with the RunRecord camelCase fields of the spec's
 *     §Public interface: id, kind, harness, sessionRef, agentRef, agentType, parentRunId,
 *     branch, composition, registeredAt. (run-show.bun.test.ts pins `show` itself.)
 *   - Unknown run id for `show`: exit code 3 (NOT_FOUND family).
 *
 * Isolation: every test uses a mkdtemp HOME + XDG_CONFIG_HOME + a throwaway `lore init`
 * corpus (cwd). NEVER touches the repo's own `.lore/`.
 *
 * Six dimensions: HAPPY (three distinct runs, parent links), NEGATIVE (unknown harness,
 * missing session), BOUNDARY (same agent id in another session), STATE (idempotent
 * re-registration of main and of a subagent, with different parent/branch),
 * REGRESSION (a re-registration never creates or alters another row).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface Sandbox {
  root: string;
  corpus: string;
}

function runLore(sb: Sandbox, args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd: sb.corpus,
    env: {
      ...process.env,
      HOME: join(sb.root, "home"),
      XDG_CONFIG_HOME: join(sb.root, "xdg"),
      EDITOR: "true",
      CLAUDECODE: "1",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "lore-run-register-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  const corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const sb = { root, corpus };
  const init = runLore(sb, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  return sb;
}

interface RegisterOpts {
  session: string;
  agentId?: string;
  agentType?: string;
  parent?: string;
  branch?: string;
  harness?: string;
}

function register(sb: Sandbox, o: RegisterOpts): RunResult {
  const args = ["run", "register", "--harness", o.harness ?? "claude-code", "--session", o.session];
  if (o.agentId !== undefined) args.push("--agent-id", o.agentId);
  if (o.agentType !== undefined) args.push("--agent-type", o.agentType);
  if (o.parent !== undefined) args.push("--parent", o.parent);
  if (o.branch !== undefined) args.push("--branch", o.branch);
  return runLore(sb, args);
}

interface RunRecord {
  id: string;
  kind: string;
  harness: string;
  sessionRef: string;
  agentRef: string | null;
  agentType: string | null;
  parentRunId: string | null;
  branch: string | null;
  composition: { schemaVersion: number; fragments: { id: string; sha256: string }[] };
  registeredAt: string;
}

function showRun(sb: Sandbox, id: string): RunRecord {
  const r = runLore(sb, ["run", "show", id, "--json"]);
  if (r.exitCode !== 0) throw new Error(`lore run show ${id} exited ${r.exitCode}: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { ok: boolean; data: RunRecord }).data;
}

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  try {
    rmSync(sb.root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

const SESSION = "sess-reg-0001";
const A1 = `cc:${SESSION}:agent-A1`;
const A2 = `cc:${SESSION}:agent-A2`;
const MAIN = `cc:${SESSION}`;

describe("AC-RID-1: run registration derives distinct runs and links subagents to the main run", () => {
  it("HAPPY: main + two subagents of one session register as three distinct runs", () => {
    for (const o of [
      { session: SESSION, branch: "main" },
      { session: SESSION, agentId: "agent-A1", agentType: "lore-implementer", branch: "wt-a1" },
      { session: SESSION, agentId: "agent-A2", agentType: "lore-reviewer", branch: "wt-a2" },
    ]) {
      const r = register(sb, o);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    }

    const main = showRun(sb, MAIN);
    const a1 = showRun(sb, A1);
    const a2 = showRun(sb, A2);
    expect(new Set([main.id, a1.id, a2.id]).size).toBe(3);
    expect([main.kind, a1.kind, a2.kind]).toEqual(["main", "subagent", "subagent"]);
    expect([main.agentRef, a1.agentRef, a2.agentRef]).toEqual([null, "agent-A1", "agent-A2"]);
    expect([a1.agentType, a2.agentType]).toEqual(["lore-implementer", "lore-reviewer"]);
    expect([main.harness, a1.harness, a2.harness]).toEqual(["claude-code", "claude-code", "claude-code"]);
    expect([main.sessionRef, a1.sessionRef, a2.sessionRef]).toEqual([SESSION, SESSION, SESSION]);
    expect([main.branch, a1.branch, a2.branch]).toEqual(["main", "wt-a1", "wt-a2"]);
  }, 120_000);

  it("HAPPY: each subagent's parent is the main run cc:<session>; the main run has no parent", () => {
    register(sb, { session: SESSION, branch: "main" });
    register(sb, { session: SESSION, agentId: "agent-A1", agentType: "lore-implementer" });
    register(sb, { session: SESSION, agentId: "agent-A2", agentType: "lore-reviewer" });

    expect(showRun(sb, MAIN).parentRunId).toBeNull();
    expect(showRun(sb, A1).parentRunId).toBe(MAIN);
    expect(showRun(sb, A2).parentRunId).toBe(MAIN);
  }, 120_000);

  it("BOUNDARY: the same agent id in a different session is a different run with that session's parent", () => {
    register(sb, { session: "sess-one" });
    register(sb, { session: "sess-two" });
    register(sb, { session: "sess-one", agentId: "agent-X", agentType: "lore-implementer" });
    register(sb, { session: "sess-two", agentId: "agent-X", agentType: "lore-implementer" });

    expect(showRun(sb, "cc:sess-one:agent-X").parentRunId).toBe("cc:sess-one");
    expect(showRun(sb, "cc:sess-two:agent-X").parentRunId).toBe("cc:sess-two");
  }, 120_000);

  it("STATE: re-registering the main run with a different parent and branch changes no stored column", () => {
    register(sb, { session: SESSION, branch: "branch-first" });
    const before = showRun(sb, MAIN);
    expect(before.branch).toBe("branch-first"); // liveness: first registration stored the branch

    const again = register(sb, { session: SESSION, parent: "cc:some-other-session", branch: "branch-second" });
    expect(again.exitCode).toBe(0);
    expect(showRun(sb, MAIN)).toEqual(before);
  }, 120_000);

  it("STATE: re-registering a subagent with a different parent and branch changes no stored column", () => {
    register(sb, { session: SESSION, branch: "main" });
    register(sb, { session: SESSION, agentId: "agent-A1", agentType: "lore-implementer", branch: "wt-first" });
    const before = showRun(sb, A1);
    expect(before.parentRunId).toBe(MAIN);
    expect(before.branch).toBe("wt-first");

    const again = register(sb, {
      session: SESSION,
      agentId: "agent-A1",
      agentType: "lore-reviewer",
      parent: "cc:forged-parent",
      branch: "wt-second",
    });
    expect(again.exitCode).toBe(0);
    expect(showRun(sb, A1)).toEqual(before);
  }, 120_000);

  it("REGRESSION: re-registration leaves the sibling rows untouched and creates no duplicate", () => {
    register(sb, { session: SESSION, branch: "m1" });
    register(sb, { session: SESSION, agentId: "agent-A1", agentType: "lore-implementer", branch: "b1" });
    register(sb, { session: SESSION, agentId: "agent-A2", agentType: "lore-reviewer", branch: "b2" });
    const snapshot = [MAIN, A1, A2].map((id) => showRun(sb, id));

    register(sb, { session: SESSION, parent: "cc:x", branch: "m2" });
    register(sb, { session: SESSION, agentId: "agent-A1", agentType: "lore-implementer", parent: "cc:x", branch: "b9" });

    const after = [MAIN, A1, A2].map((id) => showRun(sb, id));
    expect(after).toEqual(snapshot);
    expect(new Set(after.map((r) => r.id)).size).toBe(3);
  }, 120_000);

  it("NEGATIVE: an unknown harness is refused (non-zero), names the value, and registers nothing", () => {
    const r = register(sb, { session: SESSION, harness: "no-such-harness" });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("no-such-harness");
    // control that `show` is live and the refusal created no run: NOT_FOUND is exit 3
    expect(runLore(sb, ["run", "show", MAIN]).exitCode).toBe(3);
  }, 120_000);

  it("NEGATIVE: registering without --session is refused (non-zero) and names the missing flag", () => {
    const r = runLore(sb, ["run", "register", "--harness", "claude-code"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("session");
  }, 120_000);
});
