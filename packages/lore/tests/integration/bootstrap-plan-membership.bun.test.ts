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
 *                dragged into any plan's listing or session set (its claim's
 *                existence is proven in the same payload via `my_claims`, so
 *                the absence is not vacuous).
 *   BOUNDARY   — a member of a DEPRECATED plan keeps its live claim OUT of
 *                `active_sessions`: membership decides WHICH plan a task
 *                belongs to, `active`-ness still decides WHICH plans count.
 *                This is the guard against "fixing" site 284 by dropping the
 *                active-plan filter altogether.
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
 * @spec_ref task-the-eleventh-plan-member-site-found-by-enumeration
 * @spec_ref task-eight-more-plan-member-queries-still-key-on-parent-id
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

/** Every fixture claim passes `--by` explicitly, so these are the exact `active_sessions`/`my_claims` keys asserted below. */
const DIVERGED_HOLDER = "agent:diverged-holder";
const ADHOC_HOLDER = "agent:adhoc-holder";
const DEPRECATED_PLAN_HOLDER = "agent:deprecated-plan-holder";

/** Actor for the fixture's non-claim writes — never the OS username, so audit rows stay attributable. */
const FIXTURE_ACTOR = "agent:bootstrap-membership-fixture";

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

/**
 * `runLore`, but a nonzero exit throws with the full stderr/stdout. reason: a
 * silently-failed arrange step would leave a SMALLER corpus, which is exactly
 * the shape the defect under test produces — the two must never be confusable.
 */
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
  const adhocTaskSlug = createDoc(dir, "task", "Planless Adhoc", ["--adhoc"]);

  // draft → approved → deprecated: the ONLY non-terminal→non-active path a plan
  // can walk without the plan-close gate (VALID_TRANSITIONS, schemas.ts).
  runLoreOk(["approve", deprecatedPlanSlug, "--by", FIXTURE_ACTOR], dir);
  runLoreOk(["set", deprecatedPlanSlug, "--status", "deprecated"], dir);

  runLoreOk(
    ["claim", adhocTaskSlug, "--by", ADHOC_HOLDER, "--worktree", join(dir, "wt-adhoc")],
    dir,
  );
  runLoreOk(
    [
      "claim",
      deprecatedPlanMemberTaskSlug,
      "--by",
      DEPRECATED_PLAN_HOLDER,
      "--worktree",
      join(dir, "wt-retired"),
    ],
    dir,
  );
  runLoreOk(
    ["claim", divergedTaskSlug, "--by", DIVERGED_HOLDER, "--worktree", join(dir, "wt-diverged")],
    dir,
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

      // The parent plan must NOT be an active plan — otherwise the
      // `active_sessions` site (284) is structurally unreachable and its test
      // below would pass for the wrong reason.
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
    "BOUNDARY: a member of the DEPRECATED plan keeps its live claim OUT of active_sessions",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, DEPRECATED_PLAN_HOLDER);

      // Live control: the claim exists and is fresh — proven in the SAME payload,
      // so its absence from active_sessions below cannot be a vacuous pass.
      expect(report.my_claims).toEqual([
        {
          task_slug: fixture.deprecatedPlanMemberTaskSlug,
          plan_slug: fixture.deprecatedPlanSlug,
          claimed_at: expect.any(String),
          stale: false,
        },
      ]);

      // Membership decides WHICH plan a task belongs to; ACTIVE-ness still
      // decides which plans count. A fix that dropped the active-plan filter
      // would surface this row.
      expect(report.active_sessions.map((session) => session.by)).not.toContain(DEPRECATED_PLAN_HOLDER);
      for (const session of report.active_sessions) {
        expect(session.task_slugs).not.toContain(fixture.deprecatedPlanMemberTaskSlug);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

// ─── Controls ───────────────────────────────────────────────────────────────

describe("bootstrap plan membership: controls", () => {
  it(
    "NEGATIVE: a planless --adhoc task with a LIVE claim is never dragged into a plan's listing or session set",
    () => {
      const fixture = getDivergedFixture();
      const report = readBootstrap(fixture.dir, ADHOC_HOLDER);

      // Live control: the ad-hoc claim is real and fresh.
      expect(report.my_claims.map((claim) => claim.task_slug)).toContain(fixture.adhocTaskSlug);
      expect(report.my_claims.every((claim) => !claim.stale)).toBe(true);

      // …yet it belongs to no plan, so it appears in no session row.
      for (const session of report.active_sessions) {
        expect(session.task_slugs).not.toContain(fixture.adhocTaskSlug);
      }
      expect(report.active_sessions.map((session) => session.by)).not.toContain(ADHOC_HOLDER);

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
