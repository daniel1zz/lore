// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-5
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-6
 * @task task-skill-refactor-gs-t6-adopt-creates-a-carrier-task-resolve
 *
 * `lore issue resolve` writes ONLY GitHub (comment, close with state_reason, verdict label) and never the corpus;
 * `--state fixed` (reached only by archiving a carrier) and every non-verdict state are refused before GitHub is contacted.
 *
 * Oracle: the real command tree (`runLoreInProcess`) over a throwaway corpus (`mkdtemp` + `lore init`) and a STUB `gh`
 * first on PATH that logs every argv and never reaches GitHub (`helpers/gh-issue-stub.ts`).
 *
 * Six-dimension note:
 *   HAPPY      rejected on an open, carrier-less #5: exit 0; log = one comment POST (reason + marker), one PATCH
 *              closed/not_planned, label writes adding resolution:rejected and deleting the stray resolution:adopted.
 *   NEGATIVE   fixed / FIXED / adopted / closed: exit exactly 4, zero gh calls; blank reason: 4; a draft carrier naming
 *              #9: exit 4 naming its slug, no write.
 *   BOUNDARY   #11 on page 2 of a 2-page listing resolves; duplicate closes with state_reason duplicate (--of validated).
 *   ERROR      PATCH fails as a network error after the comment: exit exactly 9, stdout `comment: posted` + `close: failed`.
 *   STATE      re-running posts no second comment (marker) and exits 0; the corpus docs/versions/audit counts never move.
 *   REGRESSION red-once mutations: moving the state check after the listing read (AC-GS-5); re-adding a corpus write (AC-GS-6).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanDirs, makeIssueFixture, type IssueFixture } from "../../helpers/gh-issue-stub";
import { patchLoreConfig } from "../../helpers/patch-lore-config";
import { createCarrierSpec, landCarrierAndDone } from "../support/issue-carrier";
import { FIXTURE_DONE_CONTRACT_CONFIG } from "../support/land-task";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";
const dirsToClean: string[] = [];
afterAll(() => cleanDirs(dirsToClean));

const FOUR = "rejected, wontfix, superseded, duplicate";

describe(`${SPEC}#AC-GS-5 fixed is refused before GitHub is contacted`, () => {
  let fixture: IssueFixture;
  beforeAll(async () => {
    fixture = await makeIssueFixture([{ number: 5 }], { dirsToClean });
  }, 120_000);

  it(`${SPEC}#AC-GS-5 --state fixed exits exactly 4 naming archive and --issue, with zero gh calls`, async () => {
    const result = await fixture.run(["issue", "resolve", "5", "--state", "fixed", "--reason", "x"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(4);
    expect(result.stderr).toContain("archive");
    expect(result.stderr).toContain("--issue");
    expect(fixture.ghCalls()).toEqual([]);
  }, 60_000);

  it(`${SPEC}#AC-GS-5 FIXED, adopted and closed each exit exactly 4 listing the four valid verdicts, with zero gh calls`, async () => {
    for (const state of ["FIXED", "adopted", "closed"]) {
      const result = await fixture.run(["issue", "resolve", "5", "--state", state, "--reason", "x"]);
      expect(result.exitCode, `${state}: ${result.stderr}`).toBe(4);
      expect(result.stderr, state).toContain(FOUR);
    }
    expect(fixture.ghCalls()).toEqual([]);
  }, 60_000);
});

describe(`${SPEC}#AC-GS-6 resolve writes only GitHub, idempotent, exit kind on partial failure`, () => {
  let fixture: IssueFixture;
  const countsBefore = { docs: 0, versions: 0, audit: 0 };
  let carrierSlug = "";

  // init + prd + a carrier task create + reads: an explicit timeout, never the 10s default.
  beforeAll(async () => {
    fixture = await makeIssueFixture(
      [
        { number: 5, labels: ["resolution:adopted"] },
        { number: 6 },
        { number: 7 },
        { number: 9 },
        { number: 10 },
        { number: 11 },
      ],
      { dirsToClean, pageSize: 5 },
    );
    const created = await fixture.run(["create", "task", "--kind", "code", "--adhoc", "--ac-scope", "", "--title", "Carrier of nine", "--no-ai", "--content", "Carrier.", "--issue", "9", "--json"], "setup");
    expect(created.exitCode, created.stderr).toBe(0);
    carrierSlug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
    Object.assign(countsBefore, fixture.counts());
    fixture.resetLog();
  }, 240_000);

  it(`${SPEC}#AC-GS-6 rejected: one comment, one PATCH not_planned, the verdict label; the corpus is untouched`, async () => {
    const result = await fixture.run(["issue", "resolve", "5", "--state", "rejected", "--reason", "not a defect"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);

    const writes = fixture.writes();
    const comment = writes.findIndex((argv) => argv[1]?.endsWith("/issues/5/comments"));
    const patch = writes.findIndex((argv) => argv.includes("PATCH"));
    const labelPost = writes.findIndex((argv) => argv.includes("labels[]=resolution:rejected"));
    const labelDelete = writes.findIndex((argv) => argv[1]?.includes("/labels/resolution%3Aadopted") && argv.includes("DELETE"));
    expect(comment).toBe(0);
    expect(patch).toBeGreaterThan(comment);
    expect(labelDelete).toBeGreaterThan(patch);
    expect(labelPost).toBeGreaterThan(patch);
    expect(writes.filter((argv) => argv.includes("POST") && argv[1]?.endsWith("/comments"))).toHaveLength(1);
    expect(writes[comment]?.some((a) => a.startsWith("body=") && a.includes("not a defect") && a.includes("<!-- lore-resolve:rejected -->"))).toBe(true);
    expect(writes[patch]).toEqual(expect.arrayContaining(["state=closed", "state_reason=not_planned"]));

    const after = fixture.stateOf(5);
    expect(after.state).toBe("closed");
    expect(after.reason).toBe("not_planned");
    expect(after.labels).toEqual(["resolution:rejected"]);
    expect(fixture.counts()).toEqual(countsBefore);
  }, 120_000);

  it(`${SPEC}#AC-GS-6 re-running posts no second comment and exits 0`, async () => {
    fixture.resetLog();
    const result = await fixture.run(["issue", "resolve", "5", "--state", "rejected", "--reason", "not a defect"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("comment: already present");
    expect(fixture.stateOf(5).comments).toHaveLength(1);
    expect(fixture.writes()).toEqual([]);
    expect(fixture.counts()).toEqual(countsBefore);
  }, 120_000);

  it(`${SPEC}#AC-GS-6 a PATCH network failure after the comment exits exactly 9 naming both steps; a re-run finishes without re-commenting`, async () => {
    fixture.resetLog();
    const { writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(fixture.stubDir, "fail-patch-6"), "1");
    try {
      const failed = await fixture.run(["issue", "resolve", "6", "--state", "wontfix", "--reason", "out of scope"]);
      expect(failed.exitCode, failed.stderr + failed.stdout).toBe(9);
      expect(failed.stdout).toContain("comment: posted");
      expect(failed.stdout).toContain("close: failed");
      expect(fixture.stateOf(6).state).toBe("open");
    } finally {
      rmSync(join(fixture.stubDir, "fail-patch-6"));
    }
    const retried = await fixture.run(["issue", "resolve", "6", "--state", "wontfix", "--reason", "out of scope"]);
    expect(retried.exitCode, retried.stderr + retried.stdout).toBe(0);
    expect(retried.stdout).toContain("comment: already present");
    expect(fixture.stateOf(6).comments).toHaveLength(1);
    expect(fixture.stateOf(6).state).toBe("closed");
    expect(fixture.counts()).toEqual(countsBefore);
  }, 120_000);

  it(`${SPEC}#AC-GS-6 an issue a draft carrier names exits 4 naming that slug and writes nothing`, async () => {
    fixture.resetLog();
    const result = await fixture.run(["issue", "resolve", "9", "--state", "rejected", "--reason", "nope"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(4);
    expect(result.stderr).toContain(carrierSlug);
    expect(fixture.writes()).toEqual([]);
    expect(fixture.stateOf(9).state).toBe("open");
  }, 120_000);

  it(`${SPEC}#AC-GS-6 a blank --reason exits exactly 4 and contacts nothing`, async () => {
    fixture.resetLog();
    for (const reason of ["", "   "]) {
      const result = await fixture.run(["issue", "resolve", "7", "--state", "rejected", "--reason", reason]);
      expect(result.exitCode, result.stderr).toBe(4);
    }
    expect(fixture.ghCalls()).toEqual([]);
  }, 60_000);

  it(`${SPEC}#AC-GS-6 duplicate (issue on page 2) closes with state_reason duplicate and names the original; --of must be a listed issue`, async () => {
    fixture.resetLog();
    const bad = await fixture.run(["issue", "resolve", "11", "--state", "duplicate", "--reason", "same", "--of", "999"]);
    expect(bad.exitCode, bad.stderr).toBe(4);
    expect(fixture.writes()).toEqual([]);

    const result = await fixture.run(["issue", "resolve", "11", "--state", "duplicate", "--reason", "same", "--of", "10"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const after = fixture.stateOf(11);
    expect(after.state).toBe("closed");
    expect(after.reason).toBe("duplicate");
    expect(after.labels).toEqual(["resolution:duplicate"]);
    expect(after.comments[0]).toContain("Duplicate of #10");
    expect(fixture.counts()).toEqual(countsBefore);
  }, 120_000);
});

// ─── AC-IL-9 / AC-IL-10: pointer rules and the fixed refusal (BR-1457, BR-1458) ───

describe("AC-IL-9 pointers are validated before any GitHub write", () => {
  let fixture: IssueFixture;
  let prdSlug = "";

  beforeAll(async () => {
    fixture = await makeIssueFixture([{ number: 5 }, { number: 6 }, { number: 7 }, { number: 8 }], { dirsToClean });
    const listed = await fixture.run(["list", "--type", "prd", "--json"], "setup");
    expect(listed.exitCode, listed.stderr).toBe(0);
    const data = (JSON.parse(listed.stdout) as { data: { docs?: { slug: string }[] } | { slug: string }[] }).data;
    prdSlug = (Array.isArray(data) ? data : (data.docs ?? []))[0]?.slug ?? "";
    expect(prdSlug).not.toBe("");
    fixture.resetLog();
  }, 240_000);

  it("AC-IL-9 each invalid pointer exits exactly 4 and writes nothing to GitHub", async () => {
    const cases: readonly (readonly string[])[] = [
      ["--state", "rejected", "--of", "6"], // --of under a non-duplicate verdict
      ["--state", "duplicate", "--of", "5"], // --of naming the issue itself
      ["--state", "duplicate", "--of", "999"], // --of naming an unlisted issue
      ["--state", "rejected", "--superseded-by", "6"], // --superseded-by under a non-superseded verdict
      ["--state", "superseded", "--superseded-by", "5"], // --superseded-by naming the issue itself
      ["--state", "superseded", "--superseded-by", "no-such-document-anywhere"], // naming nothing resolvable
    ];
    for (const flags of cases) {
      fixture.resetLog();
      const result = await fixture.run(["issue", "resolve", "5", "--reason", "r", ...flags]);
      expect(result.exitCode, `${flags.join(" ")}: ${result.stderr}${result.stdout}`).toBe(4);
      expect(fixture.writes(), flags.join(" ")).toEqual([]);
    }
    expect(fixture.stateOf(5).state).toBe("open");
  }, 240_000);

  it("AC-IL-9 --superseded-by a listed issue closes the issue with a comment naming the pointer", async () => {
    const result = await fixture.run(["issue", "resolve", "6", "--state", "superseded", "--reason", "replaced", "--superseded-by", "7"]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const after = fixture.stateOf(6);
    expect(after.state).toBe("closed");
    expect(after.comments[0]).toContain("Superseded by #7");
  }, 120_000);

  it("AC-IL-9 --superseded-by a corpus document closes the issue with a comment naming the document", async () => {
    const result = await fixture.run(["issue", "resolve", "8", "--state", "superseded", "--reason", "replaced", "--superseded-by", prdSlug]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const after = fixture.stateOf(8);
    expect(after.state).toBe("closed");
    expect(after.comments[0]).toContain(`Superseded by ${prdSlug}`);
  }, 120_000);
});

describe("AC-IL-10 an issue whose naming work is archived is not given a verdict", () => {
  const PENDING = 31;
  const FIXED = 32;
  let fixture: IssueFixture;
  const slugs: Record<number, string> = {};

  beforeAll(async () => {
    fixture = await makeIssueFixture([{ number: PENDING }, { number: FIXED }], { dirsToClean });
    // reason: approve compiles each carrier's done contract from these commands (a code task needs all three)
    patchLoreConfig(fixture.dir, { workflow: { done_contract: { ...FIXTURE_DONE_CONTRACT_CONFIG } } });
    const world = { dir: fixture.dir, run: (args: readonly string[], session: string) => fixture.run([...args], session) };
    const spec = await createCarrierSpec(world);
    for (const n of [PENDING, FIXED]) {
      const created = await fixture.run(["create", "task", "--kind", "code", "--adhoc", "--spec", spec, "--ac-scope", "", "--title", `Carrier of ${n}`, "--no-ai", "--content", "Carrier.", "--issue", String(n), "--json"], "setup");
      expect(created.exitCode, created.stderr + created.stdout).toBe(0);
      const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
      slugs[n] = slug;
      // The close of PENDING is made to fail, so it stays open with archived work; FIXED is closed as completed by the archive.
      if (n === PENDING) writeFileSync(join(fixture.stubDir, `fail-patch-${n}`), "1");
      // the carrier is approved, claimed on a branch, landed and holds its contract passes, then `lore done` archives it (the retired
      // route captured one pass and ran `lore done --declare-no-new-tests`)
      const done = await landCarrierAndDone(world, slug, dirsToClean, "setup");
      expect(done.exitCode, done.stderr + done.stdout).toBe(0);
      rmSync(join(fixture.stubDir, `fail-patch-${n}`), { force: true });
    }
    expect(fixture.stateOf(PENDING).state).toBe("open");
    expect(fixture.stateOf(FIXED).state).toBe("closed");
    fixture.resetLog();
  }, 300_000);

  it("AC-IL-10 resolve --state rejected on a fixed (close pending) and on a fixed issue each exit exactly 4 naming the task, with no GitHub write", async () => {
    for (const n of [PENDING, FIXED]) {
      fixture.resetLog();
      const result = await fixture.run(["issue", "resolve", String(n), "--state", "rejected", "--reason", "r"]);
      expect(result.exitCode, `#${n}: ${result.stderr}${result.stdout}`).toBe(4);
      expect(result.stderr, `#${n}`).toContain(slugs[n]);
      expect(fixture.writes(), `#${n}`).toEqual([]);
    }
  }, 120_000);
});
