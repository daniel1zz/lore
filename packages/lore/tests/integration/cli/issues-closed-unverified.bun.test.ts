// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/src/index.ts
// @reads packages
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-4
 * @task task-skill-refactor-gs-t8-status-check-issues-counts-plain
 *
 * A GitHub-only close is NOT a verified fix: GitHub says #5 is closed (completed, label resolution:fixed), and
 * only an ARCHIVED carrier turns that into `fixed`. Until then `lore issues --resolved` shows
 * `closed (unverified)` and `lore status --check-issues` counts it (`closed_unverified_count`).
 *
 * Oracle: the real command tree (`runLoreInProcess`) over a throwaway corpus (`mkdtemp` + `lore init`) and a
 * recording STUB `gh` first on PATH serving one fake repository whose listing holds #5 closed. It never reaches
 * GitHub. The archived carrier is written the way a bare store write would be (a status UPDATE on the throwaway
 * database) so that NO archive hook runs and the stub log proves no close was attempted.
 *
 * Six-dimension note:
 *   HAPPY      no carrier: #5 is `closed (unverified)`, the count is 1, `--enumerate closed_unverified_count` is `#5`.
 *   NEGATIVE   a DRAFT carrier naming #5 changes nothing (still `closed (unverified)`, still 1): the simplest
 *              green-but-broken implementation treats ANY carrier as verification.
 *   BOUNDARY   the same fixture once the carrier is ARCHIVED: `fixed`, count 0, enumeration empty.
 *   ERROR      offline listing: `--check-issues` exits 9 and prints no `issues` payload (no partial count).
 *   STATE      the corpus holds the carrier throughout; the stub log has no write call in any phase.
 *   REGRESSION the red-once mutation: relaxing the carrier predicate in `deriveIssueStatus` to "any carrier".
 */

import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";
const FAKE_REPO = "acme/widget";
const REPO_ID = 4242;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface Corpus {
  readonly dir: string;
  readonly stubDir: string;
}

const dirsToClean: string[] = [];
afterAll(() => {
  for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
});

/** The recording stub `gh`: serves `user`, the repository and the static `listing.json`; anything else exits 99. */
function writeStubGh(stubDir: string): void {
  const script = `#!/bin/sh
D="${stubDir}"
echo "$*" >> "$D/gh.log"
mode=ok
[ -f "$D/mode" ] && read -r mode < "$D/mode"
if [ "$mode" = "network" ]; then echo "error connecting to api.github.com: could not resolve host" >&2; exit 1; fi
path="$2"
if [ "$path" = "user" ]; then printf '%s\\n' '{"login":"stub-user"}'; exit 0; fi
if [ "$path" = "repos/${FAKE_REPO}" ]; then printf '%s\\n' '{"id":${REPO_ID},"name":"widget"}'; exit 0; fi
case "$path" in
  "repos/${FAKE_REPO}/issues?"*)
    printf 'HTTP/2.0 200 OK\\n\\n'
    cat "$D/listing.json"
    exit 0 ;;
esac
echo "stub gh: unrecognised api path: $path" >&2
exit 99
`;
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
}

async function runLore(corpus: Corpus, args: string[]): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  const proc = await runLoreInProcess(args, {
    cwd: corpus.dir,
    home: FIXTURE_HOME_OUTSIDE_REPO,
    env: { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDE_CODE_SESSION_ID: "gst8fixture", EDITOR: "true", PATH: `${corpus.stubDir}:${process.env["PATH"] ?? ""}` },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

async function mustRun(corpus: Corpus, args: string[]): Promise<RunResult> {
  const result = await runLore(corpus, args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
  return result;
}

/** A throwaway corpus whose stub lists #5 closed as completed with the label `resolution:fixed`. */
async function makeCorpus(): Promise<Corpus> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-gs-t8a-corpus-")));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-gs-t8a-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  writeFileSync(
    join(stubDir, "listing.json"),
    JSON.stringify([
      { number: 5, title: "Five was closed on GitHub", state: "closed", body: "", labels: [{ name: "resolution:fixed" }], state_reason: "completed" },
    ]),
  );
  const corpus: Corpus = { dir, stubDir };
  makeCleanTreeRepo(dir);
  await mustRun(corpus, ["init"]);
  patchLoreConfig(dir, `feedback:\n  upstream:\n    repo: ${FAKE_REPO}\n`);
  // an ad-hoc carrier task needs a root PRD to be parented to
  await mustRun(corpus, ["create", "prd", "--title", "Carrier Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"]);
  return corpus;
}

/** A carrier task naming #5 (`--issue` writes `extra.issues`); returns its slug. */
async function createCarrier(corpus: Corpus): Promise<string> {
  const created = await mustRun(corpus, [
    "create", "task", "--adhoc", "--ac-scope", "", "--title", "Carrier of five", "--no-ai", "--content", "Carrier.", "--issue", "5", "--json",
  ]);
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

/** The bare write: status UPDATE on the throwaway database, so no archive hook (and no gh close) runs. */
function bareSetStatus(corpus: Corpus, slug: string, status: string): void {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"));
  try {
    db.query("UPDATE docs SET status = ? WHERE slug = ?").run(status, slug);
    const row = db.query("SELECT status FROM docs WHERE slug = ?").get(slug) as { status: string } | null;
    if (row?.status !== status) throw new Error(`bare status write did not land for ${slug}: ${row?.status}`);
  } finally {
    db.close();
  }
}

function ghWrites(corpus: Corpus): string[] {
  const path = join(corpus.stubDir, "gh.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => /-X (PATCH|POST|DELETE)/.test(line));
}

async function statusOfFive(corpus: Corpus): Promise<string> {
  const listed = await runLore(corpus, ["issues", "--resolved", "--json"]);
  expect(listed.exitCode, listed.stderr + listed.stdout).toBe(0);
  const reports = (JSON.parse(listed.stdout) as { data: { reports: Array<{ number: number; status: string }> } }).data.reports;
  const five = reports.find((row) => row.number === 5);
  expect(five, "#5 must be listed under --resolved").toBeDefined();
  return five?.status ?? "";
}

async function closedUnverifiedCount(corpus: Corpus): Promise<number> {
  const checked = await runLore(corpus, ["status", "--check-issues", "--json"]);
  expect(checked.exitCode, checked.stderr + checked.stdout).toBe(0);
  const issues = (JSON.parse(checked.stdout) as { data: { issues: { checked: boolean; closed_unverified_count: number } } }).data.issues;
  expect(issues.checked).toBe(true);
  return issues.closed_unverified_count;
}

async function enumerated(corpus: Corpus): Promise<string> {
  const result = await runLore(corpus, ["status", "--enumerate", "closed_unverified_count"]);
  expect(result.exitCode, result.stderr + result.stdout).toBe(0);
  return result.stdout;
}

describe(`${SPEC}#AC-GS-4 a GitHub-only close is unverified`, () => {
  it(
    `${SPEC}#AC-GS-4: with no carrier, #5 is 'closed (unverified)', counted once and enumerated as #5`,
    async () => {
      const corpus = await makeCorpus();
      expect(await statusOfFive(corpus)).toBe("closed (unverified)");
      expect(await closedUnverifiedCount(corpus)).toBe(1);
      const out = await enumerated(corpus);
      expect(out).toContain("closed_unverified_count: 1 member(s)");
      expect(out).toContain("#5");
      expect(ghWrites(corpus)).toEqual([]);
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-4: a DRAFT carrier naming #5 leaves the status and the count unchanged`,
    async () => {
      const corpus = await makeCorpus();
      const slug = await createCarrier(corpus);
      expect(await statusOfFive(corpus), `draft carrier ${slug} must not verify the close`).toBe("closed (unverified)");
      expect(await closedUnverifiedCount(corpus)).toBe(1);
      expect(await enumerated(corpus)).toContain("#5");
      expect(ghWrites(corpus)).toEqual([]);
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-4: once the carrier is ARCHIVED (bare write, no gh close) #5 is 'fixed' and the count is 0`,
    async () => {
      const corpus = await makeCorpus();
      const slug = await createCarrier(corpus);
      bareSetStatus(corpus, slug, "archived");
      expect(await statusOfFive(corpus)).toBe("fixed");
      expect(await closedUnverifiedCount(corpus)).toBe(0);
      const out = await enumerated(corpus);
      expect(out).toContain("closed_unverified_count: 0 member(s)");
      expect(out).not.toContain("#5");
      expect(ghWrites(corpus), "no close was attempted: the archive was a bare write").toEqual([]);
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-4: an offline listing fails --check-issues with exit 9 and no issues payload`,
    async () => {
      const corpus = await makeCorpus();
      writeFileSync(join(corpus.stubDir, "mode"), "network");
      const checked = await runLore(corpus, ["status", "--check-issues", "--json"]);
      expect(checked.exitCode).toBe(9);
      expect(checked.stdout).not.toContain("closed_unverified_count");
    },
    120_000,
  );
});
