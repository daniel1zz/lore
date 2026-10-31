// @spawns packages/lore/src/index.ts
/**
 * `$LORE_ACTOR` is retired (spec-run-only-write-identity-and-run-end-claim-release, BR-1055; supersedes the
 * deprecation contract of spec-run-identity-slice-1 D8 / AC-RID-6, CLI half).
 *
 * Contract now asserted against the real CLI:
 *   - `$LORE_ACTOR=Y` is never read: no audit row is authored by Y and NO stderr line mentions `LORE_ACTOR`
 *     (no deprecation warning either - a retired mechanism is not named).
 *   - That holds per process however many writes the process performs (`lore done` walks several steps),
 *     for two separate processes, and `--json` stdout stays machine-parseable and silent about it.
 *   - A process naming itself through the session tier and no `$LORE_ACTOR` also prints nothing about it.
 *
 * Dimensions: HAPPY (single write -> no mention), BOUNDARY (multi-write process; two processes), NEGATIVE (no
 * env var -> none), STATE (stdout untouched), REGRESSION (the env name is NOT recorded as the author).
 *
 * No mocks. Throwaway git repo + `lore init` corpus; the repo's own `.lore/` is never touched.
 *
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-2
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../../helpers/clean-tree-repo";
import { patchLoreConfig } from "../../helpers/patch-lore-config";
import { sessionActorFor, sessionIdFor } from "../../helpers/session-actor";
import { FIXTURE_DONE_CONTRACT_CONFIG, landTask } from "../support/land-task";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocSlug } from "../../helpers/parented-create.js";
setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

const ACTOR_Y = "agent:deprecation-writer-y";
const ACTOR_Z = "agent:deprecation-writer-z";
const SETUP = "agent:deprecation-setup";
/** The name the session tier resolves to for writer Y's fixture session (what an audit row carries). */
const ACTOR_Y_SESSION = sessionActorFor(ACTOR_Y);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** `actorEnv` is the (ignored) retired variable's value; `sessionLabel` names the writer through the session tier. */
function lore(args: string[], cwd: string, actorEnv: string | null, sessionLabel: string | null = null): RunResult {
  // reason: HOME lies outside the fixture repository, so bun/lore caches never dirty the tree a captured pass is stamped against
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDECODE: "1", HOME: FIXTURE_HOME_OUTSIDE_REPO };
  delete env["CLAUDE_CODE_SESSION_ID"];
  delete env["CLAUDE_SESSION_ID"];
  if (sessionLabel !== null) env["CLAUDE_CODE_SESSION_ID"] = sessionIdFor(sessionLabel);
  if (actorEnv === null) delete env["LORE_ACTOR"];
  else env["LORE_ACTOR"] = actorEnv;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[], cwd: string, actorEnv: string | null, sessionLabel: string | null = null): RunResult {
  const r = lore(args, cwd, actorEnv, sessionLabel);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

/** Any stderr line that names the retired variable. */
const loreActorMentions = (stderr: string): string[] => stderr.split("\n").filter((l) => /LORE_ACTOR/.test(l));

const scratch: string[] = [];
let dir = "";

/** The spec an ad-hoc task names (`--spec`): approve and `lore done` resolve an ad-hoc task's criteria through it. */
let spec = "";

function newTask(title: string): string {
  return JSON.parse(mustLore(["create", "task", "--kind", "code", "--adhoc", "--spec", spec, "--title", title, "--ac-scope", "", "--json"], dir, SETUP).stdout).data.slug as string;
}

async function auditSince(since: string): Promise<AuditEntry[]> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    const r = await store.queryAudit({ limit: 100_000 });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.filter((row) => row.timestamp >= since);
  } finally {
    store.close();
  }
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "actor-deprecation-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(dir);
  const git = (a: string[]) => execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "deprecation@example.invalid"]);
  git(["config", "user.name", "deprecation test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mkdirSync(FIXTURE_HOME_OUTSIDE_REPO, { recursive: true });
  // the corpus and the linked worktree directory never dirty the tree a captured pass is stamped against
  appendFileSync(join(dir, ".git", "info", "exclude"), ".lore/\n.claude/\n");
  mustLore(["init"], dir, SETUP);
  // reason: approve compiles each fixture task's done contract from these commands (a code task needs all three)
  patchLoreConfig(dir, { workflow: { done_contract: { ...FIXTURE_DONE_CONTRACT_CONFIG }, gates: { "task-claim": { enabled: false } }, review: { judgment_required_types: [] } } });
  mustLore(["create", "prd", "--title", "Deprecation Root", "--content", "root", "--no-ai"], dir, SETUP);
  spec = JSON.parse(mustLore(["create", "spec", "--title", "Deprecation Spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai", "--json"], dir, SETUP).stdout).data.slug as string;
  // AU-T7: `done --override-attestation` is decided; this suite's subject is not the override, so the class is loosened
  // the documented way (a human-tty governance decision on a throwaway corpus), never by a bypass in product code.
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-2 (CLI): $LORE_ACTOR is ignored and never named", () => {
  it("a single-write process with $LORE_ACTOR set prints no line naming it", () => {
    const r = lore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(a, dir, ACTOR_Y)), "--sub-type", "reference", "--title", "Retired single write", "--content", "body", "--no-ai"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    expect(loreActorMentions(r.stderr)).toEqual([]);
  });

  it("ONE process that performs several writes (lore done) prints no line naming it", async () => {
    const task = newTask("Retired multi write");
    scratch.push(join(FIXTURE_HOME_OUTSIDE_REPO, `deprecation-multi-${process.pid}`));
    // the task is approved (its contract compiled, the red run waived: not this test's subject), claimed on a branch as writer Y,
    // landed on main, and holds a runner pass for every contract oracle, so `lore done` has a whole archive walk to write
    await landTask(
      { dir, git: (args) => execFileSync("git", [...args], { cwd: dir, encoding: "utf8" }).trim(), lore: (args) => lore([...args], dir, null, ACTOR_Y) },
      { slug: task, branch: "deprecation-multi", worktree: join(FIXTURE_HOME_OUTSIDE_REPO, `deprecation-multi-${process.pid}`), claimValue: "branch", session: ACTOR_Y },
    );
    const since = new Date().toISOString();
    // the session names the holder; the decoy env value (Z) must not take part in resolution.
    const r = lore(["done", task], dir, ACTOR_Z, ACTOR_Y);
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    const rows = await auditSince(since);
    // the process really did several writes, so "no mention" is not just "one write -> no mention"
    expect(rows.filter((row) => row.actor === ACTOR_Y_SESSION).length).toBeGreaterThanOrEqual(3);
    expect(rows.filter((row) => row.actor === ACTOR_Z)).toEqual([]);
    expect(loreActorMentions(r.stderr)).toEqual([]);
  });

  it("two separate processes each print no line naming it", () => {
    const a = lore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(a, dir, ACTOR_Y)), "--sub-type", "reference", "--title", "Retired process one", "--content", "body", "--no-ai"], dir, ACTOR_Y);
    const b = lore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(a, dir, ACTOR_Z)), "--sub-type", "reference", "--title", "Retired process two", "--content", "body", "--no-ai"], dir, ACTOR_Z);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(loreActorMentions(a.stderr)).toEqual([]);
    expect(loreActorMentions(b.stderr)).toEqual([]);
  });

  it("--json stdout stays parseable and does not mention it; stderr neither", () => {
    const r = lore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(a, dir, ACTOR_Y)), "--sub-type", "reference", "--title", "Retired json stdout", "--content", "body", "--no-ai", "--json"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout).not.toContain("LORE_ACTOR");
    expect(loreActorMentions(r.stderr)).toEqual([]);
  });

  it("the env name is NOT recorded: no audit row is authored by Y", async () => {
    const since = new Date().toISOString();
    const r = lore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(a, dir, ACTOR_Y)), "--sub-type", "reference", "--title", "Retired not recorded", "--content", "body", "--no-ai"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    const rows = await auditSince(since);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.actor === ACTOR_Y)).toEqual([]);
  });
});

describe("spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-2 (CLI): nothing about $LORE_ACTOR when it is not set", () => {
  it("naming the writer through the session tier and no $LORE_ACTOR prints no deprecation line", () => {
    const task = newTask("Deprecation by session");
    const r = lore(["claim", task, "--worktree", "wt-deprecation-session"], dir, null, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    expect(loreActorMentions(r.stderr)).toEqual([]);
  });

  it("a write with neither a session nor $LORE_ACTOR prints no deprecation line", () => {
    const r = lore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => lore(a, dir, null)), "--sub-type", "reference", "--title", "Deprecation none", "--content", "body", "--no-ai"], dir, null);
    expect(loreActorMentions(r.stderr)).toEqual([]);
  });
});
