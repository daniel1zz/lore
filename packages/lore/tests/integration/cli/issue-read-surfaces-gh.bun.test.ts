// @spawns dist/lore
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries
 * @task task-skill-refactor-gs-t5-lore-issues-live-only-push-only-sync
 *
 * The two issue READ surfaces — `lore issues` and `lore report-issue --list` — on the GitHub transport, in the
 * live model (GitHub owns every issue fact; the corpus holds only CARRIERS, work naming an issue in
 * `extra.issues`). Moved here from the mirror model: the `--local` control, the corpus-`extra` severity source and
 * the `resolves`-edge resolution are retired with the mirror task; their live-model counterparts are asserted
 * through the compiled binary against a stubbed `gh`:
 *
 *   agreement  both surfaces return the SAME issue-number set from the one remote listing, and each names the
 *              corpus it ran in (`data.corpus_path`; first human line `Corpus: <path>`).
 *   triage     severity and category appear under ONE vocabulary on both surfaces (columns headed exactly
 *              `Severity` / `Category`; `--json` keys `severity` / `category`), read from each issue's own body
 *              front matter (the only copy now), and no filing is admitted or refused on their value.
 *   status     the listing prints the DERIVED status: an issue no work names is `open`; once a carrier names it,
 *              `adopted`; once that carrier is archived while the issue is still open, `fixed (close pending)`.
 *              An unreadable remote fails LOUD (non-zero, gh's message on stderr, nothing on stdout).
 *   no local   `--local` and `--verify` no longer exist: both exit 2 as unknown switches.
 *
 * Offline: PATH holds only the recording `gh` stub. Throwaway corpora (`mkdtemp` + `lore init`); carriers are
 * seeded through a bare ungated CorpusService. Never this repo's `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { assembleIssueBody, type CreateDocInput, type DocRecord } from "@lore/core";

import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
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
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
const REPO = "acme-test/read-surfaces-defect-channel";
const REPO_ID = 770_100;
const FEEDBACK_YAML = ["feedback:", "  upstream:", `    repo: ${REPO}`].join("\n");

const FILED_NUMBER = 301;
const HAND_FILED_NUMBER = 302;
const PLAIN_CLOSED_NUMBER = 303;
const CARRIED_NUMBER = 401;

interface ListRow {
  readonly number: number;
  readonly status: string;
  readonly carriers?: readonly string[];
  readonly severity?: string;
  readonly category?: string;
}
interface ListPayload {
  readonly corpus_path: string;
  readonly source: string;
  readonly total: number;
  readonly reports: readonly ListRow[];
}

let ghStubDir: string;
let configHome: string;
let surfacesCorpus: string;
let carriedCorpus: string;

let issuesJson: ListPayload;
let listJson: ListPayload;
let issuesHuman: RunResult;
let listHuman: RunResult;
let admission: RunResult[];

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
function fileOne(corpus: string, number: number, title: string, severity: string, category: string): string {
  setNextCreatedNumber(ghStubDir, number);
  const before = readPostBodies(ghStubDir).length;
  const run = runLore(filingArgs(title, severity, category), opts(corpus));
  clearNextCreatedNumber(ghStubDir);
  expect(run.exitCode, run.stderr).toBe(0);
  const bodies = readPostBodies(ghStubDir);
  expect(bodies).toHaveLength(before + 1);
  return bodies[bodies.length - 1] as string;
}

/** Seeds a PLAN carrier naming `number` (written through the service, never by hand), optionally archived. */
async function seedPlanCarrier(corpus: string, title: string, number: number, archived: boolean): Promise<DocRecord> {
  const store = actedStore(new SQLiteStore(join(corpus, ".lore", "lore.db")));
  try {
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const created = await cs.create({
      parent_id: await ensureRequirementsDocId(cs), type: "plan",
      title,
      content: "## Overview\n\nCarrier body.",
      extra: { issues: [{ repo_id: REPO_ID, number }] },
    } as CreateDocInput);
    if (!created.ok) throw new Error(`seed carrier create failed: ${JSON.stringify(created.error)}`);
    if (!archived) return created.value;
    for (const status of ["approved", "active", "archived"] as const) {
      const moved = await cs.set(created.value.id, { status });
      if (!moved.ok) throw new Error(`seed carrier -> ${status} failed: ${JSON.stringify(moved.error)}`);
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
  carriedCorpus = makeConsumerCorpus({ ghStubDir, configHome, prefix: "read-carried", feedbackYaml: FEEDBACK_YAML });

  // ── surfaces corpus: one report filed for real, one hand-filed from elsewhere, one with no front matter ──
  const filedBody = fileOne(surfacesCorpus, FILED_NUMBER, "filed probe", "high", "ordering-a");
  const handFiledBody = assembleIssueBody(
    {
      severity: "critical",
      category: "ordering-b",
      tags: [],
      reporter_corpus: "someone-else",
      reporter_root_prd: "prd-someone-else",
      idempotency_key: "hand-filed-key-302",
    },
    "filed from another machine; this corpus knows nothing about it",
  );
  setStubIssues(ghStubDir, [
    { number: FILED_NUMBER, title: "filed probe", state: "open", body: filedBody },
    { number: HAND_FILED_NUMBER, title: "hand filed probe", state: "open", body: handFiledBody },
    { number: PLAIN_CLOSED_NUMBER, title: "plain closed probe", state: "closed", body: "no front matter at all" },
  ]);

  issuesJson = parseData<ListPayload>(runLore(["issues", "--all", "--json"], opts(surfacesCorpus)));
  listJson = parseData<ListPayload>(runLore(["report-issue", "--list", "--json"], opts(surfacesCorpus)));
  issuesHuman = runLore(["issues", "--all"], opts(surfacesCorpus));
  listHuman = runLore(["report-issue", "--list"], opts(surfacesCorpus));

  // Admission: two more filings whose severity differs, while a `critical` report already exists remotely.
  admission = [
    runLore(filingArgs("admission critical", "critical", "ordering-c"), opts(surfacesCorpus)),
    runLore(filingArgs("admission low", "low", "ordering-c"), opts(surfacesCorpus)),
  ];

  // ── carried corpus: one filed report that work will come to name ──
  const carriedBody = fileOne(carriedCorpus, CARRIED_NUMBER, "carried probe", "medium", "closure");
  setStubIssues(ghStubDir, [{ number: CARRIED_NUMBER, title: "carried probe", state: "open", body: carriedBody }]);
}, 300_000);

afterAll(() => {
  if (ghStubDir !== undefined) cleanupRecordingGhStubDir(ghStubDir);
  removeDirs([configHome, surfacesCorpus, carriedCorpus]);
});

describe("both read surfaces return the same issues and each names the corpus it ran in", () => {
  it("the number sets of `lore issues --all --json` and `report-issue --list --json` are EQUAL and non-empty", () => {
    const issuesSet = new Set(issuesJson.reports.map((r) => r.number));
    const listSet = new Set(listJson.reports.map((r) => r.number));
    expect(issuesSet).toEqual(new Set([FILED_NUMBER, HAND_FILED_NUMBER, PLAIN_CLOSED_NUMBER]));
    expect(listSet).toEqual(issuesSet);
    expect(issuesJson.total).toBe(3);
    expect(listJson.total).toBe(3);
  });

  it("both --json payloads carry top-level corpus_path equal to the consumer corpus, and source github", () => {
    const expected = realpathSync(surfacesCorpus);
    expect(realpathSync(issuesJson.corpus_path)).toBe(expected);
    expect(realpathSync(listJson.corpus_path)).toBe(expected);
    expect(issuesJson.source).toBe("github");
    expect(listJson.source).toBe("github");
  });

  it("both human renders open with the fixed 'Corpus: ' prefix plus that same path", () => {
    const expected = `Corpus: ${realpathSync(surfacesCorpus)}`;
    for (const human of [issuesHuman, listHuman]) {
      expect(human.exitCode, human.stderr).toBe(0);
      const firstLine = human.stdout.split("\n")[0] as string;
      expect(firstLine.startsWith("Corpus: ")).toBe(true);
      expect(`Corpus: ${realpathSync(firstLine.slice("Corpus: ".length))}`).toBe(expected);
    }
  });
});

describe("no local source: --local and --verify are unknown switches", () => {
  it("`lore issues --local` and `lore issues --verify` each exit exactly 2 and print no listing", () => {
    for (const flag of ["--local", "--verify"]) {
      const run = runLore(["issues", flag], opts(surfacesCorpus));
      expect(run.exitCode, `${flag}: ${run.stderr}`).toBe(2);
      expect(run.stdout).not.toContain("filed probe");
    }
  });
});

describe("severity and category under ONE vocabulary on every read surface, and ordering-only", () => {
  it("the human tables of both surfaces carry columns headed exactly Severity and Category, in the same order", () => {
    const issuesCells = headerCells(issuesHuman.stdout);
    const listCells = headerCells(listHuman.stdout);
    expect(issuesCells).toContain("Severity");
    expect(issuesCells).toContain("Category");
    expect(issuesCells.indexOf("Severity")).toBeLessThan(issuesCells.indexOf("Category"));
    expect(listCells).toEqual(issuesCells);
  });

  it("--json rows carry severity/category under those exact keys, read from each issue's body front matter", () => {
    for (const payload of [issuesJson, listJson]) {
      const byNumber = new Map(payload.reports.map((r) => [r.number, r]));
      expect(byNumber.get(FILED_NUMBER)).toMatchObject({ severity: "high", category: "ordering-a" });
      expect(byNumber.get(HAND_FILED_NUMBER)).toMatchObject({ severity: "critical", category: "ordering-b" });
      const plain = byNumber.get(PLAIN_CLOSED_NUMBER) as ListRow;
      expect(plain.severity).toBeUndefined();
      expect(plain.category).toBeUndefined();
    }
  });

  it("no admission decision turns on severity — a critical and a low filing are both accepted", () => {
    for (const run of admission) expect(run.exitCode, run.stderr).toBe(0);
  });
});

describe("the listing prints the derived status", () => {
  const statusOf = (payload: ListPayload): string | undefined => payload.reports.find((r) => r.number === CARRIED_NUMBER)?.status;

  it("an issue no work names is open; a carrier makes it adopted; an archived carrier makes it fixed (close pending)", async () => {
    const before = parseData<ListPayload>(runLore(["report-issue", "--list", "--json"], opts(carriedCorpus)));
    expect(statusOf(before)).toBe("open");

    const carrier = await seedPlanCarrier(carriedCorpus, "Carrier plan, live", CARRIED_NUMBER, false);
    const adopted = parseData<ListPayload>(runLore(["issues", "--all", "--json"], opts(carriedCorpus)));
    expect(statusOf(adopted)).toBe("adopted");
    expect(adopted.reports.find((r) => r.number === CARRIED_NUMBER)?.carriers).toEqual([carrier.slug]);

    const archivedCarrier = await seedPlanCarrier(carriedCorpus, "Carrier plan, archived", CARRIED_NUMBER, true);
    const pending = parseData<ListPayload>(runLore(["report-issue", "--list", "--json"], opts(carriedCorpus)));
    expect(statusOf(pending)).toBe("fixed (close pending)");
    expect(pending.reports.find((r) => r.number === CARRIED_NUMBER)?.carriers).toEqual([carrier.slug, archivedCarrier.slug].sort());

    const human = runLore(["report-issue", "--list"], opts(carriedCorpus));
    expect(human.exitCode, human.stderr).toBe(0);
    const humanRow = human.stdout.split("\n").find((l) => l.includes("carried probe"));
    expect(humanRow, human.stdout).toBeDefined();
    // reason: the State column (GitHub's own open/closed) legitimately reads "open"; the derived status is the 4th cell.
    const cells = (humanRow as string).trim().split(/\s{2,}/);
    expect(cells.slice(0, 4)).toEqual([String(CARRIED_NUMBER), "carried probe", "open", "fixed (close pending)"]);
  }, 120_000);

  it("an unreadable remote fails LOUD (non-zero, gh's message on stderr) and prints no row", () => {
    setListingFailure(ghStubDir, "gh: simulated listing outage");
    try {
      const list = runLore(["report-issue", "--list", "--json"], opts(carriedCorpus));
      expect(list.exitCode).not.toBe(0);
      expect(list.stderr).toContain("simulated listing outage");
      expect(list.stdout).not.toContain("carried probe");

      const issues = runLore(["issues", "--all", "--json"], opts(carriedCorpus));
      expect(issues.exitCode).not.toBe(0);
      expect(issues.stderr).toContain("simulated listing outage");
      expect(issues.stdout).not.toContain("carried probe");
    } finally {
      setListingFailure(ghStubDir, null);
    }
  });
});
