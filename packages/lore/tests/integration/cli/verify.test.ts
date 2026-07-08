/**
 * Integration tests for `lore verify` (SPEC-039 §2, §3, §4 AC-VRF-10). Runs the
 * real CLI via subprocess against an isolated throwaway corpus — same pattern
 * as `tests/integration/cli/task-workflow.test.ts`. Fixture script-mode ACs use
 * `--oracle other --command "true"` / `"false"` — instantaneous, real spawns
 * (no sleep, no long-running commands).
 *
 * Scope: adapter translation-only (args → VerifyRunnerService.verifyPlan call →
 * exit code / stdout / stderr rendering). Business rules (attestation
 * derivation, timeout escalation, resolveTargetTask's matrix) are exhaustively
 * covered at the service/core layers (verify-runner-service.test.ts,
 * verify-spawn.test.ts, task-workflow.test.ts in @lore/core) — this file does
 * not re-test them.
 *
 * Coverage:
 *   HAPPY:      all-pass run → exit 0, per-AC pass line with duration; --ac
 *               filter restricts the run to a subset of declared ACs
 *   NEGATIVE:   ambiguous target task (>1 fresh claim, no --task) → exit 4
 *               listing candidate slugs; unknown --ac id → exit 4; a failing
 *               AC's command → exit 1
 *   BOUNDARY:   spec with only ai/human-mode ACs declared → exit 0 with an
 *               explicit "nothing to run" notice (never silently a no-op)
 *   STATE:      draft (unapproved) spec → advisory warning line on stderr,
 *               passthrough from VerifyRunnerService.warnings, never a hard gate
 *   REGRESSION: forged `--attestation` flag on `lore evidence` (AC-VRF-2
 *               adapter half) is silently ignored — evidence.ts's args schema
 *               never declares that flag and its run() builds the service
 *               input object from named fields only, so nothing is smuggled
 *               through even though citty's non-strict parser accepts the
 *               unknown flag without erroring
 *
 * @spec_ref AC-VRF-10 AC-VRF-2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — this calls the real CLI binary path.
 */
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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function createPrd(title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createSpec(title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "spec", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createPlan(title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createTask(planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/** Declare a script-mode AC via `lore ac add` (oracle "other", instantaneous command). */
function declareScriptAc(specSlug: string, acId: string, command: string): void {
  const r = runLore(
    ["ac", "add", specSlug, acId, "--statement", "A dogfood AC.", "--mode", "script", "--oracle", "other", "--command", command],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add (script) failed: ${r.stderr}`);
}

/** Declare a human-mode AC (no script to execute). */
function declareHumanAc(specSlug: string, acId: string): void {
  const r = runLore(
    ["ac", "add", specSlug, acId, "--statement", "A human-judged AC.", "--mode", "human"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add (human) failed: ${r.stderr}`);
}

/** Build a full prd → spec → plan → task chain with N script ACs declared, return the slugs. */
function buildFixture(
  label: string,
  acs: Array<{ id: string; command: string }>,
): { specSlug: string; planSlug: string; taskSlug: string } {
  const prdSlug = createPrd(`${label} PRD`);
  const specSlug = createSpec(`${label} Spec`, prdSlug);
  for (const ac of acs) declareScriptAc(specSlug, ac.id, ac.command);
  const planSlug = createPlan(`${label} Plan`, specSlug);
  const taskSlug = createTask(planSlug, `${label} Task`);
  return { specSlug, planSlug, taskSlug };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("lore verify — HAPPY", () => {
  it("AC-VRF-10.H1: all-pass run → exit 0, per-AC pass line with duration_ms", () => {
    const { planSlug, taskSlug } = buildFixture("Happy", [{ id: "AC-VRF-H1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AC-VRF-H1");
    expect(result.stdout).toContain("pass");
    expect(result.stdout).toMatch(/\(\d+ms, exit 0\)/);
    expect(result.stdout).toContain("1 passed, 0 failed.");
  });

  it("AC-VRF-10.H2: --json envelope carries task/results/skipped/warnings", () => {
    const { planSlug, taskSlug } = buildFixture("HappyJson", [{ id: "AC-VRF-H2", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: {
        task?: { slug?: string };
        results?: Array<{ ac_id: string; result: string; exit_code: number; duration_ms: number }>;
        skipped?: unknown[];
        warnings?: string[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.task?.slug).toBe(taskSlug);
    expect(parsed.data?.results).toHaveLength(1);
    expect(parsed.data?.results?.[0]?.ac_id).toBe("AC-VRF-H2");
    expect(parsed.data?.results?.[0]?.result).toBe("pass");
    expect(parsed.data?.results?.[0]?.exit_code).toBe(0);
  });

  it("AC-VRF-10.H3: --ac filters the run to the named subset", () => {
    const { planSlug, taskSlug } = buildFixture("AcFilter", [
      { id: "AC-VRF-F1", command: "true" },
      { id: "AC-VRF-F2", command: "true" },
    ]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--ac", "AC-VRF-F1", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data?: { results?: Array<{ ac_id: string }> } };
    expect(parsed.data?.results).toHaveLength(1);
    expect(parsed.data?.results?.[0]?.ac_id).toBe("AC-VRF-F1");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("lore verify — NEGATIVE", () => {
  it("AC-VRF-10.N1: ambiguous target task (>1 fresh claim, no --task) → exit 4, message lists candidates", () => {
    const prdSlug = createPrd("Ambiguous PRD");
    const specSlug = createSpec("Ambiguous Spec", prdSlug);
    declareScriptAc(specSlug, "AC-VRF-AMB", "true");
    const planSlug = createPlan("Ambiguous Plan", specSlug);
    const taskA = createTask(planSlug, "Task A");
    const taskB = createTask(planSlug, "Task B");

    runLore(["claim", taskA, "--by", "alice"], tmpDir);
    runLore(["claim", taskB, "--by", "bob"], tmpDir);

    const result = runLore(["verify", planSlug], tmpDir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(taskA);
    expect(result.stderr).toContain(taskB);
  });

  it("AC-VRF-10.N2: unknown --ac id → exit 4 (VALIDATION_ERROR)", () => {
    const { planSlug, taskSlug } = buildFixture("UnknownAc", [{ id: "AC-VRF-U1", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug, "--ac", "AC-DOES-NOT-EXIST"], tmpDir);

    expect(result.exitCode).toBe(4);
  });

  it("AC-VRF-10.N3: a failing AC's command → exit 1, ✘ line rendered", () => {
    const { planSlug, taskSlug } = buildFixture("Failing", [{ id: "AC-VRF-FAIL", command: "false" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("AC-VRF-FAIL");
    expect(result.stdout).toContain("fail");
    expect(result.stdout).toContain("0 passed, 1 failed.");
  });

  it("AC-VRF-10.N4: non-existent plan slug → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["verify", "plan-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── BOUNDARY — no script-mode ACs declared ──────────────────────────────────

describe("lore verify — BOUNDARY (no script ACs)", () => {
  it("AC-VRF-10.B1: spec with only a human-mode AC → exit 0, explicit notice, nothing executed", () => {
    const prdSlug = createPrd("NoScript PRD");
    const specSlug = createSpec("NoScript Spec", prdSlug);
    declareHumanAc(specSlug, "AC-VRF-HUMAN");
    const planSlug = createPlan("NoScript Plan", specSlug);
    const taskSlug = createTask(planSlug, "NoScript Task");

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No script-mode acceptance criteria to run");
    expect(result.stdout).toContain("AC-VRF-HUMAN (human)");
  });
});

// ─── STATE — draft-spec advisory warning ─────────────────────────────────────

describe("lore verify — STATE (draft-spec advisory)", () => {
  it("AC-VRF-10.S1: an unapproved (draft) parent spec → advisory warning on stderr, never a hard gate", () => {
    // reason: `lore create spec` defaults new docs to status "draft" — never
    // approved in this fixture, so VerifyRunnerService's advisory fires.
    const { planSlug, taskSlug } = buildFixture("DraftWarn", [{ id: "AC-VRF-DRAFT", command: "true" }]);

    const result = runLore(["verify", planSlug, "--task", taskSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("not approved/active");
    // reason: advisory only — the run still executed and passed (not a hard gate).
    expect(result.stdout).toContain("1 passed, 0 failed.");
  });
});

// ─── REGRESSION — AC-VRF-2 adapter half: forged --attestation is inert ───────

describe("lore evidence — forged --attestation is silently inert (AC-VRF-2 adapter half)", () => {
  it("REG1: an unrecognized --attestation flag does not reach the persisted evidence entry", () => {
    const { planSlug, taskSlug } = buildFixture("ForgedAttestation", []);
    void planSlug;

    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "other",
        "--command",
        "manual check",
        "--result",
        "pass",
        // reason: evidence.ts's `args` schema never declares an --attestation flag —
        // citty's non-strict parser still accepts it as a raw key, but evidence.ts's
        // run() builds the EvidenceInput object from named fields only, so this can
        // never reach TaskWorkflowService.addEvidence regardless of what's passed here.
        "--attestation",
        JSON.stringify({ runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false }),
        "--json",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data?: { doc?: { extra?: { verification_evidence?: Array<Record<string, unknown>> } } };
    };
    const entries = parsed.data?.doc?.extra?.verification_evidence ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBeDefined();
    expect("attestation" in (entries[0] ?? {})).toBe(false);
  });
});
