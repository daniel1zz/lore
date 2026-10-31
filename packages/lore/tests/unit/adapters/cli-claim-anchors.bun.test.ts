// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
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
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir, hostname } from "os";
import { sessionActorFor, withSessionIdentity } from "../../helpers/session-actor";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** `actor` names the writer through the session tier (no write command takes `--by`); `null` = unnamed. */
async function runLore(args: string[], cwd: string, actor: string | null = null): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true" }, actor) as Record<string, string>,
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

async function initCorpus(tmpDir: string): Promise<void> {
  const result = await runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

async function createPlan(tmpDir: string, title: string): Promise<string> {
  const result = await runLore(["create", "plan", "--parent", await ensureRequirementsDocSlugAsync((a) => runLore(a, tmpDir)), "--title", title, "--content", "Plan body.", "--no-ai"], tmpDir);
  if (result.exitCode !== 0) throw new Error(`create plan failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

async function createTask(tmpDir: string, planSlug: string, title: string, anchors: string[] = []): Promise<string> {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--kind",
    "code",
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
  const result = await runLore(args, tmpDir);
  if (result.exitCode !== 0) throw new Error(`create task failed: ${result.stderr}`);
  return parseSlug(result.stdout);
}

interface JsonDocEnvelope {
  ok: boolean;
  data: { slug: string; extra: Record<string, unknown> };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-claim-anchors-"));
  await initCorpus(tmpDir);
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
  it("repeatable --anchor flags persist into extra.file_anchors", async () => {
    const planSlug = await createPlan(tmpDir, "Anchor Create Plan");
    const result = await runLore(
      [
        "create",
        "task",
        "--title",
        "Anchored Task",
        "--kind",
        "code",
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
  it("omitting --anchor entirely leaves extra.file_anchors absent (unchanged pre-SPEC-042 create behavior)", async () => {
    const planSlug = await createPlan(tmpDir, "No Anchor Plan");
    const result = await runLore(
      ["create", "task", "--title", "Plain Task", "--kind", "code", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body", "--json"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonDocEnvelope;
    expect(parsed.data.extra["file_anchors"]).toBeUndefined();
  });
});

// ─── NEGATIVE: invalid anchor entry ──────────────────────────────────────────

describe("lore create task --anchor <invalid> — NEGATIVE", () => {
  it("a leading-'/' anchor → nonzero exit (4, VALIDATION_ERROR), stderr names the offending entry", async () => {
    const planSlug = await createPlan(tmpDir, "Invalid Anchor Plan");
    const result = await runLore(
      [
        "create",
        "task",
        "--title",
        "Bad Anchor Task",
        "--kind",
        "code",
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
  it("add appends, list shows current set, rm removes one entry", async () => {
    const planSlug = await createPlan(tmpDir, "Anchor Roundtrip Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Roundtrip Task", ["src/a"]);

    const addResult = await runLore(["anchor", "add", taskSlug, "src/b", "src/c/"], tmpDir);
    expect(addResult.exitCode).toBe(0);

    const listResult = await runLore(["anchor", "list", taskSlug, "--json"], tmpDir);
    expect(listResult.exitCode).toBe(0);
    const listed = JSON.parse(listResult.stdout) as { ok: boolean; data: { anchors: string[] } };
    expect(listed.data.anchors).toEqual(["src/a", "src/b", "src/c/"]);

    const rmResult = await runLore(["anchor", "rm", taskSlug, "src/a"], tmpDir);
    expect(rmResult.exitCode).toBe(0);

    const listAfterRm = await runLore(["anchor", "list", taskSlug, "--json"], tmpDir);
    const listedAfterRm = JSON.parse(listAfterRm.stdout) as { ok: boolean; data: { anchors: string[] } };
    expect(listedAfterRm.data.anchors).toEqual(["src/b", "src/c/"]);
  });
});

// ─── BOUNDARY: zero anchors ───────────────────────────────────────────────────

describe("lore anchor list — BOUNDARY", () => {
  it("a task with zero declared anchors → exit 0, empty list", async () => {
    const planSlug = await createPlan(tmpDir, "Zero Anchor Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Anchorless Task");

    const result = await runLore(["anchor", "list", taskSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { anchors: string[] } };
    expect(parsed.data.anchors).toEqual([]);
  });
});

// ─── ERROR: nonexistent task ──────────────────────────────────────────────────

describe("lore anchor add — ERROR", () => {
  it("a nonexistent task slug → exit 3 (DOC_NOT_FOUND)", async () => {
    const result = await runLore(["anchor", "add", "task-does-not-exist", "src/a"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── STATE: anchor mutation preserves claim + evidence (AC-S3-5 at the CLI seam) ─

describe("lore anchor rm — STATE (spec-spec-042-session-layer-part-2-session-registry-file-anchor#AC-S3-5 regression)", () => {
  it("removing an anchor on a task holding an active claim + evidence preserves both untouched", async () => {
    const planSlug = await createPlan(tmpDir, "Anchor State Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Stateful Task", ["src/a", "src/b"]);

    const claimResult = await runLore(["claim", taskSlug, "--worktree", "wt-x"], tmpDir, "alice");
    expect(claimResult.exitCode).toBe(0);
    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused regardless of
    // tail content; "manual" is the one oracle that still lets a genuinely
    // non-empty self-reported tail succeed. This test only checks anchor
    // removal preserves claim+evidence, not oracle-kind semantics.
    const evidenceResult = await runLore(
      ["evidence", taskSlug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );
    expect(evidenceResult.exitCode).toBe(0);

    const rmResult = await runLore(["anchor", "rm", taskSlug, "src/a"], tmpDir);
    expect(rmResult.exitCode).toBe(0);

    const getResult = await runLore(["get", taskSlug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const got = JSON.parse(getResult.stdout) as {
      data: { doc: { extra: { claim: { by: string; branch: string }; verification_evidence: unknown[]; file_anchors: string[] } } };
    };
    expect(got.data.doc.extra.claim).toMatchObject({ by: sessionActorFor("alice"), worktree: "wt-x" });
    expect(got.data.doc.extra.verification_evidence).toHaveLength(1);
    expect(got.data.doc.extra.file_anchors).toEqual(["src/b"]);
  });
});

// ─── HAPPY: claim --machine override + auto-capture; --worktree omission ────

describe("lore claim --machine/--worktree — HAPPY (SPEC-042 D2)", () => {
  it("--machine explicit override beats auto-capture", async () => {
    const planSlug = await createPlan(tmpDir, "Machine Override Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Machine Override Task");

    const result = await runLore(["claim", taskSlug, "--machine", "custom-host", "--worktree", "wt-machine", "--json"], tmpDir, "alice");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: { machine: string } } } } };
    expect(parsed.data.doc.extra.claim.machine).toBe("custom-host");
  });

  it("omitted --machine auto-captures os.hostname() (computed IN THIS FILE at run time, never hardcoded)", async () => {
    const planSlug = await createPlan(tmpDir, "Machine Auto Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Machine Auto Task");

    const result = await runLore(["claim", taskSlug, "--worktree", "wt-auto", "--json"], tmpDir, "alice");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: { machine: string } } } } };
    expect(parsed.data.doc.extra.claim.machine).toBe(hostname());
  });

  it("omitted --worktree is refused for a code task (exit 4, work-needs-branch) and no claim is stored — the cwd is never captured in its place (D2, AC-DCS1-14)", async () => {
    const planSlug = await createPlan(tmpDir, "Worktree Omitted Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Worktree Omitted Task");

    const result = await runLore(["claim", taskSlug, "--json"], tmpDir, "alice");
    expect(result.exitCode).toBe(4);
    expect(`${result.stdout}${result.stderr}`).toContain("work-needs-branch");
    const got = await runLore(["get", taskSlug, "--json"], tmpDir);
    const doc = (JSON.parse(got.stdout) as { data: { doc: { extra: Record<string, unknown> } } }).data.doc;
    expect(doc.extra["claim"]).toBeUndefined();
  });

  it("explicit --worktree persists", async () => {
    const planSlug = await createPlan(tmpDir, "Worktree Explicit Plan");
    const taskSlug = await createTask(tmpDir, planSlug, "Worktree Explicit Task");

    const result = await runLore(
      ["claim", taskSlug, "--worktree", "/repo/.worktrees/t1", "--json"],
      tmpDir,
      "alice",
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { doc: { extra: { claim: { worktree: string } } } } };
    expect(parsed.data.doc.extra.claim.worktree).toBe("/repo/.worktrees/t1");
  });
});

// ─── NEGATIVE: anchor-overlap gate blocks a fresh foreign conflicting claim ──

describe("lore claim — anchor-overlap gate block (SPEC-042 D5)", () => {
  it("a fresh foreign claim whose declared anchors overlap a sibling's → nonzero exit, stderr identifies the anchor-overlap failure", async () => {
    const planSlug = await createPlan(tmpDir, "Anchor Overlap Plan"); // top-level plan, no spec ancestor
    const taskASlug = await createTask(tmpDir, planSlug, "Task A", ["src/shared"]);
    const taskBSlug = await createTask(tmpDir, planSlug, "Task B", ["src/shared"]);

    const claimA = await runLore(["claim", taskASlug, "--worktree", "cca-wt-a"], tmpDir, "agent:t1");
    expect(claimA.exitCode).toBe(0);

    const claimB = await runLore(["claim", taskBSlug, "--worktree", "cca-wt-b"], tmpDir, "agent:t2");

    expect(claimB.exitCode).not.toBe(0);
    expect(claimB.stderr).toContain("ANCHOR_OVERLAP");
    expect(claimB.stderr).toContain("gate:task-claim:anchor-overlap");
  });

  it("REGRESSION: --steal on the candidate task does NOT bypass a sibling anchor conflict", async () => {
    const planSlug = await createPlan(tmpDir, "Anchor Overlap Steal Plan");
    const taskASlug = await createTask(tmpDir, planSlug, "Steal Task A", ["src/shared"]);
    const taskBSlug = await createTask(tmpDir, planSlug, "Steal Task B", ["src/shared"]);

    await runLore(["claim", taskASlug, "--worktree", "cca-wt-a"], tmpDir, "agent:t1");
    const stealAttempt = await runLore(["claim", taskBSlug, "--steal", "--worktree", "cca-wt-b"], tmpDir, "agent:t2");

    expect(stealAttempt.exitCode).not.toBe(0);
    expect(stealAttempt.stderr).toContain("ANCHOR_OVERLAP");
  });
});
