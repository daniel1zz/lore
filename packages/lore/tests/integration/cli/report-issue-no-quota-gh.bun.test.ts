/**
 * @spec_ref spec-the-defect-channel-cannot-be-honestly-maintained-an AC-DC-1, AC-DC-2, AC-DC-3
 * @task task-skill-test-tg-11b-report-issue-channel-acs-whose-tests
 *
 * The open-report cap is GONE (commit 9e9586dd deleted OPEN_REPORT_CAP,
 * resolveOpenReportCap, countOpenReports, OpenReportCapRefusal,
 * QUOTA_FREEING_RESOLUTIONS and UpstreamPort.listOpenAdhocDrafts; abuse control
 * belongs to the remote tracker, not to a client-side counter). AC-DC-1/2/3 were
 * written against that cap — release of quota, the refusal payload, the
 * configurable ceiling — and their three test files left with it. They are
 * corrected (TG-11B) to assert the post-removal truth through the same real
 * entry point (the compiled `lore report-issue`) against a stubbed `gh`:
 *
 *   AC-DC-1  eleven filings from one reporter, none resolved, ALL exit 0 — the
 *            exact sequence once refused (exit 4) on the 11th — and `gh` really
 *            received eleven create-POSTs.
 *   AC-DC-2  no quota refusal exists to carry a payload: no output of those
 *            filings names `quota_freeing_states` / `blocking`, and no source
 *            file under packages/<pkg>/src does either.
 *   AC-DC-3  a config still carrying `feedback.inbound.open_report_cap: 3` is
 *            NOT operative: the 4th and 5th filings are ACCEPTED, and the key is
 *            named in a warning (AC-GI-10 keeps it parseable) — proving the
 *            retired ceiling decides nothing.
 *
 * Offline: the child's PATH holds only the recording `gh` stub. Throwaway corpora
 * (`mkdtemp` + `lore init`); never this repo's `.lore/`.
 *
 * Six-dimension note: HAPPY (11 accepted), NEGATIVE (no refusal text in any
 * output), BOUNDARY (the 11th and, with the retired key at 3, the 4th), ERROR
 * (every exit code is exactly 0, never "not 4"), STATE (POST count equals filing
 * count), REGRESSION (the retired key stays parseable and named).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  assertBinaryFresh,
  filingArgs,
  makeConsumerCorpus,
  removeDirs,
  runLore,
  TMP_ROOT,
  WORKTREE_ROOT,
  type RunResult,
} from "../helpers/consumer-corpus-fixture";
import { cleanupRecordingGhStubDir, readPostBodies, recordingGhStubDir } from "../helpers/recording-gh-stub";

const FILINGS = 11;
const RETIRED_CAP_VALUE = 3;
const REPO = "acme-test/no-quota-defect-channel";

let uncappedStub: string;
let retiredKeyStub: string;
let configHome: string;
let uncappedCorpus: string;
let retiredKeyCorpus: string;
let uncappedRuns: RunResult[] = [];
let retiredKeyRuns: RunResult[] = [];

function fileMany(corpus: string, ghStubDir: string, count: number): RunResult[] {
  const results: RunResult[] = [];
  for (let n = 1; n <= count; n += 1) {
    results.push(runLore(filingArgs(`quota probe ${n}`, "critical", "quota"), { cwd: corpus, ghStubDir, configHome }));
  }
  return results;
}

beforeAll(() => {
  assertBinaryFresh();
  // reason: one stub per corpus, so each POST count is attributable to exactly one corpus's filings.
  uncappedStub = recordingGhStubDir({ repoId: 770_001 });
  retiredKeyStub = recordingGhStubDir({ repoId: 770_002 });
  configHome = mkdtempSync(join(TMP_ROOT, "lore-no-quota-config-home-"));
  uncappedCorpus = makeConsumerCorpus({
    ghStubDir: uncappedStub,
    configHome,
    prefix: "no-quota-uncapped",
    feedbackYaml: ["feedback:", "  upstream:", `    repo: ${REPO}`].join("\n"),
  });
  retiredKeyCorpus = makeConsumerCorpus({
    ghStubDir: retiredKeyStub,
    configHome,
    prefix: "no-quota-retired-key",
    feedbackYaml: [
      "feedback:",
      "  upstream:",
      `    repo: ${REPO}`,
      "  inbound:",
      `    open_report_cap: ${RETIRED_CAP_VALUE}`,
    ].join("\n"),
  });

  uncappedRuns = fileMany(uncappedCorpus, uncappedStub, FILINGS);
  retiredKeyRuns = fileMany(retiredKeyCorpus, retiredKeyStub, RETIRED_CAP_VALUE + 2);
}, 300_000);

afterAll(() => {
  for (const stub of [uncappedStub, retiredKeyStub]) if (stub !== undefined) cleanupRecordingGhStubDir(stub);
  removeDirs([configHome, uncappedCorpus, retiredKeyCorpus]);
});

/** Every `.ts`/`.tsx` file under `packages/<pkg>/src` (tests live elsewhere, so this file is never its own match). */
function sourceFiles(): string[] {
  const found: string[] = [];
  const packagesDir = join(WORKTREE_ROOT, "packages");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
    }
  };
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, "src");
    if (existsSync(src)) walk(src);
  }
  return found;
}

describe("AC-DC-1: no open-report cap — eleven unresolved filings are all accepted", () => {
  it("AC-DC-1: HAPPY — all 11 filings exit exactly 0, the 11th included (once refused with exit 4)", () => {
    expect(uncappedRuns).toHaveLength(FILINGS);
    uncappedRuns.forEach((run, index) => {
      expect(run.exitCode, `filing ${index + 1}: ${run.stderr}`).toBe(0);
    });
  });

  it("AC-DC-1: STATE — gh really received exactly one create-POST per filing, each carrying its own text", () => {
    const bodies = readPostBodies(uncappedStub);
    expect(bodies).toHaveLength(FILINGS);
    for (let n = 1; n <= FILINGS; n += 1) {
      expect(bodies.filter((body) => body.includes(`quota probe ${n} description`))).toHaveLength(1);
    }
  });

  it("AC-DC-1: NEGATIVE — no filing's stderr or stdout carries a cap refusal", () => {
    for (const run of uncappedRuns) {
      expect(`${run.stdout}\n${run.stderr}`).not.toMatch(/open[- _]report cap|cap \d+|too many open/i);
    }
  });
});

describe("AC-DC-2: no quota refusal exists, so no refusal payload does either", () => {
  it("AC-DC-2: no output of any of the 11 filings names quota_freeing_states or blocking", () => {
    for (const run of uncappedRuns) {
      const combined = `${run.stdout}\n${run.stderr}`;
      expect(combined).not.toContain("quota_freeing_states");
      expect(combined).not.toContain('"blocking"');
    }
  });

  it("AC-DC-2: no source file under packages/<pkg>/src still defines the refusal payload field", () => {
    const needle = "quota_freeing" + "_states"; // reason: split so a copy of this literal here can never be its own match.
    const offenders = sourceFiles().filter((file) => readFileSync(file, "utf8").includes(needle));
    expect(offenders).toEqual([]);
  });
});

describe("AC-DC-3: the retired feedback.inbound.open_report_cap ceiling decides nothing", () => {
  it("AC-DC-3: BOUNDARY — with the key set to 3, the 3rd, 4th and 5th filings all exit exactly 0", () => {
    expect(retiredKeyRuns).toHaveLength(RETIRED_CAP_VALUE + 2);
    retiredKeyRuns.forEach((run, index) => {
      expect(run.exitCode, `filing ${index + 1}: ${run.stderr}`).toBe(0);
    });
    expect(readPostBodies(retiredKeyStub)).toHaveLength(RETIRED_CAP_VALUE + 2);
  });

  it("AC-DC-3: REGRESSION — the retired key still parses and is NAMED in a warning, never silently dropped", () => {
    const withWarning = retiredKeyRuns.filter((run) => run.stderr.includes("open_report_cap"));
    expect(withWarning.length).toBeGreaterThan(0);
  });

  it("AC-DC-3: NEGATIVE control — the corpus that never set the key emits no cap warning", () => {
    for (const run of uncappedRuns) {
      expect(run.stderr).not.toContain("open_report_cap");
    }
  });
});
