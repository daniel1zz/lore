// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-7
 * @task task-skill-refactor-gs-t6-adopt-creates-a-carrier-task-resolve
 *
 * `lore issue adopt <n> [--plan <plan>]` creates exactly ONE draft carrier task (`extra.issues=[ref]`, member of the
 * given live plan), only READS GitHub, is idempotent (`Already adopted: <slug>`, exit 0) and is race-safe: the carrier
 * slug's DUPLICATE_SLUG arbitrates two simultaneous adopters.
 *
 * Oracle: the real command tree over a throwaway corpus (`mkdtemp` + `lore init`) and a STUB `gh` (`helpers/gh-issue-stub.ts`)
 * serving a two-page listing. The race uses two SPAWNED `bun src/index.ts` processes started with `Promise.all`.
 *
 * Six-dimension note:
 *   HAPPY      #7 (on page 2) adopted into a live plan: exit 0, one draft task `task-issue-<repo_id>-7` with plan_id, issues,
 *              no issue_report, no adhoc; the stub log holds only GET calls; `lore issues --json` shows #7 `adopted`.
 *   NEGATIVE   an archived plan: exit exactly 4, nothing created; #8 listed closed: exit exactly 4; an unlisted number: 4.
 *   BOUNDARY   no --plan: an ad-hoc carrier under the root PRD (extra.adhoc, no plan_id) with the same issues shape.
 *   STATE      a second identical run prints `Already adopted: <slug>`, exit 0, task count unchanged.
 *   RACE       two concurrent spawned runs on #6: exactly one task, both exit 0, exactly one stdout starts `Already adopted`.
 *   REGRESSION red-once mutation: dropping the DUPLICATE_SLUG handling makes the race loser exit 4.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanDirs, makeIssueFixture, STUB_REPO_ID, type IssueFixture } from "../../helpers/gh-issue-stub";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";
const dirsToClean: string[] = [];
afterAll(() => cleanDirs(dirsToClean));

interface DocJson {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly extra: Record<string, unknown>;
}

const getDoc = async (fixture: IssueFixture, slug: string): Promise<DocJson> => {
  const result = await fixture.run(["get", slug, "--json"], "reader");
  expect(result.exitCode, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout) as { data: { doc?: DocJson } & DocJson };
  return parsed.data.doc ?? parsed.data;
};

const taskCount = async (fixture: IssueFixture): Promise<number> => {
  const result = await fixture.run(["list", "--type", "task", "--json"], "reader");
  expect(result.exitCode, result.stderr).toBe(0);
  const data = (JSON.parse(result.stdout) as { data: unknown }).data as { docs?: unknown[] } | unknown[];
  return Array.isArray(data) ? data.length : (data.docs ?? []).length;
};

describe(`${SPEC}#AC-GS-7 adopt creates one carrier task, idempotent and race-safe`, () => {
  let fixture: IssueFixture;
  let livePlanId = "";
  let livePlanSlug = "";
  let archivedPlanSlug = "";

  // init + prd + two plans + an archive: an explicit timeout, never the 10s default.
  beforeAll(async () => {
    fixture = await makeIssueFixture(
      [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }, { number: 5 }, { number: 6 }, { number: 7 }, { number: 8, state: "closed", reason: "completed" }],
      { dirsToClean, pageSize: 5 },
    );
    const createPlan = async (title: string): Promise<DocJson> => {
      const result = await fixture.run(["create", "plan", "--title", title, "--no-ai", "--content", "## Goal\n\nBody.", "--json"], "setup");
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      return (JSON.parse(result.stdout) as { data: DocJson }).data;
    };
    const live = await createPlan("Live plan");
    livePlanId = live.id;
    livePlanSlug = live.slug;
    const dead = await createPlan("Archived plan");
    archivedPlanSlug = dead.slug;
    // draft -> approved -> active -> archived: the only legal path to an archived plan.
    const approved = await fixture.run(["approve", dead.slug], "setup");
    expect(approved.exitCode, approved.stderr + approved.stdout).toBe(0);
    for (const status of ["active", "archived"]) {
      const moved = await fixture.run(["set", dead.slug, "--status", status], "setup");
      expect(moved.exitCode, moved.stderr + moved.stdout).toBe(0);
    }
    fixture.resetLog();
  }, 240_000);

  it(`${SPEC}#AC-GS-7 adopting #7 (page 2) into a live plan creates one draft carrier, reads GitHub only, and shows #7 adopted`, async () => {
    const slug = `task-issue-${STUB_REPO_ID}-7`;
    const before = await taskCount(fixture);
    fixture.resetLog();
    const result = await fixture.run(["issue", "adopt", "7", "--plan", livePlanSlug]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain(slug);

    expect(fixture.writes()).toEqual([]);
    expect(fixture.ghCalls().every((argv) => !argv.includes("-X") || argv[argv.indexOf("-X") + 1] === "GET")).toBe(true);
    expect(await taskCount(fixture)).toBe(before + 1);

    const task = await getDoc(fixture, slug);
    expect(task.status).toBe("draft");
    expect(task.extra["plan_id"]).toBe(livePlanId);
    expect(task.extra["issues"]).toEqual([{ repo_id: STUB_REPO_ID, number: 7 }]);
    expect(task.extra["issue_report"]).toBeUndefined();
    expect(task.extra["adhoc"]).toBeUndefined();

    const listed = await fixture.run(["issues", "--json", "--all"], "reader");
    expect(listed.exitCode, listed.stderr).toBe(0);
    const reports = (JSON.parse(listed.stdout) as { data: { reports: { number: number; status: string; carriers: string[] }[] } }).data.reports;
    const seven = reports.find((report) => report.number === 7);
    expect(seven?.status).toBe("adopted");
    expect(seven?.carriers).toEqual([slug]);
  }, 180_000);

  it(`${SPEC}#AC-GS-7 a second identical run prints 'Already adopted: <slug>', exits 0 and creates nothing`, async () => {
    const slug = `task-issue-${STUB_REPO_ID}-7`;
    const before = await taskCount(fixture);
    const result = await fixture.run(["issue", "adopt", "7", "--plan", livePlanSlug]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout.trim()).toBe(`Already adopted: ${slug}`);
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);

  it(`${SPEC}#AC-GS-7 two concurrent spawned runs create exactly one task; both exit 0, exactly one says 'Already adopted'`, async () => {
    const slug = `task-issue-${STUB_REPO_ID}-6`;
    const before = await taskCount(fixture);
    const [first, second] = await Promise.all([
      fixture.runSpawned(["issue", "adopt", "6", "--plan", livePlanSlug], "racer-a"),
      fixture.runSpawned(["issue", "adopt", "6", "--plan", livePlanSlug], "racer-b"),
    ]);
    expect(first.exitCode, first.stderr + first.stdout).toBe(0);
    expect(second.exitCode, second.stderr + second.stdout).toBe(0);
    expect([first, second].filter((run) => run.stdout.startsWith("Already adopted"))).toHaveLength(1);
    expect([first, second].filter((run) => run.stdout.startsWith("Adopted"))).toHaveLength(1);
    expect(await taskCount(fixture)).toBe(before + 1);
    expect((await getDoc(fixture, slug)).slug).toBe(slug);
  }, 180_000);

  it(`${SPEC}#AC-GS-7 an archived plan exits exactly 4 and creates nothing`, async () => {
    const before = await taskCount(fixture);
    const result = await fixture.run(["issue", "adopt", "5", "--plan", archivedPlanSlug]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(4);
    expect(result.stderr).toContain(archivedPlanSlug);
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);

  it(`${SPEC}#AC-GS-7 an issue closed on GitHub (#8) and an unlisted number each exit exactly 4 and create nothing`, async () => {
    const before = await taskCount(fixture);
    const closed = await fixture.run(["issue", "adopt", "8", "--plan", livePlanSlug]);
    expect(closed.exitCode, closed.stderr + closed.stdout).toBe(4);
    const unlisted = await fixture.run(["issue", "adopt", "999", "--plan", livePlanSlug]);
    expect(unlisted.exitCode, unlisted.stderr + unlisted.stdout).toBe(4);
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);

  it(`${SPEC}#AC-GS-7 without --plan an ad-hoc carrier is created under the root PRD`, async () => {
    const slug = `task-issue-${STUB_REPO_ID}-5`;
    const result = await fixture.run(["issue", "adopt", "5"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const task = await getDoc(fixture, slug);
    expect(task.extra["adhoc"]).toBe(true);
    expect(task.extra["plan_id"]).toBeUndefined();
    expect(task.extra["issues"]).toEqual([{ repo_id: STUB_REPO_ID, number: 5 }]);
    expect(task.extra["issue_report"]).toBeUndefined();
  }, 120_000);
});
