// @spawns dist/lore
/**
 * @spec_ref spec-the-defect-channel-cannot-be-honestly-maintained-an AC-DC-5, AC-DC-6, AC-DC-7
 * @spec_ref spec-issue-closure-loop-computed-resolution-agent-reachable AC-ICL-7
 * @task task-skill-test-tg-11b-report-issue-channel-acs-whose-tests
 *
 * The two issue READ surfaces — `lore issues` and `lore report-issue --list` —
 * on the GitHub transport. Their original suites (issue-read-surfaces-agree,
 * issue-read-surface-local-control, issue-severity-ordering-only,
 * issue-consumer-list) seeded a second SQLite "upstream corpus" that commit
 * 8b3845b1 deleted. The criteria are corrected (TG-11B) to the same properties
 * over the transport that exists now, asserted through the compiled binary
 * against a stubbed `gh`:
 *
 *   AC-DC-5   both surfaces return the SAME issue-number set (set equality) from
 *             the one remote listing, and each names the corpus it ran in
 *             (`data.corpus_path`; first human line `Corpus: <path>`). GitHub has
 *             no corpus of its own, so the named path is the consumer's (the
 *             corpus holding the ingested tasks) — not an "upstream corpus path".
 *   AC-DC-6   reverse control: `--local` reads ONLY the consumer corpus's own
 *             ingested reports (source `local`, reason `forced-local`), so its
 *             set is a strict subset of the remote listing — the source really
 *             switches.
 *   AC-DC-7   severity and category appear under ONE vocabulary on both surfaces
 *             (columns headed exactly `Severity` / `Category`; `--json` keys
 *             `severity` / `category`), whether read from corpus `extra`
 *             (ingested) or from the issue body's front matter (not ingested),
 *             and no filing is admitted or refused on their value.
 *   AC-ICL-7  the consumer-side listing prints the COMPUTED resolution: a report
 *             whose `resolves` source is archived shows `fixed`, never `open`;
 *             an unreadable remote fails LOUD (non-zero, gh's message on stderr)
 *             while `lore issues --local` keeps the filed history visible.
 *             Dropped with the SQLite list renderer (8b3845b1) and therefore NOT
 *             asserted: echoing the recorded rejection reason on the row.
 *
 * Offline: PATH holds only the recording `gh` stub. Throwaway corpora (`mkdtemp`
 * + `lore init`), seeded `resolves` edge through a bare ungated CorpusService —
 * the same idiom issue-closure-e2e.bun.test.ts uses. Never this repo's `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { assembleIssueBody, type CreateDocInput, type DocRecord } from "@lore/core";

import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { approveCitedSpec } from "../../helpers/live-rule-fixture.js";
import {
  assertBinaryFresh,
  filingArgs,
  makeConsumerCorpus,
  removeDirs,
  runLore,
  TMP_ROOT,
  type RunResult,
} from "../helpers/consumer-corpus-fixture";
import {
  cleanupRecordingGhStubDir,
  clearNextCreatedNumber,
  readPostBodies,
  recordingGhStubDir,
  setListingFailure,
  setNextCreatedNumber,
  setStubIssues,
} from "../helpers/recording-gh-stub";

const REPO = "acme-test/read-surfaces-defect-channel";
const REPO_ID = 770_100;
const FEEDBACK_YAML = ["feedback:", "  upstream:", `    repo: ${REPO}`].join("\n");

const INGESTED_NUMBER = 301;
const NOT_INGESTED_NUMBER = 302;
const PLAIN_CLOSED_NUMBER = 303;
const FIXED_NUMBER = 401;

interface ListRow {
  readonly number: number;
  readonly resolution: string;
  readonly slug?: string;
  readonly severity?: string;
  readonly category?: string;
}
interface ListPayload {
  readonly corpus_path: string;
  readonly source: string;
  readonly source_reason?: string;
  readonly total: number;
  readonly reports: readonly ListRow[];
}

let ghStubDir: string;
let configHome: string;
let surfacesCorpus: string;
let fixedCorpus: string;

let issuesJson: ListPayload;
let listJson: ListPayload;
let localJson: LocalPayload;
let issuesHuman: RunResult;
let listHuman: RunResult;
let localHuman: RunResult;
let admission: RunResult[];

interface LocalRow {
  readonly slug: string;
  readonly resolution: string;
  readonly severity?: string;
  readonly category?: string;
}
interface LocalPayload {
  readonly corpus_path: string;
  readonly source: string;
  readonly source_reason?: string;
  readonly total: number;
  readonly reports: readonly LocalRow[];
}

function opts(cwd: string) {
  return { cwd, ghStubDir, configHome };
}

function parseData<T>(run: RunResult): T {
  expect(run.exitCode, run.stderr).toBe(0);
  const parsed = JSON.parse(run.stdout) as { ok: boolean; data: T };
  expect(parsed.ok).toBe(true);
  return parsed.data;
}

/** The header line of the first table in a human render: the line holding both triage column names. */
function headerCells(human: string): string[] {
  const line = human.split("\n").find((l) => l.includes("Severity") && l.includes("Category"));
  expect(line, `no Severity/Category header line in:\n${human}`).toBeDefined();
  return (line as string).trim().split(/\s{2,}/);
}

/** Files one report through the real CLI with the stub's next number pinned; returns the issue body gh received. */
function fileIngested(corpus: string, number: number, title: string, severity: string, category: string): string {
  setNextCreatedNumber(ghStubDir, number);
  const before = readPostBodies(ghStubDir).length;
  const run = runLore(filingArgs(title, severity, category), opts(corpus));
  clearNextCreatedNumber(ghStubDir);
  expect(run.exitCode, run.stderr).toBe(0);
  const bodies = readPostBodies(ghStubDir);
  expect(bodies).toHaveLength(before + 1);
  return bodies[bodies.length - 1] as string;
}

async function seedArchivedFixingSpec(corpus: string): Promise<DocRecord> {
  const store = new SQLiteStore(join(corpus, ".lore", "lore.db"));
  try {
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const created = await cs.create({
      type: "spec",
      title: "AC-ICL-7 fixing spec",
      content: "## Overview\n\nFixing doc body.",
    } as CreateDocInput);
    if (!created.ok) throw new Error(`seed spec create failed: ${JSON.stringify(created.error)}`);
    const approved = await approveCitedSpec(store, cs, created.value.id);
    if (!approved.ok) throw new Error(`seed spec approve failed: ${JSON.stringify(approved.error)}`);
    for (const status of ["active", "archived"] as const) {
      const moved = await cs.set(created.value.id, { status });
      if (!moved.ok) throw new Error(`seed spec -> ${status} failed: ${JSON.stringify(moved.error)}`);
    }
    return created.value;
  } finally {
    store.close();
  }
}

beforeAll(async () => {
  assertBinaryFresh();
  ghStubDir = recordingGhStubDir({ repoId: REPO_ID });
  configHome = mkdtempSync(join(TMP_ROOT, "lore-read-surfaces-config-home-"));
  surfacesCorpus = makeConsumerCorpus({ ghStubDir, configHome, prefix: "read-surfaces", feedbackYaml: FEEDBACK_YAML });
  fixedCorpus = makeConsumerCorpus({ ghStubDir, configHome, prefix: "read-fixed", feedbackYaml: FEEDBACK_YAML });

  // ── surfaces corpus: one INGESTED report (filed for real), two the corpus never ingested ──
  const ingestedBody = fileIngested(surfacesCorpus, INGESTED_NUMBER, "ingested probe", "high", "ordering-a");
  const notIngestedBody = assembleIssueBody(
    {
      severity: "critical",
      category: "ordering-b",
      tags: [],
      reporter_corpus: "someone-else",
      reporter_root_prd: "prd-someone-else",
      idempotency_key: "not-ingested-key-302",
    },
    "filed from another machine; this corpus has no task for it",
  );
  setStubIssues(ghStubDir, [
    { number: INGESTED_NUMBER, title: "ingested probe", state: "open", body: ingestedBody },
    { number: NOT_INGESTED_NUMBER, title: "not ingested probe", state: "open", body: notIngestedBody },
    { number: PLAIN_CLOSED_NUMBER, title: "plain closed probe", state: "closed", body: "no front matter at all" },
  ]);

  issuesJson = parseData<ListPayload>(runLore(["issues", "--all", "--json"], opts(surfacesCorpus)));
  listJson = parseData<ListPayload>(runLore(["report-issue", "--list", "--json"], opts(surfacesCorpus)));
  localJson = parseData<LocalPayload>(runLore(["issues", "--local", "--all", "--json"], opts(surfacesCorpus)));
  issuesHuman = runLore(["issues", "--all"], opts(surfacesCorpus));
  listHuman = runLore(["report-issue", "--list"], opts(surfacesCorpus));
  localHuman = runLore(["issues", "--local", "--all"], opts(surfacesCorpus));

  // Admission: two more filings whose severity differs, while a `critical` report already exists remotely.
  admission = [
    runLore(filingArgs("admission critical", "critical", "ordering-c"), opts(surfacesCorpus)),
    runLore(filingArgs("admission low", "low", "ordering-c"), opts(surfacesCorpus)),
  ];

  // ── fixed corpus: a filed report whose `resolves` source is archived ──
  const fixedBody = fileIngested(fixedCorpus, FIXED_NUMBER, "fixed probe", "medium", "closure");
  setStubIssues(ghStubDir, [{ number: FIXED_NUMBER, title: "fixed probe", state: "open", body: fixedBody }]);
}, 300_000);

afterAll(() => {
  if (ghStubDir !== undefined) cleanupRecordingGhStubDir(ghStubDir);
  removeDirs([configHome, surfacesCorpus, fixedCorpus]);
});

describe("AC-DC-5: both read surfaces return the same issues and each names the corpus it ran in", () => {
  it("AC-DC-5: the number sets of `lore issues --all --json` and `report-issue --list --json` are EQUAL and non-empty", () => {
    const issuesSet = new Set(issuesJson.reports.map((r) => r.number));
    const listSet = new Set(listJson.reports.map((r) => r.number));
    expect(issuesSet).toEqual(new Set([INGESTED_NUMBER, NOT_INGESTED_NUMBER, PLAIN_CLOSED_NUMBER]));
    expect(listSet).toEqual(issuesSet);
    expect(issuesJson.total).toBe(3);
    expect(listJson.total).toBe(3);
  });

  it("AC-DC-5: both --json payloads carry top-level corpus_path equal to the consumer corpus, and source github", () => {
    const expected = realpathSync(surfacesCorpus);
    expect(realpathSync(issuesJson.corpus_path)).toBe(expected);
    expect(realpathSync(listJson.corpus_path)).toBe(expected);
    expect(issuesJson.source).toBe("github");
    expect(listJson.source).toBe("github");
  });

  it("AC-DC-5: both human renders open with the fixed 'Corpus: ' prefix plus that same path", () => {
    const expected = `Corpus: ${realpathSync(surfacesCorpus)}`;
    for (const human of [issuesHuman, listHuman]) {
      expect(human.exitCode, human.stderr).toBe(0);
      const firstLine = human.stdout.split("\n")[0] as string;
      expect(firstLine.startsWith("Corpus: ")).toBe(true);
      expect(`Corpus: ${realpathSync(firstLine.slice("Corpus: ".length))}`).toBe(expected);
    }
  });
});

describe("AC-DC-6: reverse control — --local really switches the source", () => {
  it("AC-DC-6: --local names the consumer corpus with source local / forced-local", () => {
    expect(realpathSync(localJson.corpus_path)).toBe(realpathSync(surfacesCorpus));
    expect(localJson.source).toBe("local");
    expect(localJson.source_reason).toBe("forced-local");
  });

  it("AC-DC-6: --local returns ONLY the corpus-ingested report, a strict subset of the remote listing", () => {
    expect(localJson.total).toBe(1);
    expect(localJson.reports.map((r) => r.slug)).toEqual([`task-gh-${REPO_ID}-${INGESTED_NUMBER}`]);
    expect(localJson.total).toBeLessThan(issuesJson.total);
  });

  it("AC-DC-6: the --local human render also opens with 'Corpus: <consumer path>'", () => {
    expect(localHuman.exitCode, localHuman.stderr).toBe(0);
    const firstLine = localHuman.stdout.split("\n")[0] as string;
    expect(firstLine.startsWith("Corpus: ")).toBe(true);
    expect(realpathSync(firstLine.slice("Corpus: ".length))).toBe(realpathSync(surfacesCorpus));
  });
});

describe("AC-DC-7: severity and category under ONE vocabulary on every read surface, and ordering-only", () => {
  it("AC-DC-7: the human tables of both surfaces carry columns headed exactly Severity and Category, in the same order", () => {
    const issuesCells = headerCells(issuesHuman.stdout);
    const listCells = headerCells(listHuman.stdout);
    expect(issuesCells).toContain("Severity");
    expect(issuesCells).toContain("Category");
    expect(issuesCells.indexOf("Severity")).toBeLessThan(issuesCells.indexOf("Category"));
    expect(listCells).toEqual(issuesCells);
  });

  it("AC-DC-7: --json rows carry severity/category under those exact keys — corpus extra for the ingested row, body front matter for the other", () => {
    for (const payload of [issuesJson, listJson]) {
      const byNumber = new Map(payload.reports.map((r) => [r.number, r]));
      expect(byNumber.get(INGESTED_NUMBER)).toMatchObject({ severity: "high", category: "ordering-a" });
      expect(byNumber.get(NOT_INGESTED_NUMBER)).toMatchObject({ severity: "critical", category: "ordering-b" });
      const plain = byNumber.get(PLAIN_CLOSED_NUMBER) as ListRow;
      expect(plain.severity).toBeUndefined();
      expect(plain.category).toBeUndefined();
    }
  });

  it("AC-DC-7: the filed flags round-trip into the corpus — `--local` shows the same values", () => {
    expect(localJson.reports[0]).toMatchObject({ severity: "high", category: "ordering-a" });
  });

  it("AC-DC-7: no admission decision turns on severity — a critical and a low filing are both accepted", () => {
    for (const run of admission) expect(run.exitCode, run.stderr).toBe(0);
  });
});

describe("AC-ICL-7: the consumer-side listing prints the computed resolution", () => {
  it("AC-ICL-7: before any fix the report computes open; with an archived `resolves` source it shows fixed, never open", async () => {
    const before = parseData<ListPayload>(runLore(["report-issue", "--list", "--json"], opts(fixedCorpus)));
    expect(before.reports.find((r) => r.number === FIXED_NUMBER)?.resolution).toBe("open");

    const spec = await seedArchivedFixingSpec(fixedCorpus);
    const link = runLore(["link", spec.slug, `task-gh-${REPO_ID}-${FIXED_NUMBER}`, "--type", "resolves"], opts(fixedCorpus));
    expect(link.exitCode, link.stderr).toBe(0);

    const after = parseData<ListPayload>(runLore(["report-issue", "--list", "--json"], opts(fixedCorpus)));
    const row = after.reports.find((r) => r.number === FIXED_NUMBER);
    expect(row?.resolution).toBe("fixed");

    const human = runLore(["report-issue", "--list"], opts(fixedCorpus));
    expect(human.exitCode, human.stderr).toBe(0);
    const humanRow = human.stdout.split("\n").find((l) => l.includes("fixed probe"));
    expect(humanRow, human.stdout).toBeDefined();
    // reason: the State column (GitHub's own open/closed) legitimately reads "open"; the COMPUTED resolution is the 4th cell.
    const cells = (humanRow as string).trim().split(/\s{2,}/);
    expect(cells.slice(0, 4)).toEqual([String(FIXED_NUMBER), "fixed probe", "open", "fixed"]);
  }, 60_000);

  it("AC-ICL-7: an unreadable remote fails LOUD (non-zero, gh's message on stderr) while --local keeps the history visible", () => {
    setListingFailure(ghStubDir, "gh: simulated listing outage ICL7");
    try {
      const list = runLore(["report-issue", "--list", "--json"], opts(fixedCorpus));
      expect(list.exitCode).not.toBe(0);
      expect(list.stderr).toContain("simulated listing outage ICL7");

      const local = parseData<LocalPayload>(runLore(["issues", "--local", "--all", "--json"], opts(fixedCorpus)));
      expect(local.reports.map((r) => r.slug)).toContain(`task-gh-${REPO_ID}-${FIXED_NUMBER}`);
    } finally {
      setListingFailure(ghStubDir, null);
    }
  });
});
