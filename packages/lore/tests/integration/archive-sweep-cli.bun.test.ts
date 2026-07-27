/**
 * @spec_ref spec-lifecycle-archival-plan-close-cascade-deterministic
 *   §Design Decisions D3, AC-097-3
 *
 * CLI e2e for `lore archive --sweep`/`--apply` (SOURCE mode — `bun run src/index.ts`,
 * mirrors `cli-outline.bun.test.ts`'s harness): `--sweep` reports current archive
 * candidates with a literal `lore archive --apply` repair line and exits 3; `--apply`
 * archives them (one audited write each); an immediate re-sweep exits 0.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) —
 * every test operates inside its own `mkdtempSync` directory.
 *
 * A `done_plan_straggler` (R4) candidate is constructed by archiving a plan (with
 * `workflow.gates."plan-close".enabled: false` so the plan-close gate/attestation
 * floor never blocks this fixture's test-scope-irrelevant path) and THEN creating a
 * task under it — the task never existed during the plan's own archival, so it is
 * NOT touched by the R1 cascade, and shows up only via the R2-R4 sweep.
 *
 * Coverage dimensions:
 *   HAPPY:      `--sweep --json` exits 3, lists the straggler with `rule:
 *               "done_plan_straggler"` and `repair: "lore archive --apply"`;
 *               `--apply` archives it (exit 0); an immediate re-`--sweep` exits 0
 *               with an empty candidate list
 *   NEGATIVE:   neither `--sweep` nor `--apply` → exit 2 usage error
 *   BOUNDARY:   both `--sweep` AND `--apply` together → exit 2 usage error
 *   STATE:      after `--apply`, `lore get <task> --json` shows `status: "archived"`
 *   REGRESSION: an empty corpus's `--sweep` exits 0 with zero candidates
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:archive-sweep-cli-test" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

/** Disables the plan-close gate wholesale — irrelevant to THIS suite's scope (the R2-R4 sweep verb, not R1's cascade/gate interplay). */
function disablePlanCloseGate(dir: string): void {
  const loreDir = join(dir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(
    join(loreDir, "config.yaml"),
    ['workflow:', '  gates:', '    "plan-close":', "      enabled: false", ""].join("\n"),
    "utf8",
  );
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-archive-sweep-cli-test-"));
  const initResult = runLore(["init"], tmpDir);
  expect(initResult.exitCode).toBe(0);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("lore archive — HAPPY/STATE (sweep -> apply -> re-sweep)", () => {
  it("AC-097-3: sweep reports a done_plan_straggler with a literal repair, apply archives it, re-sweep is clean", () => {
    disablePlanCloseGate(tmpDir);

    const prdResult = runLore(["create", "prd", "--title", "Archive Sweep PRD", "--content", "root", "--no-ai"], tmpDir);
    expect(prdResult.exitCode).toBe(0);
    const prdSlug = parseSlug(prdResult.stdout);

    const planResult = runLore(
      ["create", "plan", "--title", "Sweep Test Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
      tmpDir,
    );
    expect(planResult.exitCode).toBe(0);
    const planSlug = parseSlug(planResult.stdout);

    const approveResult = runLore(["set", planSlug, "--status", "approved"], tmpDir);
    expect(approveResult.exitCode).toBe(0);

    const archivePlanResult = runLore(["set", planSlug, "--status", "archived"], tmpDir);
    expect(archivePlanResult.exitCode).toBe(0);

    // Task created AFTER the plan already archived — a genuine R4 straggler, never
    // touched by the R1 cascade (which only ever sees children present AT close time).
    const taskResult = runLore(
      [
        "create",
        "task",
        "--title",
        "Straggler Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--content",
        "x",
        "--no-ai",
      ],
      tmpDir,
    );
    expect(taskResult.exitCode).toBe(0);
    const taskSlug = parseSlug(taskResult.stdout);

    const sweepResult = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(sweepResult.exitCode).toBe(3);
    const sweepPayload = JSON.parse(sweepResult.stdout) as {
      ok: boolean;
      data: { candidates: Array<{ slug: string; rule: string; reason: string; repair: string }> };
    };
    expect(sweepPayload.ok).toBe(true);
    expect(sweepPayload.data.candidates).toHaveLength(1);
    expect(sweepPayload.data.candidates[0]!.slug).toBe(taskSlug);
    expect(sweepPayload.data.candidates[0]!.rule).toBe("done_plan_straggler");
    expect(sweepPayload.data.candidates[0]!.repair).toBe("lore archive --apply");

    const applyResult = runLore(["archive", "--apply", "--by", "agent:archive-sweep-cli-test"], tmpDir);
    expect(applyResult.exitCode).toBe(0);
    expect(applyResult.stdout).toContain(taskSlug);
    expect(applyResult.stdout).toContain("OK");

    const reSweepResult = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(reSweepResult.exitCode).toBe(0);
    const reSweepPayload = JSON.parse(reSweepResult.stdout) as { data: { candidates: unknown[] } };
    expect(reSweepPayload.data.candidates).toEqual([]);

    const getResult = runLore(["get", taskSlug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const getPayload = JSON.parse(getResult.stdout) as { data: { doc: { status: string } } };
    expect(getPayload.data.doc.status).toBe("archived");
  });
});

describe("lore archive — NEGATIVE/BOUNDARY (usage errors)", () => {
  it("AC-097-3: neither --sweep nor --apply exits 2", () => {
    const result = runLore(["archive"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("AC-097-3: both --sweep and --apply together exits 2", () => {
    const result = runLore(["archive", "--sweep", "--apply"], tmpDir);
    expect(result.exitCode).toBe(2);
  });
});

describe("lore archive — REGRESSION (empty corpus)", () => {
  it("AC-097-3: --sweep on an empty corpus exits 0 with zero candidates", () => {
    const result = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { candidates: unknown[] } };
    expect(payload.data.candidates).toEqual([]);
  });
});
