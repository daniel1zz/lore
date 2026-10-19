// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
// @layer integration-cli-capture-and-init AC-CT-3 (real CLI in a throwaway repo; owner is the in-process stamp-currency-floor unit test)
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
import { actedStore } from "../../live-invocation.js";
import { installShippedGuard } from "../support/main-guard-repo.js";

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
    // `lore integrate` (the landing a task needs to archive, BR-1291) reads its floor key from the config
    ["workflow:", "  gates:", ...["task-claim", "task-create"].flatMap((g) => [`    ${g}:`, "      enabled: false"]), "  integrate:", '    floor_command: "true"', ""].join("\n"),
  );
  // integrate keeps its own worktree and attempt ledger inside the repo; neither may dirty the tree
  appendFileSync(join(d, ".git", "info", "exclude"), ".claude/\n.lore/integrate-attempts/\n.lore/integrate-losses/\n");
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
function makeClaimedTask(dir: string, claimWorktree: string | null = dir): string {
  mustLore(["create", "prd", "--title", "CT3b PRD", "--no-ai", "--content", "## Overview\nbody"], dir);
  const spec = slugOf(mustLore(["create", "spec", "--title", "CT3b Spec", "--no-ai", "--content", "## Overview\nbody", "--json"], dir));
  const plan = slugOf(mustLore(["create", "plan", "--title", "CT3b Plan", "--parent", spec, "--no-ai", "--content", "body", "--json"], dir));
  const task = slugOf(
    mustLore(["create", "task", "--title", "CT3b Task", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--json"], dir),
  );
  mustLore(claimWorktree === null ? ["claim", task] : ["claim", task, "--worktree", claimWorktree], dir);
  return task;
}

interface Row {
  oracle: string;
  result: string;
  attestation?: Record<string, unknown>;
}

async function evidenceRows(dir: string, task: string): Promise<Row[]> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
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
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    const r = await store.listAuditRowsByAction(STATE_BINDING_ARMED_ACTION);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.length;
  } finally {
    store.close();
  }
}

function statusStateBinding(dir: string): unknown {
  const r = mustLore(["status", "--json"], dir);
  return (JSON.parse(r.stdout) as { data: { state_binding: unknown } }).data.state_binding;
}

describe("lore init inside a git repository arms a fresh corpus (AC-CT-3)", () => {
  it("writes exactly one state-binding-armed row, reports zero affected rows, and status says armed", async () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "ct3b-init-")));
    scratch.push(d);
    git(d, ["init", "-q", "-b", "main"]);
    const init = mustLore(["init", "--json"], d);
    const data = (JSON.parse(init.stdout) as { data: { state_binding: { armed: boolean; status: string; would_become_unbound_rows: number } } }).data;
    expect(data.state_binding.armed).toBe(true);
    expect(data.state_binding.status).toBe("armed");
    expect(data.state_binding.would_become_unbound_rows).toBe(0);
    expect(await armingRows(d)).toBe(1);
    expect(statusStateBinding(d)).toMatchObject({ armed: true });
  });

  it("REGRESSION: `lore audit arm --confirm` on an already armed corpus is idempotent", async () => {
    const d = makeCommittedCorpus();
    const r = mustLore(["audit", "arm", "--confirm", "--json"], d);
    expect(r.stdout).toContain("already_armed");
    expect(await armingRows(d)).toBe(1);
  });
});

describe("lore init OUTSIDE a git repository does not arm, and says so (AC-CT-3b, user decision 2026-10-17)", () => {
  function makeNonGitCorpus(): string {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "ct3b-nogit-")));
    if (d.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
    scratch.push(d);
    return d;
  }

  it("writes no arming row and prints the explicit not-armed line naming the path", async () => {
    const d = makeNonGitCorpus();
    const init = mustLore(["init"], d);
    expect(init.stdout).toContain(`state binding not armed: ${d} is not inside a git repository`);
    expect(init.stdout).toContain("lore audit arm --confirm");
    expect(await armingRows(d)).toBe(0);
  });

  it("--json carries state_binding {armed:false, reason:not_a_git_repo}", () => {
    const d = makeNonGitCorpus();
    const init = mustLore(["init", "--json"], d);
    const data = (JSON.parse(init.stdout) as { data: { state_binding: unknown } }).data;
    expect(data.state_binding).toEqual({ armed: false, reason: "not_a_git_repo" });
  });

  it("lore status reports the unarmed state in JSON and in a human line, for this reason", () => {
    const d = makeNonGitCorpus();
    mustLore(["init"], d);
    expect(statusStateBinding(d)).toEqual({ armed: false, reason: "not_a_git_repo" });
    const human = mustLore(["status"], d);
    expect(human.stdout).toContain("State binding: NOT armed");
    expect(human.stdout).toContain("not inside a git repository");
  });

  it("a captured pass is accepted by lore done (unarmed corpus refuses nothing)", () => {
    const d = makeNonGitCorpus();
    mustLore(["init"], d);
    appendFileSync(
      join(d, ".lore", "config.yaml"),
      ["workflow:", "  gates:", ...["task-claim", "task-create"].flatMap((g) => [`    ${g}:`, "      enabled: false"]), ""].join("\n"),
    );
    const task = makeClaimedTask(d, null);
    mustLore(["evidence", task, "--oracle", "build", "--command", "true", "--result", "pass", "--capture"], d);
    const done = lore(["done", task], d);
    expect(done.exitCode, done.stderr + done.stdout).toBe(0);
  });

  it("CONTROL: after the corpus is placed in git, `lore audit arm --confirm` arms it and status flips", async () => {
    const d = makeNonGitCorpus();
    mustLore(["init"], d);
    git(d, ["init", "-q", "-b", "main"]);
    mustLore(["audit", "arm", "--confirm"], d);
    expect(await armingRows(d)).toBe(1);
    expect(statusStateBinding(d)).toMatchObject({ armed: true });
  });
});

describe("lore evidence --capture stamps like verify (AC-CT-3b)", () => {
  it("clean committed tree: captured pass is stamped and accepted by lore done", async () => {
    const d = makeCommittedCorpus();
    // the task's own branch holds nothing past main, so `lore integrate` finds it already integrated and records the
    // landing `lore done` requires; main does not move, so the stamp below still names HEAD
    git(d, ["branch", "ct3b-ok", "main"]);
    const task = makeClaimedTask(d, "ct3b-ok");
    git(d, ["checkout", "-q", "--detach", "main"]); // the shared checkout is a detached view of main
    installShippedGuard(d, join(d, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
    mustLore(["integrate", "ct3b-ok", "--session", "ct3b-session"], d);
    mustLore(["evidence", task, "--oracle", "build", "--command", "true", "--result", "pass", "--capture"], d);
    const row = (await evidenceRows(d, task))[0]!;
    expect(row.attestation?.["state_stamp"]).toEqual({ head_sha: git(d, ["rev-parse", "HEAD"]).trim(), worktree_dirty: false });
    expect(row.attestation?.["stamp_unbound_reason"]).toBeUndefined();
    const done = lore(["done", task], d);
    expect(done.exitCode, done.stderr + done.stdout).toBe(0);
  }, 120_000);

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
