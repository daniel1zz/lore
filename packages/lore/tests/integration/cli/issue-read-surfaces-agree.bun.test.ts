/**
 * AC-DC-5 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M4) — the
 * two issue read surfaces read the SAME corpus and each NAMES it.
 *
 * ## The measured defect this suite pins
 *
 * On 2026-08-11, in a consumer project, at the same instant and in the same cwd:
 * `lore issues --all` printed `(no all issue reports)`, `lore issues --open
 * --json` printed `total: 0`, while `lore report-issue --list` printed 12 rows
 * (10 open / 2 closed). Reproduced here before the fix (3 filed reports; `issues
 * --all` → 0 rows, `report-issue --list` → 3 rows). Root cause: `commands/issues.ts`
 * read the corpus discovered from cwd — correct only UPSTREAM-side — while
 * `--list` read the local receipt ledger joined against the CONFIGURED upstream.
 * Both help strings claim to be about upstream reports, so the command an agent
 * is steered toward reported `0`, which reads as "the queue is empty, file freely".
 *
 * ## What makes this suite discriminating
 *
 * 1. **SET EQUALITY of doc ids, not non-emptiness.** A stub returning garbage
 *    ids, or a surface returning a SUBSET, fails. Both directions are asserted
 *    via a sorted-array comparison, plus an explicit size precondition — a pair
 *    of empty sets is "equal" and would otherwise pass vacuously.
 * 2. **POSITION-anchored corpus naming.** The declared render contract is "the
 *    human output's FIRST line matches the fixed prefix `Corpus: ` followed by
 *    the corpus's absolute path". Every assertion keys on `firstLine(stdout)`,
 *    never on `.toContain("Corpus: ")` — incidental presence anywhere in the
 *    buffer is exactly what a fixed prefix at a fixed position rules out.
 * 3. **The prefix is asserted as a LITERAL**, never imported from the
 *    implementation: importing `ISSUE_CORPUS_LINE_PREFIX` here would make the
 *    assertion tautological (a renamed prefix would silently keep passing).
 * 4. **The two surfaces' `corpus_path` values are compared to EACH OTHER**
 *    byte-for-byte, not only each to the fixture — two independently-correct
 *    renderings of the same path (`/var/...` vs `/private/var/...`) would still
 *    leave an agent unable to tell whether the surfaces agree.
 * 5. **No silent fallback.** An upstream that cannot be opened refuses LOUDLY;
 *    the suite asserts `lore issues` did NOT quietly degrade to the cwd corpus
 *    (which would print a perfectly clean empty listing — the same shape as
 *    success, the defect's whole failure mode).
 *
 * ⛔ Every corpus here is a throwaway `mkdtempSync` pair (upstream + consumer)
 * asserted to live under `os.tmpdir()` — NEVER this repo's own `.lore/` (root
 * CLAUDE.md). The suite spawns the COMPILED `dist/lore` resolved from THIS
 * worktree's own root and rebuilds it once in `beforeAll`, so a stale binary
 * (whose `assertFreshBinary` FATAL is indistinguishable from an assertion red)
 * can never be mistaken for a red assertion.
 *
 * Six-dimension coverage:
 *   HAPPY:      3 reports filed → `issues --all --json` and `report-issue --list
 *               --json` return the SAME doc-id set, both carrying the upstream's
 *               absolute path under `corpus_path`
 *   BOUNDARY:   a consumer with ZERO reports → both surfaces render zero rows and
 *               STILL name the corpus on their first line (the empty case is
 *               where a missing header is least likely to be noticed)
 *   NEGATIVE:   `Corpus: ` is asserted at POSITION 0, and the id sets are compared
 *               as sets with a non-empty precondition — a surface that returns a
 *               subset, a superset, or garbage fails
 *   ERROR:      `feedback.upstream.corpus_path` pointing at a non-corpus directory
 *               → `lore issues` exits non-zero naming the path, and provably does
 *               NOT fall back to the (empty) cwd corpus
 *   STATE:      after one report is resolved `wontfix` upstream, `--all` and
 *               `--list` still agree on the id set (a terminal resolution changes
 *               the RESOLUTION column, never the membership of `--all`)
 *   REGRESSION: the unconfigured consumer (no `feedback.upstream` at all) still
 *               reads cwd exactly as before, and names cwd
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M4, AC-DC-5;
 *   task-both-issue-read-surfaces-name-the-corpus-they-read-issues.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDistLoreOnce,
  cleanFixtures,
  fileReport,
  firstLine,
  makeTwin,
  run,
  runJson,
  sameRealPath,
  sortedIds,
  type RunResult,
} from "./issue-read-surfaces.shared.js";

/**
 * The DECLARED fixed prefix, written out as a literal on purpose (see point 3 of
 * this file's header). ⛔ Do not replace this with an import.
 */
const DECLARED_CORPUS_PREFIX = "Corpus: ";

interface IssuesJson {
  ok: true;
  data: {
    corpus_path: string;
    source: string;
    mode: string;
    total: number;
    reports: Array<{ id: string; slug: string; resolution: string }>;
  };
}

interface ListJson {
  ok: true;
  data: {
    corpus_path: string;
    rows: Array<{ upstream_doc_id: string; status: string }>;
  };
}

/** Asserts the declared render contract on one human buffer, returning the named path. */
function assertCorpusHeader(result: RunResult): string {
  const line = firstLine(result.stdout);
  expect(line.startsWith(DECLARED_CORPUS_PREFIX)).toBe(true);
  const path = line.slice(DECLARED_CORPUS_PREFIX.length);
  // An absolute path, not a relative one and not an empty tail.
  expect(path.startsWith("/")).toBe(true);
  return path;
}

beforeAll(() => {
  buildDistLoreOnce();
}, 300_000);

afterAll(() => {
  cleanFixtures();
});

describe("AC-DC-5: both issue read surfaces return the same id set and each names the corpus it read", () => {
  it("HAPPY: `issues --all --json` and `report-issue --list --json` return the SAME doc-id set, both naming the upstream corpus", () => {
    const { upstream, consumerRoot } = makeTwin("agree");
    const filedIds = [
      fileReport(consumerRoot, "agree report 1", { severity: "high", category: "correctness" }),
      fileReport(consumerRoot, "agree report 2"),
      fileReport(consumerRoot, "agree report 3"),
    ];
    expect(filedIds.length).toBe(3);

    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    const list = runJson<ListJson>(["report-issue", "--list"], { cwd: consumerRoot });
    expect(issues.result.exitCode).toBe(0);
    expect(list.result.exitCode).toBe(0);

    const issuesIds = issues.data.data.reports.map((r) => r.id);
    const listIds = list.data.data.rows.map((r) => r.upstream_doc_id);

    // Precondition: a pair of EMPTY sets is trivially "equal" — the defect's own
    // shape on one side. Assert both are populated before comparing them.
    expect(issuesIds.length).toBe(3);
    expect(listIds.length).toBe(3);
    // SET EQUALITY, both directions, against the ids the filings actually returned.
    expect(sortedIds(issuesIds)).toEqual(sortedIds(filedIds));
    expect(sortedIds(listIds)).toEqual(sortedIds(filedIds));
    expect(sortedIds(issuesIds)).toEqual(sortedIds(listIds));

    // Both --json payloads carry the SAME corpus_path, and it is the UPSTREAM's.
    expect(issues.data.data.corpus_path).toBe(list.data.data.corpus_path);
    expect(sameRealPath(issues.data.data.corpus_path, upstream.root)).toBe(true);
    expect(sameRealPath(issues.data.data.corpus_path, consumerRoot)).toBe(false);
    expect(issues.data.data.source).toBe("upstream");

    // Both HUMAN renders name it on their FIRST line, same value.
    const issuesHuman = run(["issues", "--all"], { cwd: consumerRoot });
    const listHuman = run(["report-issue", "--list"], { cwd: consumerRoot });
    const issuesNamed = assertCorpusHeader(issuesHuman);
    const listNamed = assertCorpusHeader(listHuman);
    expect(issuesNamed).toBe(listNamed);
    expect(issuesNamed).toBe(issues.data.data.corpus_path);

    // Every row is visible on the human renders too, so a passing header is not
    // the ONLY thing that changed. Keyed on the identity EACH render carries:
    // `lore issues`'s human table renders `Slug` (its `id` reaches `--json` only),
    // `report-issue --list`'s renders `Doc ID`.
    //
    // ⛔ IN-FLIGHT REVISION, recorded rather than quietly applied (a red-then-edited
    // oracle is indistinguishable from a covered-up failure unless the change is
    // written down). ORIGINAL: `for (const id of filedIds) expect(issuesHuman.stdout).toContain(id)`.
    // EXACT FAILURE: `expect(received).toContain(expected)` — "01KZRV0SK1ENT9AW7JN4SCDHMZ"
    // absent from a buffer whose columns were `Title Slug Reporter Reported Age
    // Resolution Severity Category`. WHY THIS IS A CORRECTION, NOT A WEAKENING:
    // `lore issues`'s human table never rendered a doc-id column — not before §M4
    // and not after — so the original assertion demanded a fact no version of this
    // command ever produced; it was wrong about the surface, not a requirement that
    // got relaxed. The replacement keeps the same discriminating power (a
    // header-only change still fails: `total` rows must render, with their identity
    // and the declared count line) and adds the second surface, which the original
    // did not check at all.
    expect(issuesHuman.stdout).toContain(`all issue reports (${filedIds.length}):`);
    for (const report of issues.data.data.reports) expect(issuesHuman.stdout).toContain(report.slug);
    for (const id of filedIds) expect(listHuman.stdout).toContain(id);
  }, 300_000);

  it("BOUNDARY: a consumer with ZERO reports still names the corpus on the FIRST line of both surfaces", () => {
    const { upstream, consumerRoot } = makeTwin("agree-empty");

    const issuesHuman = run(["issues", "--all"], { cwd: consumerRoot });
    expect(issuesHuman.exitCode).toBe(0);
    expect(sameRealPath(assertCorpusHeader(issuesHuman), upstream.root)).toBe(true);
    // The pre-existing empty-listing line survives, just no longer FIRST.
    expect(issuesHuman.stdout).toContain("(no all issue reports)");

    const listHuman = run(["report-issue", "--list"], { cwd: consumerRoot });
    expect(listHuman.exitCode).toBe(0);
    expect(sameRealPath(assertCorpusHeader(listHuman), upstream.root)).toBe(true);
    expect(listHuman.stdout).toContain("No reports filed yet from this corpus.");

    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    const list = runJson<ListJson>(["report-issue", "--list"], { cwd: consumerRoot });
    expect(issues.data.data.total).toBe(0);
    expect(list.data.data.rows.length).toBe(0);
    expect(issues.data.data.corpus_path).toBe(list.data.data.corpus_path);
  }, 300_000);

  it("STATE: a terminal `wontfix` resolution upstream leaves the two id sets equal", () => {
    const { consumerRoot, upstream } = makeTwin("agree-resolved");
    const filedIds = [
      fileReport(consumerRoot, "agree-resolved report 1"),
      fileReport(consumerRoot, "agree-resolved report 2"),
    ];

    const resolved = run(
      [
        "issue",
        "resolve",
        filedIds[0] as string,
        "--state",
        "wontfix",
        "--reason",
        "not a lore defect",
        "--by",
        "agent:m4-maintainer",
      ],
      { cwd: upstream.root },
    );
    expect(resolved.exitCode).toBe(0);

    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    const list = runJson<ListJson>(["report-issue", "--list"], { cwd: consumerRoot });
    const issuesIds = issues.data.data.reports.map((r) => r.id);
    const listIds = list.data.data.rows.map((r) => r.upstream_doc_id);
    expect(issuesIds.length).toBe(2);
    expect(sortedIds(issuesIds)).toEqual(sortedIds(listIds));

    // …and BOTH surfaces report the same terminal resolution for that id.
    const issuesRow = issues.data.data.reports.find((r) => r.id === filedIds[0]);
    const listRow = list.data.data.rows.find((r) => r.upstream_doc_id === filedIds[0]);
    expect(issuesRow?.resolution).toBe("wontfix");
    expect(listRow?.status).toBe("wontfix");
  }, 300_000);

  it("ERROR: an unopenable configured upstream refuses LOUDLY — never a silent fallback to the cwd corpus", () => {
    const bogus = mkdtempSync(join(tmpdir(), "lore-m4-not-a-corpus-"));
    const { consumerRoot } = makeTwin("agree-bogus", { upstreamPathOverride: bogus });

    const attempt = run(["issues", "--all"], { cwd: consumerRoot });
    // A fallback to the (empty) cwd corpus would print a clean empty listing and
    // exit 0 — byte-identical in shape to success, which is the defect itself.
    expect(attempt.exitCode).not.toBe(0);
    expect(attempt.stdout).not.toContain("(no all issue reports)");
    expect(attempt.stderr).toContain(bogus);
  }, 300_000);

  it("REGRESSION: an UNCONFIGURED consumer reads cwd exactly as before, and names cwd", () => {
    const { upstream, consumerRoot } = makeTwin("agree-unconfigured", { unconfigured: true });

    const issuesHuman = run(["issues", "--all"], { cwd: consumerRoot });
    expect(issuesHuman.exitCode).toBe(0);
    const named = assertCorpusHeader(issuesHuman);
    expect(sameRealPath(named, consumerRoot)).toBe(true);
    expect(sameRealPath(named, upstream.root)).toBe(false);

    const issues = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    expect(issues.data.data.total).toBe(0);
    expect(issues.data.data.source).toBe("local");
  }, 300_000);
});
