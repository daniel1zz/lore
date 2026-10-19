/**
 * AC-IT-2 — the COMPILED `dist/lore`: `lore done` on a filed report's OWN task closes its GitHub issue, and
 * `lore issues --sync` closes the done-archived ones while only labelling the rest
 * (spec-completing-an-adopted-report-s-own-task-closes-its-github D1-D3). Real binary, throwaway corpus
 * (mkdtemp; cwd and HOME both inside it), hermetic session ids (CLAUDE_CODE_SESSION_ID per call, inherited
 * CLAUDE_* / LORE_* / ANTHROPIC* dropped), and a STUB `gh` first on PATH serving one fake repository
 * (`acme/widget`): it logs every argv and answers anything it does not recognise with exit 99 — it NEVER
 * delegates to a real `gh`, so nothing here can reach GitHub.
 *   HAPPY:      report task for #9 completed with lore done (after a runner-attested pass) exits 0; the stub log
 *               shows the close with state_reason=completed, a comment naming the task, label resolution:closed.
 *   ERROR:      with the stub failing the close, done for #10 still exits 0 and archives; stderr names #10.
 *   STATE:      --sync --json lists the done-archived #10 (completed_via_done) and the plain-status-archived #11;
 *               --sync --apply closes #10 only and merely labels #11 (exactly one PATCH after the failed one).
 *   REGRESSION: mutation "done does not call the step" leaves the stub log empty (HAPPY fails).
 *
 * Requires `bun run build` first; `assertFreshBinary` fails loud on a stale binary.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo";
import { Database } from "bun:sqlite";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const FAKE_REPO = "acme/widget";

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

/**
 * Writes the stub `gh`. State lives in files beside it: `state-<n>` (open|closed), `label-<n>` (the label name
 * applied), `fail` (present = the close PATCH exits 1). Only sh builtins plus `sed`/`cat` from the original PATH.
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
n=$(printf '%s' "$path" | sed -E 's#^repos/${FAKE_REPO}/issues/([0-9]+).*#\\1#')
labels_json() {
  if [ -f "$D/label-$n" ]; then printf '[{"name":"%s"}]' "$(cat "$D/label-$n")"; else printf '[]'; fi
}
case "$path" in
  "repos/${FAKE_REPO}/issues/$n")
    if [ "$method" = "PATCH" ]; then
      if [ -f "$D/fail" ]; then echo "gh: HTTP 502 Bad Gateway (stub)" >&2; exit 1; fi
      printf 'closed' > "$D/state-$n"
      printf '%s\\n' '{}'
      exit 0
    fi
    state=open
    [ -f "$D/state-$n" ] && state=$(cat "$D/state-$n")
    printf '{"state":"%s","labels":%s}\\n' "$state" "$(labels_json)"
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
esac
echo "stub gh: unrecognised api path: $path" >&2
exit 99
`;
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
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

function patchCount(corpus: Corpus): number {
  return ghLog(corpus).filter((line) => line.includes("-X PATCH")).length;
}

function slugOfCreate(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

/** Marks an adhoc task as a filed report for GitHub #<number> (no CLI verb writes issue_report with a github ref offline). */
async function makeFiledReport(corpus: Corpus, slug: string, number: number): Promise<void> {
  const id = (JSON.parse((await mustRun(corpus, "setup", ["get", slug, "--json"])).stdout) as { data: { doc: { id: string } } }).data.doc.id;
  const db = new Database(join(corpus.dir, ".lore", "lore.db"));
  try {
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(id) as { extra: string };
    const extra = JSON.parse(row.extra) as Record<string, unknown>;
    extra["issue_report"] = {
      reporter_project: "consumer",
      reporter_actor: "agent:fixture",
      lore_version: "0.0.0",
      expected: "exit 0",
      actual: "exit 4",
      reported_at: "2026-01-01T00:00:00.000Z",
      github: { repo: FAKE_REPO, number, repo_id: 555 },
    };
    db.query("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(extra), id);
  } finally {
    db.close();
  }
}

/** A fresh corpus with feedback.upstream naming the FAKE repo and filed report tasks for #9, #10 and #11. */
async function makeCorpus(): Promise<Corpus & { slugs: Record<number, string> }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-issue-task-done-e2e-")));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-issue-task-done-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  const corpus: Corpus = { dir, stubDir };
  makeCleanTreeRepo(dir);
  await mustRun(corpus, "setup", ["init"]);
  appendFileSync(join(dir, ".lore", "config.yaml"), ["feedback:", "  upstream:", `    repo: ${FAKE_REPO}`, ""].join("\n"));
  await mustRun(corpus, "setup", ["create", "prd", "--title", "Task Done Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"]);
  const slugs: Record<number, string> = {};
  for (const number of [9, 10, 11]) {
    const slug = slugOfCreate(
      (await mustRun(corpus, "setup", ["create", "task", "--adhoc", "--ac-scope", "", "--title", `Defect ${number}`, "--no-ai", "--content", "Defect.", "--json"])).stdout,
    );
    slugs[number] = slug;
    await makeFiledReport(corpus, slug, number);
  }
  return { ...corpus, slugs };
}

/** `lore done` after a runner-attested pass (`--capture` runs the command and attests its exit code). */
async function completeWithDone(corpus: Corpus, session: string, slug: string): Promise<RunResult> {
  await mustRun(corpus, session, ["evidence", slug, "--oracle", "test", "--command", "echo 1 passed", "--result", "pass", "--capture"]);
  return await runLore(corpus, session, ["done", slug, "--declare-no-new-tests", "fixture: throwaway task"]);
}

describe("AC-IT-2: lore done on a report's own task closes its issue (compiled, stub gh)", () => {
  it("HAPPY: exits 0, stub log shows close completed + a comment naming the task + label resolution:closed", async () => {
    const corpus = await makeCorpus();
    const slug = corpus.slugs[9] as string;

    const done = await completeWithDone(corpus, "S-happy", slug);

    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain("issue #9: closed on GitHub");
    const log = ghLog(corpus);
    expect(log.some((line) => line.includes(`repos/${FAKE_REPO}/issues/9 -X PATCH`) && line.includes("state=closed") && line.includes("state_reason=completed"))).toBe(true);
    const comment = log.find((line) => line.includes(`repos/${FAKE_REPO}/issues/9/comments`));
    expect(comment).toBeDefined();
    expect(comment).toContain(`Fixed by task ${slug} (completed `);
    expect(log.some((line) => line.includes(`repos/${FAKE_REPO}/issues/9/labels`) && line.includes("resolution:closed"))).toBe(true);
  });

  it("STATE: failed close keeps the archive; --sync lists the done-archived report and the status-archived one; --apply closes only the done one", async () => {
    const corpus = await makeCorpus();
    const doneSlug = corpus.slugs[10] as string;
    const plainSlug = corpus.slugs[11] as string;
    writeFileSync(join(corpus.stubDir, "fail"), "");

    const done = await completeWithDone(corpus, "S-fail", doneSlug);

    expect(done.exitCode).toBe(0);
    expect(done.stderr).toContain("#10");
    expect(done.stderr).toContain("lore issues --sync");
    const doc = JSON.parse((await mustRun(corpus, "S-fail", ["get", doneSlug, "--json"])).stdout) as { data: { doc: { status: string } } };
    expect(doc.data.doc.status).toBe("archived");

    // reason: DCL-1 (b) — `set --status archived` applies the `lore done` floors, so the plain-archive path holds a
    // runner-captured pass too (what it still does NOT do is close the issue: only `lore done` calls onTaskCompleted).
    await mustRun(corpus, "S-plain", ["evidence", plainSlug, "--oracle", "test", "--command", "echo 1 passed", "--result", "pass", "--capture"]);
    // the report task declares an empty ac_scope, which also asks for a runner-produced red row (no-new-tests floor)
    await mustRun(corpus, "S-plain", ["evidence", plainSlug, "--oracle", "test", "--command", "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false", "--result", "expected-fail", "--capture"]);
    await mustRun(corpus, "S-plain", ["set", plainSlug, "--status", "approved"]);
    await mustRun(corpus, "S-plain", ["set", plainSlug, "--status", "active"]);
    await mustRun(corpus, "S-plain", ["set", plainSlug, "--status", "archived"]);
    expect(patchCount(corpus)).toBe(1); // only the failed done-time attempt; the plain archive never tried to close

    const listed = await runLore(corpus, "S-sync", ["issues", "--sync", "--json"]);
    expect(listed.exitCode).toBe(0);
    const drift = (JSON.parse(listed.stdout) as {
      data: { drift: Array<{ number: number; computed: string; github_state: string; completed_via_done?: boolean }> };
    }).data.drift;
    expect(drift.map((entry) => entry.number).sort()).toEqual([10, 11]);
    expect(drift.find((entry) => entry.number === 10)).toMatchObject({ computed: "closed", github_state: "open", completed_via_done: true });
    expect(drift.find((entry) => entry.number === 11)?.completed_via_done).toBeUndefined();

    rmSync(join(corpus.stubDir, "fail"));
    const applied = await runLore(corpus, "S-sync", ["issues", "--sync", "--apply", "--json"]);
    expect(applied.exitCode).toBe(0);
    const rows = (JSON.parse(applied.stdout) as { data: { applied: Array<{ number: number; closed: boolean; labelled: boolean }> } }).data.applied;
    expect(rows.find((row) => row.number === 10)).toEqual({ number: 10, closed: true, labelled: true });
    expect(rows.find((row) => row.number === 11)).toEqual({ number: 11, closed: false, labelled: true });
    expect(patchCount(corpus)).toBe(2); // exactly one more PATCH: #10. #11 is only labelled.
    expect(ghLog(corpus).some((line) => line.includes("issues/11 -X PATCH"))).toBe(false);

    const clean = await runLore(corpus, "S-sync", ["issues", "--sync", "--json"]);
    expect((JSON.parse(clean.stdout) as { data: { drift: unknown[] } }).data.drift).toEqual([]);
  }, 60_000);
});
