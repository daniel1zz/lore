// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/src/index.ts
// @reads packages
// @reads packages/*/src/**
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-10
 * @task task-skill-refactor-gs-t7-filing-creates-no-corpus-document-mcp
 *
 * Filing a report creates NO corpus document (GitHub owns the report); only the
 * local filing-log receipts (intent + outcome) remain.
 *
 * Oracle: the real CLI entry (`bun packages/lore/src/index.ts report-issue`)
 *   against a throwaway corpus (`mkdtemp` + `lore init`) and a recording `gh`
 *   stub on PATH. `SELECT count(*)` over `docs` and `versions` is identical before
 *   and after; the filing log gains exactly one intent and one outcome line with
 *   the same key; a repeat prints "Already filed" with zero further create-POSTs.
 *   The assertion is on TOTAL doc count (a filing that mints its task under a
 *   different slug prefix would pass a "no task-gh-* slug" check).
 *
 * Six-dimension note: HAPPY (CLI filing), BOUNDARY (repeat filing), ERROR (exit code
 * exactly 0), STATE (doc/version counts, receipt lines), REGRESSION (receipt
 * intent/outcome still written).
 */

import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupRecordingGhStubDir, readPostBodies, recordingGhStubDir } from "../helpers/recording-gh-stub";

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const LORE_ENTRY = join(WORKTREE_ROOT, "packages", "lore", "src", "index.ts");
const REPO = "acme-test/gs-t7-filing";
const REPO_ID = 880_007;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let ghStub: string;
let configHome: string;
let corpus: string;

/** One synchronous `lore <args>` spawn from source; PATH holds ONLY the gh stub dir. */
function runLore(args: readonly string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([process.execPath, LORE_ENTRY, ...args], {
    cwd,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: configHome,
      PATH: ghStub,
      LORE_ACTOR: "agent:gs-t7-filing-test",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

/** `SELECT count(*)` over one table of the throwaway corpus's database. */
function countRows(root: string, table: "docs" | "versions"): number {
  const db = new Database(join(root, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function receiptLines(root: string): Array<Record<string, unknown>> {
  const path = join(root, ".lore", "issue-receipts-v2.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const FILING_ARGS = [
  "report-issue",
  "--title",
  "gs-t7 filing probe",
  "--description",
  "gs-t7 filing probe description",
  "--expected",
  "expected behaviour",
  "--actual",
  "actual behaviour",
  "--severity",
  "low",
  "--category",
  "c",
];

beforeAll(() => {
  ghStub = recordingGhStubDir({ repoId: REPO_ID });
  configHome = mkdtempSync(join(tmpdir(), "lore-gs-t7-config-home-"));
  corpus = mkdtempSync(join(tmpdir(), "lore-gs-t7-corpus-"));
  const init = runLore(["init"], corpus);
  if (init.exitCode !== 0) throw new Error(`'lore init' failed (exit ${init.exitCode}): ${init.stderr}`);
  const prd = runLore(
    ["create", "prd", "--title", "gs-t7 throwaway root PRD", "--content", "Throwaway root PRD."],
    corpus,
  );
  if (prd.exitCode !== 0) throw new Error(`root PRD creation failed (exit ${prd.exitCode}): ${prd.stderr}`);
  // BR-1528: the report body is rendered from the approved `issue-report` template (setup, so before the counts below).
  const seeded = runLore(["migrate", "templates", "--apply"], corpus);
  if (seeded.exitCode !== 0) throw new Error(`'lore migrate templates --apply' failed (exit ${seeded.exitCode}): ${seeded.stderr}`);
  patchLoreConfig(corpus, `feedback:\n  upstream:\n    repo: ${REPO}\n`);
}, 120_000);

afterAll(() => {
  if (ghStub !== undefined) cleanupRecordingGhStubDir(ghStub);
  for (const dir of [configHome, corpus]) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-10: filing creates zero corpus docs and still writes the receipt", () => {
  it("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-10: filing exits 0, prints number and URL, and leaves docs/versions counts unchanged", () => {
    const docsBefore = countRows(corpus, "docs");
    const versionsBefore = countRows(corpus, "versions");
    expect(docsBefore).toBeGreaterThan(0); // the root PRD: the baseline is non-trivial

    const run = runLore(FILING_ARGS, corpus);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/Filed as issue #\d+ \(https?:\/\/\S+\)/);
    expect(countRows(corpus, "docs")).toBe(docsBefore);
    expect(countRows(corpus, "versions")).toBe(versionsBefore);
    expect(readPostBodies(ghStub)).toHaveLength(1);
  });

  it("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-10: the filing log gained exactly one intent and one outcome line with the same key", () => {
    const lines = receiptLines(corpus);
    const intents = lines.filter((line) => line["phase"] === "intent");
    const outcomes = lines.filter((line) => line["phase"] === "outcome");
    expect(intents).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.["idempotency_key"]).toBe(intents[0]?.["idempotency_key"]);
  });

  it("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-10: repeating the command prints 'Already filed', exits 0, makes no further create-POST and no doc", () => {
    const docsBefore = countRows(corpus, "docs");

    const run = runLore(FILING_ARGS, corpus);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain("Already filed");
    expect(readPostBodies(ghStub)).toHaveLength(1);
    expect(countRows(corpus, "docs")).toBe(docsBefore);
    expect(receiptLines(corpus)).toHaveLength(2);
  });
});

// ─── AC-GS-15: the MCP surface ───────────────────────────────────────────────
