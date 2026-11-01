// @reads assets/project/lore-config-template.yaml
// @spawns-external git -- builds the throwaway repo's landing branch (execFileSync git in landAttested)
/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part A; AC-LG-1..AC-LG-4; BR-1366, BR-1367)
 *
 * `lore bulk <archive|deprecate|close|done>`: preview then apply, rows that fail alone, draft -> deprecated,
 * and the `archive --apply` exit code. Everything runs on a
 * throwaway corpus (`mkdtemp` + `lore init`, git tree kept clean) — never the repo's own `.lore/`.
 *
 * Dimensions: HAPPY (preview exit 3, apply exit 0), NEGATIVE (usage exits 2, unknown id), BOUNDARY (none selected
 * exits 0), ERROR (stale + gated rows exit 1), STATE (nothing written by a preview, nothing partial by a failed
 * row), REGRESSION (`archive --apply` exits 1 on a failed candidate; archived -> deprecated stays invalid).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// reason: each task a case lands (approve, claim, branch commit, landing, contract passes) costs several CLI runs
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
import { execFileSync } from "node:child_process";
import { landTask, type TaskWorld } from "./support/land-task.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docTypeSchema, getAllowedTransitions, isValidTransition } from "@lore/core";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { archivePlanWithoutCascade } from "../helpers/archive-plan-legacy.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * One `lore` command run IN this process (helpers/run-lore-in-process.ts), not a `bun run src/index.ts` child.
 * Why: this file checks command logic (exit codes, rows, what the store holds), and each of its ~10 cases ran
 * 20-40 cold `bun` starts (each re-loads the whole CLI). Under a batch of other spawn-heavy files those starts
 * share the machine's CPU, so a case that takes seconds alone crossed the 30 s case timeout (issue #562). In
 * process a command costs milliseconds and the case no longer depends on how busy the machine is.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: FIXTURE_HOME_OUTSIDE_REPO,
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:bulk-lifecycle-test" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

interface BulkRow {
  id: string;
  slug: string;
  type: string;
  status?: string;
  version?: number;
  target?: string;
  outcome?: string;
  from_status?: string | null;
  to_status?: string | null;
  code?: string | null;
  rule?: string | null;
  reason?: string;
}

async function bulkJson(args: string[], cwd: string): Promise<{ exitCode: number; mode: string; rows: BulkRow[] }> {
  const r = await runLore(["bulk", ...args, "--json"], cwd);
  const payload = JSON.parse(r.stdout) as { data: { mode: string; rows: BulkRow[] } };
  return { exitCode: r.exitCode, mode: payload.data.mode, rows: payload.data.rows };
}

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in create output: ${stdout}`);
  return slug;
}

async function statusOf(slug: string, cwd: string): Promise<string> {
  const r = await runLore(["get", slug, "--json"], cwd);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { status: string } }; status?: string };
  return parsed.data?.doc?.status ?? parsed.status ?? `unreadable: ${r.stdout.slice(0, 200)}`;
}

async function versionOf(slug: string, cwd: string): Promise<number> {
  const r = await runLore(["get", slug, "--json"], cwd);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { version: number } }; version?: number };
  return parsed.data?.doc?.version ?? parsed.version ?? -1;
}

let tmpDir: string;
let planSlug: string;
let prdSlug: string;
let counter = 0;

async function statusesOf(slugs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const slug of slugs) out.push(await statusOf(slug, tmpDir));
  return out;
}

async function versionsOf(slugs: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const slug of slugs) out.push(await versionOf(slug, tmpDir));
  return out;
}

async function createTask(title: string): Promise<string> {
  counter += 1;
  const r = await runLore(
    ["create", "task", "--kind", "code", "--title", `${title} ${counter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"],
    tmpDir,
  );
  expect(r.exitCode, `${r.stdout}\n${r.stderr}`).toBe(0);
  return slugOf(r.stdout);
}

const wtRoots: string[] = [];
let landingSeq = 0;

/**
 * The floors judge the stored contract (AC-DCS1-7): the task is approved, claimed on a branch of its own and landed on main;
 * with `passes` it also holds a runner pass for every contract oracle (the old `addAttestedPass`), without it none. The claim is then
 * released, so a bulk verb sees an unclaimed task. A task that went through this is no longer `draft` (approve moved it on).
 */
async function landAttested(taskSlug: string, passes = true): Promise<void> {
  landingSeq += 1;
  const branch = `bulk-${landingSeq}`;
  const wtRoot = mkdtempSync(join(tmpdir(), "lore-bulk-lifecycle-wt-"));
  wtRoots.push(wtRoot);
  const world: TaskWorld = {
    dir: tmpDir,
    git: (args) => execFileSync("git", [...args], { cwd: tmpDir, encoding: "utf8" }).trim(),
    lore: (args) => runLore([...args], tmpDir),
  };
  await landTask(world, { slug: taskSlug, branch, worktree: join(wtRoot, branch), claimValue: "branch", session: "bulk", recordPasses: passes });
  const released = await runLore(["release", taskSlug], tmpDir);
  expect(released.exitCode, released.stderr).toBe(0);
}

/**
 * Loads, once and OUTSIDE any case or hook budget, the command modules these cases reach. The CLI loads each command
 * lazily, and the first call to each one pays its whole module graph (seconds when the machine is busy, 40 s observed
 * under load 60). That one-time load is not what a case checks, so it must not be charged to the 30 s budget of
 * whichever case happens to run first. Top-level await runs during collection, before any case starts.
 */
async function warmCommandModules(): Promise<void> {
  mkdirSync(FIXTURE_HOME_OUTSIDE_REPO, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "lore-bulk-lifecycle-warm-"));
  try {
    makeCleanTreeRepo(dir);
    await runLore(["init"], dir);
    const prd = slugOf((await runLore(["create", "prd", "--title", "Warm PRD", "--content", "root", "--no-ai"], dir)).stdout);
    const plan = slugOf((await runLore(["create", "plan", "--title", "Warm Plan", "--parent", prd, "--content", "x", "--no-ai"], dir)).stdout);
    const task = slugOf(
      (await runLore(["create", "task", "--kind", "code", "--title", "Warm Task", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"], dir)).stdout,
    );
    await runLore(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"], dir);
    await runLore(["get", task, "--json"], dir);
    await runLore(["set", task, "--title", "Warm Task moved"], dir);
    await runLore(["audit", task, "--json"], dir);
    await runLore(["bulk", "archive", task, "--json"], dir);
    await runLore(["bulk", "deprecate", "--where", "type=plan", "--json"], dir);
    await runLore(["done", task], dir);
    await runLore(["archive", "--sweep"], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await warmCommandModules();

beforeEach(async () => {
  mkdirSync(FIXTURE_HOME_OUTSIDE_REPO, { recursive: true });
  tmpDir = mkdtempSync(join(tmpdir(), "lore-bulk-lifecycle-test-"));
  makeCleanTreeRepo(tmpDir);
  expect((await runLore(["init"], tmpDir)).exitCode).toBe(0);
  // approve compiles each task's done contract from these commands (a code task needs all three)
  patchLoreConfig(
    tmpDir,
    [
      "workflow:", "  review:", "    judgment_required_types: []",
      "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"', "",
    ].join("\n"),
  );
  const prd = await runLore(["create", "prd", "--title", "Bulk PRD", "--content", "root", "--no-ai"], tmpDir);
  expect(prd.exitCode).toBe(0);
  prdSlug = slugOf(prd.stdout);
  const plan = await runLore(["create", "plan", "--title", "Bulk Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir);
  expect(plan.exitCode).toBe(0);
  planSlug = slugOf(plan.stdout);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const root of wtRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bulk lifecycle: preview then apply", () => {
  it("preview then apply: ids preview exits 3 writing nothing; --where selects the same rows; usage errors exit 2", async () => {
    const [a, b, c] = [await createTask("Alpha"), await createTask("Beta"), await createTask("Gamma")] as [string, string, string];
    // archive goes through the same `lore done` floors as every other write: an archived task is landed and holds its contract passes.
    for (const slug of [a, b, c]) await landAttested(slug);
    const start = await statusOf(a, tmpDir); // approve moved the tasks past draft
    const versionsBefore = await versionsOf([a, b, c]);

    const preview = await bulkJson(["archive", a, b, c], tmpDir);
    expect(preview.exitCode).toBe(3);
    expect(preview.mode).toBe("preview");
    expect(preview.rows.map((r) => r.slug).sort()).toEqual([a, b, c].sort());
    expect(preview.rows.every((r) => r.target === "archived" && r.status === start)).toBe(true);
    // STATE: a preview writes nothing.
    expect(await statusesOf([a, b, c])).toEqual([start, start, start]);
    expect(await versionsOf([a, b, c])).toEqual(versionsBefore);

    // --where selects the same rows through the lore list filters.
    const byWhere = await bulkJson(["archive", "--where", `type=task,status=${start}`], tmpDir);
    expect(byWhere.exitCode).toBe(3);
    expect(byWhere.rows.map((r) => r.slug).sort()).toEqual([a, b, c].sort());
    // BOUNDARY: nothing matches -> exit 0.
    expect((await bulkJson(["archive", "--where", "type=task,status=in-review"], tmpDir)).exitCode).toBe(0);
    // older-than keeps only rows older than N days: every fixture row is minutes old.
    expect((await bulkJson(["archive", "--where", "type=task,older-than=30d"], tmpDir)).exitCode).toBe(0);

    // NEGATIVE: usage errors are exactly 2 and write nothing.
    expect((await runLore(["bulk", "archive", a, "--apply"], tmpDir)).exitCode).toBe(2);
    expect((await runLore(["bulk", "archive", a, "--where", "type=task", "--apply", "--reason", "x"], tmpDir)).exitCode).toBe(2);
    expect((await runLore(["bulk", "archive", "--apply", "--reason", "x"], tmpDir)).exitCode).toBe(2);
    expect((await runLore(["bulk", "nuke", a], tmpDir)).exitCode).toBe(2);
    expect((await runLore(["bulk", "archive", "--where", "colour=red"], tmpDir)).exitCode).toBe(2);
    expect(await statusOf(a, tmpDir)).toBe(start);
  });

  it("preview then apply: apply writes each row once with the reason on its audit, re-apply SKIPS, an unknown id FAILS", async () => {
    const [a, b, c] = [await createTask("Alpha"), await createTask("Beta"), await createTask("Gamma")] as [string, string, string];
    // archive goes through the same `lore done` floors as every other write: an archived task is landed and holds its contract passes.
    for (const slug of [a, b, c]) await landAttested(slug);
    const versionsBefore = await versionsOf([a, b, c]);

    const apply = await bulkJson(["archive", a, b, c, "--apply", "--reason", "sprint cleanup"], tmpDir);
    expect(apply.exitCode).toBe(0);
    expect(apply.mode).toBe("apply");
    expect(apply.rows.map((r) => r.outcome)).toEqual(["OK", "OK", "OK"]);
    expect(await statusesOf([a, b, c])).toEqual(["archived", "archived", "archived"]);
    // one write per row: exactly one version bump each.
    expect(await versionsOf([a, b, c])).toEqual(versionsBefore.map((v) => v + 1));
    for (const slug of [a, b, c]) {
      const audit = await runLore(["audit", slug, "--json"], tmpDir);
      expect(audit.stdout).toContain("sprint cleanup");
    }

    // Re-applying skips what is already at the target: SKIPPED, exit 0, no further write.
    const again = await bulkJson(["archive", a, "--apply", "--reason", "again"], tmpDir);
    expect(again.exitCode).toBe(0);
    expect(again.rows[0]?.outcome).toBe("SKIPPED");
    expect(await versionOf(a, tmpDir)).toBe((versionsBefore[0] ?? 0) + 1);

    // ERROR: an unknown id refuses the preview with DOC_NOT_FOUND (exit 3) and is a FAILED row in an apply.
    expect((await runLore(["bulk", "archive", "task-no-such-doc"], tmpDir)).exitCode).toBe(3);
    const missing = await bulkJson(["archive", "task-no-such-doc", "--apply", "--reason", "x"], tmpDir);
    expect(missing.exitCode).toBe(1);
    expect(missing.rows[0]?.outcome).toBe("FAILED");
    expect(missing.rows[0]?.code).toBe("DOC_NOT_FOUND");
  });

  it("preview then apply: close archives a plan with no open tasks and skips a task; open-tasks=0 selects only such plans", async () => {
    const busyTask = await createTask("Open work");
    const emptyPlan = await runLore(["create", "plan", "--title", "Empty Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir);
    const emptySlug = slugOf(emptyPlan.stdout);
    expect((await runLore(["set", emptySlug, "--status", "approved"], tmpDir)).exitCode).toBe(0);
    expect((await runLore(["set", planSlug, "--status", "approved"], tmpDir)).exitCode).toBe(0);

    const selected = await bulkJson(["close", "--where", "type=plan,open-tasks=0"], tmpDir);
    expect(selected.exitCode).toBe(3);
    expect(selected.rows.map((r) => r.slug)).toEqual([emptySlug]);

    const applied = await bulkJson(["close", emptySlug, busyTask, "--apply", "--reason", "milestone over"], tmpDir);
    const byslug = new Map(applied.rows.map((r) => [r.slug, r]));
    expect(byslug.get(busyTask)?.outcome).toBe("SKIPPED");
    expect(byslug.get(busyTask)?.reason).toContain("close applies to plans");
    expect(byslug.get(emptySlug)?.outcome, JSON.stringify(byslug.get(emptySlug))).toBe("OK");
    expect(await statusOf(emptySlug, tmpDir)).toBe("archived");
    expect(applied.exitCode).toBe(0);
  });

  it("preview then apply: --where plan=<slug|id> selects exactly that plan's tasks; an unknown plan exits 2 naming it", async () => {
    const own = [await createTask("Own one"), await createTask("Own two")];
    const other = await runLore(["create", "plan", "--title", "Other Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir);
    const otherSlug = slugOf(other.stdout);
    const foreign = await runLore(
      ["create", "task", "--kind", "code", "--title", "Foreign", "--parent", otherSlug, "--plan-id", otherSlug, "--content", "x", "--no-ai"],
      tmpDir,
    );
    const foreignSlug = slugOf(foreign.stdout);

    const bySlug = await bulkJson(["deprecate", "--where", `type=task,plan=${planSlug}`], tmpDir);
    expect(bySlug.exitCode).toBe(3);
    expect(bySlug.rows.map((r) => r.slug).sort()).toEqual([...own].sort());
    expect(bySlug.rows.map((r) => r.slug)).not.toContain(foreignSlug);

    const planId = (JSON.parse((await runLore(["get", planSlug, "--json"], tmpDir)).stdout) as { data: { doc: { id: string } } }).data.doc.id;
    const byId = await bulkJson(["deprecate", "--where", `type=task,plan=${planId}`], tmpDir);
    expect(byId.rows.map((r) => r.slug).sort()).toEqual([...own].sort());

    // NEGATIVE: an unknown plan is a usage error naming it, never an empty selection.
    const unknown = await runLore(["bulk", "deprecate", "--where", "type=task,plan=plan-no-such-plan"], tmpDir);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout + unknown.stderr).toContain("plan-no-such-plan");
  });

  it("preview then apply: an archived or deprecated document is never a candidate for any verb", async () => {
    const mk = async (title: string): Promise<string> =>
      slugOf((await runLore(["create", "plan", "--title", title, "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir)).stdout);
    const live = [await mk("Live A"), await mk("Live B")];
    const archived = [await mk("Gone A"), await mk("Gone B")];
    const deprecated = await mk("Dead C");
    for (const s of [...live, ...archived]) expect((await runLore(["set", s, "--status", "approved"], tmpDir)).exitCode).toBe(0);
    for (const s of archived) expect((await runLore(["set", s, "--status", "archived"], tmpDir)).exitCode).toBe(0);
    expect((await runLore(["set", deprecated, "--status", "deprecated"], tmpDir)).exitCode).toBe(0);
    expect((await runLore(["set", planSlug, "--status", "deprecated"], tmpDir)).exitCode).toBe(0);

    const preview = await bulkJson(["close", "--where", "type=plan"], tmpDir);
    expect(preview.exitCode).toBe(3);
    expect(preview.rows.map((r) => r.slug).sort()).toEqual([...live].sort());
    for (const verb of ["archive", "deprecate"]) {
      expect((await bulkJson([verb, "--where", "type=plan"], tmpDir)).rows.map((r) => r.slug).sort()).toEqual([...live].sort());
    }
  });
});

describe("bulk lifecycle: row fails alone", () => {
  it("row fails alone: a stale row and a gate-refused row FAIL, the third is written, exit 1", async () => {
    const [ok, stale, gated] = [await createTask("Fine"), await createTask("Moves"), await createTask("NoEvidence")] as [string, string, string];
    await landAttested(ok);
    await landAttested(stale);
    await landAttested(gated, false); // landed, but no runner pass of its contract: the attested-pass floor refuses it
    const start = await statusOf(stale, tmpDir);

    // The preview the apply is pinned to.
    const preview = await bulkJson(["done", ok, stale, gated], tmpDir);
    expect(preview.exitCode).toBe(3);
    const pinned = new Map(preview.rows.map((r) => [r.slug, r.version]));

    // `stale` changes after the preview: its version moves.
    // reason: an approved task's title is locked (record-edit gate), so its version is moved by a working-state write, a note of evidence
    const moved = await runLore(["evidence", stale, "--oracle", "manual", "--command", "echo moved", "--result", "pass", "--output-tail", "moved after the preview"], tmpDir);
    expect(moved.exitCode, moved.stderr).toBe(0);
    const staleVersionNow = await versionOf(stale, tmpDir);
    expect(staleVersionNow).toBeGreaterThan(pinned.get(stale) ?? 0);

    const apply = await bulkJson(
      ["done", `${ok}@${pinned.get(ok)}`, `${stale}@${pinned.get(stale)}`, `${gated}@${pinned.get(gated)}`, "--apply"],
      tmpDir,
    );
    expect(apply.exitCode).toBe(1);
    const rows = new Map(apply.rows.map((r) => [r.slug, r]));
    expect(rows.get(ok)?.outcome).toBe("OK");
    expect(rows.get(stale)?.outcome).toBe("FAILED");
    expect(rows.get(stale)?.code).toBe("STALE_VERSION");
    expect(rows.get(stale)?.rule).toBe("STALE_VERSION");
    expect(rows.get(gated)?.outcome).toBe("FAILED");
    expect(rows.get(gated)?.code).toBe("VALIDATION_ERROR");
    expect(rows.get(gated)?.rule).toBe("BR-1292");
    expect(rows.get(gated)?.reason).toContain("attested-pass");

    // The failed rows wrote nothing: statuses unchanged and the stale row kept only the title edit's version.
    expect(await statusOf(ok, tmpDir)).toBe("archived");
    expect(await statusOf(stale, tmpDir)).toBe(start);
    expect(await statusOf(gated, tmpDir)).toBe(start);
    expect(await versionOf(stale, tmpDir)).toBe(staleVersionNow);
    // No retry: asking again does not rescue the stale row (its pinned version is still behind).
    const retry = await bulkJson(["done", `${stale}@${pinned.get(stale)}`, "--apply"], tmpDir);
    expect(retry.exitCode).toBe(1);
    expect(retry.rows[0]?.code).toBe("STALE_VERSION");
  });
});

describe("bulk lifecycle: draft can be abandoned", () => {
  it("draft can be abandoned: draft -> deprecated is valid for every doc type, archived -> deprecated is not", async () => {
    const types = docTypeSchema.options;
    expect(types.length).toBeGreaterThan(5); // not vacuous
    for (const type of types) {
      expect(isValidTransition("draft", "deprecated", type), `draft -> deprecated for ${type}`).toBe(true);
    }
    expect(getAllowedTransitions("draft")).toContain("deprecated");
    expect(getAllowedTransitions("archived")).toEqual([]);
    for (const type of types) {
      expect(isValidTransition("archived", "deprecated", type), `archived -> deprecated for ${type}`).toBe(false);
      expect(isValidTransition("deprecated", "archived", type), `deprecated -> archived for ${type}`).toBe(false);
    }
  });

  it("draft can be abandoned: bulk deprecate writes deprecated with the reason on a draft plan and a draft task", async () => {
    const task = await createTask("Abandon me");
    const plan = slugOf(
      (await runLore(["create", "plan", "--title", "Abandoned Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir)).stdout,
    );
    const applied = await bulkJson(["deprecate", plan, task, "--apply", "--reason", "no longer wanted"], tmpDir);
    expect(applied.exitCode).toBe(0);
    expect(applied.rows.map((r) => r.outcome)).toEqual(["OK", "OK"]);
    expect(await statusOf(plan, tmpDir)).toBe("deprecated");
    expect(await statusOf(task, tmpDir)).toBe("deprecated");
    expect((await runLore(["audit", plan, "--json"], tmpDir)).stdout).toContain("no longer wanted");
  });

  it("draft can be abandoned: archived -> deprecated is INVALID_TRANSITION (set exits 4, bulk row FAILED, exit 1)", async () => {
    const task = await createTask("Already archived");
    await landAttested(task);
    expect((await bulkJson(["archive", task, "--apply", "--reason", "done with it"], tmpDir)).exitCode).toBe(0);
    expect((await runLore(["set", task, "--status", "deprecated"], tmpDir)).exitCode).toBe(4);
    const bulk = await bulkJson(["deprecate", task, "--apply", "--reason", "too late"], tmpDir);
    expect(bulk.exitCode).toBe(1);
    expect(bulk.rows[0]?.outcome).toBe("FAILED");
    expect(bulk.rows[0]?.code).toBe("INVALID_TRANSITION");
    expect(await statusOf(task, tmpDir)).toBe("archived");
  });
});

describe("bulk lifecycle: archive --apply exit code", () => {
  it("lore done refuses a task with no attested pass (the CLI half of the former lore_done parity case)", async () => {
    const without = await createTask("Refused via CLI");
    await landAttested(without, false); // landed, with no runner pass of its contract
    const before = await statusOf(without, tmpDir);
    const cliRefusal = await runLore(["done", without], tmpDir);
    expect(cliRefusal.exitCode).toBe(4);
    expect(cliRefusal.stderr).toContain("[floor: attested-pass]");
    expect(await statusOf(without, tmpDir)).toBe(before);
  });

  // reason: the retired case made `archive --apply` exit 1 with a FAILED row by parking a straggler in review (in-review -> archived
  // is no lifecycle step). A task that holds a contract has been approved and can no longer be parked in review; the failing candidate
  // is a task parked in review that was never approved: it holds no contract, so `lore done` cannot judge it and its row is FAILED.
  it("lore archive --apply exits 1 when a candidate failed (no contract to judge), 0 when none did", async () => {
    patchLoreConfig(
      tmpDir,
      [
        "workflow:", "  gates:", '    "plan-close":', "      enabled: false",
        "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"', "",
      ].join("\n"),
    );
    expect((await runLore(["set", planSlug, "--status", "approved"], tmpDir)).exitCode).toBe(0);
    // An open task under an archived plan is an R4 candidate. BR-1379 no longer lets the write path create it under an archived
    // plan, so the plan is archived directly afterwards.
    const straggler = await createTask("Straggler in review, never approved");
    const parked = await runLore(["set", straggler, "--status", "in-review"], tmpDir);
    expect(parked.exitCode, parked.stderr).toBe(0);
    const good = await createTask("Straggler that lands");
    await landAttested(good);
    archivePlanWithoutCascade(tmpDir, planSlug);
    const apply = await runLore(["archive", "--apply"], tmpDir);
    expect(apply.exitCode, apply.stdout + apply.stderr).toBe(1);
    expect(apply.stdout).toContain("FAILED");
    expect(apply.stdout).toContain(straggler);
    expect(apply.stdout).toContain("holds no done contract");
    // the failed row wrote nothing; the landed straggler is archived by the same apply
    expect(await statusOf(straggler, tmpDir)).toBe("in-review");
    expect(await statusOf(good, tmpDir)).toBe("archived");

    // Control: once the unjudgeable straggler is abandoned, nothing fails and the apply exits 0.
    expect((await runLore(["set", straggler, "--status", "draft"], tmpDir)).exitCode).toBe(0);
    expect((await runLore(["set", straggler, "--status", "deprecated"], tmpDir)).exitCode).toBe(0);
    const ok = await runLore(["archive", "--apply"], tmpDir);
    expect(ok.exitCode, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).not.toContain("FAILED");
  });
});
