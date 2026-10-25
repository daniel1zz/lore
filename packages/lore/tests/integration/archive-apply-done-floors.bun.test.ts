// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-approval-and-plan-closure-go-through-the-same-checks-on
 *   AC-AP-10, §Design Decisions D8 (supersedes spec-lifecycle-archival-plan-close-cascade-deterministic D3's
 *   "unconditional" sentence for the sweep's task straggler rule); business rule BR-1072; issue #173.
 *
 * RED test for `lore archive --apply` honouring the `lore done` floors. Today `archiveSweepCandidate`
 * archives every R4 straggler task without asking `DoneFloorPort.checkDoneFloors`, so a task with no
 * attested pass is archived by the sweep even though `lore done` would refuse it. The paired
 * implementation makes the sweep skip a floor-refused task, print `[SKIPPED] <slug> — refused by <floor>`,
 * carry `floor` on the `--json` outcome, and keep reporting the task from `--sweep` (exit 3) afterwards.
 *
 * Fixture (CLI subprocess, `bun run src/index.ts`, throwaway corpus — never the repo's own `.lore/`):
 *   an ARCHIVED plan (plan-close gate disabled so archiving it needs no attestation) with, created AFTER the
 *   plan closed (so the R1 cascade never touched them):
 *     T1 — an unclaimed task carrying a runner-captured pass (attested)  -> must be archived by --apply
 *     T2 — an unclaimed task with NO evidence                            -> floor `attested-pass`, stays open
 *     R3 — an expired handoff under the plan (created_at backdated 30d)  -> archived by the same --apply
 *
 * Coverage dimensions:
 *   NEGATIVE: (a) T2 stays open and is printed as `[SKIPPED] <T2> — refused by attested-pass`
 *   HAPPY:    (b) T1 is archived by the same --apply; (e) the expired handoff is archived by it too
 *   ERROR:    (c) `--apply --json` carries `floor: "attested-pass"` on T2's outcome
 *   STATE:    (d) a following `--sweep` exits exactly 3 and still lists T2 with its refusing floor
 *   REGRESSION: (e) the handoff sweep path is unchanged
 *
 * Against current main: (a), (c), (d) fail on ASSERTIONS (T2 is archived, so there is no `[SKIPPED]` line,
 * no `floor` field and no residual candidate); (b) and (e) pass today and guard that the paired fix does
 * not stop archiving what is allowed to be archived.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { archivePlanWithoutCascade } from "../helpers/archive-plan-legacy.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/integration/ -> packages/lore/ (2 levels up).
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:archive-apply-done-floors-test" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Runs a setup command that must succeed; returns its stdout. */
function mustRun(args: string[], cwd: string): string {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

/**
 * Appends the plan-close override (never overwrites — `lore init` seeds a required `project:` block).
 * Also empties `judgment_required_types`: plans are judged by default (BR-281 / BR-1237) and this suite's
 * fixture approves a plan only to reach the archive floors it tests, not to exercise review-judgment.
 */
function disablePlanCloseGate(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      '    "plan-close":',
      "      enabled: false",
      "  review:",
      "    judgment_required_types: []",
      "",
    ].join("\n"),
  );
}

function statusOf(slug: string, cwd: string): string {
  const payload = JSON.parse(mustRun(["get", slug, "--json"], cwd)) as { data: { doc: { status: string } } };
  return payload.data.doc.status;
}

/** Ages a doc so the R3 expired-handoff rule (strict `>` handoff_ttl_minutes, default 10080) fires. */
function backdate(slug: string, cwd: string): void {
  const payload = JSON.parse(mustRun(["get", slug, "--json"], cwd)) as { data: { doc: { id: string } } };
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const db = new Database(join(cwd, ".lore", "lore.db"));
  try {
    db.query("UPDATE docs SET created_at = ? WHERE id = ?").run(old, payload.data.doc.id);
  } finally {
    db.close();
  }
}

interface Fixture {
  readonly planSlug: string;
  /** Straggler task WITH a runner-captured pass. */
  readonly t1: string;
  /** Straggler task with NO evidence at all. */
  readonly t2: string;
  /** Expired handoff under the archived plan. */
  readonly r3: string;
}

let tmpDir: string;

function buildFixture(dir: string): Fixture {
  disablePlanCloseGate(dir);
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Apply Floors PRD", "--content", "root", "--no-ai"], dir));
  const planSlug = parseSlug(
    mustRun(["create", "plan", "--title", "Apply Floors Plan", "--parent", prd, "--content", "x", "--no-ai"], dir),
  );
  mustRun(["set", planSlug, "--status", "approved"], dir);

  const createTask = (title: string): string =>
    parseSlug(
      mustRun(
        ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"],
        dir,
      ),
    );
  const t1 = createTask("Floor Straggler Attested");
  const t2 = createTask("Floor Straggler Bare");
  mustRun(
    ["evidence", t1, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"],
    dir,
  );

  const handoffOut = mustRun(["handoff", "--next", "resume the floor work", "--plan", planSlug], dir);
  const r3 = parseSlug(handoffOut);
  backdate(r3, dir);

  // reason: BR-1379 — archived is terminal, so a task can no longer be created under an archived plan and a plan close
  // cascades its tasks. The straggler state (archived plan, open attested/bare tasks) is the LEGACY shape this suite
  // exercises; write it directly after the members exist.
  archivePlanWithoutCascade(dir, planSlug);

  return { planSlug, t1, t2, r3 };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-archive-apply-floors-test-"));
  makeCleanTreeRepo(tmpDir);
  mustRun(["init"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("lore archive --apply — honours the lore done floors (AC-AP-10, BR-1072)", () => {
  it("(a) NEGATIVE: leaves the evidence-less straggler T2 open and prints '[SKIPPED] <T2> — refused by attested-pass'", () => {
    const { t2 } = buildFixture(tmpDir);

    const apply = runLore(["archive", "--apply"], tmpDir);

    expect(apply.exitCode).toBe(0);
    expect(apply.stdout).toContain(`[SKIPPED] ${t2} — refused by attested-pass`);
    expect(statusOf(t2, tmpDir)).not.toBe("archived");
  });

  it("(b) HAPPY: archives the attested-pass straggler T1 in the same --apply", () => {
    const { t1 } = buildFixture(tmpDir);

    const apply = runLore(["archive", "--apply"], tmpDir);

    expect(apply.exitCode).toBe(0);
    expect(apply.stdout).toContain(`[OK] ${t1}`);
    expect(statusOf(t1, tmpDir)).toBe("archived");
  });

  it("(c) ERROR: --apply --json carries floor 'attested-pass' on T2's outcome and no floor on T1's", () => {
    const { t1, t2 } = buildFixture(tmpDir);

    const apply = runLore(["archive", "--apply", "--json"], tmpDir);

    expect(apply.exitCode).toBe(0);
    const payload = JSON.parse(apply.stdout) as {
      data: { outcomes: Array<{ slug: string; ok: boolean; detail: string; floor?: string }> };
    };
    const t2Outcome = payload.data.outcomes.find((o) => o.slug === t2);
    const t1Outcome = payload.data.outcomes.find((o) => o.slug === t1);
    expect(t2Outcome?.floor).toBe("attested-pass");
    expect(t1Outcome?.ok).toBe(true);
    expect(t1Outcome?.floor).toBeUndefined();
  });

  it("(d) STATE: a following --sweep exits exactly 3 and still lists T2 with its refusing floor (never silent)", () => {
    const { t1, t2 } = buildFixture(tmpDir);
    runLore(["archive", "--apply"], tmpDir);

    const sweep = runLore(["archive", "--sweep"], tmpDir);

    expect(sweep.exitCode).toBe(3);
    expect(sweep.stdout).toContain(t2);
    expect(sweep.stdout).toContain("attested-pass");
    expect(sweep.stdout).not.toContain(t1);
  });

  it("(e) REGRESSION: the expired handoff R3 is archived by the same --apply", () => {
    const { r3 } = buildFixture(tmpDir);

    const apply = runLore(["archive", "--apply"], tmpDir);

    expect(apply.exitCode).toBe(0);
    expect(apply.stdout).toContain(`[OK] ${r3}`);
    expect(statusOf(r3, tmpDir)).toBe("archived");
  });
});
