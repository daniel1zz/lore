// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns dist/lore
// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-close-task-migration-compiled.bun.test.ts — `lore migrate close-tasks [--apply]` observed through the COMPILED
 * `dist/lore` on a throwaway repository and corpus (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-13;
 * ledger D30, D41). The repository's own `.lore/` is never touched.
 *
 * Each test name starts with `AC-DCS2-13:` (with the colon).
 *
 *   AC-DCS2-13  a close task is a non-terminal task whose slug starts with the close-plan prefix and whose anchors name no file; the
 *               preview lists each with what it would do and writes nothing; `--apply` releases its claim, moves its evidence rows to
 *               the plan execution_log as evidence-moved entries, deprecates it, removes its blocks edges and runs the one plan close for
 *               each plan left with no open task; a plan close that fails exits 4 naming the cause after the other plans were processed;
 *               a second `--apply` writes nothing
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository. The AI of the plan close's assess is a shell-script
 * double (a claude-cli provider command) and `gh` is a stub first on PATH, so nothing leaves the machine. Every `lore migrate` call is
 * a REAL spawn of `dist/lore`; the setup (plans, tasks, claim, evidence, landing) goes through the same command tree.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIST = join(PROJECT_ROOT, "dist", "lore");
const ENTRY = join(PROJECT_ROOT, "packages", "lore", "src", "index.ts");

const PASS_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" };
const OWNER = "dcs2-13-owner";

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

let fixture: DoneContractFixture;
let scratch = "";
let dbPath = "";
let aiLog = "";
let ghState = "";
let sequence = 0;

function envOf(session: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  return { ...env, CLAUDE_CODE_SESSION_ID: session, PATH: `${join(scratch, "gh-bin")}:${process.env["PATH"] ?? ""}`, ...extra, HOME: FIXTURE_HOME_OUTSIDE_REPO };
}

function spawnOut(command: string, args: readonly string[], cwd: string, session: string): Promise<Out> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env: envOf(session), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1, text: `${stdout}\n${stderr}` }));
  });
}

/** `lore migrate close-tasks ...` through the compiled binary. */
const migrate = (...flags: string[]): Promise<Out> => spawnOut(DIST, ["migrate", "close-tasks", ...flags], fixture.dir, OWNER);

/** A setup command through the in-process command tree (never one that archives a task). */
async function setup(args: readonly string[], session = OWNER): Promise<Out> {
  const result = await runLoreInProcess([...args], { cwd: fixture.dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: envOf(session) });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

async function mustSetup(args: readonly string[], session = OWNER): Promise<string> {
  const out = await setup(args, session);
  if (out.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${out.exitCode}: ${out.text}`);
  return out.stdout;
}

const gitIn = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The shell double of the assess AI: every judged dimension passes; one line per call is appended to the call log. */
function writeAiDouble(path: string): void {
  const dimension = `{"verdict":"pass","reason":"pass by the double","reference":"Google engineering code review guide"}`;
  const answer = `{"dimensions":{"spec_conformance":${dimension},"design_necessity":${dimension},"concurrency_safety":${dimension},"security":${dimension}},"criteria":[]}`;
  writeFileSync(path, ["#!/bin/sh", "cat >/dev/null", `echo "$(date +%s) plain" >> '${aiLog}'`, `cat <<'JSONEOF'`, answer, "JSONEOF", ""].join("\n"), { mode: 0o755 });
  chmodSync(path, 0o755);
}

/** A `gh` stub first on PATH: the issue API the batch reads and writes, state in a JSON file. */
function writeGhStub(dir: string): void {
  mkdirSync(dir, { recursive: true });
  ghState = join(dir, "state.json");
  writeFileSync(ghState, JSON.stringify({ next: 1, issues: [] }));
  writeFileSync(
    join(dir, "gh.js"),
    [
      `const fs = require("fs");`,
      `const S = ${JSON.stringify(ghState)};`,
      `const argv = process.argv.slice(2);`,
      `const state = JSON.parse(fs.readFileSync(S, "utf8"));`,
      `const out = (v) => { process.stdout.write(typeof v === "string" ? v : JSON.stringify(v) + "\\n"); process.exit(0); };`,
      `const fields = {};`,
      `for (let i = 0; i < argv.length; i += 1) if ((argv[i] === "-f" || argv[i] === "-F") && argv[i + 1] !== undefined) { const eq = argv[i + 1].indexOf("="); fields[argv[i + 1].slice(0, eq)] = argv[i + 1].slice(eq + 1); }`,
      `const method = argv.includes("-X") ? argv[argv.indexOf("-X") + 1] : "GET";`,
      `const path = argv[0] === "api" ? argv[1] : "";`,
      `const entry = (i) => ({ number: i.number, title: i.title, state: "open", body: i.body, html_url: "https://github.com/acme/widget/issues/" + i.number, labels: [], state_reason: null, id: 9000 + i.number, node_id: "I_" + i.number });`,
      `if (path === "user") out({ login: "stub-user" });`,
      `if (/^repos\\/[^/]+\\/[^/]+$/.test(path)) out({ id: 4242, name: "widget", full_name: "acme/widget" });`,
      `if (/^search\\/issues/.test(path)) out({ total_count: 0, items: [] });`,
      `if (/^repos\\/[^/]+\\/[^/]+\\/issues(\\?.*)?$/.test(path)) {`,
      `  if (method === "POST") { const issue = { number: state.next, title: fields.title, body: fields.body }; state.next += 1; state.issues.push(issue); fs.writeFileSync(S, JSON.stringify(state)); out(entry(issue)); }`,
      `  out(JSON.stringify(argv.includes("--slurp") ? [state.issues.map(entry)] : state.issues.map(entry)) + "\\n");`,
      `}`,
      `process.stderr.write("stub gh: unrecognised call: " + argv.join(" ") + "\\n"); process.exit(99);`,
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nexec bun ${JSON.stringify(join(dir, "gh.js"))} "$@"\n`, { mode: 0o755 });
  chmodSync(join(dir, "gh"), 0o755);
}

const withDb = <T>(body: (db: Database) => T): T => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return body(db);
  } finally {
    db.close();
  }
};

interface Row {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

const rowOf = (slug: string): Row =>
  withDb((db) => {
    const row = db.query("SELECT id, slug, status, version, extra FROM docs WHERE slug = ?").get(slug) as { id: string; slug: string; status: string; version: number; extra: string } | null;
    if (row === null) throw new Error(`no document ${slug}`);
    return { ...row, extra: JSON.parse(row.extra) as Record<string, unknown> };
  });

const auditCount = (): number => withDb((db) => (db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n);
const linkCount = (id: string): number => withDb((db) => (db.query("SELECT COUNT(*) AS n FROM links WHERE (from_id = ? OR to_id = ?) AND link_type = 'blocks'").get(id, id) as { n: number }).n);
const logOf = (slug: string): Array<Record<string, unknown>> => (rowOf(slug).extra["execution_log"] as Array<Record<string, unknown>> | undefined) ?? [];
const aiCalls = (): string[] => readFileSync(aiLog, "utf8").split("\n").filter((line) => line !== "");

/** A snapshot of every document and the audit trail, so "writes nothing" is a comparison of the whole corpus. */
const corpusSnapshot = (): string =>
  withDb((db) => JSON.stringify({ docs: db.query("SELECT id, status, version, extra FROM docs ORDER BY id").all(), audit: (db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n, links: db.query("SELECT * FROM links ORDER BY from_id, to_id, link_type").all() }));

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "dcs2-13-"));
  aiLog = join(scratch, "ai-calls.log");
  writeFileSync(aiLog, "");
  const aiScript = join(scratch, "fake-ai.sh");
  writeAiDouble(aiScript);
  writeGhStub(join(scratch, "gh-bin"));

  fixture = await makeDoneContractFixture();
  fixture.setDoneContractConfig(PASS_CONFIG);
  dbPath = join(fixture.dir, ".lore", "lore.db");
  patchLoreConfig(fixture.dir, {
    workflow: { gates: { "plan-promote": { enabled: false } }, review: { judgment_required_types: [] }, integrate: { floor_command: "true" } },
    ai: { provider: "claude-cli", providers: { "claude-cli": { command: aiScript, args: [], timeout_ms: 60000 } }, templates: {}, telemetry: false },
    feedback: { upstream: { repo: "acme/widget" } },
  });
  writeFileSync(join(fixture.dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { "check:plan-close": "echo Ran 1 tests", test: "echo Ran 1 tests", "test:file": "echo Ran 1 tests" } }));
  fixture.git(["add", "package.json"]);
  fixture.git(["commit", "-q", "-m", "fixture package scripts"]);
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs2-13-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
  if (!existsSync(DIST)) throw new Error(`dist/lore is missing at ${DIST}: run \`bun run build\` first`);
});

afterAll(() => {
  fixture?.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

/** A plan under the fixture spec, approved; `requiresUat` makes its close refuse without a verdict (the plan-uat-gate refusal). */
async function approvedPlan(title: string, requiresUat = false): Promise<string> {
  const plan = slugOf(
    await mustSetup(["create", "plan", "--title", title, "--parent", fixture.spec, "--content", "## Plan\n\nBody.\n", "--no-ai", ...(requiresUat ? ["--requires-uat"] : [])]),
  );
  await mustSetup(["approve", plan]);
  return plan;
}

/** A code task of the plan whose work landed on main (the assess measures a landing), so the plan can close. */
async function landedCodeTask(plan: string, label: string): Promise<string> {
  sequence += 1;
  const anchor = `tests/${label}.test.ts`;
  const slug = await fixture.createTask({ plan, kind: "code", title: `Work ${label}`, anchors: [anchor], acScope: ["AC-FX-1"] });
  await mustSetup(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  const branch = `dcs2-13-${label}-${sequence}`;
  const path = join(scratch, `${label}-${sequence}`);
  fixture.git(["worktree", "add", "-q", "-b", branch, path, "main"]);
  const claimed = await setup(["claim", slug, "--worktree", branch]);
  expect(claimed.exitCode, claimed.text).toBe(0);
  gitIn(path, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(path, ["config", "user.name", "fixture"]);
  mkdirSync(join(path, "tests"), { recursive: true });
  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(join(path, anchor), `// ${label}\n`);
  writeFileSync(join(path, "src", `${label}.ts`), `export const ${label} = 1;\n`);
  gitIn(path, ["add", "-A"]);
  gitIn(path, ["commit", "-q", "-m", `work ${label}`]);
  const finished = await runLoreInProcess(["finish", slug], { cwd: path, home: FIXTURE_HOME_OUTSIDE_REPO, env: envOf(OWNER) });
  expect(finished.exitCode, `${finished.stdout}${finished.stderr}`).toBe(0);
  const landed = await spawnOut("bun", ["run", ENTRY, "land", slug], fixture.dir, OWNER);
  expect(landed.exitCode, landed.text).toBe(0);
  return slug;
}

const NOW = "2026-01-01T00:00:00.000Z";

/** One runner-produced evidence row of the old protocol. */
const evidenceRow = (command: string): Record<string, unknown> => ({ oracle: "test", command, result: "pass", recorded_at: NOW, recorded_by: "agent:legacy", capture_source: "runner" });

/**
 * Writes an APPROVED, CLAIMED and EVIDENCED close task as the old protocol left it, straight into the throwaway corpus through the one
 * write route (a corpus task can no longer be claimed through the command tree, which is why the migration exists). Returns its slug.
 */
async function seedLegacyCloseTask(planSlug: string, title: string): Promise<string> {
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  try {
    const plan = await app.corpusService.get(planSlug);
    if (!plan.ok) throw new Error(`seed: plan ${planSlug} not found`);
    const extra: Record<string, unknown> = {
      plan_id: plan.value.doc.id,
      ac_scope: [],
      claim: { by: "agent:legacy", at: NOW, harness_run: "cc:legacy", start_head: fixture.git(["rev-parse", "HEAD"]) },
      verification_evidence: [evidenceRow("echo Ran 1 tests first"), evidenceRow("echo Ran 1 tests second")],
    };
    const created = await app.corpusService.create({ type: "task", title, content: "## Task\n\nClose the plan.\n", parent_id: plan.value.doc.id, extra });
    if (!created.ok) throw new Error(`seed: create failed: ${JSON.stringify(created.error)}`);
    const moved = await app.corpusService.writeDoc({ doc: created.value, patch: { status: "approved" }, action: "update", auditAction: "update", lock: "none" });
    if (!moved.ok) throw new Error(`seed: approve-write failed: ${JSON.stringify(moved.error)}`);
    return created.value.slug;
  } finally {
    app.close();
  }
}

interface CloseWorld {
  readonly plan: string;
  readonly closeTask: string;
  readonly blocker: string;
  readonly blocked: string;
  readonly evidenceCount: number;
}

/**
 * A plan whose only open task is a close task that is CLAIMED and EVIDENCED and holds blocks edges on both sides: a landed code task
 * blocks it, and it blocks a deprecated task. `landed` is false for the plan that never reaches its assess.
 */
async function closeWorld(label: string, options: { landed: boolean; requiresUat?: boolean }): Promise<CloseWorld> {
  const plan = await approvedPlan(`Plan ${label}`, options.requiresUat === true);
  const blocker = options.landed ? await landedCodeTask(plan, label) : await fixture.createTask({ plan, kind: "corpus", title: `Blocker ${label}` });
  if (!options.landed) await mustSetup(["set", blocker, "--status", "deprecated"]);
  const closeTask = await seedLegacyCloseTask(plan, `Close plan ${label}`);
  expect(closeTask.startsWith("task-close-plan-"), `the slug of the close task is ${closeTask}`).toBe(true);
  const blocked = await fixture.createTask({ plan, kind: "corpus", title: `Blocked ${label}` });
  await mustSetup(["set", blocked, "--status", "deprecated"]);
  await mustSetup(["link", blocker, closeTask, "--type", "blocks"]);
  await mustSetup(["link", closeTask, blocked, "--type", "blocks"]);
  const stored = rowOf(closeTask);
  expect(stored.extra["claim"], "the close task is claimed").toBeDefined();
  const evidenceCount = (stored.extra["verification_evidence"] as unknown[]).length;
  expect(evidenceCount).toBe(2);
  expect(linkCount(stored.id), "the close task holds blocks edges on both sides").toBe(2);
  return { plan, closeTask, blocker, blocked, evidenceCount };
}

describe("AC-DCS2-13: lore migrate close-tasks resolves every close task and runs the plan close that is due", () => {
  let first: CloseWorld;
  let second: CloseWorld;
  let lookalikeAnchored = "";
  let lookalikeTitle = "";

  beforeAll(async () => {
    first = await closeWorld("alpha", { landed: true });
    // a plan whose close refuses (its P0 UAT gate: no verdict is recorded): the other plans are still processed first or after it
    second = await closeWorld("beta", { landed: true, requiresUat: true });
    // look-alikes that are NOT close tasks: the prefix with a file anchor, and a task without the prefix whose title talks about closing
    const plan = await approvedPlan("Plan lookalikes");
    lookalikeAnchored = await fixture.createTask({ plan, kind: "code", title: "Close plan with a file", anchors: ["src/lookalike.ts"], acScope: [] });
    lookalikeTitle = await fixture.createTask({ plan, kind: "corpus", title: "Wrap up plan" });
    expect(lookalikeAnchored.startsWith("task-close-plan-")).toBe(true);
    await mustSetup(["approve", lookalikeAnchored, "--red-waiver", "not the subject"]);
    await mustSetup(["approve", lookalikeTitle]);
  });

  it("AC-DCS2-13: without --apply it lists each close task with what it would do, writes nothing (the whole corpus is byte-identical) and exits 0; a prefixed task with a file anchor and an unprefixed task are not listed", async () => {
    const before = corpusSnapshot();
    const out = await migrate();
    expect(out.exitCode, out.text).toBe(0);
    expect(out.stdout).toContain(first.closeTask);
    expect(out.stdout).toContain(second.closeTask);
    expect(out.stdout, "names the claim it would release").toMatch(/release/i);
    expect(out.stdout, "names the evidence rows it would move").toContain("2 evidence row");
    expect(out.stdout, "names the plan close it would run").toContain(first.plan);
    expect(out.stdout, "a task whose anchors name a file is not a close task").not.toContain(lookalikeAnchored);
    expect(out.stdout).not.toContain(lookalikeTitle);
    expect(corpusSnapshot(), "the preview wrote nothing").toBe(before);
    expect(aiCalls().length, "the preview ran no plan close").toBe(0);

    const json = await migrate("--json");
    expect(json.exitCode, json.text).toBe(0);
    const listed = (JSON.parse(json.stdout) as { data: { applied: boolean; tasks: Array<{ slug: string }> } }).data;
    expect(listed.applied).toBe(false);
    expect(listed.tasks.map((task) => task.slug).sort()).toEqual([first.closeTask, second.closeTask].sort());
    expect(corpusSnapshot(), "the json preview wrote nothing either").toBe(before);
  });

  it("AC-DCS2-13: --apply releases the claim, moves the evidence rows to the plan log, deprecates the task, removes its blocks edges and closes the plan; the plan whose close refuses makes the exit 4 and names its cause after the other plan was processed", async () => {
    const closeBefore = rowOf(first.closeTask);
    const planBefore = rowOf(first.plan);
    expect(planBefore.status).toBe("approved");
    expect(logOf(first.plan).filter((entry) => entry["kind"] === "evidence-moved")).toHaveLength(0);

    const out = await migrate("--apply");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.stderr, "the failing plan close is named with its cause").toContain(second.plan);
    expect(out.stderr).toContain("plan-uat-gate");

    // the claimed and evidenced close task of the plan that closed
    const closed = rowOf(first.closeTask);
    expect(closeBefore.extra["claim"]).toBeDefined();
    expect(closed.extra["claim"], "the claim is released").toBeUndefined();
    expect(closed.status, "the task is deprecated").toBe("deprecated");
    expect(linkCount(closed.id), "its blocks edges are gone").toBe(0);
    const moved = logOf(first.plan).filter((entry) => entry["kind"] === "evidence-moved");
    expect(moved, "one evidence-moved entry per evidence row, on the plan log").toHaveLength(first.evidenceCount);
    for (const entry of moved) {
      expect(entry["task"]).toBe(first.closeTask);
      expect(String(entry["from"])).toContain(first.closeTask);
      expect(String(entry["to"])).toContain(first.plan);
    }
    expect(moved.map((entry) => String(entry["from"])).join("\n")).toContain("echo Ran 1 tests first");
    expect(moved.map((entry) => String(entry["from"])).join("\n")).toContain("echo Ran 1 tests second");
    expect(withDb((db) => (db.query("SELECT COUNT(*) AS n FROM audit WHERE doc_id = ? AND action = 'release'").get(closed.id) as { n: number }).n), "the release is audited").toBeGreaterThan(0);
    expect(rowOf(first.plan).status, "the plan whose only open task it was is closed").toBe("archived");
    expect(aiCalls().length, "the one plan close ran its assess").toBeGreaterThan(0);

    // the plan whose close refused: its close task was still resolved, the plan stays open
    const refused = rowOf(second.closeTask);
    expect(refused.status).toBe("deprecated");
    expect(refused.extra["claim"]).toBeUndefined();
    expect(logOf(second.plan).filter((entry) => entry["kind"] === "evidence-moved")).toHaveLength(second.evidenceCount);
    expect(rowOf(second.plan).status, "a refused close leaves the plan open").toBe("approved");

    // not close tasks: untouched
    expect(rowOf(lookalikeAnchored).status).toBe("approved");
    expect(rowOf(lookalikeTitle).status).toBe("approved");
  });

  it("AC-DCS2-13: a second --apply finds no non-terminal close task and writes nothing (exit 0) once every plan close has run; the plan that refused is retried and still names its cause", async () => {
    // retry of the refused plan: its UAT gate is still unmet, so the close refuses again and the corpus is unchanged
    const before = corpusSnapshot();
    const retry = await migrate("--apply");
    expect(retry.exitCode, retry.text).toBe(4);
    expect(retry.stderr).toContain("plan-uat-gate");
    expect(corpusSnapshot(), "a refused retry writes nothing").toBe(before);

    // once the plan is closable the retry closes it, and then a further run writes nothing
    await mustSetup(["uat", "record", second.plan, "--json-file", writeVerdict()]);
    const done = await migrate("--apply");
    expect(done.exitCode, done.text).toBe(0);
    expect(rowOf(second.plan).status).toBe("archived");
    const settled = corpusSnapshot();
    const again = await migrate("--apply");
    expect(again.exitCode, again.text).toBe(0);
    expect(again.stdout.toLowerCase()).toContain("nothing");
    expect(corpusSnapshot(), "the second --apply wrote nothing").toBe(settled);
    expect(auditCount()).toBe(JSON.parse(settled).audit);
    const preview = await migrate();
    expect(preview.exitCode, preview.text).toBe(0);
    expect(preview.stdout, "no non-terminal task is a close task any more").not.toContain(first.closeTask);
    expect(preview.stdout).not.toContain(second.closeTask);
  });
});

/** A UAT verdict file accepting every P0 (the plan has no requirements, so an accept verdict with no list is complete). */
function writeVerdict(): string {
  const path = join(scratch, "verdict.json");
  writeFileSync(
    path,
    JSON.stringify({
      verdict: "accept",
      tier_results: [{ tier: "P0", accepted: 1, rejected: 0, unverified: 0 }],
      requirement_coverage: { total: 1, covered: 1, uncovered_p0: [] },
      uiux: { blocker_count: 0, min_dimension_score: 4 },
      run_meta: { at: new Date().toISOString(), by: "agent:uat-fixture" },
    }),
  );
  return path;
}
