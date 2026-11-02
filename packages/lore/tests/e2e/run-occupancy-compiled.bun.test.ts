// @reads assets/**
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * @spec_ref spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (AC-WL-2; D1; BR-1070)
 *
 * The COMPILED `dist/lore` on a throwaway corpus (mkdtemp + `lore init`; the repo's own `.lore/` is never touched):
 * `lore run occupancy --worktree <dir>/agent-X --json` follows the run registry.
 *
 *   register (session S, agent X)  -> exit 0, data.occupied true, data.agent_run.id = cc:S:X
 *   run end cc:S:X                 -> exit 0, data.occupied false, data.agent_run.ended true
 *   no --worktree                  -> exit exactly 2
 *
 * Every spawned `lore` runs with the identity sources scrubbed (no inherited CLAUDE_CODE_SESSION_ID), so the
 * session under test is the one the test names.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

setDefaultTimeout(180_000);

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

const SESSION = "occ-e2e-session";
const AGENT = "occagent42";
const RUN_ID = `cc:${SESSION}:${AGENT}`;

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let root = "";
let corpus = "";
let worktreeDir = "";

function childEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDECODE: "1",
    EDITOR: "true",
  };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete e[k];
  return e;
}

async function lore(args: string[]): Promise<Out> {
  return await runLoreInProcess(args, { cwd: corpus, home: join(root, "home"), env: childEnv() });
}

async function mustLore(args: string[]): Promise<Out> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

interface OccupancyData {
  readonly worktree: string;
  readonly agent_run: { id: string; ended: boolean; parent_ended: boolean | null } | null;
  readonly open_claims: readonly unknown[];
  readonly occupied: boolean;
}

async function occupancy(): Promise<{ exitCode: number; data: OccupancyData }> {
  const r = await lore(["run", "occupancy", "--worktree", worktreeDir, "--json"]);
  return { exitCode: r.exitCode, data: (JSON.parse(r.stdout) as { data: OccupancyData }).data };
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "run-occupancy-e2e-")));
  if (root.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const vcs = (a: string[]) => execFileSync("git", a, { cwd: corpus, stdio: ["ignore", "pipe", "pipe"] });
  vcs(["init", "-q", "-b", "main"]);
  vcs(["config", "user.email", "e2e@example.invalid"]);
  vcs(["config", "user.name", "run occupancy e2e"]);
  writeFileSync(join(corpus, "README.md"), "fixture\n");
  vcs(["add", "."]);
  vcs(["commit", "-q", "-m", "init"]);
  await mustLore(["init"]);
  await mustLore(["create", "prd", "--title", "Occupancy E2E Root", "--no-ai", ...templatedFieldsArgs("prd")]);
  worktreeDir = join(root, `agent-${AGENT}`);
  mkdirSync(worktreeDir);
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup of a tmp fixture */
  }
});

describe("AC-WL-2 lore run occupancy (compiled)", () => {
  it("HAPPY + STATE: a registered agent run occupies its worktree until `lore run end`", async () => {
    await mustLore(["run", "register", "--harness", "claude-code", "--session", SESSION]);
    await mustLore(["run", "register", "--harness", "claude-code", "--session", SESSION, "--agent-id", AGENT, "--agent-type", "t"]);

    const live = await occupancy();
    expect(live.exitCode).toBe(0);
    expect(live.data.occupied).toBe(true);
    expect(live.data.agent_run?.id).toBe(RUN_ID);
    expect(live.data.agent_run?.ended).toBe(false);
    expect(live.data.worktree).toBe(worktreeDir);

    await mustLore(["run", "end", RUN_ID, "--reason", "e2e agent stopped"]);

    const gone = await occupancy();
    expect(gone.exitCode).toBe(0);
    expect(gone.data.occupied).toBe(false);
    expect(gone.data.agent_run?.id).toBe(RUN_ID);
    expect(gone.data.agent_run?.ended).toBe(true);
  });

  it("BOUNDARY: a worktree whose basename names no agent has no owning run", async () => {
    const other = join(root, "hand-made");
    mkdirSync(other);
    const r = await lore(["run", "occupancy", "--worktree", other, "--json"]);
    expect(r.exitCode).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: OccupancyData }).data;
    expect(data.agent_run).toBeNull();
    expect(data.occupied).toBe(false);
  });

  it("HAPPY: the human render names the run and the verdict", async () => {
    const r = await lore(["run", "occupancy", "--worktree", worktreeDir]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(RUN_ID);
    expect(r.stdout).toContain("Occupied: no");
  });

  it("NEGATIVE: without --worktree it exits exactly 2", async () => {
    const r = await lore(["run", "occupancy"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--worktree");
  });
});
