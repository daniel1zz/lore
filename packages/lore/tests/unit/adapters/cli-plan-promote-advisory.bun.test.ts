/**
 * `lore approve <plan>` — `plan-promote` reachability EARLY-WARNING advisory,
 * rendered on the LIVE CLI approve path (spec-verify-reachability-plan-promote-
 * early-warning §Scope M1, task T2 "wire planPromoteReachabilityAdvisory into
 * live enforcement path + CLI stderr render + e2e", AC-VRW-5).
 *
 * `planPromoteReachabilityAdvisory` (checkpoint-registry.ts) shipped with unit
 * coverage (T1, `verify-reachability.test.ts`) but ZERO production consumer — a
 * post-merge live probe found `dist/lore approve <plan-under-prd>` exiting 0
 * with NO advisory output at all (grep of gate-enforcer.ts/review-service.ts/
 * cli/commands/approve.ts turned up no reference). This suite spawns the
 * COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY corpus
 * (`mkdtemp` + `lore init`) — never the repo's own `.lore/` corpus (project
 * CLAUDE.md hard rule) — and asserts the wiring reaches the real CLI process,
 * not just the service-layer unit tests.
 *
 * Coverage:
 *   HAPPY (a): approving a plan parented DIRECTLY under a PRD (no spec-tier
 *     ancestor at all — `lore verify` is structurally unreachable,
 *     `verifyReachability(null, ...)` => `why: "parent-not-spec"`) prints >= 1
 *     reachability advisory line to stderr AND exits 0 (D1 — advisory never
 *     blocks).
 *   HAPPY (b) / REGRESSION: approving a plan parented under a spec that
 *     declares >= 1 script-mode acceptance criterion (`lore verify`-reachable)
 *     prints ZERO advisory lines, still exits 0 — the common case must stay
 *     silent, never noisy.
 *   STATE: both scenarios independently drive the SAME plan-promote checkpoint
 *     to a passing verdict (`checkPlanPromote` vacuously passes when
 *     `hasSpecParent` is false; the AC-satisfying spec-parented plan passes on
 *     its own merits) — this suite is about the ADVISORY channel, not the
 *     gate's pass/fail verdict, which is asserted unchanged in both branches
 *     via the shared `exitCode === 0` check.
 *
 * @spec_ref spec-verify-reachability-plan-promote-early-warning §Acceptance
 *   Criteria AC-VRW-5
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    // Hermetic actor identity: without it, environments that strip CLAUDECODE
    // (e.g. `lore verify`'s env allowlist) fall to the OS username and emit an
    // unrelated actor-traceability warning on stderr, breaking the exact
    // empty-stderr assertion below.
    env: { ...process.env, HOME: cwd, EDITOR: "true", LORE_ACTOR: "agent:e2e-advisory-probe" },
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
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
}

function createPrd(dir: string, title: string): string {
  const result = runLore(["create", "prd", "--title", title, "--content", "PRD body.", "--no-ai"], dir);
  if (result.exitCode !== 0) throw new Error(`create prd failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

function createPlan(dir: string, parentSlug: string, title: string): string {
  const result = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  if (result.exitCode !== 0) throw new Error(`create plan failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

// ─── Suite: binary freshness guard ───────────────────────────────────────────

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-plan-promote-advisory-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY (a): PRD-parented plan — unreachable, advisory prints, exit 0 ────

describe("lore approve <plan-under-prd> — reachability advisory (AC-VRW-5a)", () => {
  it("prints >= 1 reachability advisory line to stderr and exits 0", () => {
    const prdSlug = createPrd(tmpDir, "Advisory PRD");
    const planSlug = createPlan(tmpDir, prdSlug, "PRD-Parented Plan");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    const advisoryLines = result.stderr
      .split("\n")
      .filter((line) => line.includes("ADVISORY") && line.includes("lore verify"));
    expect(advisoryLines.length).toBeGreaterThanOrEqual(1);
    // reason: D1 — the advisory names the plan-close consequence and the two
    // real options; assert the concrete precondition wording too (not just a
    // bare marker), and that it never claims to have blocked anything.
    expect(result.stderr).toContain("does not block this promote");
    expect(result.stderr).toContain("this plan has no spec-tier ancestor at all");
  });
});

// ─── HAPPY (b) / REGRESSION: spec-parented, reachable plan — silent, exit 0 ─

describe("lore approve <plan-under-reachable-spec> — no advisory (AC-VRW-5b)", () => {
  it("prints ZERO advisory lines and exits 0 when the ancestor spec declares >= 1 script-mode AC", () => {
    const prdSlug = createPrd(tmpDir, "Reachable PRD");
    const specResult = runLore(
      [
        "create",
        "spec",
        "--title",
        "Reachable Spec",
        "--parent",
        prdSlug,
        "--content",
        "## Overview\n\nSpec body for the reachability advisory e2e.\n",
        "--no-ai",
      ],
      tmpDir,
    );
    expect(specResult.exitCode).toBe(0);
    const specSlug = parseSlug(specResult.stdout);

    const acResult = runLore(
      [
        "ac",
        "add",
        specSlug,
        "AC-REACH-1",
        "--statement",
        "The reachable spec declares a script-mode oracle.",
        "--mode",
        "script",
        "--oracle",
        "test",
        "--command",
        "bun test",
      ],
      tmpDir,
    );
    expect(acResult.exitCode).toBe(0);

    const specApprove = runLore(["approve", specSlug], tmpDir);
    expect(specApprove.exitCode).toBe(0);

    const planSlug = createPlan(tmpDir, specSlug, "Spec-Parented Reachable Plan");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("approved");
    const advisoryLines = result.stderr.split("\n").filter((line) => line.includes("ADVISORY"));
    expect(advisoryLines.length).toBe(0);
    expect(result.stderr).toBe("");
  });
});
