// @spawns packages/lore/src/index.ts
/**
 * `capture_source` visibility + a generic count↔enumerator contract
 * (task-raise-the-evidence-tail-guard-s-predicate-to-its-own,
 * spec-falsifiability-reachability-a-feedable-checkpoint-an §D5/AC-FR-5, G4).
 *
 * Defect closed: `lore status --json` reported `pass_unfalsified_count` and
 * `unredeemed_allow_missing_path_count` with NO way to enumerate their
 * members — measured 2026-08-10, producing the member list behind
 * `pass_unfalsified_count=29` required a throwaway script iterating all 138
 * specs by hand. This file proves, GENERICALLY (never a hand-listed set),
 * that every `*_count` field a real `lore status --json` reports has a
 * matching `lore status --enumerate <field>` whose returned member count
 * EQUALS the reported number — and that the corpus-wide `capture_source`
 * runner-vs-self-report distribution is one such field.
 *
 * Driven via the REAL CLI subprocess (never the service directly) against a
 * throwaway `mkdtemp`-rooted corpus. NEVER touches this repo's own `.lore/`.
 *
 * ⛔ The global `lore` binary symlinks into the MAIN checkout's `dist/` —
 * this file spawns `bun run <INDEX_TS> ...` against THIS worktree's own
 * source entry, never the bare `lore` binary.
 *
 * Coverage:
 *   HAPPY:      distribution-reported (AC-FR-5's primary oracle) — one
 *               runner row + one self-report row, both counts non-zero and
 *               correct, both enumerators' member counts match
 *   NEGATIVE:   an unregistered count-field name is refused by name (RED (b)
 *               — the binding-on-future-counts requirement)
 *   BOUNDARY:   a genuinely EMPTY corpus reports every count as 0 with a
 *               matching EMPTY member list (never a mismatch at the floor)
 *   ERROR:      the generic scan — EVERY `*_count` key `lore status --json`
 *               reports, read at TEST TIME (never a hand-listed set), has an
 *               enumerator whose member count matches
 *   REGRESSION: a legacy evidence row with capture_source ABSENT is counted
 *               as self-report, never silently dropped from either count
 *
 * @spec_ref AC-FR-5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` — the real CLI, this worktree's own source entry. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-capsrc-vis-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createPlan(): string {
  const r = runLore(["create", "plan", "--title", "Cap Src Plan", "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return m[1];
}

function createTask(planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return m[1];
}

/** Parses `lore status --json`'s `data` object. */
function statusJson(): Record<string, unknown> {
  const r = runLore(["status", "--json"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`lore status --json failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { data: Record<string, unknown> };
  return parsed.data;
}

/** Drives `lore status --enumerate <field> --json` and returns its parsed payload. */
function enumerate(field: string): { exitCode: number; count?: number; members?: string[]; stderr: string } {
  const r = runLore(["status", "--enumerate", field, "--json"], tmpDir);
  if (r.exitCode !== 0) return { exitCode: r.exitCode, stderr: r.stderr };
  const parsed = JSON.parse(r.stdout) as { data: { count: number; members: string[] } };
  return { exitCode: r.exitCode, count: parsed.data.count, members: parsed.data.members, stderr: r.stderr };
}

describe("AC-FR-5 — capture_source visibility + generic count↔enumerator contract", () => {
  it("distribution-reported: one runner row + one self-report row both count non-zero and correctly, and each enumerator's member count matches", () => {
    const planSlug = createPlan();

    // One RUNNER row — --capture spawns the command itself.
    const runnerTask = createTask(planSlug, "Runner Task");
    const runnerWrite = runLore(
      ["evidence", runnerTask, "--oracle", "test", "--command", "echo hi", "--result", "pass", "--capture"],
      tmpDir,
    );
    expect(runnerWrite.exitCode).toBe(0);

    // One SELF-REPORT row — --oracle manual, D5's one surviving self-report escape.
    const selfReportTask = createTask(planSlug, "Self Report Task");
    const selfReportWrite = runLore(
      [
        "evidence",
        selfReportTask,
        "--oracle",
        "manual",
        "--command",
        "checked the login page by hand",
        "--result",
        "pass",
        "--output-tail",
        "logged in 3 times rapidly, 4th correctly blocked",
      ],
      tmpDir,
    );
    expect(selfReportWrite.exitCode).toBe(0);

    const status = statusJson();
    // A projection hardcoding zero self-reports would fail THIS assertion.
    expect(status["capture_source_runner_count"]).toBe(1);
    expect(status["capture_source_self_report_count"]).toBe(1);

    const runnerEnum = enumerate("capture_source_runner_count");
    expect(runnerEnum.exitCode).toBe(0);
    expect(runnerEnum.count).toBe(1);
    expect(runnerEnum.members).toHaveLength(1);
    expect(runnerEnum.members?.[0]).toContain(runnerTask);

    const selfReportEnum = enumerate("capture_source_self_report_count");
    expect(selfReportEnum.exitCode).toBe(0);
    expect(selfReportEnum.count).toBe(1);
    expect(selfReportEnum.members).toHaveLength(1);
    expect(selfReportEnum.members?.[0]).toContain(selfReportTask);
  });

  it("NEGATIVE (RED b): an unregistered count-field name is refused, naming it and the known set — the binding-on-future-counts requirement", () => {
    const result = enumerate("totally_unregistered_count_field");
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("totally_unregistered_count_field");
    expect(result.stderr).toContain("no enumerator registered");
  });

  it("BOUNDARY: a genuinely empty corpus reports every *_count field as 0 with a matching EMPTY member list", () => {
    const status = statusJson();
    const countFields = Object.keys(status).filter((k) => k.endsWith("_count"));
    expect(countFields.length).toBeGreaterThan(0);
    for (const field of countFields) {
      expect(status[field]).toBe(0);
      const result = enumerate(field);
      expect(result.exitCode).toBe(0);
      expect(result.count).toBe(0);
      expect(result.members).toEqual([]);
    }
  });

  it("ERROR: the GENERIC scan — every *_count field a real lore status --json reports (read at TEST TIME, never hand-listed) has an enumerator whose member count matches", () => {
    // Seed some real state so the counts are non-trivial.
    const planSlug = createPlan();
    const t1 = createTask(planSlug, "Scan Task 1");
    runLore(["evidence", t1, "--oracle", "test", "--command", "echo hi", "--result", "pass", "--capture"], tmpDir);
    const t2 = createTask(planSlug, "Scan Task 2");
    runLore(
      ["evidence", t2, "--oracle", "manual", "--command", "manual check", "--result", "pass", "--output-tail", "ok, checked"],
      tmpDir,
    );

    const status = statusJson();
    const countFields = Object.keys(status).filter((k) => k.endsWith("_count"));
    expect(countFields.length).toBeGreaterThanOrEqual(4); // at minimum the 4 documented in this task's own doc

    for (const field of countFields) {
      const reported = status[field];
      expect(typeof reported).toBe("number");
      const result = enumerate(field);
      // Naming the offending field on failure — never a bare boolean assert.
      expect(result.exitCode, `field "${field}" has no working enumerator`).toBe(0);
      expect(result.count, `field "${field}": enumerate count mismatch`).toBe(reported);
      expect(result.members?.length, `field "${field}": member array length mismatch`).toBe(reported);
    }
  });
});

// ─── runner-unattested bucket (issue #48, BR-1073) — AC-EH-2 c, d, e ──────────
//
// `status --json`/`--enumerate` read the corpus through the real CLI, and the
// runner-unattested + legacy rows cannot be produced by any public writer (that
// is the point of the label), so they are written DIRECTLY into the throwaway
// corpus's store by a one-shot `bun` script (bun:sqlite is unreachable from
// vitest itself). RED today: the label is counted inside the self-report bucket
// and no runner-unattested count/enumerator exists.

const SQLITE_STORE_TS = join(PACKAGE_ROOT, "src", "store", "sqlite-store.ts");

/** Appends one hand-built evidence row to `taskSlug`'s stored doc, bypassing every writer. */
function injectEvidenceRow(taskSlug: string, row: Record<string, unknown>): void {
  const script = join(tmpDir, `inject-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(
    script,
    `import { SQLiteStore } from ${JSON.stringify(SQLITE_STORE_TS)};
const store = new SQLiteStore(${JSON.stringify(join(tmpDir, ".lore", "lore.db"))});
const found = await store.findBySlug(${JSON.stringify(taskSlug)});
if (!found.ok || found.value === null) throw new Error("task not found: " + ${JSON.stringify(taskSlug)});
const prior = (found.value.extra["verification_evidence"] ?? []) as unknown[];
const updated = await store.update(found.value.id, {
  extra: { ...found.value.extra, verification_evidence: [...prior, ${JSON.stringify(row)}] },
});
if (!updated.ok) throw new Error(JSON.stringify(updated.error));
`,
  );
  const r = spawnSync("bun", ["run", script], { cwd: tmpDir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`inject failed: ${r.stderr}${r.stdout}`);
}

/** 2 runner (CLI --capture), 1 self-report (CLI manual), 1 runner-unattested + 1 legacy (injected). */
function seedMixedFixture(): { unattestedTask: string } {
  const planSlug = createPlan();
  for (const title of ["Runner A", "Runner B"]) {
    const t = createTask(planSlug, title);
    const w = runLore(["evidence", t, "--oracle", "test", "--command", "echo hi", "--result", "pass", "--capture"], tmpDir);
    expect(w.exitCode).toBe(0);
  }
  const selfTask = createTask(planSlug, "Self Report");
  const sw = runLore(
    ["evidence", selfTask, "--oracle", "manual", "--command", "manual check", "--result", "pass", "--output-tail", "ok, checked by hand"],
    tmpDir,
  );
  expect(sw.exitCode).toBe(0);
  const unattestedTask = createTask(planSlug, "Unattested Control");
  injectEvidenceRow(unattestedTask, {
    oracle: "test",
    command: "bunx vitest run x.test.ts",
    result: "inconclusive",
    recorded_at: "2026-01-01T00:00:00.000Z",
    recorded_by: "agent:runner",
    capture_source: "runner-unattested",
    output_tail: "green control failed",
  });
  const legacyTask = createTask(planSlug, "Legacy Row");
  injectEvidenceRow(legacyTask, {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_at: "2026-01-01T00:00:00.000Z",
    recorded_by: "agent:legacy",
  });
  return { unattestedTask };
}

describe("AC-EH-2 c/d — status counts and enumerates runner-unattested as its own bucket", () => {
  it("(c) 2 runner + 1 self-report + 1 runner-unattested + 1 legacy: counts 2 / 2 / 1 and the three sum to 5", () => {
    seedMixedFixture();
    const status = statusJson();
    expect(status["capture_source_runner_count"]).toBe(2);
    // self-report = the explicit self-report row + the legacy row with no capture_source.
    expect(status["capture_source_self_report_count"]).toBe(2);
    expect(status["capture_source_runner_unattested_count"]).toBe(1);
    const sum =
      (status["capture_source_runner_count"] as number) +
      (status["capture_source_self_report_count"] as number) +
      ((status["capture_source_runner_unattested_count"] as number | undefined) ?? 0);
    expect(sum).toBe(5);
  });

  it("(d) --enumerate capture_source_runner_unattested_count lists exactly that one row and exits 0", () => {
    const { unattestedTask } = seedMixedFixture();
    const result = enumerate("capture_source_runner_unattested_count");
    expect(result.exitCode).toBe(0);
    expect(result.count).toBe(1);
    expect(result.members).toHaveLength(1);
    expect(result.members?.[0]).toContain(unattestedTask);
  });
});
