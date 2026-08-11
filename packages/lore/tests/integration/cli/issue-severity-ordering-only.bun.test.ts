/**
 * AC-DC-7 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M6) —
 * `--severity` / `--category` on `lore report-issue` are ORDERING ONLY: they
 * round-trip into `extra.issue_report`, appear on BOTH read surfaces (a rendered
 * column plus a `--json` key), and provably change NO admission decision.
 *
 * ## Why the negative half is the important half
 *
 * Severity is SELF-DECLARED by the filer. If it bucketed, exempted, or evicted
 * quota, the ceiling would be under the control of the party it constrains —
 * the same reason §M2 sites the cap on the upstream side. A suite that only
 * proved "the flag round-trips" would go green against an implementation where
 * `severity=critical` bypassed the cap entirely, which is the failure mode worth
 * an oracle. So the suite drives a quota filled ENTIRELY with
 * `severity=critical` and asserts a further critical report is still refused,
 * plus the mirror case (a `low` report is refused by that same full quota, so
 * severity does not bucket in either direction).
 *
 * ## The inert-flag trap
 *
 * `adapters/cli/strict-flags.ts` already refused `--severity` with exit 2 BEFORE
 * this mechanism existed, so an exit-code-only oracle over the NEGATIVE case
 * ("a bogus severity is refused") would have been green with zero
 * implementation. Every refusal assertion here therefore also asserts the
 * refusal is NOT citty's unknown-option wording, and names the offending value.
 *
 * ⛔ Throwaway `mkdtempSync` corpora under `os.tmpdir()` only — NEVER this repo's
 * own `.lore/`. Spawns the COMPILED `dist/lore` from THIS worktree, rebuilt once
 * in `beforeAll`. The upstream declares `feedback.inbound.open_report_cap: 3` so
 * the quota cases cost 4 spawns instead of 11.
 *
 * Six-dimension coverage:
 *   HAPPY:      `--severity critical --category correctness` round-trips into the
 *               upstream doc's `extra.issue_report` and shows up on BOTH read
 *               surfaces (`--json` key AND a rendered column header + value)
 *   NEGATIVE:   a quota filled entirely with `severity=critical` still refuses a
 *               further critical report (exit 4, naming the operative cap), and
 *               refuses a `low` one too — admission is severity-blind both ways
 *   BOUNDARY:   a report filed with NEITHER flag carries NEITHER key on either
 *               surface — an absent label is an honest NOT DECLARED, never a
 *               fabricated default severity
 *   ERROR:      `--severity bogus` is refused LOUDLY naming the valid values, is
 *               NOT the unknown-option refusal, and files NOTHING (the upstream
 *               report count is byte-identical afterwards)
 *   STATE:      resolving one of the three critical reports frees a slot, so a
 *               4th critical report is then ACCEPTED — quota is keyed on
 *               computed resolution, never on severity
 *   REGRESSION: `--severity`/`--category` combined with `--list` is a usage error
 *               (exit 2), same mutex the other report-filing flags already carry
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M6, AC-DC-7;
 *   task-both-issue-read-surfaces-name-the-corpus-they-read-issues.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  buildDistLoreOnce,
  cleanFixtures,
  fileReport,
  makeTwin,
  run,
  runJson,
  tryFileReport,
} from "./issue-read-surfaces.shared.js";

/** The upstream-declared ceiling every quota case in this suite runs against. */
const DECLARED_CAP = 3;

/** See the AC-DC-6 suite: TWO independent lone tokens, never one remembered phrase. */
const UNKNOWN_OPTION_TOKENS = [/[Uu]nknown/, /option|flag/];

function assertNotUnknownOption(stderr: string): void {
  expect(UNKNOWN_OPTION_TOKENS.every((token) => token.test(stderr))).toBe(false);
}

interface IssuesJson {
  ok: true;
  data: {
    corpus_path: string;
    total: number;
    reports: Array<{ id: string; severity?: string; category?: string }>;
  };
}

interface ListJson {
  ok: true;
  data: {
    corpus_path: string;
    rows: Array<{ upstream_doc_id: string; severity?: string; category?: string }>;
  };
}

interface GetJson {
  ok: true;
  data: { doc: { extra: { issue_report?: { severity?: string; category?: string } } } };
}

beforeAll(() => {
  buildDistLoreOnce();
}, 300_000);

afterAll(() => {
  cleanFixtures();
});

describe("AC-DC-7: severity/category are visible on both reads and change no admission decision", () => {
  it("HAPPY: --severity/--category round-trip into extra.issue_report and appear on BOTH read surfaces (json key + rendered column)", () => {
    const { upstream, consumerRoot } = makeTwin("sev-roundtrip", { upstreamCap: DECLARED_CAP });
    const id = fileReport(consumerRoot, "sev roundtrip report", {
      severity: "critical",
      category: "correctness",
    });

    // (a) the value landed in the UPSTREAM doc's own extra.issue_report — the
    //     round-trip's storage half, read straight off the upstream corpus.
    const doc = runJson<GetJson>(["get", id], { cwd: upstream.root });
    expect(doc.result.exitCode).toBe(0);
    expect(doc.data.data.doc.extra.issue_report?.severity).toBe("critical");
    expect(doc.data.data.doc.extra.issue_report?.category).toBe("correctness");

    // (b) read surface one: lore issues
    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    const issuesRow = issues.data.data.reports.find((r) => r.id === id);
    expect(issuesRow?.severity).toBe("critical");
    expect(issuesRow?.category).toBe("correctness");

    // (c) read surface two: lore report-issue --list
    const list = runJson<ListJson>(["report-issue", "--list"], { cwd: consumerRoot });
    const listRow = list.data.data.rows.find((r) => r.upstream_doc_id === id);
    expect(listRow?.severity).toBe("critical");
    expect(listRow?.category).toBe("correctness");

    // (d) a RENDERED COLUMN on both human surfaces — a --json-only field would
    //     satisfy "present in --json" while leaving the human read blind.
    const issuesHuman = run(["issues", "--all"], { cwd: consumerRoot });
    expect(issuesHuman.stdout).toContain("Severity");
    expect(issuesHuman.stdout).toContain("Category");
    expect(issuesHuman.stdout).toContain("critical");
    expect(issuesHuman.stdout).toContain("correctness");

    const listHuman = run(["report-issue", "--list"], { cwd: consumerRoot });
    expect(listHuman.stdout).toContain("Severity");
    expect(listHuman.stdout).toContain("Category");
    expect(listHuman.stdout).toContain("critical");
    expect(listHuman.stdout).toContain("correctness");
  }, 300_000);

  it("NEGATIVE: a quota filled entirely with severity=critical still refuses a further critical report — and a low one too", () => {
    const { consumerRoot } = makeTwin("sev-quota", { upstreamCap: DECLARED_CAP });
    const criticalIds: string[] = [];
    for (let i = 1; i <= DECLARED_CAP; i += 1) {
      criticalIds.push(
        fileReport(consumerRoot, `sev-quota critical ${i}`, { severity: "critical", category: "correctness" }),
      );
    }
    expect(criticalIds.length).toBe(DECLARED_CAP);

    // Another `critical` does NOT jump the queue, exempt itself, or evict a peer.
    const refusedCritical = tryFileReport(consumerRoot, "sev-quota critical overflow", {
      severity: "critical",
      category: "correctness",
    });
    expect(refusedCritical.exitCode).toBe(4);
    assertNotUnknownOption(refusedCritical.stderr);
    expect(refusedCritical.stderr).toContain(`cap ${DECLARED_CAP}`);
    for (const id of criticalIds) expect(refusedCritical.stderr).toContain(id);

    // …and the mirror: a `low` report is refused by that same full quota, so
    // severity does not bucket in EITHER direction.
    const refusedLow = tryFileReport(consumerRoot, "sev-quota low overflow", { severity: "low" });
    expect(refusedLow.exitCode).toBe(4);
    assertNotUnknownOption(refusedLow.stderr);
    expect(refusedLow.stderr).toContain(`cap ${DECLARED_CAP}`);

    // …and one with NO severity at all is refused identically.
    const refusedUnlabelled = tryFileReport(consumerRoot, "sev-quota unlabelled overflow");
    expect(refusedUnlabelled.exitCode).toBe(4);
    expect(refusedUnlabelled.stderr).toContain(`cap ${DECLARED_CAP}`);
  }, 300_000);

  it("STATE: resolving one critical report frees a slot — quota is keyed on computed resolution, never on severity", () => {
    const { upstream, consumerRoot } = makeTwin("sev-release", { upstreamCap: DECLARED_CAP });
    const criticalIds: string[] = [];
    for (let i = 1; i <= DECLARED_CAP; i += 1) {
      criticalIds.push(fileReport(consumerRoot, `sev-release critical ${i}`, { severity: "critical" }));
    }
    expect(tryFileReport(consumerRoot, "sev-release blocked", { severity: "critical" }).exitCode).toBe(4);

    const resolved = run(
      [
        "issue",
        "resolve",
        criticalIds[0] as string,
        "--state",
        "wontfix",
        "--reason",
        "self-declared critical, not a lore defect",
        "--by",
        "agent:m6-maintainer",
      ],
      { cwd: upstream.root },
    );
    expect(resolved.exitCode).toBe(0);

    const accepted = tryFileReport(consumerRoot, "sev-release critical after release", { severity: "critical" });
    expect(accepted.exitCode).toBe(0);
  }, 300_000);

  it("BOUNDARY: a report filed with NEITHER flag carries NEITHER key on either surface — never a fabricated default", () => {
    const { consumerRoot } = makeTwin("sev-absent", { upstreamCap: DECLARED_CAP });
    const id = fileReport(consumerRoot, "sev-absent unlabelled report");

    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    const issuesRow = issues.data.data.reports.find((r) => r.id === id);
    expect(issuesRow).toBeDefined();
    expect(issuesRow?.severity).toBeUndefined();
    expect(issuesRow?.category).toBeUndefined();

    const list = runJson<ListJson>(["report-issue", "--list"], { cwd: consumerRoot });
    const listRow = list.data.data.rows.find((r) => r.upstream_doc_id === id);
    expect(listRow).toBeDefined();
    expect(listRow?.severity).toBeUndefined();
    expect(listRow?.category).toBeUndefined();
  }, 300_000);

  it("ERROR: --severity bogus is refused LOUDLY naming the valid values, is not the unknown-option refusal, and files NOTHING", () => {
    const { consumerRoot } = makeTwin("sev-bogus", { upstreamCap: DECLARED_CAP });

    const before = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    expect(before.data.data.total).toBe(0);

    const refused = tryFileReport(consumerRoot, "sev-bogus report", { severity: "catastrophic" });
    expect(refused.exitCode).toBe(2);
    // ⛔ The discriminating half: strict-flags ALREADY exited 2 for `--severity`
    // before this mechanism existed, so the exit code alone proves nothing.
    assertNotUnknownOption(refused.stderr);
    expect(refused.stderr).toContain("catastrophic");
    expect(refused.stderr).toContain("critical");
    expect(refused.stderr).toContain("low");

    const after = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    expect(after.data.data.total).toBe(0);
  }, 300_000);

  it("REGRESSION: --severity/--category combined with --list is a usage error, same mutex the other report-filing flags carry", () => {
    const { consumerRoot } = makeTwin("sev-list-mutex", { upstreamCap: DECLARED_CAP });

    for (const flag of [
      ["--severity", "critical"],
      ["--category", "correctness"],
    ]) {
      const refused = run(["report-issue", "--list", ...flag], { cwd: consumerRoot });
      expect(refused.exitCode).toBe(2);
      assertNotUnknownOption(refused.stderr);
      expect(refused.stderr).toContain(flag[0] as string);
    }
  }, 300_000);
});
