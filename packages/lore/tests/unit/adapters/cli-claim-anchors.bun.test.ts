/**
 * `lore create task --anchor` / `lore anchor add|rm|list` / `lore claim
 * --machine/--worktree` — CLI-adapter exit-code contract tests (SPEC-042
 * §Design Decisions D2, D3; §Acceptance Criteria AC-S3-7).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule). Requires `bun run build` to have run
 * first; `assertFreshBinary` (mirrors `cli-handoff.bun.test.ts`) fails loud
 * before any test runs if `dist/lore` is missing or older than the newest
 * `.ts` source under `packages/{lore,core}/src`.
 *
 * Gates are ON by default in a freshly-`init`ed corpus (retro follow-up item
 * 8, defense-in-depth) — the anchor-overlap block scenario below relies on
 * this default, exercising the SAME `task-claim` gate `lore_claim`/HTTP/direct-
 * service callers all go through, not a CLI-only pre-flight.
 *
 * Coverage:
 *   HAPPY:      `create task --anchor` (repeatable) persists; `lore anchor
 *               add/rm/list` round-trip; `claim --machine` override beats
 *               auto-capture; auto-captured machine equals `os.hostname()`
 *               computed IN THIS FILE at run time (never hardcoded)
 *   NEGATIVE:   an invalid anchor (leading "/") → nonzero exit, stderr names
 *               the offending field
 *   BOUNDARY:   `lore anchor list` on a task with zero anchors → exit 0, empty list
 *   ERROR:      `lore anchor add` on a nonexistent task → exit 3 (DOC_NOT_FOUND)
 *   STATE:      `lore anchor rm` on a task holding an active claim + evidence
 *               preserves BOTH untouched (AC-S3-5 regression, exercised again
 *               at the CLI seam)
 *   REGRESSION: omitting `--anchor` on `create task` leaves file_anchors
 *               absent (unchanged pre-SPEC-042 create behavior); `--worktree`
 *               omitted on `claim` → NO `worktree` key at all (no cwd capture, D2)
 *
 * Deviations from the literal AC-S3-7 bullet text (both pre-authorized by the
 * dispatching orchestrator's Context Digest — "AC only requires nonzero +
 * stderr content"):
 *   1. "invalid anchor exits 2" — this suite asserts exit 4 (VALIDATION_ERROR
 *      through the standard exitCode()/formatError() pipeline), not a CLI-side
 *      pre-validation exit 2. SPEC-042 D3 mandates `normalizeFileAnchors`
 *      (`@lore/core`) as the SINGLE validation gate for anchor entries —
 *      duplicating its leading-slash/`..`/backslash rules as a second CLI-side
 *      check (the only way to produce exit 2 here) would violate that SSOT
 *      invariant. `cli-handoff.bun.test.ts` documents an identical,
 *      precedented deviation for the same reason.
 *   2. "stderr naming the conflicting task slug … and the recovery command" —
 *      `GateEnforcer.enforce` (the seam `TaskWorkflowService.claim` runs
 *      through) deliberately returns ONLY the machine-readable failure reason
 *      (`"ANCHOR_OVERLAP"`), never the rich feeding-pack text `feedAnchorOverlap`
 *      renders (see `gate-enforcer.ts`'s own module invariant: "adds ZERO new
 *      predicate logic … only decides what a service caller sees when that
 *      decision is 'blocked'"). Only `lore gate task-claim` (a separate
 *      pre-flight command, not exercised by `lore claim` itself) renders that
 *      detail. This suite asserts nonzero exit + a stderr message identifying
 *      the failure class (`ANCHOR_OVERLAP` / the `gate:task-claim:anchor-overlap`
 *      field), not the sibling slug/recovery-command text.
 *
 * @spec_ref SPEC-042 §Acceptance Criteria AC-S3-7
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir, hostname } from "os";
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
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
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

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function createPlan(tmpDir: string, title: string): string {
  const result = runLore(["create", "plan", "--title", title, "--content", "Plan body.", "--no-ai"], tmpDir);
  if (result.exitCode !== 0) throw new Error(`create plan failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

function createTask(tmpDir: string, planSlug: string, title: string, anchors: string[] = []): string {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--parent",
    planSlug,
    "--plan-id",
    planSlug,
    "--no-ai",
    "--content",
    "Task body.",
  ];
  for (const anchor of anchors) {
    args.push("--anchor", anchor);
  }
  const result = runLore(args, tmpDir);
  if (result.exitCode !== 0) throw new Error(`create task failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

interface JsonDocEnvelope {
  ok: boolean;
  data: { slug: string; extra: Record<string, unknown> };
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
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-claim-anchors-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY: create task --anchor (repeatable) persists ──────────────────────

describe("lore create task --anchor — HAPPY", () => {
  it("repeatable --anchor flags persist into extra.file_anchors", () => {
    const planSlug = createPlan(tmpDir, "Anchor Create Plan");
    const result = runLore(
      [
        "create",
        "task",
        "--title",
        "Anchored Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--anchor",
        "src/a",
        "--anchor",
        "src/b/",
        "--no-ai",
        "--content",
        "body",
        "--json",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonDocEnvelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.data.extra["file_anchors"]).toEqual(["src/a", "src/b/"]);
  });
});

// ─── REGRESSION: omitting --anchor leaves file_anchors absent ───────────────

describe("lore create task (no --anchor) — REGRESSION", () => {
  it("omitting --anchor entirely leaves extra.file_anchors absent (unchanged pre-SPEC-042 create behavior)", () => {
    const planSlug = createPlan(tmpDir, "No Anchor Plan");
    const result = runLore(
      ["create", "task", "--title", "Plain Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body", "--json"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonDocEnvelope;
    expect(parsed.data.extra["file_anchors"]).toBeUndefined();
  });
});

// ─── NEGATIVE: invalid anchor entry ──────────────────────────────────────────

describe("lore create task --anchor <invalid> — NEGATIVE", () => {
  it("a leading-'/' anchor → nonzero exit (4, VALIDATION_ERROR), stderr names the offending entry", () => {
    const planSlug = createPlan(tmpDir, "Invalid Anchor Plan");
    const result = runLore(
      [
        "create",
        "task",
        "--title",
        "Bad Anchor Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--anchor",
        "/absolute/path",
        "--no-ai",
        "--content",
        "body",
      ],
      tmpDir,
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("file_anchors");
  });
});

// ─── HAPPY: lore anchor add/rm/list round-trip ───────────────────────────────

describe("lore anchor add/rm/list — HAPPY round-trip", () => {
  it("add appends, list shows current set, rm removes one entry", () => {
    const planSlug = createPlan(tmpDir, "Anchor Roundtrip Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Roundtrip Task", ["src/a"]);

    const addResult = runLore(["anchor", "add", taskSlug, "src/b", "src/c/"], tmpDir);
    expect(addResult.exitCode).toBe(0);

    const listResult = runLore(["anchor", "list", taskSlug, "--json"], tmpDir);
    expect(listResult.exitCode).toBe(0);
    const listed = JSON.parse(listResult.stdout) as { ok: boolean; data: { anchors: string[] } };
    expect(listed.data.anchors).toEqual(["src/a", "src/b", "src/c/"]);

    const rmResult = runLore(["anchor", "rm", taskSlug, "src/a"], tmpDir);
    expect(rmResult.exitCode).toBe(0);

    const listAfterRm = runLore(["anchor", "list", taskSlug, "--json"], tmpDir);
    const listedAfterRm = JSON.parse(listAfterRm.stdout) as { ok: boolean; data: { anchors: string[] } };
    expect(listedAfterRm.data.anchors).toEqual(["src/b", "src/c/"]);
  });
});

// ─── BOUNDARY: zero anchors ───────────────────────────────────────────────────

describe("lore anchor list — BOUNDARY", () => {
  it("a task with zero declared anchors → exit 0, empty list", () => {
    const planSlug = createPlan(tmpDir, "Zero Anchor Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Anchorless Task");

    const result = runLore(["anchor", "list", taskSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { anchors: string[] } };
    expect(parsed.data.anchors).toEqual([]);
  });
});

// ─── ERROR: nonexistent task ──────────────────────────────────────────────────

describe("lore anchor add — ERROR", () => {
  it("a nonexistent task slug → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["anchor", "add", "task-does-not-exist", "src/a"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── STATE: anchor mutation preserves claim + evidence (AC-S3-5 at the CLI seam) ─

describe("lore anchor rm — STATE (AC-S3-5 regression)", () => {
  it("removing an anchor on a task holding an active claim + evidence preserves both untouched", () => {
    const planSlug = createPlan(tmpDir, "Anchor State Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Stateful Task", ["src/a", "src/b"]);

    const claimResult = runLore(["claim", taskSlug, "--by", "alice", "--branch", "wt-x"], tmpDir);
    expect(claimResult.exitCode).toBe(0);
    const evidenceResult = runLore(
      ["evidence", taskSlug, "--oracle", "tsc", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );
    expect(evidenceResult.exitCode).toBe(0);

    const rmResult = runLore(["anchor", "rm", taskSlug, "src/a"], tmpDir);
    expect(rmResult.exitCode).toBe(0);

    const getResult = runLore(["get", taskSlug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const got = JSON.parse(getResult.stdout) as {
      data: { doc: { extra: { claim: { by: string; branch: string }; verification_evidence: unknown[]; file_anchors: string[] } } };
    };
    expect(got.data.doc.extra.claim).toMatchObject({ by: "alice", branch: "wt-x" });
    expect(got.data.doc.extra.verification_evidence).toHaveLength(1);
    expect(got.data.doc.extra.file_anchors).toEqual(["src/b"]);
  });
});

// ─── HAPPY: claim --machine override + auto-capture; --worktree omission ────

describe("lore claim --machine/--worktree — HAPPY (SPEC-042 D2)", () => {
  it("--machine explicit override beats auto-capture", () => {
    const planSlug = createPlan(tmpDir, "Machine Override Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Machine Override Task");

    const result = runLore(["claim", taskSlug, "--by", "alice", "--machine", "custom-host", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: { machine: string } } } } };
    expect(parsed.data.doc.extra.claim.machine).toBe("custom-host");
  });

  it("omitted --machine auto-captures os.hostname() (computed IN THIS FILE at run time, never hardcoded)", () => {
    const planSlug = createPlan(tmpDir, "Machine Auto Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Machine Auto Task");

    const result = runLore(["claim", taskSlug, "--by", "alice", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: { machine: string } } } } };
    expect(parsed.data.doc.extra.claim.machine).toBe(hostname());
  });

  it("omitted --worktree yields NO worktree field at all (no process.cwd() capture, D2)", () => {
    const planSlug = createPlan(tmpDir, "Worktree Omitted Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Worktree Omitted Task");

    const result = runLore(["claim", taskSlug, "--by", "alice", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: Record<string, unknown> } } } };
    expect("worktree" in parsed.data.doc.extra.claim).toBe(false);
  });

  it("explicit --worktree persists", () => {
    const planSlug = createPlan(tmpDir, "Worktree Explicit Plan");
    const taskSlug = createTask(tmpDir, planSlug, "Worktree Explicit Task");

    const result = runLore(
      ["claim", taskSlug, "--by", "alice", "--worktree", "/repo/.worktrees/t1", "--json"],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: { worktree: string } } } } };
    expect(parsed.data.doc.extra.claim.worktree).toBe("/repo/.worktrees/t1");
  });
});

// ─── NEGATIVE: anchor-overlap gate blocks a fresh foreign conflicting claim ──

describe("lore claim — anchor-overlap gate block (SPEC-042 D5)", () => {
  it("a fresh foreign claim whose declared anchors overlap a sibling's → nonzero exit, stderr identifies the anchor-overlap failure", () => {
    const planSlug = createPlan(tmpDir, "Anchor Overlap Plan"); // top-level plan, no spec ancestor
    const taskASlug = createTask(tmpDir, planSlug, "Task A", ["src/shared"]);
    const taskBSlug = createTask(tmpDir, planSlug, "Task B", ["src/shared"]);

    const claimA = runLore(["claim", taskASlug, "--by", "agent:t1"], tmpDir);
    expect(claimA.exitCode).toBe(0);

    const claimB = runLore(["claim", taskBSlug, "--by", "agent:t2"], tmpDir);

    expect(claimB.exitCode).not.toBe(0);
    expect(claimB.stderr).toContain("ANCHOR_OVERLAP");
    expect(claimB.stderr).toContain("gate:task-claim:anchor-overlap");
  });

  it("REGRESSION: --steal on the candidate task does NOT bypass a sibling anchor conflict", () => {
    const planSlug = createPlan(tmpDir, "Anchor Overlap Steal Plan");
    const taskASlug = createTask(tmpDir, planSlug, "Steal Task A", ["src/shared"]);
    const taskBSlug = createTask(tmpDir, planSlug, "Steal Task B", ["src/shared"]);

    runLore(["claim", taskASlug, "--by", "agent:t1"], tmpDir);
    const stealAttempt = runLore(["claim", taskBSlug, "--by", "agent:t2", "--steal"], tmpDir);

    expect(stealAttempt.exitCode).not.toBe(0);
    expect(stealAttempt.stderr).toContain("ANCHOR_OVERLAP");
  });
});
