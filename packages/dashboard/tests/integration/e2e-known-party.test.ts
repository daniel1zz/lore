// @spawns packages/lore/src/index.ts
/**
 * The dashboard e2e harness writes as a KNOWN PARTY (BR-1351): it opens a human session in its throwaway checkout and
 * spawns `lore` with no agent harness marker (GitHub #317). This drives the REAL `lore` entry in a mkdtemp corpus.
 *
 * The WRITES under test are started through `/bin/sh -c`, a shell-string start which the test run's spawn rewrite
 * (scripts/test-known-party-spawn.ts) never touches, so no agent run is injected and a write succeeds ONLY through
 * the human session. (`startHumanSession` itself uses `node:child_process`, which the rewrite does touch; the session
 * binding it makes is what the later writes prove.)
 *
 * Six-dimension coverage: HAPPY (write succeeds under the session), NEGATIVE (the same write is refused without it,
 * and with the CLAUDECODE marker left in), STATE (refused again after `session end`), BOUNDARY (an empty state dir),
 * ERROR (`session start` outside a corpus throws), REGRESSION (CLAUDECODE/LORE_ACTOR stripped from the child env).
 *
 * @spec_ref spec-every-write-is-made-by-a-known-party-an-attested-agent-run
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { endHumanSession, knownPartyEnv, startHumanSession } from "../e2e/known-party.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const LORE: readonly [string, ...string[]] = ["bun", ENTRY];

/** One un-rewritten `lore` run; returns its exit status and stderr. */
function lore(args: string[], cwd: string, env: NodeJS.ProcessEnv): { status: number; stderr: string } {
  // reason: a shell-string start is never rewritten by the test run's spawn shim, so no agent run is injected.
  const quoted = [ENTRY, ...args].map((token) => `'${token.replaceAll("'", "'\\''")}'`).join(" ");
  const proc = spawnSync("/bin/sh", ["-c", `bun ${quoted}`], { cwd, env, encoding: "utf8" });
  if (proc.status === null) throw new Error(`lore ${args.join(" ")} did not exit: ${String(proc.error)}`);
  return { status: proc.status, stderr: proc.stderr };
}

const CREATE = ["create", "prd", "--title", "Known party probe", "--content", "probe", "--json"];

describe("e2e known-party helper", () => {
  const dirs: string[] = [];
  let stateHome: string;
  let corpus: string;

  beforeAll(() => {
    stateHome = mkdtempSync(join(tmpdir(), "lore-e2e-kp-state-"));
    corpus = mkdtempSync(join(tmpdir(), "lore-e2e-kp-corpus-"));
    dirs.push(stateHome, corpus);
    expect(lore(["init", "--author", "e2e-runner"], corpus, knownPartyEnv(stateHome)).status).toBe(0);
  });

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a write with no session (NEGATIVE)", () => {
    const run = lore(CREATE, corpus, knownPartyEnv(stateHome));
    expect(run.status, run.stderr).toBe(4);
  });

  it("refuses a write when CLAUDECODE=1 is left in even under a session (NEGATIVE)", () => {
    startHumanSession(LORE, corpus, stateHome);
    try {
      const run = lore(CREATE, corpus, { ...knownPartyEnv(stateHome), CLAUDECODE: "1" });
      expect(run.status, run.stderr).toBe(4);
    } finally {
      endHumanSession(LORE, corpus, stateHome);
    }
  });

  it("accepts the write under the human session, refuses it again after `session end` (HAPPY, STATE)", () => {
    startHumanSession(LORE, corpus, stateHome);
    const during = lore(CREATE, corpus, knownPartyEnv(stateHome));
    expect(during.status, during.stderr).toBe(0);
    endHumanSession(LORE, corpus, stateHome);
    const after = lore(CREATE, corpus, knownPartyEnv(stateHome));
    expect(after.status, after.stderr).toBe(4);
  });

  it("strips the agent harness marker and identity variables from the child env (REGRESSION)", () => {
    const env = knownPartyEnv("/tmp/state", { KEEP: "1" }, { CLAUDECODE: "1", LORE_ACTOR: "x", CLAUDE_CODE_SESSION_ID: "s", PATH: "/bin" });
    expect(env["CLAUDECODE"]).toBeUndefined();
    expect(env["LORE_ACTOR"]).toBeUndefined();
    expect(env["CLAUDE_CODE_SESSION_ID"]).toBeUndefined();
    expect(env["PATH"]).toBe("/bin");
    expect(env["LORE_STATE_HOME"]).toBe("/tmp/state");
    expect(env["KEEP"]).toBe("1");
  });

  it("lets a caller set LORE_ACTOR deliberately after the scrub (BOUNDARY)", () => {
    expect(knownPartyEnv("/tmp/state", { LORE_ACTOR: "agent:x" }, { LORE_ACTOR: "old" })["LORE_ACTOR"]).toBe("agent:x");
  });

  it("refuses an empty state dir (BOUNDARY)", () => {
    expect(() => knownPartyEnv("")).toThrow(/stateHome is empty/);
  });

  it("throws when `session start` fails, e.g. outside a corpus (ERROR)", () => {
    const bare = mkdtempSync(join(tmpdir(), "lore-e2e-kp-bare-"));
    dirs.push(bare);
    expect(() => startHumanSession(LORE, bare, stateHome)).toThrow();
  });
});
