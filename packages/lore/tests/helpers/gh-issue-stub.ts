/**
 * A STUB `gh` plus a throwaway corpus wired to it, for the commands that talk to GitHub's issue API
 * (`lore issue adopt`, `lore issue resolve`; spec-github-owns-issue-report-state-no-mirror-task-work-carries).
 *
 * Public surface: `makeIssueFixture(issues, options)` -> `IssueFixture`; `IssueFixture.run` / `runAsync` /
 * `ghCalls` / `writes` / `resetLog` / `stateOf` / `counts`.
 *
 * Invariants:
 *   - The stub is first on PATH and never reaches GitHub. It keeps all state in `<stubDir>/state.json`
 *     (issue state, state_reason, labels, comments) and appends one JSON array (the argv) per call to
 *     `<stubDir>/gh.log`, so a test can assert the exact calls, their order and that a refused command made none.
 *   - The listing is paginated (`pageSize` issues per page, `Link: rel="next"` header) so a test can put an issue on page 2.
 *   - `fail-patch-<n>` / `fail-page-2` flag files make that call fail as a network error.
 *   - The corpus is `mkdtemp` + `lore init` with `feedback.upstream.repo` set and one root PRD; never the repository's own.
 *
 * Side-effect class: IO (temp dirs, subprocesses).
 */

import { patchLoreConfig } from "./patch-lore-config.js";
import { Database } from "bun:sqlite";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "./clean-tree-repo";
import { runLoreInProcess } from "./run-lore-in-process";

export const STUB_REPO = "acme/widget";
export const STUB_REPO_ID = 4242;

/** One issue the stub serves. */
export interface StubIssue {
  readonly number: number;
  readonly title?: string;
  readonly body?: string;
  readonly state?: "open" | "closed";
  readonly reason?: string | null;
  readonly labels?: readonly string[];
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface IssueFixture {
  readonly dir: string;
  readonly stubDir: string;
  /** Runs `lore <args>` in-process against the fixture corpus with the stub first on PATH. */
  run(args: string[], session?: string): Promise<RunResult>;
  /** Runs `lore <args>` as a SPAWNED `bun src/index.ts` process (for genuinely concurrent runs). */
  runSpawned(args: string[], session: string): Promise<RunResult>;
  /** Every `gh` call so far, oldest first, as argv arrays (without the leading `gh`). */
  ghCalls(): string[][];
  /** The calls that write (`-X POST|PATCH|DELETE`). */
  writes(): string[][];
  resetLog(): void;
  /** While armed, the stub holds the first listing page until two processes have requested it (a forced race). */
  armListingBarrier(): void;
  /** Removes the barrier and its arrival markers. */
  disarmListingBarrier(): void;
  /** Current stub-side facts of one issue. */
  stateOf(n: number): { state: string; reason: string | null; labels: string[]; comments: string[] };
  /** Row counts of the corpus tables. */
  counts(): { docs: number; versions: number; audit: number };
}

const STUB_JS = (stubDir: string): string => `
const fs = require("fs");
const D = ${JSON.stringify(stubDir)};
const REPO = ${JSON.stringify(STUB_REPO)};
const argv = process.argv.slice(2);
fs.appendFileSync(D + "/gh.log", JSON.stringify(argv) + "\\n");
const flagIdx = (f) => argv.indexOf(f);
const method = flagIdx("-X") >= 0 ? argv[flagIdx("-X") + 1] : "GET";
const fields = argv.map((a, i) => (argv[i - 1] === "-f" ? a : null)).filter((a) => a !== null);
const field = (name) => { const hit = fields.find((f) => f.startsWith(name + "=")); return hit === undefined ? undefined : hit.slice(name.length + 1); };
const read = () => JSON.parse(fs.readFileSync(D + "/state.json", "utf8"));
const write = (s) => fs.writeFileSync(D + "/state.json", JSON.stringify(s));
const out = (v) => { process.stdout.write(typeof v === "string" ? v : JSON.stringify(v) + "\\n"); process.exit(0); };
const net = () => { process.stderr.write("error connecting to api.github.com: could not resolve host: api.github.com\\n"); process.exit(1); };
if (argv[0] !== "api") { process.stderr.write("stub gh: unexpected call: " + argv.join(" ") + "\\n"); process.exit(99); }
const path = argv[1];
if (path === "user") out({ login: "stub-user" });
if (path === "repos/" + REPO) out({ id: ${STUB_REPO_ID}, name: "widget" });
const state = read();
const entry = (n) => { const i = state.issues[String(n)]; return { number: n, title: i.title, state: i.state, body: i.body, labels: i.labels.map((name) => ({ name })), state_reason: i.reason }; };
let m = path.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\?.*page=(\\d+)/);
if (m) {
  const page = Number(m[1]);
  if (page === 2 && fs.existsSync(D + "/fail-page-2")) net();
  if (page === 1 && fs.existsSync(D + "/barrier-listing")) {
    // Rendezvous: hold the first listing page until two processes have asked for it, so both have decided before either writes.
    fs.writeFileSync(D + "/arrived-" + process.pid, "1");
    const deadline = Date.now() + 20000;
    while (fs.readdirSync(D).filter((f) => f.startsWith("arrived-")).length < 2 && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  const nums = Object.keys(state.issues).map(Number).sort((a, b) => a - b);
  const slice = nums.slice((page - 1) * state.pageSize, page * state.pageSize);
  const more = page * state.pageSize < nums.length;
  const head = "HTTP/2.0 200 OK\\n" + (more ? 'Link: <https://api.github.com/repositories/${STUB_REPO_ID}/issues?state=all&per_page=100&page=' + (page + 1) + '>; rel="next"\\n' : "") + "\\n";
  out(head + JSON.stringify(slice.map(entry)) + "\\n");
}
m = path.match(/^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)(\\/comments|\\/labels)?(?:\\/(.+?))?(?:\\?.*)?$/);
if (!m) { process.stderr.write("stub gh: unrecognised api path: " + path + "\\n"); process.exit(99); }
const n = m[1];
const issue = state.issues[n];
if (issue === undefined) { process.stderr.write("stub gh: no such issue " + n + "\\n"); process.exit(99); }
if (m[2] === "/comments") {
  if (method === "POST") { issue.comments.push(field("body")); write(state); out({}); }
  out("HTTP/2.0 200 OK\\n\\n" + JSON.stringify(issue.comments.map((body) => ({ body }))) + "\\n");
}
if (m[2] === "/labels") {
  if (method === "DELETE") { const gone = decodeURIComponent(m[3]); issue.labels = issue.labels.filter((l) => l !== gone); write(state); out({}); }
  if (method === "POST") { const lbl = argv.find((a) => a.startsWith("labels[]=")).slice(9); issue.labels.push(lbl); write(state); out([]); }
  out(issue.labels.map((name) => ({ name })));
}
if (method === "PATCH") {
  if (fs.existsSync(D + "/fail-patch-" + n)) net();
  issue.state = field("state"); issue.reason = field("state_reason") ?? null; write(state); out({});
}
out({ state: issue.state, state_reason: issue.reason, labels: issue.labels.map((name) => ({ name })) });
`;

/**
 * Creates the stub, a throwaway corpus (config + one root PRD) and the runners.
 *
 * @param issues - the issues the stub serves, in number order across pages
 * @param options.pageSize - issues per listing page (default 100)
 * @param options.dirsToClean - the caller's cleanup list; the two temp dirs are pushed onto it
 * @param options.withRootPrd - false builds a corpus with NO prd (default true: one root PRD is created)
 */
export async function makeIssueFixture(
  issues: readonly StubIssue[],
  options: { readonly pageSize?: number; readonly dirsToClean: string[]; readonly withRootPrd?: boolean },
): Promise<IssueFixture> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-issue-corpus-")));
  const stubDir = realpathSync(mkdtempSync(join(tmpdir(), "lore-issue-stub-")));
  options.dirsToClean.push(dir, stubDir);

  writeFileSync(join(stubDir, "gh-stub.js"), STUB_JS(stubDir));
  writeFileSync(join(stubDir, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(stubDir, "gh-stub.js")}" "$@"\n`);
  chmodSync(join(stubDir, "gh"), 0o755);
  writeFileSync(join(stubDir, "gh.log"), "");
  const initial: Record<string, unknown> = {};
  for (const issue of issues) {
    initial[String(issue.number)] = {
      title: issue.title ?? `Issue ${issue.number}`,
      body: issue.body ?? "",
      state: issue.state ?? "open",
      reason: issue.reason ?? null,
      labels: [...(issue.labels ?? [])],
      comments: [],
    };
  }
  writeFileSync(join(stubDir, "state.json"), JSON.stringify({ pageSize: options.pageSize ?? 100, issues: initial }));

  const baseEnv = (session: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (/^(CLAUDE|LORE|ANTHROPIC)/.test(key) && !key.startsWith("LORE_TEST_SANDBOX")) continue;
      env[key] = value;
    }
    return {
      ...env,
      HOME: FIXTURE_HOME_OUTSIDE_REPO,
      CLAUDE_CODE_SESSION_ID: session,
      EDITOR: "true",
      PATH: `${stubDir}:${process.env["PATH"] ?? ""}`,
    };
  };

  const run = async (args: string[], session = "worker"): Promise<RunResult> => {
    const proc = await runLoreInProcess(args, { cwd: dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: baseEnv(session) });
    return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
  };

  const indexTs = join(new URL("../../", import.meta.url).pathname, "src", "index.ts");
  const runSpawned = async (args: string[], session: string): Promise<RunResult> => {
    const proc = Bun.spawn(["bun", "run", indexTs, ...args], { cwd: dir, env: baseEnv(session), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  makeCleanTreeRepo(dir);
  const must = async (args: string[]): Promise<void> => {
    const result = await run(args, "setup");
    if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
  };
  await must(["init"]);
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", "    plan-promote:", "      enabled: false", "    plan-close:", "      enabled: false", "  review:", "    judgment_required_types: []", "feedback:", "  upstream:", `    repo: ${STUB_REPO}`, ""].join("\n"),
  );
  if (options.withRootPrd !== false) {
    await must(["create", "prd", "--title", "Issue Fixture PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"]);
  }
  writeFileSync(join(stubDir, "gh.log"), "");

  const ghCalls = (): string[][] =>
    (existsSync(join(stubDir, "gh.log")) ? readFileSync(join(stubDir, "gh.log"), "utf8") : "")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as string[]);

  return {
    dir,
    stubDir,
    run,
    runSpawned,
    ghCalls,
    writes: () => ghCalls().filter((argv) => argv.some((a, i) => argv[i - 1] === "-X" && /^(POST|PATCH|DELETE)$/.test(a))),
    resetLog: () => writeFileSync(join(stubDir, "gh.log"), ""),
    armListingBarrier: () => writeFileSync(join(stubDir, "barrier-listing"), "1"),
    disarmListingBarrier: () => {
      rmSync(join(stubDir, "barrier-listing"), { force: true });
      for (const name of readdirSync(stubDir)) if (name.startsWith("arrived-")) rmSync(join(stubDir, name), { force: true });
    },
    stateOf: (n) => {
      const entry = (JSON.parse(readFileSync(join(stubDir, "state.json"), "utf8")) as { issues: Record<string, { state: string; reason: string | null; labels: string[]; comments: string[] }> }).issues[String(n)];
      if (entry === undefined) throw new Error(`stub has no issue #${n}`);
      return entry;
    },
    counts: () => {
      const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
      try {
        const count = (table: string): number => (db.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
        return { docs: count("docs"), versions: count("versions"), audit: count("audit") };
      } finally {
        db.close();
      }
    },
  };
}

/** Removes the fixture's temp dirs. */
export function cleanDirs(dirs: readonly string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
