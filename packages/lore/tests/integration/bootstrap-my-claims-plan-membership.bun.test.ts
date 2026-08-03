/**
 * `lore bootstrap --json`'s `my_claims[].plan_slug` — RED-first suite for site
 * 12 of `task-plan-member-sites-twelve-and-thirteen-both-structurally`.
 *
 * What is under test: plan membership IS `extra.plan_id` (the DECLARED
 * property — `isPlanMember`, `service/plan-membership.ts`), and `parent_id` is
 * only a PROXY a task may legitimately diverge from: `lore create task
 * --plan-id P --parent Q` with `P !== Q` is a SUPPORTED shape (SPEC-065 D4).
 * `SessionService.bootstrap`'s `my_claims` construction
 * (`session-service.ts`, the loop building `BootstrapReport["my_claims"]`)
 * resolved `plan_slug` from `task.parent_id` instead — a field literally named
 * `plan_slug`, answering with the filing parent. A diverged task therefore
 * reported the WRONG plan's slug, and a planless `--adhoc` task (parented at
 * the corpus root PRD by construction, SPEC-069 D2) reported the ROOT PRD's
 * slug as if it were a plan.
 *
 * Sibling sites explicitly OUT OF SCOPE (per the governing task doc):
 * `latest_handoffs`/`handoffPointers`'s own `plan_slug` derivations key on a
 * `planId` variable already resolved from handoff docs' `parent_id` — correct,
 * because a handoff doc has no `extra.plan_id` at all; its `parent_id` IS its
 * plan link. Only the `my_claims` site is this task's target.
 *
 * Fixture discipline: every corpus here is a `mkdtemp` + `lore init` throwaway
 * (project CLAUDE.md hard rule — this repo's own `.lore/` is the team's live
 * knowledge base and is NEVER written by a test). Arrange steps go through the
 * REAL CLI, every one asserting exit 0 (`runLoreOk`) — a half-built fixture can
 * never read as a passing assertion.
 *
 * Coverage (six dimensions):
 *   HAPPY      — a diverged task's `my_claims` entry reports its DECLARED
 *                plan's slug (`extra.plan_id`), not the filing parent's.
 *   BOUNDARY   — the SAME entry's `plan_slug` is explicitly NOT the filing
 *                parent's slug (the pre-fix value, named so a regression
 *                reads as itself).
 *   NEGATIVE   — a planless `--adhoc` task's entry reports `"(unknown)"`, and
 *                explicitly NOT the root PRD's slug (two independent
 *                assertions — one fix could satisfy either alone).
 *   ERROR      — a task whose `extra.plan_id` points at a soft-deleted (hence
 *                store-invisible) plan degrades to `"(unknown)"` rather than
 *                crashing `bootstrap` or leaking a stale slug.
 *   STATE      — `bootstrap` is read-only: two consecutive runs over an
 *                untouched corpus return byte-identical `my_claims`.
 *   REGRESSION — an ALIGNED task (`parent_id === extra.plan_id`, the common
 *                shape) reports its plan's slug exactly as before the fix —
 *                this shape is common to BOTH the old and new derivation.
 *
 * @spec_ref task-plan-member-sites-twelve-and-thirteen-both-structurally
 * @spec_ref spec-065 D4
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { bootstrapReportSchema } from "@lore/core";

// tests/integration/ → tests/ → packages/lore/ (2 levels up).
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

const FIXTURE_ACTOR = "agent:my-claims-membership-fixture";
const DIVERGED_HOLDER = "agent:my-claims-diverged-holder";
const ADHOC_HOLDER = "agent:my-claims-adhoc-holder";
const ALIGNED_HOLDER = "agent:my-claims-aligned-holder";
const BROKEN_REF_HOLDER = "agent:my-claims-broken-ref-holder";

const TEST_TIMEOUT_MS = 120_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: readonly string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: FIXTURE_ACTOR },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function runLoreOk(args: readonly string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `fixture step failed (exit ${result.exitCode}): lore ${args.join(" ")}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return result;
}

function parseCreatedSlug(stdout: string): string {
  const match = /Slug:\s+(\S+)/.exec(stdout);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse created slug from output: ${stdout}`);
  return slug;
}

const bootstrapEnvelopeSchema = z.object({ ok: z.literal(true), data: bootstrapReportSchema });
type BootstrapReportPayload = z.infer<typeof bootstrapEnvelopeSchema>["data"];

function readBootstrap(cwd: string, by: string): BootstrapReportPayload {
  const result = runLoreOk(["bootstrap", "--by", by, "--json"], cwd);
  return bootstrapEnvelopeSchema.parse(JSON.parse(result.stdout)).data;
}

function makeTempCorpus(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  runLoreOk(["init"], dir);
  return dir;
}

const temporaryDirs: string[] = [];

afterAll(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createDoc(cwd: string, type: string, title: string, extraArgs: readonly string[]): string {
  const result = runLoreOk(
    ["create", type, "--title", title, "--content", `${title} body.`, "--no-ai", ...extraArgs],
    cwd,
  );
  return parseCreatedSlug(result.stdout);
}

/** Finds a `my_claims` entry by `task_slug`, or fails loud — never `undefined` flowing into an assertion. */
function myClaimFor(report: BootstrapReportPayload, taskSlug: string): BootstrapReportPayload["my_claims"][number] {
  const entry = report.my_claims.find((c) => c.task_slug === taskSlug);
  if (entry === undefined) {
    throw new Error(
      `no my_claims entry for ${taskSlug} — present: ${report.my_claims.map((c) => c.task_slug).join(", ") || "(none)"}`,
    );
  }
  return entry;
}

// ─── HAPPY + BOUNDARY: the diverged member ───────────────────────────────────

describe("bootstrap my_claims plan_slug: membership contract (site 12)", () => {
  it(
    "HAPPY: a diverged task's my_claims entry reports its DECLARED plan's slug",
    () => {
      const dir = makeTempCorpus("lore-my-claims-diverged-");
      const rootSlug = createDoc(dir, "prd", "My Claims Root", []);
      const planASlug = createDoc(dir, "plan", "Plan A", ["--parent", rootSlug]);
      const planBSlug = createDoc(dir, "plan", "Plan B", ["--parent", rootSlug]);
      const divergedSlug = createDoc(dir, "task", "Diverged Member", [
        "--parent",
        planBSlug,
        "--plan-id",
        planASlug,
      ]);
      runLoreOk(["claim", divergedSlug, "--by", DIVERGED_HOLDER, "--worktree", join(dir, "wt-diverged")], dir);

      const report = readBootstrap(dir, DIVERGED_HOLDER);
      const claim = myClaimFor(report, divergedSlug);

      expect(claim.plan_slug).toBe(planASlug);
      // BOUNDARY: the filing parent's slug never leaks in (the pre-fix value).
      expect(claim.plan_slug).not.toBe(planBSlug);
    },
    TEST_TIMEOUT_MS,
  );

  // ─── NEGATIVE ───────────────────────────────────────────────────────────────

  it(
    "NEGATIVE: a planless --adhoc task's entry reports (unknown), never the root PRD's slug",
    () => {
      const dir = makeTempCorpus("lore-my-claims-adhoc-");
      const rootSlug = createDoc(dir, "prd", "My Claims Adhoc Root", []);
      // reason: --adhoc requires an explicit --ac-scope "" declaration since
      // task-an-ad-hoc-task-can-never-reach-the-attestation-path-that.
      const adhocSlug = createDoc(dir, "task", "Planless Adhoc", ["--adhoc", "--ac-scope", ""]);
      runLoreOk(["claim", adhocSlug, "--by", ADHOC_HOLDER, "--worktree", join(dir, "wt-adhoc")], dir);

      const report = readBootstrap(dir, ADHOC_HOLDER);
      const claim = myClaimFor(report, adhocSlug);

      expect(claim.plan_slug).toBe("(unknown)");
      // Two independent assertions per the task's own oracle: a fix could
      // satisfy "reports (unknown)" without also fixing "never the root PRD's
      // slug" (e.g. if some OTHER field coincidentally read as (unknown)).
      expect(claim.plan_slug).not.toBe(rootSlug);
    },
    TEST_TIMEOUT_MS,
  );

  // ─── ERROR ──────────────────────────────────────────────────────────────────

  it(
    "ERROR: a task whose declared plan was soft-deleted degrades to (unknown), never crashes bootstrap",
    () => {
      const dir = makeTempCorpus("lore-my-claims-broken-ref-");
      const rootSlug = createDoc(dir, "prd", "My Claims Broken Ref Root", []);
      const planSlug = createDoc(dir, "plan", "Soon Deleted Plan", ["--parent", rootSlug]);
      const taskSlug = createDoc(dir, "task", "Broken Ref Member", ["--parent", planSlug, "--plan-id", planSlug]);
      runLoreOk(["claim", taskSlug, "--by", BROKEN_REF_HOLDER, "--worktree", join(dir, "wt-broken")], dir);

      // Soft-delete the DECLARED plan after the claim exists — the task's
      // extra.plan_id now points at a doc `allDocs` no longer resolves.
      runLoreOk(["delete", planSlug, "--confirm"], dir);

      const result = runLore(["bootstrap", "--by", BROKEN_REF_HOLDER, "--json"], dir);
      expect(result.exitCode).toBe(0);
      const report = bootstrapEnvelopeSchema.parse(JSON.parse(result.stdout)).data;
      const claim = myClaimFor(report, taskSlug);
      expect(claim.plan_slug).toBe("(unknown)");
    },
    TEST_TIMEOUT_MS,
  );

  // ─── STATE ──────────────────────────────────────────────────────────────────

  it(
    "STATE: bootstrap is read-only — two consecutive runs over an untouched corpus are identical",
    () => {
      const dir = makeTempCorpus("lore-my-claims-state-");
      const rootSlug = createDoc(dir, "prd", "My Claims State Root", []);
      const planSlug = createDoc(dir, "plan", "State Plan", ["--parent", rootSlug]);
      const taskSlug = createDoc(dir, "task", "State Member", ["--parent", planSlug, "--plan-id", planSlug]);
      runLoreOk(["claim", taskSlug, "--by", ALIGNED_HOLDER, "--worktree", join(dir, "wt-state")], dir);

      expect(readBootstrap(dir, ALIGNED_HOLDER)).toEqual(readBootstrap(dir, ALIGNED_HOLDER));
    },
    TEST_TIMEOUT_MS,
  );

  // ─── REGRESSION ─────────────────────────────────────────────────────────────

  it(
    "REGRESSION: an ALIGNED task (parent_id === extra.plan_id) reports its plan's slug unaffected",
    () => {
      const dir = makeTempCorpus("lore-my-claims-aligned-");
      const rootSlug = createDoc(dir, "prd", "My Claims Aligned Root", []);
      const planSlug = createDoc(dir, "plan", "Aligned Plan", ["--parent", rootSlug]);
      const taskSlug = createDoc(dir, "task", "Aligned Member", ["--parent", planSlug, "--plan-id", planSlug]);
      runLoreOk(["claim", taskSlug, "--by", ALIGNED_HOLDER, "--worktree", join(dir, "wt-aligned")], dir);

      const report = readBootstrap(dir, ALIGNED_HOLDER);
      const claim = myClaimFor(report, taskSlug);
      expect(claim.plan_slug).toBe(planSlug);
    },
    TEST_TIMEOUT_MS,
  );
});
