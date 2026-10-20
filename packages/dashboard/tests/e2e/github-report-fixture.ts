/**
 * Shared fixture for the dashboard Issues e2e specs (`issues.spec.ts`, `issues-resolution.spec.ts`): files reports
 * through the REAL compiled `dist/lore report-issue` against the project's offline recording `gh` stub, never the
 * network and never the retired SQLite `feedback.upstream.{corpus_path,root_prd}` shape (which `report-issue` now
 * refuses with exit 4).
 *
 * How it works: the e2e corpus (the one `lore serve` has open) is configured with `feedback.upstream.repo`; every
 * `report-issue` spawn runs with `PATH` pinned to JUST the stub directory, so a real `gh` can never be reached. A
 * filing posts the issue to the stub and the filing corpus gets its issue task `task-gh-<repo_id>-<number>`
 * (carrying `extra.issue_report`), which is the row the dashboard Issues projection reads.
 *
 * Public surface: {@link startGithubReportFixture}, {@link GithubReportFixture}.
 *
 * Invariants:
 *   - Every path used is asserted under the OS tmpdir; the repo's own `.lore/` is never touched.
 *   - The e2e corpus's `feedback` config key is removed again by {@link GithubReportFixture.stop}.
 *
 * Side-effect class: IO (temp dirs, process spawns, one config key in the e2e corpus).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dropLoreConfigKey, patchLoreConfig } from "../../../lore/tests/helpers/patch-lore-config.js";
import {
  cleanupRecordingGhStubDir,
  recordingGhStubDir,
  setNextCreatedNumber,
} from "../../../lore/tests/integration/helpers/recording-gh-stub.js";
import { e2eStateHome, knownPartyEnv } from "./known-party.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e -> tests -> dashboard -> packages -> <repo root>
export const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
export const DIST_LORE = join(REPO_ROOT, "dist", "lore");
export const TMP_ROOT = tmpdir();

/** The fake repository the stub answers for; its numeric id is the rename-proof key in every issue-task slug. */
export const FAKE_REPO = "acme-e2e/dashboard-issues";
export const FAKE_REPO_ID = 880_320;

/** Every fixture path used by the e2e suites MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
export function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

export interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Synchronous `dist/lore <args>` spawn as a KNOWN PARTY (BR-1351): the e2e human session, agent harness marker
 * stripped (see known-party.ts). `ghStubDir`, when given, becomes the child's whole PATH.
 */
export function runLore(args: string[], cwd: string, opts: { env?: Record<string, string>; ghStubDir?: string } = {}): CliResult {
  assertUnderTmp(cwd);
  const env = knownPartyEnv(e2eStateHome(), opts.env ?? {});
  if (opts.ghStubDir !== undefined) env["PATH"] = opts.ghStubDir;
  try {
    const stdout = execFileSync(DIST_LORE, args, { cwd, env }).toString();
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const failure = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: failure.stdout?.toString() ?? "",
      stderr: failure.stderr?.toString() ?? "",
      status: failure.status ?? 1,
    };
  }
}

/** `runLore` + `--json`, parsed. Throws with full stdio context on a non-zero exit or a non-JSON response. */
export function runLoreJson<T>(args: string[], cwd: string, opts: { env?: Record<string, string>; ghStubDir?: string } = {}): T {
  const result = runLore([...args, "--json"], cwd, opts);
  if (result.status !== 0) {
    throw new Error(`'lore ${args.join(" ")}' exited ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from 'lore ${args.join(" ")}' (exit ${result.status}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

/** Fails loud when `dist/lore` is missing: the specs spawn the compiled binary, they never build it. */
export function buildDistLore(): void {
  execFileSync("bun", ["run", "build"], { cwd: REPO_ROOT });
}

/** The corpus root the e2e `lore serve` has open (global-setup publishes its db path). */
export function e2eCorpusRoot(): string {
  const dbPath = process.env["LORE_E2E_DB_PATH"];
  if (dbPath === undefined) {
    throw new Error("LORE_E2E_DB_PATH is not set — expected global-setup.ts to publish it");
  }
  const root = dirname(dirname(dbPath));
  assertUnderTmp(root);
  return root;
}

export interface FileReportInput {
  title: string;
  description: string;
  expected: string;
  actual: string;
  actor: string;
}

export interface FiledGithubReport {
  /** GitHub issue number the stub assigned. */
  number: number;
  /** The issue task's slug in the e2e corpus (`task-gh-<repo_id>-<number>`). */
  slug: string;
  /** The issue task's doc id (what the dashboard routes by). */
  docId: string;
}

export interface GithubReportFixture {
  readonly corpusRoot: string;
  readonly ghStubDir: string;
  /** Files one report through `dist/lore report-issue` against the stub and resolves its issue task. */
  fileReport(input: FileReportInput): FiledGithubReport;
  /** Best-effort: approve an issue task so it leaves the open set (restores the shared "0 open" baseline). */
  cleanupApprove(docId: string): void;
  /** Removes the stub + config dirs and drops the `feedback` key from the e2e corpus config. */
  stop(): void;
}

/**
 * Points the e2e corpus at the fake GitHub repo (`feedback.upstream.repo`), makes sure it has a root PRD (filing
 * publishes the reporter's root-PRD identity), and returns the filing handle.
 */
export function startGithubReportFixture(prefix: string): GithubReportFixture {
  const corpusRoot = e2eCorpusRoot();
  const ghStubDir = recordingGhStubDir({ repoId: FAKE_REPO_ID, login: "e2e-reporter" });
  assertUnderTmp(ghStubDir);
  const configHome = mkdtempSync(join(TMP_ROOT, `lore-e2e-${prefix}-cfg-`));
  assertUnderTmp(configHome);

  patchLoreConfig(corpusRoot, { feedback: { upstream: { repo: FAKE_REPO } } });

  const prds = runLoreJson<{ ok: true; data: { docs: Array<{ id: string }> } }>(["list", "--type", "prd"], corpusRoot);
  if (prds.data.docs.length === 0) {
    runLoreJson(
      ["create", "prd", "--title", "E2E Issues Root PRD", "--content", "seed root prd for the dashboard issues e2e"],
      corpusRoot,
    );
  }

  let nextNumber = 1000 + Math.floor(Math.random() * 100_000);

  return {
    corpusRoot,
    ghStubDir,
    fileReport(input) {
      const number = nextNumber++;
      setNextCreatedNumber(ghStubDir, number);
      const filed = runLoreJson<{ ok: true; data: { number: number } }>(
        [
          "report-issue",
          "--title",
          input.title,
          "--description",
          input.description,
          "--expected",
          input.expected,
          "--actual",
          input.actual,
          "--severity",
          "medium",
          "--category",
          "cli",
        ],
        corpusRoot,
        { env: { LORE_ACTOR: input.actor, LORE_CONFIG_HOME: configHome }, ghStubDir },
      );
      if (filed.data.number !== number) {
        throw new Error(`stub answered issue #${filed.data.number}, expected #${number}`);
      }
      const slug = `task-gh-${FAKE_REPO_ID}-${number}`;
      const doc = runLoreJson<{ ok: true; data: { doc: { id: string } } }>(["get", slug], corpusRoot);
      return { number, slug, docId: doc.data.doc.id };
    },
    cleanupApprove(docId) {
      try {
        runLore(["approve", docId], corpusRoot);
      } catch {
        // best-effort — a test's own assertions already reported anything meaningfully wrong
      }
    },
    stop() {
      try {
        dropLoreConfigKey(corpusRoot, ["feedback"]);
      } catch {
        // best-effort
      }
      cleanupRecordingGhStubDir(ghStubDir);
      rmSync(configHome, { recursive: true, force: true });
    },
  };
}
