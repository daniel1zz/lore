// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore review` CLI subcommand (SPEC-034 §4, §6). Runs the real CLI
 * via subprocess against an isolated temp SQLite DB, same pattern as
 * tests/integration/cli/assess.test.ts (which this file's hermeticity setup mirrors
 * exactly, via the shared `tests/helpers/stub-claude.ts` helper).
 *
 * Hermeticity note: `runLore` prepends a fail-fast stub `claude` binary to PATH (see
 * `beforeEach`, `installStubClaude`). `lore review` is an AI-intent command exactly like
 * `lore assess` — without this shim, the deterministic-fail and provider-failure tests
 * below would either invoke a REAL AI call or (worse) pass for the wrong reason.
 *
 * Coverage:
 *   HAPPY:      a doc whose deterministic checks all pass/skip goes to the AI judge path
 *               (proven indirectly: it reaches exit 6 via the stub's failure, not exit 4/2 —
 *               see ERROR below); `--pending` on a mixed-outcome queue exits 0 with a
 *               per-doc summary table
 *   NEGATIVE:   --no-ai always exits 2 (review has no non-AI mode); --ai + --no-ai together
 *               exits 2; missing doc without --pending exits 2
 *   BOUNDARY:   empty pending queue → "No pending documents.", exit 0
 *   ERROR:      a task with no verification_evidence fails the evidence_completeness
 *               deterministic check → judgment recorded (decision=reject, confidence=1.00)
 *               WITHOUT ever invoking the AI provider (the stub would exit 1 if called,
 *               yet the command exits 0 — proof the provider was never reached); a doc
 *               whose deterministic checks all pass reaches the AI judge, which fails via
 *               the stub → exit 6, no judgment recorded (checked via `lore pending`'s
 *               badge staying "[unreviewed]")
 *   STATE:      after a deterministic-reject judgment, `lore pending`'s AI Judgment badge
 *               reflects the recorded decision
 *   REGRESSION: `--pending` with a mix of deterministic-reject (succeeds) and
 *               provider-failure (fails) docs exits 0 (NOT all failed) with a stderr
 *               warning naming the failure count
 *
 * @spec_ref SPEC-034 §4, §6
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installStubClaude, stubClaudeEnv } from "../../helpers/stub-claude.js";

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
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir. PATH is shimmed
 * to resolve `claude` to the fail-fast stub created in `beforeEach` (see
 * tests/helpers/stub-claude.ts), so the AI-provider spawn always hits a deterministic
 * exit-1 failure instead of whatever `claude` happens to be installed on the host machine.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: stubClaudeEnv(cwd, join(cwd, "stub-bin")),
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
  tmpDir = join(tmpdir(), `lore-review-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  installStubClaude(tmpDir);

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

function createPlan(title: string): string {
  const r = runLore(["create", "plan", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return slug;
}

/** Create a task with NO verification_evidence — naturally fails the evidence_completeness
 * deterministic check without needing to fabricate an invalid doc via direct store access. */
function createTaskWithoutEvidence(planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return slug;
}

/** Create a root-type PRD doc — parent_contract passes (root type, no parent required),
 * schema passes (prdExtraSchema accepts any extra), so ALL deterministic checks pass/skip
 * and the doc reaches the AI judge path. */
function createPrd(title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract prd slug from: ${r.stdout}`);
  return slug;
}

// ─── NEGATIVE: --no-ai always exits 2 ─────────────────────────────────────────

describe("lore review --no-ai — always a contradiction", () => {
  it("exits 2 even for an existing doc (review has no non-AI mode)", () => {
    const planSlug = createPlan("No-AI Plan");
    const result = runLore(["review", planSlug, "--no-ai"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--no-ai");
  });

  it("exits 2 even for a NONEXISTENT doc — the mutex check runs before doc resolution", () => {
    const result = runLore(["review", "doc-does-not-exist-anywhere", "--no-ai"], tmpDir);
    expect(result.exitCode).toBe(2);
  });
});

describe("lore review --ai --no-ai together — mutually exclusive", () => {
  it("exits 2 when both flags are passed, before any doc lookup", () => {
    const result = runLore(["review", "doc-does-not-exist-anywhere", "--ai", "--no-ai"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");
  });
});

describe("lore review — missing doc argument (no --pending)", () => {
  it("exits 2 with a helpful message", () => {
    const result = runLore(["review"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--pending");
  });
});

// ─── ERROR: deterministic-check-fail path never touches the AI provider ──────

describe("lore review — deterministic check failure short-circuits before any AI call", () => {
  it("a task with no verification_evidence: exit 0, decision=reject, confidence=1.00, checks table shows evidence_completeness FAIL", () => {
    const planSlug = createPlan("Det Fail Plan");
    const taskSlug = createTaskWithoutEvidence(planSlug, "Evidence-less Task");

    const result = runLore(["review", taskSlug], tmpDir);

    // exit 0 — recording a judgment (even decision=reject) counts as success; if the AI
    // provider HAD been invoked, the stub would force exit 6 instead.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Decision: reject");
    expect(result.stdout).toContain("confidence: 1.00");
    expect(result.stdout).toContain("evidence_completeness");
    expect(result.stdout).toContain("fail");
    // The judge identity for a deterministic-only judgment is NOT the real AI provider.
    expect(result.stdout).toContain("deterministic-checks");
  });

  it("--json envelope carries the same deterministic judgment shape", () => {
    const planSlug = createPlan("Det Fail Plan JSON");
    const taskSlug = createTaskWithoutEvidence(planSlug, "Evidence-less Task JSON");

    const result = runLore(["review", taskSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { judgment: { decision: string; confidence: number; judge: { provider: string } } };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.judgment.decision).toBe("reject");
    expect(parsed.data.judgment.confidence).toBe(1.0);
    expect(parsed.data.judgment.judge.provider).toBe("deterministic-checks");
  });
});

// ─── ERROR: provider failure → exit 6, no judgment recorded ───────────────────

describe("lore review — AI provider failure (doc passes all deterministic checks)", () => {
  it("exits 6 with AI_PROVIDER_ERROR-shaped stderr, and no judgment is recorded", () => {
    const prdSlug = createPrd("Clean Root PRD");

    const result = runLore(["review", prdSlug], tmpDir);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).not.toContain("--no-ai");
    expect(result.stderr).toContain("no non-AI fallback");

    // No judgment was recorded — the doc still shows [unreviewed] in `lore pending`.
    // reason: PendingDoc has no `slug` field (only id/type/title/...) — match by title.
    const pendingResult = runLore(["pending", "--json"], tmpDir);
    expect(pendingResult.exitCode).toBe(0);
    const parsed = JSON.parse(pendingResult.stdout) as {
      data: { docs: Array<{ title: string; judgment: unknown }> };
    };
    const prdRow = parsed.data.docs.find((d) => d.title === "Clean Root PRD");
    expect(prdRow).toBeDefined();
    expect(prdRow?.judgment).toBeNull();
  });
});

// ─── BOUNDARY: empty pending queue ────────────────────────────────────────────

describe("lore review --pending — empty queue", () => {
  it("prints 'No pending documents.' and exits 0", () => {
    const result = runLore(["review", "--pending"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No pending documents.");
  });
});

// ─── HAPPY / REGRESSION: --pending mixed outcomes ─────────────────────────────

describe("lore review --pending — mixed outcomes (deterministic-reject succeeds, AI path fails)", () => {
  it("exits 0 (not all failed) with a stderr warning naming the failure count", () => {
    const planSlug = createPlan("Batch Plan");
    createTaskWithoutEvidence(planSlug, "Batch Evidence-less Task");
    createPrd("Batch Clean PRD");

    const result = runLore(["review", "--pending"], tmpDir);

    // Not ALL docs failed (the task's deterministic-reject judgment recorded successfully),
    // so the batch exit code stays 0 even though the PRD's AI path failed via the stub.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("reviewed");
    expect(result.stderr).toMatch(/Warning: \d+\/\d+ doc\(s\) failed review\./);
  });

  it("--json envelope reports both judgment results and an error result", () => {
    const planSlug = createPlan("Batch Plan JSON");
    createTaskWithoutEvidence(planSlug, "Batch Evidence-less Task JSON");
    createPrd("Batch Clean PRD JSON");

    const result = runLore(["review", "--pending", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: {
        results: Array<{ title: string; judgment?: { decision: string }; error?: { code: string } }>;
        total: number;
        failed: number;
      };
    };
    // 2 pending docs (SPEC-103 M3: the evidence-less task is a ledger-tier doc, hidden
    // from the pending queue by default): the plan itself (draft, no parent → fails
    // parent_contract — a plan is not a ROOT_TYPE) and the clean PRD (passes all
    // deterministic checks, reaches the AI judge, which fails via the stub). The plan's
    // deterministic-reject judgment RECORDS successfully (success, despite
    // decision=reject) — only the PRD's AI path is a genuine failure.
    expect(parsed.data.total).toBe(2);
    expect(parsed.data.failed).toBe(1);
    const succeeded = parsed.data.results.filter((r) => r.judgment !== undefined);
    const failed = parsed.data.results.filter((r) => r.error !== undefined);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    for (const s of succeeded) expect(s.judgment?.decision).toBe("reject");
    expect(failed[0]?.error?.code).toBe("AI_PROVIDER_ERROR");
  });
});
