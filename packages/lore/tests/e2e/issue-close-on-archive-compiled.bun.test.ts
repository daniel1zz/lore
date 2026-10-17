/**
 * AC-IC-2 — the COMPILED `dist/lore` closes the GitHub issue a plan resolves when that plan is archived,
 * and binds plans to reports at creation (spec-archiving-the-work-that-resolves-a-defect-report-closes
 * D1-D5). Real binary, throwaway corpus (mkdtemp, `cwd`/`HOME` both pointed at it), and a STUB `gh`
 * executable first on PATH: the stub serves one fake repository (`acme/widget`), logs every argv to a
 * file, and answers any call it does not recognise with exit 99 — it NEVER delegates to a real `gh`, so
 * nothing here can reach GitHub.
 *   HAPPY:      --resolves 7 writes the link; archiving the plan prints 'issue #7: closed on GitHub'; the
 *               stub log shows the close with state_reason=completed and a comment naming the plan.
 *   NEGATIVE:   --resolves 999 and --resolves <non-report doc> exit exactly 4 and create nothing.
 *   BOUNDARY:   --resolves given twice (number form + task-gh slug form) writes both links.
 *   ERROR:      with the stub failing the close, the archive still exits 0, stderr names #8 and
 *               'lore issues --sync'; --sync --json lists #8 as drift; --sync --apply closes it.
 *   REGRESSION: mutation "closer not wired in app.ts" leaves the close log empty (first test fails).
 *
 * Requires `bun run build` first; `assertFreshBinary` fails loud on a stale binary.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
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

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
});
afterAll(() => {
  for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes the stub `gh`. State lives in files beside it: `state-<n>` (open|closed), `label-<n>` (present =
 * resolution:fixed applied), `fail` (present = the close PATCH exits 1). Uses only sh builtins plus `sed`,
 * resolved from the original PATH appended after the stub directory.
 */
function writeStubGh(stubDir: string): void {
  const script = `#!/bin/sh
D="${stubDir}"
echo "$*" >> "$D/gh.log"
if [ "$1" != "api" ]; then echo "stub gh: unexpected call: $*" >&2; exit 99; fi
path="$2"
method=GET
prev=""
for a in "$@"; do
  if [ "$prev" = "-X" ]; then method="$a"; fi
  prev="$a"
done
n=$(printf '%s' "$path" | sed -E 's#^repos/${FAKE_REPO}/issues/([0-9]+).*#\\1#')
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
    labels='[]'
    [ -f "$D/label-$n" ] && labels='[{"name":"resolution:fixed"}]'
    printf '{"state":"%s","labels":%s}\\n' "$state" "$labels"
    exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/comments")
    printf '%s\\n' '{}'
    exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/labels")
    if [ "$method" = "POST" ]; then
      : > "$D/label-$n"
      printf '%s\\n' '[]'
      exit 0
    fi
    if [ -f "$D/label-$n" ]; then printf '%s\\n' '[{"name":"resolution:fixed"}]'; else printf '%s\\n' '[]'; fi
    exit 0 ;;
esac
echo "stub gh: unrecognised api path: $path" >&2
exit 99
`;
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
}

function runLore(corpus: Corpus, args: string[]): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd: corpus.dir,
    env: {
      ...process.env,
      HOME: corpus.dir,
      CLAUDECODE: "1",
      EDITOR: "true",
      // stub first; the original PATH stays behind it only so `sed`/`cat` resolve inside the stub.
      PATH: `${corpus.stubDir}:${process.env["PATH"] ?? ""}`,
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(corpus: Corpus, args: string[]): RunResult {
  const result = runLore(corpus, args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
  return result;
}

function ghLog(corpus: Corpus): string[] {
  const path = join(corpus.stubDir, "gh.log");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

function slugOfCreate(stdout: string): string {
  const slug = (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
  return slug;
}

function idOf(corpus: Corpus, slug: string): string {
  return (JSON.parse(mustRun(corpus, ["get", slug, "--json"]).stdout) as { data: { doc: { id: string } } }).data.doc.id;
}

/** Marks an adhoc task as a filed report for GitHub #<number> (no CLI verb writes issue_report with a github ref offline). */
function makeFiledReport(corpus: Corpus, slug: string, number: number): void {
  const id = idOf(corpus, slug);
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

/** A fresh corpus: initialised, gates that would reject placeholder fixtures disabled, feedback.upstream naming the FAKE repo, two filed reports (#7, #8). */
function makeCorpus(): Corpus & { prdSlug: string; report7: string; report8: string } {
  const dir = mkdtempSync(join(tmpdir(), "lore-issue-close-e2e-"));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-issue-close-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  const corpus: Corpus = { dir, stubDir };
  mustRun(corpus, ["init"]);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    plan-promote:",
      "      enabled: false",
      "    plan-close:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "feedback:",
      "  upstream:",
      `    repo: ${FAKE_REPO}`,
      "",
    ].join("\n"),
  );
  const prd = slugOfCreate(
    mustRun(corpus, ["create", "prd", "--title", "Close Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"]).stdout,
  );
  const report7 = slugOfCreate(
    mustRun(corpus, ["create", "task", "--adhoc", "--ac-scope", "", "--title", "Defect seven", "--no-ai", "--content", "Defect.", "--json"]).stdout,
  );
  const report8 = slugOfCreate(
    mustRun(corpus, ["create", "task", "--adhoc", "--ac-scope", "", "--title", "Defect eight", "--no-ai", "--content", "Defect.", "--json"]).stdout,
  );
  makeFiledReport(corpus, report7, 7);
  makeFiledReport(corpus, report8, 8);
  return { ...corpus, prdSlug: prd, report7, report8 };
}

function createPlan(corpus: Corpus & { prdSlug: string }, title: string, extraArgs: string[]): RunResult {
  return runLore(corpus, [
    "create", "plan", "--title", title, "--parent", corpus.prdSlug, "--no-ai", "--content", "Plan body.", "--json", ...extraArgs,
  ]);
}

function planCount(corpus: Corpus): number {
  return (JSON.parse(mustRun(corpus, ["list", "--type", "plan", "--json"]).stdout) as { data: { docs: unknown[] } }).data.docs.length;
}

function resolvesTargets(corpus: Corpus, planSlug: string): string[] {
  const got = JSON.parse(mustRun(corpus, ["get", planSlug, "--json"]).stdout) as {
    data: { navigation: { related: Array<{ slug: string; link_type: string }> } };
  };
  return got.data.navigation.related.filter((r) => r.link_type === "resolves").map((r) => r.slug).sort();
}

function archivePlan(corpus: Corpus, planSlug: string): RunResult {
  mustRun(corpus, ["set", planSlug, "--status", "approved"]);
  mustRun(corpus, ["set", planSlug, "--status", "active"]);
  return runLore(corpus, ["set", planSlug, "--status", "archived"]);
}

describe("AC-IC-2: --resolves binds a plan to filed reports at creation", () => {
  it("--resolves 7 writes the plan and a resolves link that lore get shows", () => {
    const corpus = makeCorpus();
    const created = createPlan(corpus, "Plan resolving seven", ["--resolves", "7"]);
    expect(created.exitCode).toBe(0);
    const planSlug = slugOfCreate(created.stdout);
    expect(resolvesTargets(corpus, planSlug)).toEqual([corpus.report7]);
  });

  it("NEGATIVE: --resolves 999 exits exactly 4 and creates nothing", () => {
    const corpus = makeCorpus();
    const before = planCount(corpus);
    const refused = createPlan(corpus, "Plan resolving nothing", ["--resolves", "999"]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("999");
    expect(planCount(corpus)).toBe(before);
  });

  it("NEGATIVE: --resolves naming an existing document that is not a filed report exits exactly 4 and creates nothing", () => {
    const corpus = makeCorpus();
    const before = planCount(corpus);
    const refused = createPlan(corpus, "Plan resolving a PRD", ["--resolves", corpus.prdSlug]);
    expect(refused.exitCode).toBe(4);
    expect(planCount(corpus)).toBe(before);
  });

  it("NEGATIVE: one bad value among good ones refuses the whole creation", () => {
    const corpus = makeCorpus();
    const before = planCount(corpus);
    const refused = createPlan(corpus, "Plan half good", ["--resolves", "7", "--resolves", "999"]);
    expect(refused.exitCode).toBe(4);
    expect(planCount(corpus)).toBe(before);
  });

  it("BOUNDARY: --resolves given twice (number form and task-gh slug form) writes both links", () => {
    const corpus = makeCorpus();
    const created = createPlan(corpus, "Plan resolving two", ["--resolves", "7", "--resolves", corpus.report8]);
    expect(created.exitCode).toBe(0);
    expect(resolvesTargets(corpus, slugOfCreate(created.stdout))).toEqual([corpus.report7, corpus.report8].sort());
  });

  it("usage: --resolves on a type that cannot resolve (prd) exits 2", () => {
    const corpus = makeCorpus();
    const refused = runLore(corpus, ["create", "prd", "--title", "Second PRD", "--no-ai", "--content", "x", "--resolves", "7"]);
    expect(refused.exitCode).toBe(2);
  });
});

describe("AC-IC-2: archiving the resolving plan closes the issue on GitHub (stub gh)", () => {
  it("HAPPY: exits 0, prints 'issue #7: closed on GitHub', and the stub log shows close completed + a comment naming the plan", () => {
    const corpus = makeCorpus();
    const planSlug = slugOfCreate(createPlan(corpus, "Plan that fixes seven", ["--resolves", "7"]).stdout);

    const archived = archivePlan(corpus, planSlug);

    expect(archived.exitCode).toBe(0);
    expect(archived.stdout).toContain("issue #7: closed on GitHub");
    const log = ghLog(corpus);
    expect(log.some((line) => line.includes(`repos/${FAKE_REPO}/issues/7 -X PATCH`) && line.includes("state=closed") && line.includes("state_reason=completed"))).toBe(true);
    const comment = log.find((line) => line.includes(`repos/${FAKE_REPO}/issues/7/comments`));
    expect(comment).toBeDefined();
    expect(comment).toContain(planSlug);
    expect(log.some((line) => line.includes(`repos/${FAKE_REPO}/issues/7/labels`) && line.includes("labels[]=resolution:fixed"))).toBe(true);
    // the issue task itself is untouched (spec Out of scope)
    const report = JSON.parse(mustRun(corpus, ["get", corpus.report7, "--json"]).stdout) as { data: { doc: { status: string } } };
    expect(report.data.doc.status).toBe("draft");
  });

  it("ERROR: with the stub failing the close the archive still exits 0, stderr names #8 and 'lore issues --sync'; --sync lists it and --sync --apply closes it", () => {
    const corpus = makeCorpus();
    const planSlug = slugOfCreate(createPlan(corpus, "Plan that fixes eight", ["--resolves", "8"]).stdout);
    writeFileSync(join(corpus.stubDir, "fail"), "");

    const archived = archivePlan(corpus, planSlug);

    expect(archived.exitCode).toBe(0);
    expect(archived.stderr).toContain("#8");
    expect(archived.stderr).toContain("lore issues --sync");
    expect(archived.stdout).not.toContain("closed on GitHub");
    const plan = JSON.parse(mustRun(corpus, ["get", planSlug, "--json"]).stdout) as { data: { doc: { status: string } } };
    expect(plan.data.doc.status).toBe("archived");

    const listed = runLore(corpus, ["issues", "--sync", "--json"]);
    expect(listed.exitCode).toBe(0);
    const drift = (JSON.parse(listed.stdout) as { data: { drift: Array<{ number: number; computed: string; github_state: string }> } }).data.drift;
    expect(drift.map((d) => d.number)).toEqual([8]);
    expect(drift[0]).toMatchObject({ computed: "fixed", github_state: "open" });
    expect(ghLog(corpus).filter((line) => line.includes("-X PATCH"))).toHaveLength(1); // only the failed archive-time attempt; --sync wrote nothing

    rmSync(join(corpus.stubDir, "fail"));
    const applied = runLore(corpus, ["issues", "--sync", "--apply", "--json"]);
    expect(applied.exitCode).toBe(0);
    const appliedRows = (JSON.parse(applied.stdout) as { data: { applied: Array<{ number: number; closed: boolean; labelled: boolean }> } }).data.applied;
    expect(appliedRows).toEqual([{ number: 8, closed: true, labelled: true }]);
    expect(ghLog(corpus).filter((line) => line.includes("-X PATCH"))).toHaveLength(2);

    const clean = runLore(corpus, ["issues", "--sync", "--json"]);
    expect((JSON.parse(clean.stdout) as { data: { drift: unknown[] } }).data.drift).toEqual([]);
  }, 60_000);

  it("usage: --apply without --sync exits 2", () => {
    const corpus = makeCorpus();
    expect(runLore(corpus, ["issues", "--apply"]).exitCode).toBe(2);
  });
});
