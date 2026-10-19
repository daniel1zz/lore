// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-12
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-13
 * @task task-skill-implement-gs-t10-one-time-lore-issues-migrate
 *
 * `lore issues migrate` over a fixture corpus holding one legacy mirror per migration category, a recording stub gh,
 * and legacy rows seeded at the STORE level (CorpusService refuses `extra.issue_report` and `resolves` since GS-T1):
 *   #1 verdict already on GitHub        #2 verdict not on GitHub (also resolved by an archived task)
 *   #3 adopted by a live plan, open     #4 adopted by a live plan, closed     #5 adopted by an archived plan
 *   #6 mirror itself archived           #7 open, un-adopted
 *   #8 #9 #10 resolved by ONE archived task (3 links)   #11 resolved by an archived plan
 *   #12 resolved by an approved spec    #13 relates-to from a knowledge doc   local-only rejected report (no issue)
 *
 * Six-dimension note:
 *   HAPPY      apply reaches the post-conditions AND keeps their meaning: per-carrier refs, the re-home, the comments.
 *   NEGATIVE   a GitHub failure on one mirror leaves that mirror, its inbound link and its version untouched.
 *   BOUNDARY   the 3-ref carrier; the local-only report filed then closed not_planned.
 *   ERROR      stub failing the close (exit 9, `N of M migrated`, N == M-1); stub offline before any call (exit 9, no write).
 *   STATE      dry run writes nothing; a second apply writes nothing; a rerun after a failure posts no second comment.
 *   REGRESSION red-once: skipping the link rewrite (AC-GS-12); committing the corpus before the GitHub writes (AC-GS-13).
 */

import { Database } from "bun:sqlite";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { cleanDirs, makeIssueFixture, STUB_REPO_ID, type IssueFixture } from "../../helpers/gh-issue-stub";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";
const dirsToClean: string[] = [];
afterAll(() => cleanDirs(dirsToClean));

/** The stub serves no issue creation; this adds `POST repos/<repo>/issues`, minting the next number. */
const CREATE_ISSUE_PATCH = `
if (method === "POST" && path === "repos/" + REPO + "/issues") {
  const s = read();
  const n = Math.max(0, ...Object.keys(s.issues).map(Number)) + 1;
  s.issues[String(n)] = { title: field("title"), body: field("body"), state: "open", reason: null, labels: [], comments: [] };
  write(s);
  out({ number: n, html_url: "https://github.com/" + REPO + "/issues/" + n });
}
const state = read();`;

interface Seeded {
  readonly fixture: IssueFixture;
  readonly ids: Record<string, string>;
  readonly slugs: Record<string, string>;
}

interface Row {
  readonly [column: string]: unknown;
}

function sql(fixture: IssueFixture, query: string, ...params: Array<string | number>): Row[] {
  const db = new Database(join(fixture.dir, ".lore", "lore.db"), { readonly: true });
  try {
    return db.query(query).all(...params) as Row[];
  } finally {
    db.close();
  }
}

function sqlWrite(fixture: IssueFixture, statements: Array<{ query: string; params: Array<string | number> }>): void {
  const db = new Database(join(fixture.dir, ".lore", "lore.db"));
  try {
    for (const { query, params } of statements) db.query(query).run(...params);
  } finally {
    db.close();
  }
}

const REPORT = (number: number | undefined, resolution?: Record<string, unknown>): string =>
  JSON.stringify({
    reporter_project: "acme",
    reporter_actor: "tester",
    lore_version: "0.0.0",
    expected: "works",
    actual: "broken",
    reported_at: "2026-01-01T00:00:00.000Z",
    possible_duplicates: [],
    ...(number !== undefined ? { github: { repo: "acme/widget", number, repo_id: STUB_REPO_ID } } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
  });

/** Builds the corpus: ordinary docs through the CLI, the legacy rows through SQL. */
async function seedFixture(): Promise<Seeded> {
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const fixture = await makeIssueFixture(
    numbers.map((number) => ({
      number,
      title: `Issue ${number}`,
      ...(number === 1 ? { state: "closed" as const, reason: "not_planned", labels: ["resolution:rejected"] } : {}),
      ...(number === 3 ? { labels: ["resolution:adopted"] } : {}),
      ...(number === 4 ? { state: "closed" as const, reason: "completed" } : {}),
    })),
    { dirsToClean, pageSize: 5 },
  );
  const stubJs = join(fixture.stubDir, "gh-stub.js");
  writeFileSync(stubJs, readFileSync(stubJs, "utf8").replace("const state = read();", CREATE_ISSUE_PATCH));

  const ids: Record<string, string> = {};
  const slugs: Record<string, string> = {};
  const create = async (key: string, args: string[]): Promise<void> => {
    const result = await fixture.run(["create", ...args, "--no-ai", "--json"], "setup");
    if (result.exitCode !== 0) throw new Error(`create ${key} failed: ${result.stderr}${result.stdout}`);
    const data = (JSON.parse(result.stdout) as { data: { id: string; slug: string } }).data;
    ids[key] = data.id;
    slugs[key] = data.slug;
  };
  const adhoc = (title: string): string[] => ["task", "--adhoc", "--ac-scope", "", "--title", title, "--content", `${title} body.`];

  await create("spec", ["spec", "--title", "Migration spec", "--content", "## Overview\n\nBody."]);
  await create("planLive", ["plan", "--title", "Live plan", "--parent", slugs["spec"] ?? "", "--content", "Plan."]);
  await create("planArchived", ["plan", "--title", "Archived adopter", "--parent", slugs["spec"] ?? "", "--content", "Plan."]);
  await create("planResolver", ["plan", "--title", "Archived resolver plan", "--parent", slugs["spec"] ?? "", "--content", "Plan."]);
  await create("knowledge", ["knowledge", "--title", "Related note", "--sub-type", "reference", "--content", "Note."]);
  await create("taskThree", adhoc("Task resolving three"));
  await create("taskTwo", adhoc("Task resolving the unwritten verdict"));
  for (const number of numbers) await create(`m${number}`, adhoc(`Mirror ${number}`));
  await create("mLocal", adhoc("Local-only report"));

  const set = (id: string, extra: string): { query: string; params: Array<string | number> } => ({
    query: "UPDATE docs SET extra = json_patch(extra, ?) WHERE id = ?",
    params: [extra, id],
  });
  const status = (id: string, value: string): { query: string; params: Array<string | number> } => ({ query: "UPDATE docs SET status = ? WHERE id = ?", params: [value, id] });
  const link = (from: string, to: string, type: string): { query: string; params: Array<string | number> } => ({
    query: "INSERT INTO links (from_id, to_id, link_type, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
    params: [from, to, type, "2026-01-01T00:00:00.000Z", "seed"],
  });
  const mirror = (key: string, number: number | undefined, resolution?: Record<string, unknown>): { query: string; params: Array<string | number> } =>
    set(ids[key] ?? "", JSON.stringify({ issue_report: JSON.parse(REPORT(number, resolution)) }));

  sqlWrite(fixture, [
    mirror("m1", 1, { state: "rejected", reason: "not a defect" }),
    mirror("m2", 2, { state: "wontfix", reason: "out of scope" }),
    mirror("m3", 3, { state: "adopted", adopted_by: slugs["planLive"] ?? "" }),
    mirror("m4", 4, { state: "adopted", adopted_by: slugs["planLive"] ?? "" }),
    mirror("m5", 5, { state: "adopted", adopted_by: slugs["planArchived"] ?? "" }),
    mirror("m6", 6),
    mirror("m7", 7),
    mirror("m8", 8),
    mirror("m9", 9),
    mirror("m10", 10),
    mirror("m11", 11),
    mirror("m12", 12),
    mirror("m13", 13),
    mirror("mLocal", undefined, { state: "rejected", reason: "local noise" }),
    status(ids["m6"] ?? "", "archived"),
    status(ids["taskThree"] ?? "", "archived"),
    status(ids["taskTwo"] ?? "", "archived"),
    status(ids["planArchived"] ?? "", "archived"),
    status(ids["planResolver"] ?? "", "archived"),
    status(ids["spec"] ?? "", "approved"),
    link(ids["taskThree"] ?? "", ids["m8"] ?? "", "resolves"),
    link(ids["taskThree"] ?? "", ids["m9"] ?? "", "resolves"),
    link(ids["taskThree"] ?? "", ids["m10"] ?? "", "resolves"),
    link(ids["planResolver"] ?? "", ids["m11"] ?? "", "resolves"),
    link(ids["spec"] ?? "", ids["m12"] ?? "", "resolves"),
    link(ids["knowledge"] ?? "", ids["m13"] ?? "", "relates-to"),
    link(ids["taskTwo"] ?? "", ids["m2"] ?? "", "resolves"),
  ]);
  fixture.resetLog();
  return { fixture, ids, slugs };
}

const tableCount = (fixture: IssueFixture, table: string): number => (sql(fixture, `SELECT COUNT(*) AS c FROM ${table}`)[0]?.["c"] as number) ?? -1;
const snapshotCounts = (fixture: IssueFixture): Record<string, number> => ({
  ...fixture.counts(),
  links: tableCount(fixture, "links"),
});
const extraOf = (fixture: IssueFixture, id: string): Record<string, unknown> =>
  JSON.parse(String(sql(fixture, "SELECT extra FROM docs WHERE id = ?", id)[0]?.["extra"] ?? "{}")) as Record<string, unknown>;
const migrateComments = (fixture: IssueFixture, n: number): string[] => fixture.stateOf(n).comments.filter((body) => body.includes("<!-- lore-migrate:"));

describe(`${SPEC}#AC-GS-12 migration reaches its post-conditions losslessly and is idempotent`, () => {
  let seeded: Seeded;
  const SEED_TIMEOUT = 900_000;

  it(`${SPEC}#AC-GS-12 dry run exits 0, lists every mirror and link with its disposition, and writes nothing`, async () => {
    seeded = await seedFixture();
    const { fixture } = seeded;
    const before = snapshotCounts(fixture);
    const result = await fixture.run(["issues", "migrate", "--json"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const plan = (JSON.parse(result.stdout) as { data: { apply: boolean; mirrors: Array<{ slug: string; disposition: string; issue: { number: number } | null; links: Array<{ action: string }> }>; totals: { mirrors: number; links: number } } }).data;
    expect(plan.apply).toBe(false);
    expect(plan.totals).toMatchObject({ mirrors: 14, links: 7 });
    const dispositionOf = (key: string): string | undefined => plan.mirrors.find((m) => m.slug === seeded.slugs[key])?.disposition;
    expect(dispositionOf("m1")).toBe("retire:verdict-matches-github");
    expect(dispositionOf("m2")).toBe("retire:verdict-written-to-github");
    expect(dispositionOf("m3")).toBe("rehome");
    expect(dispositionOf("m4")).toBe("retire:adoption-dropped-closed");
    expect(dispositionOf("m5")).toBe("retire:adoption-dropped-owner");
    expect(dispositionOf("m6")).toBe("keep-as-carrier");
    expect(dispositionOf("m7")).toBe("retire:open-unadopted");
    expect(dispositionOf("m8")).toBe("retire:archived-resolver");
    expect(dispositionOf("m11")).toBe("retire:archived-resolver");
    expect(dispositionOf("m12")).toBe("retire:open-unadopted");
    expect(dispositionOf("m13")).toBe("retire:open-unadopted");
    expect(plan.mirrors.find((m) => m.slug === seeded.slugs["mLocal"])).toMatchObject({ issue: null, disposition: "retire:verdict-written-to-github" });
    expect(plan.mirrors.find((m) => m.slug === seeded.slugs["m12"])?.links.map((l) => l.action)).toEqual(["comment"]);
    expect(plan.mirrors.find((m) => m.slug === seeded.slugs["m8"])?.links.map((l) => l.action)).toEqual(["stamp"]);

    expect(snapshotCounts(fixture)).toEqual(before);
    expect(fixture.writes()).toEqual([]);
  }, SEED_TIMEOUT);

  it(`${SPEC}#AC-GS-12 apply exits 0 and every post-condition holds with its meaning kept`, async () => {
    const { fixture, ids, slugs } = seeded;
    const result = await fixture.run(["issues", "migrate", "--apply"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("14 of 14 migrated");

    // zero-ness
    expect(sql(fixture, `SELECT COUNT(*) AS c FROM docs WHERE deleted_at IS NULL AND extra LIKE '%"issue_report"%'`)[0]?.["c"]).toBe(0);
    expect(sql(fixture, "SELECT COUNT(*) AS c FROM links WHERE link_type = 'resolves'")[0]?.["c"]).toBe(0);

    // meaning: per-carrier refs
    const ref = (number: number): { repo_id: number; number: number } => ({ repo_id: STUB_REPO_ID, number });
    expect(extraOf(fixture, ids["taskThree"] ?? "")["issues"]).toEqual([ref(8), ref(9), ref(10)]);
    expect(extraOf(fixture, ids["planResolver"] ?? "")["issues"]).toEqual([ref(11)]);
    expect(extraOf(fixture, ids["taskTwo"] ?? "")["issues"]).toEqual([ref(2)]);
    expect(extraOf(fixture, ids["planArchived"] ?? "")["issues"]).toBeUndefined();

    // meaning: the live-plan adoption is re-homed (same slug, plan membership, one ref, no mirror payload)
    const rehomed = sql(fixture, "SELECT slug, parent_id, deleted_at FROM docs WHERE id = ?", ids["m3"] ?? "")[0];
    expect(rehomed?.["slug"]).toBe(slugs["m3"]);
    expect(rehomed?.["deleted_at"]).toBeNull();
    expect(rehomed?.["parent_id"]).toBe(ids["planLive"]);
    const rehomedExtra = extraOf(fixture, ids["m3"] ?? "");
    expect(rehomedExtra["plan_id"]).toBe(ids["planLive"]);
    expect(rehomedExtra["issues"]).toEqual([ref(3)]);
    expect(rehomedExtra["issue_report"]).toBeUndefined();
    expect(rehomedExtra["adhoc"]).toBeUndefined();
    // the archived mirror stays, as a carrier
    expect(extraOf(fixture, ids["m6"] ?? "")["issues"]).toEqual([ref(6)]);
    expect(sql(fixture, "SELECT deleted_at FROM docs WHERE id = ?", ids["m6"] ?? "")[0]?.["deleted_at"]).toBeNull();

    // exactly one issue_mirror_retired audit row per retired mirror (every mirror but #3 and #6)
    const retiredKeys = ["m1", "m2", "m4", "m5", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "mLocal"];
    for (const key of retiredKeys) {
      expect(sql(fixture, "SELECT COUNT(*) AS c FROM audit WHERE action = 'issue_mirror_retired' AND doc_id = ?", ids[key] ?? "")[0]?.["c"], key).toBe(1);
      expect(sql(fixture, "SELECT deleted_at FROM docs WHERE id = ?", ids[key] ?? "")[0]?.["deleted_at"], key).not.toBeNull();
    }
    expect(sql(fixture, "SELECT COUNT(*) AS c FROM audit WHERE action = 'issue_mirror_retired'")[0]?.["c"]).toBe(retiredKeys.length);

    // meaning: the spec and knowledge links became exactly one comment each
    expect(migrateComments(fixture, 12)).toHaveLength(1);
    expect(migrateComments(fixture, 12)[0]).toContain(`Addressed by spec ${slugs["spec"]}`);
    expect(migrateComments(fixture, 13)).toHaveLength(1);
    expect(migrateComments(fixture, 13)[0]).toContain(`Referenced by knowledge ${slugs["knowledge"]}`);
    expect(migrateComments(fixture, 13)[0]).toContain("as relates-to");

    // GitHub: the unwritten verdict landed, the fixed issues closed, the retired label is gone
    expect(fixture.stateOf(2)).toMatchObject({ state: "closed", reason: "not_planned", labels: ["resolution:wontfix"] });
    for (const n of [6, 8, 9, 10, 11]) expect(fixture.stateOf(n), `#${n}`).toMatchObject({ state: "closed", reason: "completed", labels: ["resolution:fixed"] });
    expect(fixture.stateOf(3).labels).toEqual([]);
    expect(fixture.stateOf(12).state).toBe("open");

    // the local-only report: one create call, then a not_planned close of the NEW issue
    const writes = fixture.writes();
    const create = writes.findIndex((argv) => argv[1] === "repos/acme/widget/issues" && argv.includes("POST"));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(writes.filter((argv) => argv[1] === "repos/acme/widget/issues" && argv.includes("POST"))).toHaveLength(1);
    const closeNew = writes.findIndex((argv) => argv[1] === "repos/acme/widget/issues/14" && argv.includes("PATCH") && argv.includes("state_reason=not_planned"));
    expect(closeNew).toBeGreaterThan(create);
    expect(fixture.stateOf(14)).toMatchObject({ state: "closed", reason: "not_planned" });
  }, SEED_TIMEOUT);

  it(`${SPEC}#AC-GS-12 a second apply exits 0 with zero gh writes and zero corpus writes`, async () => {
    const { fixture } = seeded;
    const before = snapshotCounts(fixture);
    fixture.resetLog();
    const result = await fixture.run(["issues", "migrate", "--apply"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("0 of 0 migrated");
    expect(fixture.writes()).toEqual([]);
    expect(snapshotCounts(fixture)).toEqual(before);
  }, SEED_TIMEOUT);
});

describe(`${SPEC}#AC-GS-13 a GitHub failure leaves the mirror intact and the run resumable`, () => {
  let seeded: Seeded;
  const SEED_TIMEOUT = 900_000;

  it(`${SPEC}#AC-GS-13 with gh offline before any call, apply exits exactly 9 and no corpus row moves`, async () => {
    seeded = await seedFixture();
    const { fixture } = seeded;
    const ghPath = join(fixture.stubDir, "gh");
    const healthy = readFileSync(ghPath, "utf8");
    writeFileSync(ghPath, `#!/bin/sh\necho "error connecting to api.github.com: could not resolve host: api.github.com" >&2\nexit 1\n`);
    const before = snapshotCounts(fixture);
    try {
      const result = await fixture.run(["issues", "migrate", "--apply"]);
      expect(result.exitCode, result.stderr + result.stdout).toBe(9);
      expect(snapshotCounts(fixture)).toEqual(before);
    } finally {
      writeFileSync(ghPath, healthy);
    }
  }, SEED_TIMEOUT);

  it(`${SPEC}#AC-GS-13 a failed close exits exactly 9 with 'N of M migrated' (N == M-1) and leaves that mirror, its link and its version untouched`, async () => {
    const { fixture, ids } = seeded;
    const mirrorBefore = sql(fixture, "SELECT version, extra FROM docs WHERE id = ?", ids["m2"] ?? "")[0];
    const carrierVersionBefore = sql(fixture, "SELECT version FROM docs WHERE id = ?", ids["taskTwo"] ?? "")[0]?.["version"];
    writeFileSync(join(fixture.stubDir, "fail-patch-2"), "1");
    const result = await fixture.run(["issues", "migrate", "--apply"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(9);
    const summary = /(\d+) of (\d+) migrated/.exec(result.stdout);
    expect(summary, result.stdout).not.toBeNull();
    expect(Number(summary?.[1])).toBe(Number(summary?.[2]) - 1);
    expect(Number(summary?.[2])).toBe(14);

    // the mirror is still there, unchanged, and its inbound link and carrier were not touched
    const mirrorAfter = sql(fixture, "SELECT version, extra, deleted_at FROM docs WHERE id = ?", ids["m2"] ?? "")[0];
    expect(mirrorAfter?.["deleted_at"]).toBeNull();
    expect(mirrorAfter?.["version"]).toBe(mirrorBefore?.["version"]);
    expect(mirrorAfter?.["extra"]).toBe(mirrorBefore?.["extra"]);
    expect(sql(fixture, "SELECT COUNT(*) AS c FROM links WHERE from_id = ? AND to_id = ? AND link_type = 'resolves'", ids["taskTwo"] ?? "", ids["m2"] ?? "")[0]?.["c"]).toBe(1);
    expect(sql(fixture, "SELECT version FROM docs WHERE id = ?", ids["taskTwo"] ?? "")[0]?.["version"]).toBe(carrierVersionBefore);
    expect(extraOf(fixture, ids["taskTwo"] ?? "")["issues"]).toBeUndefined();
    expect(sql(fixture, "SELECT COUNT(*) AS c FROM audit WHERE action = 'issue_mirror_retired' AND doc_id = ?", ids["m2"] ?? "")[0]?.["c"]).toBe(0);

    // every OTHER mirror is migrated
    const stillMirrors = sql(fixture, `SELECT id FROM docs WHERE deleted_at IS NULL AND extra LIKE '%"issue_report"%'`).map((row) => row["id"]);
    expect(stillMirrors).toEqual([ids["m2"]]);
    expect(fixture.stateOf(2).state).toBe("open");
  }, SEED_TIMEOUT);

  it(`${SPEC}#AC-GS-13 a rerun with a healthy stub exits 0 and posts no second comment for that issue`, async () => {
    const { fixture, ids } = seeded;
    rmSync(join(fixture.stubDir, "fail-patch-2"), { force: true });
    const result = await fixture.run(["issues", "migrate", "--apply"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("1 of 1 migrated");
    expect(migrateComments(fixture, 2)).toHaveLength(1);
    expect(fixture.stateOf(2)).toMatchObject({ state: "closed", reason: "not_planned" });
    expect(sql(fixture, "SELECT COUNT(*) AS c FROM audit WHERE action = 'issue_mirror_retired' AND doc_id = ?", ids["m2"] ?? "")[0]?.["c"]).toBe(1);
    expect(extraOf(fixture, ids["taskTwo"] ?? "")["issues"]).toEqual([{ repo_id: STUB_REPO_ID, number: 2 }]);
    expect(sql(fixture, "SELECT COUNT(*) AS c FROM links WHERE link_type = 'resolves'")[0]?.["c"]).toBe(0);
  }, SEED_TIMEOUT);
});
