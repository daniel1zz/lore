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
import { saveConfig } from "@lore/core/node";
import { citeSpecViaCli, loreRunnerFor } from "../../helpers/cli-live-rule.js";

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
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDE_CODE_SESSION_ID: "e2e-advisory-probe-session" },
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

    // SPEC-103 §Mechanisms M2 — `review-judgment` is a SEPARATE, ADDITIVE
    // checkpoint on `ReviewService.approve` for spec/adr docs (default
    // `judgment_required_types: ["spec","adr"]`) this fixture predates. The
    // spec approve below exists purely to make the ancestor spec REACHABLE
    // for the plan-promote advisory this suite actually tests (AC-VRW-5b),
    // not to exercise M2's own review-judgment semantics, so disable M2 here
    // — mirrors `gate-hooks.bun.test.ts`'s / `gate-spec-promote.bun.test.ts`'s
    // `judgment_required_types: []` precedent.
    saveConfig(tmpDir, {
      project: { name: "cli-plan-promote-advisory-test", author: "tester" },
      workflow: { review: { judgment_required_types: [] } },
    } as never);

    citeSpecViaCli(loreRunnerFor(runLore, tmpDir), tmpDir, undefined, specSlug, "AC-REACH-1"); // BR-1007: approvable only when a criterion cites a live rule
    const specApprove = runLore(["approve", specSlug], tmpDir);
    expect(specApprove.exitCode).toBe(0);

    const planSlug = createPlan(tmpDir, specSlug, "Spec-Parented Reachable Plan");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("approved");
    const advisoryLines = result.stderr.split("\n").filter((line) => line.includes("ADVISORY"));
    expect(advisoryLines.length).toBe(0);
    expect(result.stderr).toBe("");
  }, 20000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/AC-TB-4): this body calls the `runLore` spawn helper 4 direct times
  // (create spec, ac add, approve spec, approve plan) plus one more via
  // `createPlan`'s own `runLore` call and one more from the `beforeEach`
  // `lore init` — 6 real `dist/lore` spawns total per run. Measured failure:
  // 6222ms (original incident) / 6981ms (reproduced here under induced load,
  // load average ~135) against bun:test's DEFAULT 5000ms budget — reads as a
  // killed-child/empty-stderr failure, not a timeout, unless this budget is
  // named. 20000ms gives >=3x headroom over both measured overruns without
  // policing the number (the oracle only requires the argument be present).
});
