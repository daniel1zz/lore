/**
 * AC-DC-6 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M4) — the
 * REVERSE CONTROL for AC-DC-5: `lore issues --local` in the SAME consumer corpus
 * returns zero rows and names the CONSUMER corpus path.
 *
 * ## Why this control is load-bearing
 *
 * AC-DC-5 alone cannot distinguish "the default read switched to the configured
 * upstream" from "both branches read the upstream" (or, before the fix, from
 * "both read cwd and the fixture happened to be empty on both sides"). This
 * suite pins the OTHER end of the switch: with one flag flipped and nothing else
 * changed, the SAME cwd must yield a DIFFERENT corpus, a DIFFERENT named path,
 * and a DIFFERENT row count. Without it, `--local` could be an inert flag —
 * this repo's fifth documented false-oracle vector (a silently inert CLI flag).
 *
 * ## The inert-flag trap this suite avoids
 *
 * `adapters/cli/strict-flags.ts` rejects an unknown flag with exit 2. So "exit
 * code is non-zero" and "the flag is unimplemented" look identical, and an
 * exit-code-only oracle would go green with zero implementation the moment the
 * flag was merely DECLARED. Every refusal-shaped assertion here therefore also
 * asserts stderr does NOT carry citty's unknown-option wording, and the positive
 * cases assert exit 0 plus an observable path difference.
 *
 * ⛔ Throwaway `mkdtempSync` corpora under `os.tmpdir()` only — NEVER this repo's
 * own `.lore/`. Spawns the COMPILED `dist/lore` from THIS worktree, rebuilt once
 * in `beforeAll`.
 *
 * Six-dimension coverage:
 *   HAPPY:      `issues --local` in the consumer → 0 rows, names the CONSUMER path
 *   NEGATIVE:   stderr never carries the unknown-option wording, and the named
 *               path is asserted NOT to be the upstream's
 *   BOUNDARY:   `--local` combined with each of `--open`/`--resolved`/`--all`
 *               stays local (the source switch is orthogonal to the mode filter)
 *   ERROR:      `--local` in an UNCONFIGURED consumer behaves exactly like the
 *               default there (cwd), so the flag is never a second, divergent
 *               resolution path
 *   STATE:      `--local` run INSIDE the upstream corpus returns the 3 reports and
 *               names the UPSTREAM — proving `--local` means "cwd", not "empty"
 *   REGRESSION: the CONTROL half — the same cwd WITHOUT `--local` returns 3 rows
 *               and names the upstream, so the two branches provably differ
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M4, AC-DC-6;
 *   task-both-issue-read-surfaces-name-the-corpus-they-read-issues.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  buildDistLoreOnce,
  cleanFixtures,
  fileReport,
  firstLine,
  makeTwin,
  run,
  runJson,
  sameRealPath,
} from "./issue-read-surfaces.shared.js";

/** The DECLARED fixed prefix, written as a literal (never imported — see the sibling AC-DC-5 suite's header). */
const DECLARED_CORPUS_PREFIX = "Corpus: ";

/**
 * citty's unknown-flag refusal wording, matched as TWO independent lone tokens
 * rather than one remembered contiguous phrase (root CLAUDE.md: a
 * contiguous-substring matcher degrades silently to no-match, and here a
 * no-match would EXCUSE an inert flag).
 */
const UNKNOWN_OPTION_TOKENS = [/[Uu]nknown/, /option|flag/];

interface IssuesJson {
  ok: true;
  data: {
    corpus_path: string;
    source: string;
    mode: string;
    total: number;
    reports: Array<{ id: string }>;
  };
}

/** Asserts the buffer is NOT citty's unknown-flag refusal (the inert-flag trap). */
function assertNotUnknownOption(stderr: string): void {
  const looksUnknown = UNKNOWN_OPTION_TOKENS.every((token) => token.test(stderr));
  expect(looksUnknown).toBe(false);
}

beforeAll(() => {
  buildDistLoreOnce();
}, 300_000);

afterAll(() => {
  cleanFixtures();
});

describe("AC-DC-6: --local reads the cwd corpus and names it, so the default upstream read is a real switch", () => {
  it("HAPPY/NEGATIVE/REGRESSION: in one cwd, --local yields 0 rows naming the CONSUMER while the default yields 3 naming the UPSTREAM", () => {
    const { upstream, consumerRoot } = makeTwin("local");
    const filedIds = [
      fileReport(consumerRoot, "local report 1"),
      fileReport(consumerRoot, "local report 2"),
      fileReport(consumerRoot, "local report 3"),
    ];
    expect(filedIds.length).toBe(3);

    // ── the control half: DEFAULT read, same cwd ───────────────────────────────
    const upstreamRead = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    expect(upstreamRead.result.exitCode).toBe(0);
    expect(upstreamRead.data.data.total).toBe(3);
    expect(sameRealPath(upstreamRead.data.data.corpus_path, upstream.root)).toBe(true);
    expect(upstreamRead.data.data.source).toBe("upstream");

    // ── the reverse control: --local, same cwd, nothing else changed ───────────
    const localRead = runJson<IssuesJson>(["issues", "--all", "--local"], { cwd: consumerRoot });
    expect(localRead.result.exitCode).toBe(0);
    assertNotUnknownOption(localRead.result.stderr);
    expect(localRead.data.data.total).toBe(0);
    expect(localRead.data.data.reports).toEqual([]);
    expect(localRead.data.data.source).toBe("local");

    // It names the CONSUMER corpus, and provably NOT the upstream.
    expect(sameRealPath(localRead.data.data.corpus_path, consumerRoot)).toBe(true);
    expect(sameRealPath(localRead.data.data.corpus_path, upstream.root)).toBe(false);
    // The two branches differ in the observable the AC is written in terms of.
    expect(localRead.data.data.corpus_path).not.toBe(upstreamRead.data.data.corpus_path);

    // Human render: FIRST line names the consumer corpus.
    const localHuman = run(["issues", "--all", "--local"], { cwd: consumerRoot });
    expect(localHuman.exitCode).toBe(0);
    assertNotUnknownOption(localHuman.stderr);
    const line = firstLine(localHuman.stdout);
    expect(line.startsWith(DECLARED_CORPUS_PREFIX)).toBe(true);
    expect(sameRealPath(line.slice(DECLARED_CORPUS_PREFIX.length), consumerRoot)).toBe(true);
    expect(localHuman.stdout).toContain("(no all issue reports)");
    // …and none of the upstream ids leaked into the local read.
    for (const id of filedIds) expect(localHuman.stdout).not.toContain(id);
  }, 300_000);

  it("BOUNDARY: --local stays local under every mode flag (--open / --resolved / --all)", () => {
    const { upstream, consumerRoot } = makeTwin("local-modes");
    fileReport(consumerRoot, "local-modes report 1");

    for (const mode of ["--open", "--resolved", "--all"]) {
      const localRead = runJson<IssuesJson>(["issues", mode, "--local"], { cwd: consumerRoot });
      expect(localRead.result.exitCode).toBe(0);
      assertNotUnknownOption(localRead.result.stderr);
      expect(localRead.data.data.total).toBe(0);
      expect(sameRealPath(localRead.data.data.corpus_path, consumerRoot)).toBe(true);
      expect(sameRealPath(localRead.data.data.corpus_path, upstream.root)).toBe(false);
    }
  }, 300_000);

  it("STATE: --local run INSIDE the upstream corpus returns its 3 reports and names the UPSTREAM — `--local` means cwd, not empty", () => {
    const { upstream, consumerRoot } = makeTwin("local-upstream-cwd");
    const filedIds = [
      fileReport(consumerRoot, "local-upstream-cwd report 1"),
      fileReport(consumerRoot, "local-upstream-cwd report 2"),
      fileReport(consumerRoot, "local-upstream-cwd report 3"),
    ];

    const fromUpstream = runJson<IssuesJson>(["issues", "--all", "--local"], { cwd: upstream.root });
    expect(fromUpstream.result.exitCode).toBe(0);
    assertNotUnknownOption(fromUpstream.result.stderr);
    expect(fromUpstream.data.data.total).toBe(3);
    expect(fromUpstream.data.data.reports.map((r) => r.id).sort()).toEqual([...filedIds].sort());
    expect(sameRealPath(fromUpstream.data.data.corpus_path, upstream.root)).toBe(true);
    expect(fromUpstream.data.data.source).toBe("local");
  }, 300_000);

  it("ERROR: --local in an UNCONFIGURED consumer matches that consumer's default read exactly — no second resolution path", () => {
    const { consumerRoot } = makeTwin("local-unconfigured", { unconfigured: true });

    const withFlag = runJson<IssuesJson>(["issues", "--all", "--local"], { cwd: consumerRoot });
    const withoutFlag = runJson<IssuesJson>(["issues", "--all"], { cwd: consumerRoot });
    expect(withFlag.result.exitCode).toBe(0);
    assertNotUnknownOption(withFlag.result.stderr);
    expect(withFlag.data.data.corpus_path).toBe(withoutFlag.data.data.corpus_path);
    expect(withFlag.data.data.source).toBe("local");
    expect(withoutFlag.data.data.source).toBe("local");
    expect(sameRealPath(withFlag.data.data.corpus_path, consumerRoot)).toBe(true);
  }, 300_000);
});
