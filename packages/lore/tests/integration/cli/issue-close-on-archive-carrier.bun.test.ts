// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/src/index.ts
// @reads packages
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-8
 * @task task-skill-refactor-gs-t4-close-on-archive-keyed-on-carriers
 *
 * Archiving a CARRIER (a task via `lore done`, a plan via `lore set --status archived`) closes every GitHub
 * issue its `extra.issues` names, skips an issue already closed with a verdict, and audits each failure.
 *
 * Oracle: the real command tree (`runLoreInProcess`) over a throwaway corpus (`mkdtemp` + `lore init`, a clean
 * git tree so `lore done` can bind evidence) and a STUB `gh` first on PATH. The stub serves one fake repository,
 * logs every argv, and answers anything it does not recognise with exit 99; it never reaches GitHub.
 * The carrier is written through the service (`lore create task|plan --issue N`), never by hand into the db.
 *
 * Six-dimension note:
 *   HAPPY      three-issue task carrier: #11 and #12 each get one comment naming the task, one PATCH
 *              closed/completed, one label write resolution:fixed.
 *   NEGATIVE   #13 (closed not_planned + resolution:rejected) gets no write at all and is reported skipped.
 *   ERROR      #12's PATCH fails as a network error: exit 0, task archived, stdout/stderr name #12 and
 *              `lore issues --sync`, exactly one issue_close_failed audit row names #12, #11 is still closed.
 *   BOUNDARY   the fixture names THREE issues, so a step that reads only `extra.issues[0]` fails on #12.
 *   STATE      a plan carrier closes the same way; a task with no carrier makes zero gh calls.
 *   REGRESSION the red-once mutation: onArchived reading only the first IssueRef.
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

interface StubIssue {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly stateReason?: string;
  readonly label?: string;
}

const dirsToClean: string[] = [];
afterAll(() => {
  for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes the stub `gh`. Per-issue state lives in files beside it: `state-<n>`, `reason-<n>`, `label-<n>` (the one
 * label name applied), and `fail-patch-<n>` (present = that issue's close PATCH fails as a network error).
 * `listing.json` is the array `GET repos/<repo>/issues?...` serves. Only sh builtins plus `sed`/`cat`.
 */
function writeStubGh(stubDir: string): void {
  const script = `#!/bin/sh
D="${stubDir}"
echo "$*" >> "$D/gh.log"
if [ "$1" != "api" ]; then echo "stub gh: unexpected call: $*" >&2; exit 99; fi
path="$2"
method=GET
prev=""
lbl=""
for a in "$@"; do
  if [ "$prev" = "-X" ]; then method="$a"; fi
  case "$a" in
    labels*=*) lbl="\${a#*=}" ;;
  esac
  prev="$a"
done
if [ "$path" = "user" ]; then printf '%s\\n' '{"login":"stub-user"}'; exit 0; fi
if [ "$path" = "repos/${FAKE_REPO}" ]; then printf '%s\\n' '{"id":${REPO_ID},"name":"widget"}'; exit 0; fi
case "$path" in
  "repos/${FAKE_REPO}/issues?"*)
    cat "$D/listing.json"
    exit 0 ;;
esac
n=$(printf '%s' "$path" | sed -E 's#^repos/${FAKE_REPO}/issues/([0-9]+).*#\\1#')
labels_json() {
  if [ -f "$D/label-$n" ]; then printf '[{"name":"%s"}]' "$(cat "$D/label-$n")"; else printf '[]'; fi
}
case "$path" in
  "repos/${FAKE_REPO}/issues/$n")
    if [ "$method" = "PATCH" ]; then
      if [ -f "$D/fail-patch-$n" ]; then echo "error connecting to api.github.com (stub)" >&2; exit 1; fi
      printf 'closed' > "$D/state-$n"
      printf 'completed' > "$D/reason-$n"
      printf '%s\\n' '{}'
      exit 0
    fi
    state=open
    [ -f "$D/state-$n" ] && state=$(cat "$D/state-$n")
    reason=null
    [ -f "$D/reason-$n" ] && reason="\\"$(cat "$D/reason-$n")\\""
    printf '{"state":"%s","state_reason":%s,"labels":%s}\\n' "$state" "$reason" "$(labels_json)"
    exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/comments")
    printf '%s\\n' '{}'
    exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/labels")
    if [ "$method" = "POST" ]; then
      printf '%s' "$lbl" > "$D/label-$n"
      printf '%s\\n' '[]'
      exit 0
    fi
    printf '%s\\n' "$(labels_json)"
    exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/labels/"*)
    rm -f "$D/label-$n"
    exit 0 ;;
esac
echo "stub gh: unrecognised api path: $path" >&2
exit 99
`;
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
}

/** Seeds the stub: the listing every `--issue` check reads and each issue's own state files. */
function seedStub(stubDir: string, issues: readonly StubIssue[]): void {
  writeFileSync(
    join(stubDir, "listing.json"),
    JSON.stringify(
      issues.map((issue) => ({
        number: issue.number,
        title: `Issue ${issue.number}`,
        state: issue.state,
        body: "",
        labels: issue.label === undefined ? [] : [{ name: issue.label }],
        state_reason: issue.stateReason ?? null,
      })),
    ),
  );
  for (const issue of issues) {
    writeFileSync(join(stubDir, `state-${issue.number}`), issue.state);
    if (issue.stateReason !== undefined) writeFileSync(join(stubDir, `reason-${issue.number}`), issue.stateReason);
    if (issue.label !== undefined) writeFileSync(join(stubDir, `label-${issue.number}`), issue.label);
  }
}

async function runLore(corpus: Corpus, session: string, args: string[]): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  const proc = await runLoreInProcess(args, {
    cwd: corpus.dir,
    home: FIXTURE_HOME_OUTSIDE_REPO,
    env: {
      ...env,
      HOME: FIXTURE_HOME_OUTSIDE_REPO,
      CLAUDE_CODE_SESSION_ID: session,
      EDITOR: "true",
      // stub first; the original PATH stays behind it only so `sed`/`cat` resolve inside the stub.
      PATH: `${corpus.stubDir}:${process.env["PATH"] ?? ""}`,
    },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

async function mustRun(corpus: Corpus, session: string, args: string[]): Promise<RunResult> {
  const result = await runLore(corpus, session, args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
  return result;
}

function ghLog(corpus: Corpus): string[] {
  const path = join(corpus.stubDir, "gh.log");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

/** The gh calls that write (PATCH, POST, DELETE) to issue `n`, oldest first. */
function writesTo(corpus: Corpus, n: number): string[] {
  return ghLog(corpus).filter(
    (line) => line.includes(`repos/${FAKE_REPO}/issues/${n}`) && /-X (PATCH|POST|DELETE)/.test(line),
  );
}

function slugOfCreate(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

/** `issue_close_failed` audit rows for this corpus, read straight from its database. */
function closeFailedAuditRows(corpus: Corpus): Array<{ issue: number; step: string; source: string }> {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const rows = db.query("SELECT details FROM audit WHERE action = 'issue_close_failed'").all() as Array<{ details: string }>;
    return rows.map((row) => JSON.parse(row.details) as { issue: number; step: string; source: string });
  } finally {
    db.close();
  }
}

/** A fresh corpus: clean git tree, feedback.upstream naming the FAKE repo, one root PRD, and the stub seeded with `issues`. */
async function makeCorpus(issues: readonly StubIssue[]): Promise<Corpus & { prdSlug: string }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-gs-t4-corpus-")));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-gs-t4-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  seedStub(stubDir, issues);
  const corpus: Corpus = { dir, stubDir };
  makeCleanTreeRepo(dir);
  await mustRun(corpus, "setup", ["init"]);
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    plan-promote:",
      "      enabled: false",
      "    plan-close:",
      "      enabled: false",
      "  review:",
      "    judgment_required_types: []",
      "feedback:",
      "  upstream:",
      `    repo: ${FAKE_REPO}`,
      "",
    ].join("\n"),
  );
  const prd = slugOfCreate(
    (await mustRun(corpus, "setup", ["create", "prd", "--title", "Carrier Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"])).stdout,
  );
  return { ...corpus, prdSlug: prd };
}

/** Creates a task carrier through the service (`--issue` writes `extra.issues`). */
async function createCarrierTask(corpus: Corpus, title: string, numbers: readonly number[]): Promise<string> {
  const issueArgs = numbers.flatMap((number) => ["--issue", String(number)]);
  return slugOfCreate(
    (await mustRun(corpus, "setup", ["create", "task", "--kind", "code", "--adhoc", "--ac-scope", "", "--title", title, "--no-ai", "--content", "Carrier.", ...issueArgs, "--json"])).stdout,
  );
}

/** `lore done` after a runner-attested pass (`--capture` runs the command and attests its exit code) on an unclaimed task: a claim naming a working copy would arm the not-landed floor, which needs a real `lore integrate`. */
async function completeWithDone(corpus: Corpus, slug: string): Promise<RunResult> {
  await mustRun(corpus, "worker", ["evidence", slug, "--oracle", "test", "--command", "echo 1 passed", "--result", "pass", "--capture"]);
  return await runLore(corpus, "worker", ["done", slug, "--declare-no-new-tests", "fixture: throwaway task"]);
}

async function statusOf(corpus: Corpus, slug: string): Promise<string> {
  return (JSON.parse((await mustRun(corpus, "setup", ["get", slug, "--json"])).stdout) as { data: { doc: { status: string } } }).data.doc.status;
}

const THREE_ISSUES: readonly StubIssue[] = [
  { number: 11, state: "open" },
  { number: 12, state: "open" },
  { number: 13, state: "closed", stateReason: "not_planned", label: "resolution:rejected" },
];

describe(`${SPEC}#AC-GS-8: archiving a carrier closes each named issue`, () => {
  it(
    `${SPEC}#AC-GS-8: lore done on a three-issue task closes #11 and #12 (comment, PATCH, fixed label each) and writes nothing to #13`,
    async () => {
      const corpus = await makeCorpus(THREE_ISSUES);
      const slug = await createCarrierTask(corpus, "Carrier three", [11, 12, 13]);

      const done = await completeWithDone(corpus, slug);

      expect(done.exitCode, done.stderr + done.stdout).toBe(0);
      expect(await statusOf(corpus, slug)).toBe("archived");
      for (const n of [11, 12]) {
        const writes = writesTo(corpus, n);
        const comments = writes.filter((line) => line.includes(`issues/${n}/comments`));
        expect(comments, `#${n} comments`).toHaveLength(1);
        expect(comments[0]).toContain(slug);
        const patches = writes.filter((line) => line.includes(`issues/${n} -X PATCH`));
        expect(patches, `#${n} PATCH`).toHaveLength(1);
        expect(patches[0]).toContain("state=closed");
        expect(patches[0]).toContain("state_reason=completed");
        const labelAdds = writes.filter((line) => line.includes(`issues/${n}/labels -X POST`));
        expect(labelAdds, `#${n} label write`).toHaveLength(1);
        expect(labelAdds[0]).toContain("labels[]=resolution:fixed");
      }
      expect(writesTo(corpus, 13), "#13 must receive no write at all").toEqual([]);
      expect(done.stdout).toContain("#13 skipped: closed as rejected");
      expect(closeFailedAuditRows(corpus)).toEqual([]);
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-8: a failed PATCH on #12 keeps exit 0 and the archive, names #12 and 'lore issues --sync', and audits exactly one row for #12`,
    async () => {
      const corpus = await makeCorpus(THREE_ISSUES);
      writeFileSync(join(corpus.stubDir, "fail-patch-12"), "");
      const slug = await createCarrierTask(corpus, "Carrier failing", [11, 12, 13]);

      const done = await completeWithDone(corpus, slug);

      expect(done.exitCode, done.stderr + done.stdout).toBe(0);
      expect(await statusOf(corpus, slug)).toBe("archived");
      const output = done.stdout + done.stderr;
      expect(output).toContain("#12");
      expect(output).toContain("lore issues --sync");
      // the failure on #12 did not stop #11: it is closed in full
      expect(writesTo(corpus, 11).filter((line) => line.includes("-X PATCH"))).toHaveLength(1);
      expect(writesTo(corpus, 11).filter((line) => line.includes("labels[]=resolution:fixed"))).toHaveLength(1);
      const audit = closeFailedAuditRows(corpus);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ issue: 12, step: "close", source: slug });
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-8: archiving a PLAN carrier closes its issues the same way`,
    async () => {
      const corpus = await makeCorpus(THREE_ISSUES);
      const planSlug = slugOfCreate(
        (
          await mustRun(corpus, "setup", [
            "create", "plan", "--title", "Plan carrier", "--parent", corpus.prdSlug, "--no-ai", "--content", "Plan body.",
            "--issue", "11", "--issue", "12", "--issue", "13", "--json",
          ])
        ).stdout,
      );
      await mustRun(corpus, "setup", ["set", planSlug, "--status", "approved"]);
      await mustRun(corpus, "setup", ["set", planSlug, "--status", "active"]);

      const archived = await runLore(corpus, "setup", ["set", planSlug, "--status", "archived"]);

      expect(archived.exitCode, archived.stderr + archived.stdout).toBe(0);
      for (const n of [11, 12]) {
        expect(writesTo(corpus, n).filter((line) => line.includes("-X PATCH") && line.includes("state_reason=completed")), `#${n} PATCH`).toHaveLength(1);
        expect(writesTo(corpus, n).filter((line) => line.includes(`issues/${n}/comments`))[0]).toContain(planSlug);
      }
      expect(writesTo(corpus, 13)).toEqual([]);
      expect(archived.stdout).toContain("#13 skipped: closed as rejected");
    },
    120_000,
  );

  it(
    `${SPEC}#AC-GS-8: a task that carries no issue makes zero gh calls when archived`,
    async () => {
      const corpus = await makeCorpus(THREE_ISSUES);
      const slug = slugOfCreate(
        (await mustRun(corpus, "setup", ["create", "task", "--kind", "code", "--adhoc", "--ac-scope", "", "--title", "No carrier", "--no-ai", "--content", "Plain.", "--json"])).stdout,
      );
      const callsBefore = ghLog(corpus).length;

      const done = await completeWithDone(corpus, slug);

      expect(done.exitCode, done.stderr + done.stdout).toBe(0);
      expect(ghLog(corpus).length).toBe(callsBefore);
    },
    120_000,
  );
});
