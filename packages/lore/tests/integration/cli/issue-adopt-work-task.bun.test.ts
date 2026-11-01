// @reads assets/project/lore-config-template.yaml
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
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanDirs, makeIssueFixture, STUB_REPO_ID, type IssueFixture } from "../../helpers/gh-issue-stub";
import { patchLoreConfig } from "../../helpers/patch-lore-config";
import { createCarrierSpec, landCarrierAndDone } from "../support/issue-carrier";
import { FIXTURE_DONE_CONTRACT_CONFIG } from "../support/land-task";

import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
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
      const result = await fixture.run(["create", "plan", "--parent", await ensureRequirementsDocSlugAsync((a) => fixture.run(a, "setup")), "--title", title, "--no-ai", "--content", "## Goal\n\nBody.", "--json"], "setup");
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
    const result = await fixture.run(["issue", "adopt", "7", "--plan", livePlanSlug, "--kind", "code"]);
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
    const result = await fixture.run(["issue", "adopt", "7", "--plan", livePlanSlug, "--kind", "code"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout.trim()).toBe(`Already adopted: ${slug}`);
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);

  it(`${SPEC}#AC-GS-7 two concurrent spawned runs create exactly one task; both exit 0, exactly one says 'Already adopted'`, async () => {
    const slug = `task-issue-${STUB_REPO_ID}-6`;
    const before = await taskCount(fixture);
    // The stub holds each run's first listing page until BOTH have asked for it: both have then read the carrier index
    // (empty) and decided `create`, so the loser can only be saved by the DUPLICATE_SLUG arbiter, not by seeing the winner.
    fixture.armListingBarrier();
    const [first, second] = await Promise.all([
      fixture.runSpawned(["issue", "adopt", "6", "--plan", livePlanSlug, "--kind", "code"], "racer-a"),
      fixture.runSpawned(["issue", "adopt", "6", "--plan", livePlanSlug, "--kind", "code"], "racer-b"),
    ]).finally(() => fixture.disarmListingBarrier());
    expect(first.exitCode, first.stderr + first.stdout).toBe(0);
    expect(second.exitCode, second.stderr + second.stdout).toBe(0);
    expect([first, second].filter((run) => run.stdout.startsWith("Already adopted"))).toHaveLength(1);
    expect([first, second].filter((run) => run.stdout.startsWith("Adopted"))).toHaveLength(1);
    expect(await taskCount(fixture)).toBe(before + 1);
    expect((await getDoc(fixture, slug)).slug).toBe(slug);
  }, 180_000);

  it(`${SPEC}#AC-GS-7 an archived plan exits exactly 4 and creates nothing`, async () => {
    const before = await taskCount(fixture);
    const result = await fixture.run(["issue", "adopt", "5", "--plan", archivedPlanSlug, "--kind", "code"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(4);
    expect(result.stderr).toContain(archivedPlanSlug);
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);

  it(`${SPEC}#AC-GS-7 an issue closed on GitHub (#8) and an unlisted number each exit exactly 4 and create nothing`, async () => {
    const before = await taskCount(fixture);
    const closed = await fixture.run(["issue", "adopt", "8", "--plan", livePlanSlug, "--kind", "code"]);
    expect(closed.exitCode, closed.stderr + closed.stdout).toBe(4);
    const unlisted = await fixture.run(["issue", "adopt", "999", "--plan", livePlanSlug, "--kind", "code"]);
    expect(unlisted.exitCode, unlisted.stderr + unlisted.stdout).toBe(4);
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);

  it(`${SPEC}#AC-GS-7 without --plan an ad-hoc carrier is created under the root PRD`, async () => {
    const slug = `task-issue-${STUB_REPO_ID}-5`;
    const result = await fixture.run(["issue", "adopt", "5", "--kind", "code"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const task = await getDoc(fixture, slug);
    expect(task.extra["adhoc"]).toBe(true);
    expect(task.extra["plan_id"]).toBeUndefined();
    expect(task.extra["issues"]).toEqual([{ repo_id: STUB_REPO_ID, number: 5 }]);
    expect(task.extra["issue_report"]).toBeUndefined();
  }, 120_000);
});

// ─── AC-IL-6..8: number validation, the requirements-document refusal, adoptability (BR-520, BR-524, BR-1456) ───

const MALFORMED_NUMBERS = ["", "0", "007", "1.5", "0x10", "1e3", "abc", "99999999999999999999"] as const;

describe("AC-IL-6 a malformed issue number is refused before GitHub is contacted", () => {
  let fixture: IssueFixture;
  beforeAll(async () => {
    fixture = await makeIssueFixture([{ number: 5 }], { dirsToClean });
    fixture.resetLog();
  }, 120_000);

  it("AC-IL-6 issue adopt refuses each malformed number with exit exactly 4 naming field 'number' and the value, no gh call", async () => {
    for (const value of MALFORMED_NUMBERS) {
      const result = await fixture.run(["issue", "adopt", value, "--kind", "code"]);
      expect(result.exitCode, `adopt '${value}': ${result.stderr}${result.stdout}`).toBe(4);
      expect(result.stderr, `adopt '${value}'`).toContain("number");
      expect(result.stderr, `adopt '${value}'`).toContain(value);
    }
    expect(fixture.ghCalls()).toEqual([]);
  }, 120_000);

  it("AC-IL-6 issue resolve refuses each malformed number with exit exactly 4 naming field 'number' and the value, no gh call", async () => {
    for (const value of MALFORMED_NUMBERS) {
      const result = await fixture.run(["issue", "resolve", value, "--state", "rejected", "--reason", "r"]);
      expect(result.exitCode, `resolve '${value}': ${result.stderr}${result.stdout}`).toBe(4);
      expect(result.stderr, `resolve '${value}'`).toContain("number");
      expect(result.stderr, `resolve '${value}'`).toContain(value);
    }
    expect(fixture.ghCalls()).toEqual([]);
  }, 120_000);

  it("AC-IL-6 a bare -1 is read as a switch: adopt exits exactly 1 reporting the missing positional", async () => {
    const result = await fixture.run(["issue", "adopt", "-1"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(1);
    expect(result.stderr + result.stdout).toContain("Missing required positional");
    expect(fixture.ghCalls()).toEqual([]);
  }, 60_000);
});

describe("AC-IL-7 an ad-hoc adoption needs a requirements document, a plan adoption does not", () => {
  let fixture: IssueFixture;
  let planSlug = "";
  beforeAll(async () => {
    fixture = await makeIssueFixture([{ number: 5 }], { dirsToClean, withRootPrd: false });
    // reason: the corpus must stay free of any requirements document (that is what this test is about), and a plan needs a parent
    // (spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6): the plan is filed under a spec.
    const spec = await fixture.run(["create", "spec", "--title", "Prdless spec", "--no-ai", "--content", "## Overview/Goal\nx\n\n## Scope\nx\n\n## Acceptance Criteria\nx", "--json"], "setup");
    expect(spec.exitCode, spec.stderr + spec.stdout).toBe(0);
    const specSlug = (JSON.parse(spec.stdout) as { data: DocJson }).data.slug;
    const plan = await fixture.run(["create", "plan", "--parent", specSlug, "--title", "Prdless plan", "--no-ai", "--content", "## Goal\n\nBody.", "--json"], "setup");
    expect(plan.exitCode, plan.stderr + plan.stdout).toBe(0);
    planSlug = (JSON.parse(plan.stdout) as { data: DocJson }).data.slug;
  }, 240_000);

  it("AC-IL-7 without --plan the adoption exits exactly 4 and the task count is unchanged; with a live --plan it exits 0", async () => {
    const before = await taskCount(fixture);
    const refused = await fixture.run(["issue", "adopt", "5", "--kind", "code"]);
    expect(refused.exitCode, refused.stderr + refused.stdout).toBe(4);
    expect(await taskCount(fixture)).toBe(before);

    const adopted = await fixture.run(["issue", "adopt", "5", "--plan", planSlug, "--kind", "code"]);
    expect(adopted.exitCode, adopted.stderr + adopted.stdout).toBe(0);
    expect(await taskCount(fixture)).toBe(before + 1);
  }, 180_000);
});

describe("AC-IL-8 any open listed issue is adoptable; closed or archived-work issues are refused", () => {
  const HAND_WRITTEN = 21;
  const DAMAGED = 22;
  const DEPRECATED = 23;
  const ARCHIVED_TASK = 24;
  const ARCHIVED_PLAN = 25;
  let fixture: IssueFixture;
  let archivedTaskSlug = "";
  let archivedPlanSlug = "";
  let deprecatedTaskSlug = "";

  const slugOf = (stdout: string): string => (JSON.parse(stdout) as { data: { slug: string } }).data.slug;

  beforeAll(async () => {
    fixture = await makeIssueFixture(
      [
        { number: HAND_WRITTEN, body: "Hand written text with no field block." },
        { number: DAMAGED, body: "---\nseverity: high\nthe block never closes\n\nDamaged block description." },
        { number: DEPRECATED },
        { number: ARCHIVED_TASK },
        { number: ARCHIVED_PLAN },
      ],
      { dirsToClean },
    );
    const must = async (args: string[]): Promise<string> => {
      const result = await fixture.run(args, "setup");
      expect(result.exitCode, `${args.join(" ")}: ${result.stderr}${result.stdout}`).toBe(0);
      return result.stdout;
    };
    const prd = await fixture.run(["list", "--type", "prd", "--json"], "setup");
    const prdData = (JSON.parse(prd.stdout) as { data: { docs?: { slug: string }[] } | { slug: string }[] }).data;
    const prdSlug = (Array.isArray(prdData) ? prdData : (prdData.docs ?? []))[0]?.slug ?? "";
    expect(prdSlug).not.toBe("");

    // reason: approve compiles each carrier's done contract from these commands (a code task needs all three); an ad-hoc task names its spec
    patchLoreConfig(fixture.dir, { workflow: { done_contract: { ...FIXTURE_DONE_CONTRACT_CONFIG } } });
    const world = { dir: fixture.dir, run: (args: readonly string[], session: string) => fixture.run([...args], session) };
    const carrierSpec = await createCarrierSpec(world);

    const carrier = async (title: string, n: number): Promise<string> =>
      slugOf(await must(["create", "task", "--adhoc", "--kind", "code", "--spec", carrierSpec, "--ac-scope", "", "--title", title, "--no-ai", "--content", "Carrier.", "--issue", String(n), "--json"]));

    deprecatedTaskSlug = await carrier("Deprecated carrier", DEPRECATED);
    await must(["set", deprecatedTaskSlug, "--status", "deprecated", "--reason", "fixture: a deprecated carrier"]);

    // Archiving a carrier closes its issue on GitHub; the PATCH is made to fail so the issue stays OPEN with archived work.
    archivedTaskSlug = await carrier("Archived carrier", ARCHIVED_TASK);
    writeFileSync(join(fixture.stubDir, `fail-patch-${ARCHIVED_TASK}`), "1");
    // the carrier is approved, claimed on a branch, landed and holds its contract passes, then `lore done` archives it (the retired route
    // captured one pass and ran `lore done --declare-no-new-tests`)
    const archivedByDone = await landCarrierAndDone(world, archivedTaskSlug, dirsToClean, "setup");
    expect(archivedByDone.exitCode, archivedByDone.stderr + archivedByDone.stdout).toBe(0);
    rmSync(join(fixture.stubDir, `fail-patch-${ARCHIVED_TASK}`));

    archivedPlanSlug = slugOf(
      await must(["create", "plan", "--title", "Archived carrier plan", "--parent", prdSlug, "--no-ai", "--content", "## Goal\n\nBody.", "--issue", String(ARCHIVED_PLAN), "--json"]),
    );
    await must(["set", archivedPlanSlug, "--status", "approved"]);
    await must(["set", archivedPlanSlug, "--status", "active"]);
    writeFileSync(join(fixture.stubDir, `fail-patch-${ARCHIVED_PLAN}`), "1");
    await must(["set", archivedPlanSlug, "--status", "archived"]);
    rmSync(join(fixture.stubDir, `fail-patch-${ARCHIVED_PLAN}`));
    expect(fixture.stateOf(ARCHIVED_TASK).state).toBe("open");
    expect(fixture.stateOf(ARCHIVED_PLAN).state).toBe("open");
  }, 300_000);

  it("AC-IL-8 an issue with a hand-written body and one with a damaged field block are adopted, the task body carrying the issue text", async () => {
    for (const [n, text] of [[HAND_WRITTEN, "Hand written text with no field block."], [DAMAGED, "Damaged block description."]] as const) {
      const result = await fixture.run(["issue", "adopt", String(n), "--kind", "code"]);
      expect(result.exitCode, `#${n}: ${result.stderr}${result.stdout}`).toBe(0);
      const task = await fixture.run(["get", `task-issue-${STUB_REPO_ID}-${n}`], "reader");
      expect(task.exitCode, task.stderr).toBe(0);
      expect(task.stdout, `#${n}`).toContain(text);
    }
  }, 180_000);

  it("AC-IL-8 an issue whose only naming task is deprecated is adopted as task-issue-<repo_id>-<n>-r1", async () => {
    const result = await fixture.run(["issue", "adopt", String(DEPRECATED), "--kind", "code"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain(`task-issue-${STUB_REPO_ID}-${DEPRECATED}-r1`);
    expect((await getDoc(fixture, `task-issue-${STUB_REPO_ID}-${DEPRECATED}-r1`)).status).toBe("draft");
  }, 120_000);

  it("AC-IL-8 an open issue named by an archived task, and one named by an archived plan, each exit exactly 4 naming that work and 'lore issues --sync'; nothing is created", async () => {
    const before = await taskCount(fixture);
    for (const [n, slug] of [[ARCHIVED_TASK, archivedTaskSlug], [ARCHIVED_PLAN, archivedPlanSlug]] as const) {
      const result = await fixture.run(["issue", "adopt", String(n), "--kind", "code"]);
      expect(result.exitCode, `#${n}: ${result.stderr}${result.stdout}`).toBe(4);
      expect(result.stderr, `#${n}`).toContain(slug);
      expect(result.stderr, `#${n}`).toContain("lore issues --sync");
    }
    expect(await taskCount(fixture)).toBe(before);
  }, 120_000);
});
