// @spawns packages/lore/src/index.ts
// @reads packages
// @reads scripts/check-unclaimed-oracle.ts
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-9
 * @task task-skill-refactor-gs-t8-status-check-issues-counts-plain
 *
 * `lore status --check-issues` counts issues per derived status from the LIVE listing joined with carriers, and
 * plain `lore status` never contacts GitHub.
 *
 * Fixture (the stub lists #20, #21, #22 all open):
 *   #20  one DEPRECATED task carrier (its only carrier)                -> adopted (abandoned)
 *   #21  a DEPRECATED plan AND a DRAFT task, both naming it            -> adopted (a live sibling exists)
 *   #22  one ARCHIVED task carrier                                     -> fixed (close pending)
 *
 * Oracle: the real command tree (`runLoreInProcess`) over a throwaway corpus (`mkdtemp` + `lore init`) and a
 * recording STUB `gh` first on PATH; it never reaches GitHub. Carrier statuses are set with a bare status UPDATE
 * on the throwaway database (no archive hook, so no close is attempted).
 *
 * Six-dimension note:
 *   HAPPY      `--check-issues --json` exits 0: adopted_abandoned_count 1 enumerating #20, close_pending_count 1
 *              enumerating #22.
 *   NEGATIVE   #21 is in neither count: a predicate that ignores sibling carriers counts it abandoned (count 2).
 *   BOUNDARY   the counts and their enumerations agree (`count === members.length`), sorted `#<n>`.
 *   ERROR      offline: `--check-issues` exits 9 and prints no counts; `--enumerate` of a live count also exits 9.
 *   STATE      plain `lore status --json` exits 0 with `issues == {checked:false}`, no `adopted_abandoned_count`
 *              key anywhere in `data`, and the stub log EMPTY (zero gh calls, not even `gh api user`).
 *   REGRESSION the red-once mutation: computing abandonment per carrier instead of per issue.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const slugOfCreate = (stdout: string): string => (JSON.parse(stdout) as { data: { slug: string } }).data.slug;

async function createTaskCarrier(corpus: Corpus, title: string, issue: number): Promise<string> {
  return slugOfCreate(
    (await mustRun(corpus, ["create", "task", "--adhoc", "--ac-scope", "", "--title", title, "--no-ai", "--content", "Carrier.", "--issue", String(issue), "--json"])).stdout,
  );
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

function ghLog(corpus: Corpus): string[] {
  const path = join(corpus.stubDir, "gh.log");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

interface IssuesPayload {
  checked: boolean;
  adopted_abandoned_count?: number;
  close_pending_count?: number;
  closed_unverified_count?: number;
  members?: Record<string, string[]>;
}

async function buildCorpus(): Promise<Corpus> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-gs-t8b-corpus-")));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-gs-t8b-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  writeFileSync(
    join(stubDir, "listing.json"),
    JSON.stringify(
      [20, 21, 22].map((number) => ({ number, title: `Issue ${number}`, state: "open", body: "", labels: [], state_reason: null })),
    ),
  );
  const corpus: Corpus = { dir, stubDir };
  makeCleanTreeRepo(dir);
  await mustRun(corpus, ["init"]);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    `workflow:\n  review:\n    judgment_required_types: []\nfeedback:\n  upstream:\n    repo: ${FAKE_REPO}\n`,
  );
  const prd = slugOfCreate(
    (await mustRun(corpus, ["create", "prd", "--title", "Carrier Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"])).stdout,
  );

  const deprecatedTask20 = await createTaskCarrier(corpus, "Deprecated carrier of twenty", 20);
  bareSetStatus(corpus, deprecatedTask20, "deprecated");

  const plan21 = slugOfCreate(
    (await mustRun(corpus, ["create", "plan", "--title", "Plan carrier of twenty-one", "--parent", prd, "--no-ai", "--content", "Plan body.", "--issue", "21", "--json"])).stdout,
  );
  bareSetStatus(corpus, plan21, "deprecated");
  await createTaskCarrier(corpus, "Draft carrier of twenty-one", 21);

  const archivedTask22 = await createTaskCarrier(corpus, "Archived carrier of twenty-two", 22);
  bareSetStatus(corpus, archivedTask22, "archived");
  return corpus;
}

describe(`${SPEC}#AC-GS-9 status --check-issues counts live, plain status makes no gh call`, () => {
  let corpus: Corpus;
  // Eleven spawns (init, prd, three tasks, one plan, reads) build the fixture: an explicit timeout.
  beforeAll(async () => {
    corpus = await buildCorpus();
  }, 240_000);

  it(
    `${SPEC}#AC-GS-9: abandoned counts #20 only and close-pending counts #22 only; #21 (live sibling) counts in neither`,
    async () => {
      const checked = await runLore(corpus, ["status", "--check-issues", "--json"]);
      expect(checked.exitCode, checked.stderr + checked.stdout).toBe(0);
      const issues = (JSON.parse(checked.stdout) as { data: { issues: IssuesPayload } }).data.issues;
      expect(issues.checked).toBe(true);
      expect(issues.adopted_abandoned_count).toBe(1);
      expect(issues.close_pending_count).toBe(1);
      expect(issues.members?.["adopted_abandoned_count"]).toEqual(["#20"]);
      expect(issues.members?.["close_pending_count"]).toEqual(["#22"]);
      expect(JSON.stringify(issues.members)).not.toContain("#21");
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-9: --enumerate prints #20 for adopted_abandoned_count and #22 for close_pending_count`,
    async () => {
      const abandoned = await runLore(corpus, ["status", "--enumerate", "adopted_abandoned_count"]);
      expect(abandoned.exitCode, abandoned.stderr).toBe(0);
      expect(abandoned.stdout).toContain("adopted_abandoned_count: 1 member(s)");
      expect(abandoned.stdout).toContain("#20");
      expect(abandoned.stdout).not.toContain("#21");
      const pending = await runLore(corpus, ["status", "--enumerate", "close_pending_count"]);
      expect(pending.exitCode, pending.stderr).toBe(0);
      expect(pending.stdout).toContain("close_pending_count: 1 member(s)");
      expect(pending.stdout).toContain("#22");
      expect(pending.stdout).not.toContain("#21");
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-9: plain status --json reports issues {checked:false}, carries no adopted_abandoned_count, and makes zero gh calls`,
    async () => {
      writeFileSync(join(corpus.stubDir, "gh.log"), "");
      const plain = await runLore(corpus, ["status", "--json"]);
      expect(plain.exitCode, plain.stderr + plain.stdout).toBe(0);
      const data = (JSON.parse(plain.stdout) as { data: Record<string, unknown> }).data;
      expect(data["issues"]).toEqual({ checked: false });
      expect(Object.keys(data)).not.toContain("adopted_abandoned_count");
      expect(plain.stdout).not.toContain("adopted_abandoned_count");
      expect(ghLog(corpus), "plain status must not call gh at all").toEqual([]);

      const human = await runLore(corpus, ["status"]);
      expect(human.exitCode, human.stderr).toBe(0);
      expect(human.stdout).toContain("issues: not checked (lore status --check-issues)");
      expect(ghLog(corpus)).toEqual([]);
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-9: offline, --check-issues and a live --enumerate both exit 9 and print no count`,
    async () => {
      writeFileSync(join(corpus.stubDir, "mode"), "network");
      try {
        const checked = await runLore(corpus, ["status", "--check-issues", "--json"]);
        expect(checked.exitCode).toBe(9);
        expect(checked.stdout).not.toContain("adopted_abandoned_count");
        const enumerated = await runLore(corpus, ["status", "--enumerate", "adopted_abandoned_count"]);
        expect(enumerated.exitCode).toBe(9);
        expect(enumerated.stdout).not.toContain("#20");
      } finally {
        writeFileSync(join(corpus.stubDir, "mode"), "ok");
      }
    },
    120_000,
  );
});
