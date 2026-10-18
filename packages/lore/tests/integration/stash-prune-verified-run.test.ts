// @spawns packages/lore/src/index.ts
/**
 * BR-1035 regression for `lore stash prune`: the decision record's `executor_run` is the VERIFIED run, the same
 * value the store wrapper stamps onto rows. An unregistered `--harness-run X` verifies to null, so the record
 * must say null, not X (one operation, one answer).
 *
 * Throwaway repo + corpus (mkdtemp, `git init`, `lore init`), never the repo's own `.lore/` or stash stack.
 * Control: a REGISTERED run id must reach `executor_run` unchanged, so "always null" cannot pass this file.
 *
 * @spec_ref BR-1035 (regression found in the IV-5 review of plan-ambient-state-read-once-at-the-entry-owned-only-prune-user)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { RunId } from "@lore/core";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

let repo = "";
let dbPath = "";
let counter = 0;

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: repo,
    env: { ...process.env, HOME: repo, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

/** A stash whose tracked content is then committed to main, so decide(stash-drop) appends a decision record. */
function makeContainedStash(): void {
  counter += 1;
  const content = `contained ${counter}\n`;
  writeFileSync(join(repo, "tracked.txt"), content);
  git(["stash", "push", "-u", "-m", `wip ${counter}`]);
  writeFileSync(join(repo, "tracked.txt"), content);
  git(["commit", "-q", "-am", `main gets blob ${counter}`]);
}

async function decisionExecutorRuns(): Promise<Array<string | null>> {
  const store = new SQLiteStore(dbPath);
  try {
    const rows = await store.listDecisionLog();
    if (!rows.ok) throw new Error(`listDecisionLog failed: ${JSON.stringify(rows.error)}`);
    return rows.value.map((row) => row.executor_run);
  } finally {
    store.close();
  }
}

async function registerRun(id: RunId): Promise<void> {
  const store = new SQLiteStore(dbPath);
  try {
    const inserted = await store.insertRun({
      id,
      kind: "main",
      harness: "claude-code",
      sessionRef: "sess-verified",
      agentRef: null,
      agentType: null,
      parentRunId: null,
      branch: null,
      composition: { schemaVersion: 1, fragments: [] },
      registeredAt: "2026-10-01T00:00:00.000Z",
    });
    if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
  } finally {
    store.close();
  }
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "lore-iv5-stash-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "tracked.txt"), "base\n");
  git(["add", "tracked.txt"]);
  git(["commit", "-q", "-m", "base"]);
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  appendFileSync(join(repo, ".git", "info", "exclude"), ".lore/\n");
  dbPath = join(repo, ".lore", "lore.db");
});

afterAll(() => {
  if (repo.startsWith(tmpdir())) rmSync(repo, { recursive: true, force: true });
});

describe("lore stash prune records the VERIFIED run (BR-1035)", () => {
  it("an unregistered --harness-run id yields a decision executor_run of null", async () => {
    makeContainedStash();
    const before = (await decisionExecutorRuns()).length;
    const result = runLore(["stash", "prune", "--apply", "--harness-run", "cc:sess-unregistered:ghost"]);
    expect(result.exitCode).toBe(0);
    const added = (await decisionExecutorRuns()).slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added).toEqual(added.map(() => null));
  });

  it("control: a registered --harness-run id reaches the decision executor_run unchanged", async () => {
    const id = "cc:sess-verified" as RunId;
    await registerRun(id);
    makeContainedStash();
    const before = (await decisionExecutorRuns()).length;
    const result = runLore(["stash", "prune", "--apply", "--harness-run", id]);
    expect(result.exitCode).toBe(0);
    const added = (await decisionExecutorRuns()).slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added).toEqual(added.map(() => id));
  });
});
