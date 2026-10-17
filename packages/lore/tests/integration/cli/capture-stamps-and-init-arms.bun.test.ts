// @spawns packages/lore/src/index.ts
/**
 * AC-CT-3b (SPEC-143) — `lore evidence --capture` stamps state exactly like `lore verify`, and a
 * fresh `lore init` corpus is armed at init.
 *
 * Driven through the real CLI in a throwaway git repo + `lore init` corpus (the repo's own `.lore/`
 * is never touched).
 *
 *   HAPPY      clean committed tree  -> captured pass carries state_stamp, accepted by `lore done`
 *   NEGATIVE   dirty tree            -> stamp_unbound_reason dirty_tree, no state_stamp, `lore done` refuses
 *   STATE      fresh `lore init`     -> exactly ONE state-binding-armed audit row, 0 rows affected
 *   REGRESSION `lore audit arm --confirm` on the armed corpus is idempotent (already_armed, no 2nd row)
 *   BOUNDARY   HEAD moved during the command -> state_moved, no head recorded
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-3
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATE_BINDING_ARMED_ACTION } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// reason: HOME outside every fixture repo, so bun/lore caches never dirty the tree under test.
const FIXTURE_HOME = realpathSync(mkdtempSync(join(tmpdir(), "ct3b-home-")));
const SESSION ={ CLAUDE_CODE_SESSION_ID: "c73b0000-aaaa-bbbb-cccc-111111111111" };

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function lore(args: string[], cwd: string): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDECODE: "1", HOME: FIXTURE_HOME, ...SESSION };
  delete env["LORE_ACTOR"];
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[], cwd: string): RunResult {
  const r = lore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

const scratch: string[] = [];
afterAll(() => {
  for (const d of [...scratch, FIXTURE_HOME]) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A git repo with `lore init` run INSIDE it and everything committed: the tree is clean. */
function makeCommittedCorpus(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "ct3b-")));
  if (d.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(d);
  git(d, ["init", "-q", "-b", "main"]);
  git(d, ["config", "user.email", "ct3b@example.invalid"]);
  git(d, ["config", "user.name", "ct3b test"]);
  writeFileSync(join(d, "README.md"), "fixture\n");
  mustLore(["init"], d);
  // reason: gates are not under test; disabling them lets the fixture claim a task under a draft spec.
  appendFileSync(
    join(d, ".lore", "config.yaml"),
    ["workflow:", "  gates:", ...["task-claim", "task-create"].flatMap((g) => [`    ${g}:`, "      enabled: false"]), ""].join("\n"),
  );
  git(d, ["add", "."]);
  git(d, ["commit", "-q", "-m", "init"]);
  return d;
}

function slugOf(r: RunResult): string {
  const m = /(?:Created|created)[^\n]*?\b([a-z0-9][a-z0-9-]{8,})\b/.exec(r.stdout);
  const json = /"slug":\s*"([^"]+)"/.exec(r.stdout);
  const slug = json?.[1] ?? m?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${r.stdout}`);
  return slug;
}

/** prd -> spec -> plan -> task, claimed; returns the task slug. Tracked files stay clean (db is gitignored). */
function makeClaimedTask(dir: string, claimWorktree: string = dir): string {
  mustLore(["create", "prd", "--title", "CT3b PRD", "--no-ai", "--content", "## Overview\nbody"], dir);
  const spec = slugOf(mustLore(["create", "spec", "--title", "CT3b Spec", "--no-ai", "--content", "## Overview\nbody", "--json"], dir));
  const plan = slugOf(mustLore(["create", "plan", "--title", "CT3b Plan", "--parent", spec, "--no-ai", "--content", "body", "--json"], dir));
  const task = slugOf(
    mustLore(["create", "task", "--title", "CT3b Task", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--json"], dir),
  );
  mustLore(["claim", task, "--worktree", claimWorktree], dir);
  return task;
}

interface Row {
  oracle: string;
  result: string;
  attestation?: Record<string, unknown>;
}

async function evidenceRows(dir: string, task: string): Promise<Row[]> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const r = await store.findMany({ type: "task" });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const doc = r.value.find((d) => d.slug === task);
    if (doc === undefined) throw new Error(`task ${task} not found`);
    return (doc.extra?.["verification_evidence"] as Row[] | undefined) ?? [];
  } finally {
    store.close();
  }
}

async function armingRows(dir: string): Promise<number> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const r = await store.listAuditRowsByAction(STATE_BINDING_ARMED_ACTION);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.length;
  } finally {
    store.close();
  }
}

describe("lore init arms a fresh corpus (AC-CT-3)", () => {
  it("writes exactly one state-binding-armed row and reports zero affected rows", async () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "ct3b-init-")));
    scratch.push(d);
    const init = mustLore(["init", "--json"], d);
    const data = (JSON.parse(init.stdout) as { data: { state_binding: { status: string; would_become_unbound_rows: number } } }).data;
    expect(data.state_binding.status).toBe("armed");
    expect(data.state_binding.would_become_unbound_rows).toBe(0);
    expect(await armingRows(d)).toBe(1);
  });

  it("REGRESSION: `lore audit arm --confirm` on an already armed corpus is idempotent", async () => {
    const d = makeCommittedCorpus();
    const r = mustLore(["audit", "arm", "--confirm", "--json"], d);
    expect(r.stdout).toContain("already_armed");
    expect(await armingRows(d)).toBe(1);
  });
});

describe("lore evidence --capture stamps like verify (AC-CT-3b)", () => {
  it("clean committed tree: captured pass is stamped and accepted by lore done", async () => {
    const d = makeCommittedCorpus();
    const task = makeClaimedTask(d);
    mustLore(["evidence", task, "--oracle", "build", "--command", "true", "--result", "pass", "--capture"], d);
    const row = (await evidenceRows(d, task))[0]!;
    expect(row.attestation?.["state_stamp"]).toEqual({ head_sha: git(d, ["rev-parse", "HEAD"]).trim(), worktree_dirty: false });
    expect(row.attestation?.["stamp_unbound_reason"]).toBeUndefined();
    const done = lore(["done", task], d);
    expect(done.exitCode, done.stderr + done.stdout).toBe(0);
  });

  it("dirty tree: captured pass is unbound/dirty_tree and lore done refuses it", async () => {
    const d = makeCommittedCorpus();
    // reason: the claim is taken in a CLEAN linked worktree so the pre-existing uncommitted-claimed-
    // worktree refusal does not fire first; the capture itself runs in the DIRTY checkout `d`.
    const linked = join(FIXTURE_HOME, "linked-wt");
    git(d, ["worktree", "add", "-q", "-b", "ct3b-linked", linked]);
    const task = makeClaimedTask(d, linked);
    writeFileSync(join(d, "dirty.txt"), "uncommitted\n");
    mustLore(["evidence", task, "--oracle", "build", "--command", "true", "--result", "pass", "--capture"], d);
    const row = (await evidenceRows(d, task))[0]!;
    expect(row.attestation?.["state_stamp"]).toBeUndefined();
    expect(row.attestation?.["stamp_unbound_reason"]).toBe("dirty_tree");
    const done = lore(["done", task], d);
    expect(done.exitCode, done.stderr + done.stdout).not.toBe(0);
    expect(done.stderr + done.stdout).toContain("dirty_tree");
  });

  it("HEAD moved during the command: state_moved, no head recorded", async () => {
    const d = makeCommittedCorpus();
    const task = makeClaimedTask(d);
    mustLore(
      ["evidence", task, "--oracle", "build", "--command", "git commit -q --allow-empty -m moved", "--result", "pass", "--capture"],
      d,
    );
    const att = (await evidenceRows(d, task))[0]!.attestation!;
    expect(att["stamp_unbound_reason"]).toBe("state_moved");
    expect(att["state_stamp"]).toBeUndefined();
    expect(att["head_sha"]).toBeUndefined();
  });
});
