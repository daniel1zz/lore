/**
 * AC-DC-7 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M6,
 * superseded by spec-the-defect-channel-reaches-no-machine-but-its-own-github)
 * — REWRITTEN, not retired (task-skill-test-retire-or-rewrite-the-severity-
 * vs-cap-cases). `--severity` / `--category` on `lore report-issue` are
 * ORDERING ONLY: they round-trip into `extra.issue_report`, appear on BOTH
 * read surfaces (a rendered column plus a `--json` key), and provably change
 * NO admission decision (packages/core/src/issue-report.ts: "ordering-only,
 * never changes whether a report is accepted").
 *
 * ⛔ WHY REWRITTEN, NOT RETIRED: this file's original NEGATIVE and STATE cases
 * exercised the open-report rate cap, which was deleted repo-wide in this same
 * plan (`task-skill-implement-delete-the-six-cap-symbols-and-retire-the`, 109
 * case-sensitive references). Those two cases asserted "a quota filled
 * entirely with severity=critical still refuses a further report" and
 * "resolving one report frees a slot" — with no quota, NEITHER claim is
 * merely failing, both are UNFALSIFIABLE: no implementation can make "the
 * cap refuses" or "resolving frees a cap slot" true when there is no cap.
 * Byte-identical disposition to `task-skill-test-retire-or-rewrite-ac-dc-17-
 * whose-subject-cap` (`issue-adopt-compiled.bun.test.ts`, rewrite chosen over
 * retire there for the same reason: this file is the only surface-level
 * (compiled-binary) coverage of the severity/admission claim — everything
 * else exercising `extra.issue_report.severity` is a pure-function unit test.
 * Retiring it outright would drop that production wiring to zero coverage).
 *
 * ## Why the negative half is the important half — what survives the cap
 *
 * Severity is SELF-DECLARED by the filer. Before the cap's removal, "severity
 * changes no admission decision" could only be shown INDIRECTLY: fill a quota
 * entirely with `severity=critical` and show a further report — critical or
 * not — still gets refused. With the cap gone, that property is provable
 * DIRECTLY and STRONGER than before: file a volume that would have
 * overflowed the OLD cap (declared at 3 in this suite's own upstream fixture,
 * kept declared below so the now-inert legacy config key is exercised, not
 * just absent) across MIXED severities, and every single filing succeeds.
 * No implementation could satisfy this while secretly re-introducing a
 * severity-keyed ceiling.
 *
 * ## The inert-flag trap
 *
 * `adapters/cli/strict-flags.ts` already refused `--severity` with exit 2 BEFORE
 * this mechanism existed, so an exit-code-only oracle over the ERROR case
 * ("a bogus severity is refused") would have been green with zero
 * implementation. Every refusal assertion here therefore also asserts the
 * refusal is NOT citty's unknown-option wording, and names the offending value.
 *
 * ⛔ Throwaway `mkdtempSync` corpora under `os.tmpdir()` only — NEVER this repo's
 * own `.lore/`. Spawns the COMPILED `dist/lore` from THIS worktree, rebuilt once
 * in `beforeAll`. The upstream still declares the legacy
 * `feedback.inbound.open_report_cap: 3` key (AC-GI-10: it must keep parsing
 * and warning by name, never be deleted) — every case below proves it is
 * provably INERT rather than merely absent.
 *
 * Six-dimension coverage:
 *   HAPPY:      `--severity critical --category correctness` round-trips into the
 *               upstream doc's `extra.issue_report` and shows up on BOTH read
 *               surfaces (`--json` key AND a rendered column header + value)
 *   NEGATIVE/STATE (rewritten — the refusal this asserted no longer exists):
 *               a volume PAST the old cap's declared ceiling, filed at mixed
 *               severities (critical, low, unlabelled), all succeed — severity
 *               buckets nothing, in either direction, at any volume
 *   BOUNDARY:   a report filed with NEITHER flag carries NEITHER key on either
 *               surface — an absent label is an honest NOT DECLARED, never a
 *               fabricated default severity
 *   ERROR:      `--severity bogus` is refused LOUDLY naming the valid values, is
 *               NOT the unknown-option refusal, and files NOTHING (the upstream
 *               report count is byte-identical afterwards)
 *   STATE (rewritten — the quota-freeing claim this asserted no longer exists):
 *               resolving a report has NO bearing on subsequent admission —
 *               filing succeeds both BEFORE and AFTER a resolution, at any
 *               severity, flipping the old "resolving is required to admit
 *               more" claim into "resolving is irrelevant to admission"
 *   REGRESSION: `--severity`/`--category` combined with `--list` is a usage error
 *               (exit 2), same mutex the other report-filing flags already carry
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github
 *   (supersedes spec-the-defect-channel-cannot-be-honestly-maintained-an §M6,
 *   AC-DC-7); task-both-issue-read-surfaces-name-the-corpus-they-read-issues;
 *   task-skill-test-retire-or-rewrite-the-severity-vs-cap-cases.
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

/**
 * The value declared under the LEGACY `feedback.inbound.open_report_cap` key
 * in this suite's upstream fixture. The key must keep parsing (AC-GI-10) —
 * this constant is no longer an active ceiling, it is the volume every
 * rewritten case below files PAST to prove the declared value has zero
 * effect on admission.
 */
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

  it("NEGATIVE/STATE (rewritten — the refusal this asserted no longer exists): a volume PAST the old cap's declared ceiling, at mixed severities, all succeed — severity buckets nothing in either direction", () => {
    const { consumerRoot } = makeTwin("sev-past-cap", { upstreamCap: DECLARED_CAP });
    const PAST_CAP_VOLUME = DECLARED_CAP + 2; // strictly more than the legacy declared value

    // Every one of these `fileReport` calls asserts exit 0 internally — a
    // single refusal anywhere in either loop throws and fails this case.
    const criticalIds: string[] = [];
    for (let i = 1; i <= PAST_CAP_VOLUME; i += 1) {
      criticalIds.push(
        fileReport(consumerRoot, `sev-past-cap critical ${i}`, { severity: "critical", category: "correctness" }),
      );
    }
    expect(criticalIds.length).toBe(PAST_CAP_VOLUME);

    // …and the mirror: a run of `low` reports, filed AFTER the critical run
    // already exceeded the legacy declared value, also all succeed — severity
    // does not bucket in EITHER direction, and accumulated volume of ONE
    // severity has no bearing on admission of another.
    const lowIds: string[] = [];
    for (let i = 1; i <= PAST_CAP_VOLUME; i += 1) {
      lowIds.push(fileReport(consumerRoot, `sev-past-cap low ${i}`, { severity: "low" }));
    }
    expect(lowIds.length).toBe(PAST_CAP_VOLUME);

    // …and one with NO severity at all, filed last, succeeds identically.
    const unlabelledId = fileReport(consumerRoot, "sev-past-cap unlabelled");

    const totalFiled = criticalIds.length + lowIds.length + 1;
    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    expect(issues.result.exitCode).toBe(0);
    expect(issues.data.data.total).toBe(totalFiled);

    const byId = new Map(issues.data.data.reports.map((r) => [r.id, r]));
    // Round-trip survives under volume too, not just the single-report HAPPY case.
    expect(byId.get(criticalIds[0] as string)?.severity).toBe("critical");
    expect(byId.get(criticalIds[criticalIds.length - 1] as string)?.severity).toBe("critical");
    expect(byId.get(lowIds[0] as string)?.severity).toBe("low");
    expect(byId.get(unlabelledId)?.severity).toBeUndefined();
  }, 300_000);

  it("STATE (rewritten — the quota-freeing claim this asserted no longer exists): resolving a report has no bearing on subsequent admission — filing succeeds before AND after a resolution, at any severity", () => {
    const { upstream, consumerRoot } = makeTwin("sev-resolve-noop", { upstreamCap: DECLARED_CAP });

    const beforeIds: string[] = [];
    for (let i = 1; i <= DECLARED_CAP; i += 1) {
      beforeIds.push(fileReport(consumerRoot, `sev-resolve-noop critical ${i}`, { severity: "critical" }));
    }

    // Filing PAST the legacy declared value succeeds with NOTHING resolved —
    // the old story required a resolution first; this flips that claim.
    const overflowBeforeResolve = fileReport(consumerRoot, "sev-resolve-noop critical overflow before resolve", {
      severity: "critical",
    });
    expect(typeof overflowBeforeResolve).toBe("string");

    const resolved = run(
      [
        "issue",
        "resolve",
        beforeIds[0] as string,
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

    // …and filing AFTER a resolution also succeeds, at a DIFFERENT severity —
    // resolving is neither required for, nor a gate on, subsequent admission.
    const afterResolve = fileReport(consumerRoot, "sev-resolve-noop low after resolve", { severity: "low" });
    expect(typeof afterResolve).toBe("string");
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
