// @spawns packages/lore/src/index.ts
/**
 * `lore bootstrap`'s plan-membership contract — RED-first suite for
 * `task-the-eleventh-plan-member-site-found-by-enumeration`.
 *
 * What is under test: plan membership IS `extra.plan_id` (the DECLARED
 * property — `isPlanMember`, `service/plan-membership.ts`), and `parent_id` is
 * only a PROXY a task may legitimately diverge from: `lore create task
 * --plan-id P --parent Q` with `P !== Q` is a SUPPORTED shape (SPEC-065 D4).
 * `SessionService.bootstrap` keyed BOTH of its plan-scoped derivations on that
 * proxy:
 *
 *   - the active-plan task listing (`session-service.ts:251`), so a diverged
 *     member was silently missing from its OWN plan's `active_plans` entry —
 *     and `bootstrap` is the SESSION-START INJECTION path every consumer
 *     session reads first;
 *   - the `activeTasks` set feeding `deriveSessions` (`session-service.ts:284`),
 *     so a diverged member's LIVE claim was missing from `active_sessions` —
 *     the field a fresh session reads to learn who else is working BEFORE it
 *     claims.
 *
 * ONE TEST PER SITE (the task's own oracle): the two defect tests below assert
 * DIFFERENT report fields from the SAME fixture, because a single combined test
 * could pass on either fix alone.
 *
 * Presence, never a bare count (the task's oracle again): the `active_plans`
 * test pins `last_activity_at` to the diverged task's OWN `updated_at` — a
 * 24-char value only that document can produce (the fixture claims it LAST, and
 * asserts up front that its timestamp is strictly newer than both the plan's and
 * the aligned sibling's). A count alone would also pass under an unrelated
 * off-by-one. The `active_sessions` test asserts the diverged task's SLUG inside
 * the holder's session row, likewise a value, not a size.
 *
 * Fixture discipline: every corpus here is a `mkdtemp` + `lore init` throwaway
 * (project CLAUDE.md hard rule — this repo's own `.lore/` is the team's live
 * knowledge base and is NEVER written by a test). Arrange steps go through the
 * REAL CLI (`bun run src/index.ts`, the shipped surface consumers invoke), and
 * every one of them fails LOUD on a nonzero exit — a half-built fixture can
 * never read as a passing assertion.
 *
 * Coverage (six dimensions):
 *   HAPPY      — the diverged member appears in its declared plan's
 *                `active_plans` entry (site 251) and its live claim appears in
 *                `active_sessions` (site 284).
 *   NEGATIVE   — a planless `--adhoc` task holding a LIVE claim is never
 *                dragged into any plan's `active_plans` LISTING (it belongs to
 *                no plan, so it inflates no plan's counts) — but IS now
 *                present in `active_sessions` (updated by
 *                task-active-sessions-derives-only-over-active-plans-tasks-with
 *                Required #1: an adhoc task's SPEC-069 D2 root-PRD parent
 *                could never satisfy `activePlanIds.has(parent_id)` under the
 *                pre-fix intersection, which is exactly the second of the two
 *                independently-sufficient defects that task's doc measured).
 *   BOUNDARY   — a member of a DEPRECATED plan's live claim DOES appear in
 *                `active_sessions` (updated by
 *                task-active-sessions-derives-only-over-active-plans-tasks-with:
 *                that task's own Required #1 removed the active-plan-status
 *                filter from this site entirely — `active_sessions` is now
 *                CORPUS-GLOBAL, keyed only on a task's OWN terminal status,
 *                never its parent plan's. Membership still decides WHICH
 *                plan's `active_plans`/`task_counts` entry a task's activity
 *                rolls up into (site 251, untouched) — but active-ness no
 *                longer gates `active_sessions` membership at all. The
 *                pre-fix assertion here was the intersection-with-
 *                `activePlanIds` bug that task's own doc measured and fixed).
 *   ERROR      — every fixture CLI step asserts exit 0 and surfaces stderr
 *                (`runLoreOk`); a malformed `--json` payload fails the
 *                `bootstrapReportSchema.parse` below rather than being
 *                indexed into.
 *   STATE      — `bootstrap` is read-only/idempotent: two consecutive runs over
 *                an untouched corpus return byte-identical payloads.
 *   REGRESSION — an ALIGNED-only corpus (`parent_id === extra.plan_id`, the
 *                common shape) yields a fully enumerated `active_plans` payload:
 *                every field pinned to a fixture-derived value, so the change
 *                cannot alter the common case. This test passes BEFORE and
 *                AFTER the fix (measured), which is what "byte-identical for the
 *                aligned shape" means for a fixture whose ULIDs/timestamps are
 *                minted fresh on every run.
 *
 * ADDENDUM (task-active-sessions-derives-only-over-active-plans-tasks-with):
 * the "Site 284" describe block below was updated, not this file's own
 * fixtures — that task removed the active-plan-status filter from
 * `active_sessions` ENTIRELY (it is now corpus-global), so the two
 * assertions that used to pin "excluded because its plan isn't active" as
 * correct behavior now pin the opposite. Site 251 (`active_plans` membership)
 * is untouched by that task and its assertions are unchanged.
 *
 * @spec_ref task-the-eleventh-plan-member-site-found-by-enumeration
 * @spec_ref task-eight-more-plan-member-queries-still-key-on-parent-id
 * @spec_ref task-active-sessions-derives-only-over-active-plans-tasks-with
 */

import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { bootstrapReportSchema } from "@lore/core";
import { sessionActorFor, withSessionIdentity } from "../helpers/session-actor";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

// tests/integration/ → tests/ → packages/lore/ (2 levels up).
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/** Every fixture claim passes `--by` explicitly, so these are the exact `active_sessions`/`my_claims` keys asserted below. */
// BR-1055: a writer is named through the session tier. Each LABEL is the fixture identity a spawn runs as; the
// HOLDER/ACTOR constant is the name that identity resolves to (what `my_claims` and `bootstrap --by` see).
const DIVERGED_LABEL = "agent:diverged-holder";
const ADHOC_LABEL = "agent:adhoc-holder";
const DEPRECATED_PLAN_LABEL = "agent:deprecated-plan-holder";
const DIVERGED_HOLDER = sessionActorFor(DIVERGED_LABEL);
const ADHOC_HOLDER = sessionActorFor(ADHOC_LABEL);
const DEPRECATED_PLAN_HOLDER = sessionActorFor(DEPRECATED_PLAN_LABEL);

/** Actor for the fixture's non-claim writes — never the OS username, so audit rows stay attributable. */
const FIXTURE_LABEL = "agent:bootstrap-membership-fixture";
const FIXTURE_ACTOR = sessionActorFor(FIXTURE_LABEL);

/** Generous per-test budget: each test drives real `bun run src/index.ts` subprocesses (`check:test-budgets` D2 — never rely on the 5000ms default). */
const TEST_TIMEOUT_MS = 120_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The `lore get --json` projection this suite reads — parsed, never trusted shape-first (unknown keys are dropped by design). */
const docProjectionSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    doc: z.object({
      id: z.string().min(1),
      slug: z.string().min(1),
      status: z.string().min(1),
      parent_id: z.string().nullable(),
      updated_at: z.string().min(1),
      extra: z.record(z.string(), z.unknown()),
    }),
  }),
});

/** The `lore bootstrap --json` envelope — `data` is validated by `bootstrapReportSchema`, the SAME schema the service self-checks against. */
const bootstrapEnvelopeSchema = z.object({ ok: z.literal(true), data: bootstrapReportSchema });

type BootstrapReportPayload = z.infer<typeof bootstrapEnvelopeSchema>["data"];

/** Runs `bun run src/index.ts ...args` in `cwd`. `HOME` is redirected into the fixture so no global lore config leaks in. */
function runLore(args: readonly string[], cwd: string, actor: string = FIXTURE_LABEL): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, actor) as Record<string, string>,
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/**
 * `runLore`, but a nonzero exit throws with the full stderr/stdout. reason: a
 * silently-failed arrange step would leave a SMALLER corpus, which is exactly
 * the shape the defect under test produces — the two must never be confusable.
 */
function runLoreOk(args: readonly string[], cwd: string, actor: string = FIXTURE_LABEL): RunResult {
  const result = runLore(args, cwd, actor);
  if (result.exitCode !== 0) {
    throw new Error(
      `fixture step failed (exit ${result.exitCode}): lore ${args.join(" ")}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return result;
}

/** Extracts the `Slug: <slug>` line `lore create` prints — the slug is never hardcoded, always read back from the writer. */
function parseCreatedSlug(stdout: string): string {
  const match = /Slug:\s+(\S+)/.exec(stdout);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse created slug from output: ${stdout}`);
  return slug;
}

function createDoc(cwd: string, type: string, title: string, extraArgs: readonly string[]): string {
  const result = runLoreOk(
    ["create", type, "--title", title, "--content", `${title} body.`, "--no-ai", ...extraArgs],
    cwd,
  );
  return parseCreatedSlug(result.stdout);
}

function readDoc(cwd: string, slug: string): z.infer<typeof docProjectionSchema>["data"]["doc"] {
  const result = runLoreOk(["get", slug, "--json"], cwd);
  return docProjectionSchema.parse(JSON.parse(result.stdout)).data.doc;
}

function readBootstrap(cwd: string, by: string): BootstrapReportPayload {
  const result = runLoreOk(["bootstrap", "--by", by, "--json"], cwd);
  return bootstrapEnvelopeSchema.parse(JSON.parse(result.stdout)).data;
}

function makeTempCorpus(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  runLoreOk(["init"], dir);
  // reason: plans are judged by default (BR-281 / BR-1237); this suite approves a plan only to put it in
  // a lifecycle state, never to exercise review-judgment.
  patchLoreConfig(dir, "workflow:\n  review:\n    judgment_required_types: []\n");
  return dir;
}

const temporaryDirs: string[] = [];

afterAll(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Fixture A: the diverged-member corpus ──────────────────────────────────

interface DivergedFixture {
  readonly dir: string;
  /** ACTIVE plan the diverged task DECLARES via `extra.plan_id`. */
  readonly activePlanSlug: string;
  readonly activePlanId: string;
  readonly activePlanUpdatedAt: string;
  /** DEPRECATED plan the diverged task is FILED under via `parent_id` — deliberately not an active plan, so site 284 is reachable. */
  readonly deprecatedPlanSlug: string;
  readonly deprecatedPlanId: string;
  readonly divergedTaskSlug: string;
  readonly divergedTaskUpdatedAt: string;
  readonly alignedTaskSlug: string;
  readonly alignedTaskUpdatedAt: string;
  readonly adhocTaskSlug: string;
  readonly deprecatedPlanMemberTaskSlug: string;
}

let divergedFixture: DivergedFixture | undefined;

/**
 * Builds (once, memoized) the corpus this suite's defect tests read:
 *
 *   prd root
 *   ├── plan ACTIVE      ← declared by the diverged task's `extra.plan_id`
 *   │   └── task aligned member            (parent_id === extra.plan_id)
 *   ├── plan DEPRECATED  ← the diverged task's `parent_id`
 *   │   ├── task diverged member           (extra.plan_id = ACTIVE plan)
 *   │   └── task deprecated-plan member    (its own plan, non-active)
 *   └── task planless --adhoc              (no extra.plan_id at all)
 *
 * Claim order is load-bearing: the diverged member is claimed LAST, making its
 * `updated_at` the newest write anywhere in the ACTIVE plan's subtree — which is
 * what turns `active_plans[].last_activity_at` into a PRESENCE oracle for it.
 */
function getDivergedFixture(): DivergedFixture {
  if (divergedFixture !== undefined) return divergedFixture;

  const dir = makeTempCorpus("lore-bootstrap-membership-diverged-");
  const rootSlug = createDoc(dir, "prd", "Membership Root", []);
  const activePlanSlug = createDoc(dir, "plan", "Active Plan", ["--parent", rootSlug]);
  const deprecatedPlanSlug = createDoc(dir, "plan", "Retired Plan", ["--parent", rootSlug]);

  const alignedTaskSlug = createDoc(dir, "task", "Aligned Member", [
    "--parent",
    activePlanSlug,
    "--plan-id",
    activePlanSlug,
  ]);
  const deprecatedPlanMemberTaskSlug = createDoc(dir, "task", "Retired Plan Member", [
    "--parent",
    deprecatedPlanSlug,
    "--plan-id",
    deprecatedPlanSlug,
  ]);
  const divergedTaskSlug = createDoc(dir, "task", "Diverged Member", [
    "--parent",
    deprecatedPlanSlug,
    "--plan-id",
    activePlanSlug,
  ]);
  // reason: `--ac-scope ""` is REQUIRED on the --adhoc branch since
  //   task-an-ad-hoc-task-can-never-reach-the-attestation-path-that (merge 3b20514) — the
  //   explicit-empty declaration, distinct from absent. This fixture was authored on a branch
  //   that predated that rule, so the two merged green-in-isolation and red together.
  const adhocTaskSlug = createDoc(dir, "task", "Planless Adhoc", ["--adhoc", "--ac-scope", ""]);

  // draft → approved → deprecated: the ONLY non-terminal→non-active path a plan
  // can walk without the plan-close gate (VALID_TRANSITIONS, schemas.ts).
  runLoreOk(["approve", deprecatedPlanSlug], dir);
  runLoreOk(["set", deprecatedPlanSlug, "--status", "deprecated"], dir);

  runLoreOk(
    ["claim", adhocTaskSlug, "--worktree", join(dir, "wt-adhoc")],
    dir,
    ADHOC_LABEL,
  );
  runLoreOk(
    [
      "claim",
      deprecatedPlanMemberTaskSlug,
      "--worktree",
      join(dir, "wt-retired"),
    ],
    dir,
    DEPRECATED_PLAN_LABEL,
  );
  runLoreOk(
    ["claim", divergedTaskSlug, "--worktree", join(dir, "wt-diverged")],
    dir,
    DIVERGED_LABEL,
  );

  const activePlan = readDoc(dir, activePlanSlug);
  const deprecatedPlan = readDoc(dir, deprecatedPlanSlug);
  const alignedTask = readDoc(dir, alignedTaskSlug);
  const divergedTask = readDoc(dir, divergedTaskSlug);

  // Fixture invariants — a degenerate timestamp would make the presence oracle
  // below vacuous, so it fails HERE, loudly, instead of passing quietly there.
  if (divergedTask.updated_at <= alignedTask.updated_at) {
    throw new Error(
      `fixture invariant violated: diverged task's updated_at (${divergedTask.updated_at}) must be ` +
        `strictly newer than the aligned sibling's (${alignedTask.updated_at})`,
    );
  }
  if (divergedTask.updated_at <= activePlan.updated_at) {
    throw new Error(
      `fixture invariant violated: diverged task's updated_at (${divergedTask.updated_at}) must be ` +
        `strictly newer than its declared plan's (${activePlan.updated_at})`,
    );
  }

  divergedFixture = {
    dir,
    activePlanSlug,
    activePlanId: activePlan.id,
    activePlanUpdatedAt: activePlan.updated_at,
    deprecatedPlanSlug,
    deprecatedPlanId: deprecatedPlan.id,
    divergedTaskSlug,
    divergedTaskUpdatedAt: divergedTask.updated_at,
    alignedTaskSlug,
    alignedTaskUpdatedAt: alignedTask.updated_at,
    adhocTaskSlug,
    deprecatedPlanMemberTaskSlug,
  };
  return divergedFixture;
}

/** The `active_plans` entry for `slug`, or a loud failure — never `undefined` flowing into an assertion. */
function activePlanEntry(report: BootstrapReportPayload, slug: string): BootstrapReportPayload["active_plans"][number] {
  const entry = report.active_plans.find((plan) => plan.slug === slug);
  if (entry === undefined) {
    throw new Error(
      `no active_plans entry for ${slug} — present: ${report.active_plans.map((p) => p.slug).join(", ") || "(none)"}`,
    );
  }
  return entry;
}

// ─── Fixture B: the aligned-only control corpus ──────────────────────────────

interface AlignedOnlyFixture {
  readonly dir: string;
  readonly planSlug: string;
  readonly planTitle: string;
  readonly taskSlug: string;
  readonly taskUpdatedAt: string;
}

let alignedOnlyFixture: AlignedOnlyFixture | undefined;

/** The common shape only: one active plan, one task whose `parent_id === extra.plan_id`, no claims. */
function getAlignedOnlyFixture(): AlignedOnlyFixture {
  if (alignedOnlyFixture !== undefined) return alignedOnlyFixture;

  const dir = makeTempCorpus("lore-bootstrap-membership-aligned-");
  const rootSlug = createDoc(dir, "prd", "Aligned Root", []);
  const planTitle = "Solo Active Plan";
  const planSlug = createDoc(dir, "plan", planTitle, ["--parent", rootSlug]);
  const taskSlug = createDoc(dir, "task", "Solo Member", ["--parent", planSlug, "--plan-id", planSlug]);
  const task = readDoc(dir, taskSlug);

  alignedOnlyFixture = { dir, planSlug, planTitle, taskSlug, taskUpdatedAt: task.updated_at };
  return alignedOnlyFixture;
}

// ─── PRE-CONDITION ──────────────────────────────────────────────────────────

describe("bootstrap plan membership: fixture preconditions", () => {
  it(
    "PRE-CONDITION: the fixture holds the SUPPORTED diverged shape — declared plan is ACTIVE, parent plan is DEPRECATED",
    () => {
      const fixture = getDivergedFixture();
      const diverged = readDoc(fixture.dir, fixture.divergedTaskSlug);

      expect(diverged.extra["plan_id"]).toBe(fixture.activePlanId);
      expect(diverged.parent_id).toBe(fixture.deprecatedPlanId);
      expect(diverged.parent_id).not.toBe(diverged.extra["plan_id"]);

      // The parent plan is DEPRECATED (non-active) — this is what makes the
      // site-284 test below a genuine test of the corpus-global fix
      // (task-active-sessions-derives-only-over-active-plans-tasks-with): a
      // claim under a non-active plan's member must now STILL appear in
      // `active_sessions`, since that field no longer gates on plan status at
      // all (only site 251's `active_plans` membership still cares).
      expect(readDoc(fixture.dir, fixture.deprecatedPlanSlug).status).toBe("deprecated");
      expect(readDoc(fixture.dir, fixture.activePlanSlug).status).toBe("draft");

      // The planless control really is planless (no plan_id to be a member by).
      const adhoc = readDoc(fixture.dir, fixture.adhocTaskSlug);
      expect(adhoc.extra["adhoc"]).toBe(true);
      expect(adhoc.extra["plan_id"]).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});

// ─── Site 251 — the active-plan task listing ─────────────────────────────────

describe("bootstrap active_plans keys on declared membership (session-service.ts:251)", () => {
  it(
    "HAPPY: the DECLARED plan's active_plans entry INCLUDES the diverged member",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, DIVERGED_HOLDER);
      const entry = activePlanEntry(report, fixture.activePlanSlug);

      // PRESENCE, not a count: `last_activity_at` is max(updated_at) over the
      // plan + the tasks the listing resolved, and the diverged member holds the
      // newest write in that subtree (fixture invariant) — this exact string can
      // only appear if the diverged member was in the resolved set.
      expect(entry.last_activity_at).toBe(fixture.divergedTaskUpdatedAt);
      // The pre-fix value, named explicitly so a regression reads as itself:
      // dropping the diverged member leaves the aligned sibling as the newest.
      expect(entry.last_activity_at).not.toBe(fixture.alignedTaskUpdatedAt);

      // Both members are resolved, and EXACTLY both: three independent counters
      // (`computeTaskCounts` — three `if`s, no `else`), so the diverged member is
      // counted in `ready` (nothing blocks it) AND in `claimed` (its lease is
      // fresh), while the aligned sibling is only `ready`. `ready: 2` is
      // therefore two DISTINCT members, not one member double-counted — before
      // the fix this read `{ready: 1, claimed: 0, done: 0}` (the aligned sibling
      // alone). Exactness also pins the ad-hoc control: a planless task dragged
      // in here would read `{ready: 3, claimed: 2, done: 0}`.
      expect(entry.task_counts).toEqual({ ready: 2, claimed: 1, done: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "BOUNDARY: the DEPRECATED plan the diverged member is FILED under is not listed at all",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, DIVERGED_HOLDER);
      expect(report.active_plans.map((plan) => plan.slug)).not.toContain(fixture.deprecatedPlanSlug);
    },
    TEST_TIMEOUT_MS,
  );
});

// ─── Site 284 — the active_sessions derivation ───────────────────────────────

describe("bootstrap active_sessions keys on declared membership (session-service.ts:284)", () => {
  it(
    "HAPPY: the diverged member's LIVE claim appears in active_sessions",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, DIVERGED_HOLDER);

      const session = report.active_sessions.find((candidate) => candidate.by === DIVERGED_HOLDER);
      if (session === undefined) {
        throw new Error(
          `no active_sessions row for ${DIVERGED_HOLDER} — rows: ${JSON.stringify(report.active_sessions)}`,
        );
      }
      expect(session.task_slugs).toContain(fixture.divergedTaskSlug);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    // Updated by task-active-sessions-derives-only-over-active-plans-tasks-with:
    // this used to assert the OPPOSITE (claim excluded) as the "correct,
    // guarded" behavior — that was precisely the corpus-global-scope defect
    // that task's own doc measured and fixed (NEGATIVE bullet 2: "a fresh
    // claim on a task under an archived plan also appears. Today it does
    // not." — this fixture's plan is DEPRECATED rather than ARCHIVED, but
    // `session-service.ts` treated both identically pre-fix, so this exact
    // fixture reproduces that same shape).
    "REGRESSION: a member of the DEPRECATED plan's live claim DOES appear in active_sessions (corpus-global scope)",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, DEPRECATED_PLAN_HOLDER);

      // Live control: the claim exists and is fresh — proven in the SAME payload.
      expect(report.my_claims).toEqual([
        {
          task_slug: fixture.deprecatedPlanMemberTaskSlug,
          plan_slug: fixture.deprecatedPlanSlug,
          claimed_at: expect.any(String),
          stale: false,
        },
      ]);

      // `active_sessions` is corpus-global — a task's OWN status (not its
      // parent plan's) is what would exclude it, and this task's own status
      // is "draft" (never archived/deprecated itself), so its live claim
      // appears regardless of its plan's terminal status.
      const session = report.active_sessions.find((s) => s.by === DEPRECATED_PLAN_HOLDER);
      if (session === undefined) {
        throw new Error(
          `no active_sessions row for ${DEPRECATED_PLAN_HOLDER} — rows: ${JSON.stringify(report.active_sessions)}`,
        );
      }
      expect(session.task_slugs).toContain(fixture.deprecatedPlanMemberTaskSlug);
      expect(session.stale).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    // Site 251 (`active_plans` membership) is UNAFFECTED by this task — a
    // task's own status still governs `active_sessions`, but its PLAN's
    // active-ness still governs whether it rolls up into any `active_plans`
    // entry at all (there is none for a deprecated plan, per site-251's own
    // BOUNDARY test above).
    "REGRESSION: the DEPRECATED plan itself still contributes no active_plans entry (site 251 unaffected)",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, DEPRECATED_PLAN_HOLDER);
      expect(report.active_plans.map((plan) => plan.slug)).not.toContain(fixture.deprecatedPlanSlug);
    },
    TEST_TIMEOUT_MS,
  );
});

// ─── Controls ───────────────────────────────────────────────────────────────

describe("bootstrap plan membership: controls", () => {
  it(
    "NEGATIVE: a planless --adhoc task with a LIVE claim is never dragged into any plan's active_plans listing",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, ADHOC_HOLDER);

      // Live control: the ad-hoc claim is real and fresh.
      expect(report.my_claims.map((claim) => claim.task_slug)).toContain(fixture.adhocTaskSlug);
      expect(report.my_claims.every((claim) => !claim.stale)).toBe(true);

      // It belongs to no plan (extra.plan_id absent, SPEC-069 D2), so it
      // inflates no plan's active_plans task_counts.
      for (const plan of report.active_plans) {
        expect(plan.slug).not.toBe(fixture.adhocTaskSlug);
      }

      // reason: "it also inflates no plan's counts" is pinned by the site-251
      // test's EXACT `task_counts` equality ({ready:2, claimed:1, done:0} — the
      // two declared members and nothing else); a claimed ad-hoc task dragged in
      // would read as `{ready:3, claimed:2}` there. Asserting it here too would
      // make this control fail before the fix for a reason that has nothing to do
      // with ad-hoc tasks, destroying its value as a both-sides control.
    },
    TEST_TIMEOUT_MS,
  );

  it(
    // Updated by task-active-sessions-derives-only-over-active-plans-tasks-with
    // Required #1 — an adhoc task's claim now DOES appear in active_sessions,
    // since that field is corpus-global and no longer requires a `plan_id` at
    // all. This is the exact second defect the task doc measured: "adhoc tasks
    // are parented to the root PRD, never a plan... can never satisfy
    // activePlanIds.has(parent_id)".
    "REGRESSION: a planless --adhoc task's LIVE claim DOES appear in active_sessions (corpus-global scope)",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, ADHOC_HOLDER);

      const session = report.active_sessions.find((s) => s.by === ADHOC_HOLDER);
      if (session === undefined) {
        throw new Error(
          `no active_sessions row for ${ADHOC_HOLDER} — rows: ${JSON.stringify(report.active_sessions)}`,
        );
      }
      expect(session.task_slugs).toContain(fixture.adhocTaskSlug);
      expect(session.stale).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "REGRESSION: an ALIGNED-only corpus yields a fully enumerated, unchanged active_plans payload",
    () => {
      const fixture = getAlignedOnlyFixture();
      const report = readBootstrap(fixture.dir, FIXTURE_ACTOR);

      expect(report.active_plans).toEqual([
        {
          slug: fixture.planSlug,
          title: fixture.planTitle,
          task_counts: { ready: 1, claimed: 0, done: 0 },
          last_activity_at: fixture.taskUpdatedAt,
        },
      ]);
      expect(report.active_sessions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "STATE: bootstrap is read-only — two consecutive runs over an untouched corpus are identical",
    () => {
      const fixture = getAlignedOnlyFixture();
      expect(readBootstrap(fixture.dir, FIXTURE_ACTOR)).toEqual(readBootstrap(fixture.dir, FIXTURE_ACTOR));
    },
    TEST_TIMEOUT_MS,
  );
});
