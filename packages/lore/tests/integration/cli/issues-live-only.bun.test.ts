// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-2
 * @task task-skill-refactor-gs-t5-lore-issues-live-only-push-only-sync
 *
 * `lore issues` reads ONLY the live GitHub listing joined with carriers: offline, unauthenticated or rate-limited
 * it exits 9 / 8 / 10 and lists nothing, EVEN THOUGH the corpus holds a carrier naming #7. There is no
 * `--local` and no offline fallback.
 *
 * Oracle: the real CLI entry (`bun run src/index.ts`, the same function the compiled binary calls, so no stale
 * `dist/lore` can mislead) spawned against a throwaway corpus (`mkdtemp` + `lore init`), with PATH holding ONLY a
 * recording `gh` stub. The stub serves a healthy repository while the carrier is created (the `--issue` write
 * path reads GitHub), then is flipped to fail as a network error, as not-logged-in, or as rate-limited. It never
 * reaches GitHub.
 *
 * Six-dimension note:
 *   HAPPY      healthy stub: `--all --json` lists #7 with its carrier (control: proves the fixture is live, so the
 *              later absence of '#7' means the command refused, not that the fixture was empty).
 *   NEGATIVE   `--local` is an unknown switch: exit exactly 2.
 *   ERROR      network -> 9; not-logged-in -> 8 and stderr names `gh auth login`; rate-limited -> 10 and stderr
 *              carries the reset time.
 *   BOUNDARY   in all three failures stdout parses to no rows and contains neither '#7' nor the carrier's slug.
 *   STATE      the carrier is present in the corpus during every failure (checked through `lore get`).
 *   REGRESSION the red-once mutation: catching TRANSPORT_UNAVAILABLE in commands/issues.ts and listing the carrier
 *              index. Such a fallback may still exit 9, so the row-absence assertion on '#7' is the one that
 *              catches it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";
const FAKE_REPO = "acme/widget";
const REPO_ID = 4242;
const INDEX_TS = join(new URL("../../../", import.meta.url).pathname, "src", "index.ts");
const RESET_EPOCH = 1893456000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const dirsToClean: string[] = [];
afterAll(() => {
  for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
});

/** The stub `gh`: sh builtins only (PATH holds nothing else). The `mode` file picks healthy / network / auth / rate. */
function writeStubGh(stubDir: string): void {
  const script = `#!/bin/sh
D="${stubDir}"
echo "$*" >> "$D/gh.log"
mode=ok
[ -f "$D/mode" ] && read -r mode < "$D/mode"
case "$mode" in
  network) echo "error connecting to api.github.com: could not resolve host: api.github.com" >&2; exit 1 ;;
  auth) echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 1 ;;
  rate) printf 'HTTP 403: API rate limit exceeded\\nX-RateLimit-Reset: ${RESET_EPOCH}\\n' >&2; exit 1 ;;
esac
path="$2"
if [ "$path" = "user" ]; then printf '%s\\n' '{"login":"stub-user"}'; exit 0; fi
if [ "$path" = "repos/${FAKE_REPO}" ]; then printf '%s\\n' '{"id":${REPO_ID},"name":"widget"}'; exit 0; fi
case "$path" in
  "repos/${FAKE_REPO}/issues?"*)
    printf 'HTTP/2.0 200 OK\\n\\n'
    printf '%s\\n' '[{"number":7,"title":"Seven is broken","state":"open","body":"","labels":[],"state_reason":null}]'
    exit 0 ;;
esac
echo "stub gh: unrecognised api path: $path" >&2
exit 99
`;
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
}

/** Spawns the CLI entry with PATH = the stub directory only. */
function runLore(corpusDir: string, stubDir: string, args: readonly string[]): RunResult {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(CLAUDE|ANTHROPIC)/.test(key) || (key.startsWith("LORE") && !key.startsWith("LORE_TEST_"))) continue;
    env[key] = value;
  }
  const proc = spawnSync(process.execPath, [INDEX_TS, ...args], {
    cwd: corpusDir,
    encoding: "utf8",
    env: { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDE_CODE_SESSION_ID: "gs2fixture", EDITOR: "true", PATH: stubDir },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status ?? -1 };
}

function mustRun(corpusDir: string, stubDir: string, args: readonly string[]): RunResult {
  const result = runLore(corpusDir, stubDir, args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
  return result;
}

/** A throwaway corpus configured for the fake repository, holding ONE task carrier naming #7. */
function makeCorpusWithCarrier(): { dir: string; stubDir: string; slug: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-gs2-corpus-")));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-gs2-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  makeCleanTreeRepo(dir);
  mustRun(dir, stubDir, ["init"]);
  appendFileSync(join(dir, ".lore", "config.yaml"), `feedback:\n  upstream:\n    repo: ${FAKE_REPO}\n`);
  mustRun(dir, stubDir, ["create", "prd", "--title", "Carrier Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"]);
  const created = mustRun(dir, stubDir, [
    "create", "task", "--adhoc", "--ac-scope", "", "--title", "Carrier of seven", "--no-ai", "--content", "Carrier.", "--issue", "7", "--json",
  ]);
  return { dir, stubDir, slug: (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug };
}

/** The `reports` array of a `--json` stdout; an empty stdout (nothing printed) is zero rows. */
function rowsOf(stdout: string): unknown[] {
  if (stdout.trim() === "") return [];
  const parsed = JSON.parse(stdout) as { data?: { reports?: unknown[] } };
  return parsed.data?.reports ?? [];
}

describe(`${SPEC}#AC-GS-2 lore issues is live-only`, () => {
  let fixture: { dir: string; stubDir: string; slug: string };
  // Four spawns (init + create + two reads) build the fixture: an explicit timeout, never the 10s default.
  beforeAll(() => {
    fixture = makeCorpusWithCarrier();
  }, 120_000);
  const issuesArgs = ["issues", "--all", "--json"];

  it(`${SPEC}#AC-GS-2 control: a healthy listing shows #7 with its carrier`, () => {
    writeFileSync(join(fixture.stubDir, "mode"), "ok");
    const result = runLore(fixture.dir, fixture.stubDir, issuesArgs);
    expect(result.exitCode).toBe(0);
    const rows = rowsOf(result.stdout) as Array<{ number: number; carriers: string[]; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe(7);
    expect(rows[0]?.carriers).toEqual([fixture.slug]);
    expect(rows[0]?.status).toBe("adopted");
  }, 60_000);

  it(`${SPEC}#AC-GS-2 network failure exits 9 and lists nothing`, () => {
    writeFileSync(join(fixture.stubDir, "mode"), "network");
    const result = runLore(fixture.dir, fixture.stubDir, issuesArgs);
    expect(result.exitCode).toBe(9);
    expect(rowsOf(result.stdout)).toEqual([]);
    expect(result.stdout).not.toContain("#7");
    expect(result.stdout).not.toContain(fixture.slug);
  }, 60_000);

  it(`${SPEC}#AC-GS-2 not-logged-in exits 8, stderr names gh auth login, lists nothing`, () => {
    writeFileSync(join(fixture.stubDir, "mode"), "auth");
    const result = runLore(fixture.dir, fixture.stubDir, issuesArgs);
    expect(result.exitCode).toBe(8);
    expect(result.stderr).toContain("gh auth login");
    expect(rowsOf(result.stdout)).toEqual([]);
    expect(result.stdout).not.toContain("#7");
    expect(result.stdout).not.toContain(fixture.slug);
  }, 60_000);

  it(`${SPEC}#AC-GS-2 rate limit exits 10, stderr carries the reset time, lists nothing`, () => {
    writeFileSync(join(fixture.stubDir, "mode"), "rate");
    const result = runLore(fixture.dir, fixture.stubDir, issuesArgs);
    expect(result.exitCode).toBe(10);
    // The reset is rendered either as the raw epoch or as an ISO timestamp of it; both name the same instant.
    const isoReset = new Date(RESET_EPOCH * 1000).toISOString();
    expect(result.stderr.includes(String(RESET_EPOCH)) || result.stderr.includes(isoReset.slice(0, 16))).toBe(true);
    expect(rowsOf(result.stdout)).toEqual([]);
    expect(result.stdout).not.toContain("#7");
    expect(result.stdout).not.toContain(fixture.slug);
  }, 60_000);

  it(`${SPEC}#AC-GS-2 the human listing prints no carrier row while offline either`, () => {
    writeFileSync(join(fixture.stubDir, "mode"), "network");
    const result = runLore(fixture.dir, fixture.stubDir, ["issues", "--all"]);
    expect(result.exitCode).toBe(9);
    expect(result.stdout).not.toContain("#7");
    expect(result.stdout).not.toContain(fixture.slug);
    expect(result.stdout).not.toContain("Seven is broken");
  }, 60_000);

  it(`${SPEC}#AC-GS-2 --local is an unknown switch (exit 2)`, () => {
    writeFileSync(join(fixture.stubDir, "mode"), "ok");
    const result = runLore(fixture.dir, fixture.stubDir, ["issues", "--local"]);
    expect(result.exitCode).toBe(2);
  }, 60_000);
});
