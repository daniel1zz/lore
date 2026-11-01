// @reads assets/dispatch-standing-rules.md
// @reads package.json
// @reads tsconfig.json
// @reads tsconfig.base.json
// @reads bun.lock
// @reads bunfig.toml
// @reads vitest.node-files.ts
// @reads packages/lore/src/service/dispatch-service.ts
// @spawns dist/lore
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-dispatch-compiled.bun.test.ts — `lore dispatch <code task>` prints the whole subagent prompt from the stored
 * contract and the shipped standing rules (spec-integrate-proves-and-lands-evidence-at-landing-the-merge), observed through the
 * `lore` command tree on a throwaway repository and corpus; the false-green case runs the compiled `dist/lore`.
 *
 * Each test name starts with `AC-DCS2-<n>:` (with the colon), so `-t 'AC-DCS2-1:'` never matches AC-DCS2-10.
 *
 *   Task "lore dispatch prints the whole subagent prompt from the contract and the shipped standing rules":
 *     AC-DCS2-6  the prompt holds the locked task body, the contract, the three commands and the shipped rules byte for byte;
 *                check, corpus and contract-less tasks exit 4; the shipped file is read, never inlined, and a change to it
 *                (a rebuilt copy) changes the output
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const RULES_PATH = join(REPO_ROOT, "assets", "dispatch-standing-rules.md");
const SERVICE_PATH = join(REPO_ROOT, "packages", "lore", "src", "service", "dispatch-service.ts");
const BINARY = join(REPO_ROOT, "dist", "lore");
const READ_STATEMENT = 'const rules = await this.assets.read("dispatch-standing-rules.md");';

let fixture: DoneContractFixture;
let scratch = "";
let sequence = 0;
let plan = "";
let planInteg = "";
const INTEG = "dcs2-dispatch-integ";
const BODY_MARKER = "Dispatch body marker: change only the parser of module alpha.";

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  patchLoreConfig(fixture.dir, { workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } } } });
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  scratch = mkdtempSync(join(tmpdir(), "dcs2-dispatch-"));
  plan = await fixture.createPlan("Dispatch plan on main");
  planInteg = await fixture.createPlan("Dispatch plan with integration branch", INTEG);
});

afterAll(() => {
  fixture.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  return { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDE_CODE_SESSION_ID: "dispatch-orchestrator" };
}

async function loreIn(args: readonly string[]): Promise<Out> {
  const result = await runLoreInProcess([...args], { cwd: fixture.dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: processEnv() });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

/** Runs a compiled binary from `cwd` (a directory outside this repository) and returns what it printed. */
function spawnBinary(binary: string, cwd: string, args: readonly string[]): Out {
  const result = spawnSync(binary, [...args], { cwd, env: processEnv(), encoding: "utf8", timeout: 120_000 });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { stdout, stderr, exitCode: result.status ?? -1, text: `${stdout}\n${stderr}` };
}

/** Creates and approves a task of `kind` (a code task is approved with a red waiver unless `redRequired`). */
async function approvedTask(planSlug: string, kind: "code" | "check" | "corpus", redRequired = false): Promise<string> {
  fixture.setDoneContractConfig({ install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" });
  sequence += 1;
  const created = await fixture.run([
    "create", "task", "--title", `Dispatch ${kind} task ${sequence}`, "--plan-id", planSlug, "--kind", kind,
    "--content", `## Task\n\n${BODY_MARKER}\n`, "--no-ai",
    ...(kind === "corpus" ? ["--ac-scope", ""] : ["--ac-scope", "AC-FX-1"]),
  ]);
  expect(created.exitCode, created.stderr).toBe(0);
  const slug = created.stdout.match(/Slug:\s+(\S+)/)?.[1] ?? "";
  expect(slug).not.toBe("");
  const approve = kind === "code" && !redRequired ? ["approve", slug, "--red-waiver", "fixture: dispatch tests add no test"] : ["approve", slug];
  await fixture.mustRun(approve);
  return slug;
}

/** Leaves an approved task with no kind and no contract (the shape of a task approved before kinds), through the service layer: approve refuses it now. */
async function stripKindAndContractThroughStore(slug: string): Promise<void> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const found = await app.corpusService.get(slug);
    if (!found.ok) throw new Error(`seed: ${slug} not found: ${JSON.stringify(found.error)}`);
    const doc = found.value.doc;
    const { kind: _kind, done_contract: _contract, ...rest } = doc.extra as Record<string, unknown>;
    const written = await app.corpusService.writeDoc({
      doc,
      patch: { extra: rest },
      action: "update",
      changeSummary: "fixture: a task approved before kinds existed",
      auditAction: "update",
      auditDetails: { operation: "fixture-kindless" },
      lock: "none",
      by: doc.created_by,
      now: new Date().toISOString(),
    });
    if (!written.ok) throw new Error(`seed: strip failed: ${JSON.stringify(written.error)}`);
  } finally {
    app.close();
  }
}

const rulesText = (): string => readFileSync(RULES_PATH, "utf8");

interface StoredContract {
  readonly base_branch: string;
  readonly landing_route: string;
  readonly red_required: boolean;
  readonly red_waiver_reason?: string;
  readonly oracles: readonly { id: string; command?: string }[];
  readonly added_oracles: readonly { id: string; command?: string }[];
}

describe("lore dispatch prints the whole subagent prompt from the stored contract and the shipped standing rules", () => {
  it("AC-DCS2-6: a code task prompt holds the locked body, every oracle command, the base, red and route, the three commands and the rules byte for byte", async () => {
    const slug = await approvedTask(plan, "code");
    const stored = (await fixture.readTask(slug)).extra["done_contract"] as StoredContract;
    const before = (await fixture.readTask(slug)).version;
    const out = await loreIn(["dispatch", slug]);
    expect(out.exitCode, out.text).toBe(0);

    expect(out.stdout).toContain(BODY_MARKER);
    expect(out.stdout).toContain(stored.base_branch);
    expect(out.stdout).toContain(stored.landing_route);
    const oracles = [...stored.oracles, ...stored.added_oracles];
    expect(oracles.length).toBeGreaterThanOrEqual(2);
    for (const oracle of oracles) {
      expect(out.stdout).toContain(oracle.id);
      if (oracle.command !== undefined) expect(out.stdout).toContain(oracle.command);
    }
    expect(stored.red_required).toBe(false);
    expect(out.stdout).toContain("fixture: dispatch tests add no test");
    for (const verb of ["lore start", "lore finish", "lore land"]) expect(out.stdout).toContain(verb);
    // The standing rules are the shipped file's exact bytes.
    expect(rulesText().length).toBeGreaterThan(200);
    expect(out.stdout).toContain(rulesText());
    // Reading is a pure function of the stored task: nothing was written.
    expect((await fixture.readTask(slug)).version).toBe(before);
  });

  it("AC-DCS2-6: red required is printed as required, and an integration-branch plan prints that branch and its route", async () => {
    const slug = await approvedTask(planInteg, "code", true);
    const stored = (await fixture.readTask(slug)).extra["done_contract"] as StoredContract;
    expect(stored.red_required).toBe(true);
    expect(stored.base_branch).toBe(INTEG);
    const out = await loreIn(["dispatch", slug]);
    expect(out.exitCode, out.text).toBe(0);
    expect(out.stdout).toContain(INTEG);
    expect(out.stdout).toContain("integration-branch");
    expect(out.stdout).toMatch(/red_required: true/);
    expect(out.stdout).toContain(rulesText());
  });

  it("AC-DCS2-6: a check task and a corpus task exit 4 and the output names lore finish", async () => {
    for (const kind of ["check", "corpus"] as const) {
      const slug = await approvedTask(plan, kind);
      const out = await loreIn(["dispatch", slug]);
      expect(out.exitCode, `${kind}: ${out.text}`).toBe(4);
      expect(out.text).toContain("lore finish");
      expect(out.text).toContain(kind);
      expect(out.stdout).not.toContain(rulesText());
    }
  });

  it("AC-DCS2-6: a code task with no stored contract exits 4 naming the missing contract, never a recompiled one", async () => {
    const slug = await approvedTask(plan, "code");
    await stripKindAndContractThroughStore(slug);
    const out = await loreIn(["dispatch", slug]);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toMatch(/contract/);
    expect(out.text).toContain(slug);
    expect((await fixture.readTask(slug)).extra["done_contract"]).toBeUndefined();
  });

  it("AC-DCS2-6: an unknown task exits 4 and a draft task (no contract yet) exits 4", async () => {
    const unknown = await loreIn(["dispatch", "task-no-such-task-anywhere"]);
    expect(unknown.exitCode, unknown.text).not.toBe(0);
    sequence += 1;
    const created = await fixture.mustRun(["create", "task", "--title", `Dispatch draft ${sequence}`, "--plan-id", plan, "--kind", "code", "--content", "## Task\n\nDraft.\n", "--ac-scope", "AC-FX-1", "--no-ai"]);
    const draft = created.match(/Slug:\s+(\S+)/)?.[1] ?? "";
    const out = await loreIn(["dispatch", draft]);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toMatch(/contract/);
  });

  it("AC-DCS2-6: the rules are read through the assets port, never inlined in the service", () => {
    const source = readFileSync(SERVICE_PATH, "utf8");
    expect(source.split(READ_STATEMENT).length - 1).toBe(1);
    // No line of the shipped file (past a short heading) is copied into the service.
    const longLines = rulesText().split("\n").filter((line) => line.trim().length >= 24);
    expect(longLines.length).toBeGreaterThanOrEqual(5);
    for (const line of longLines) expect(source, `inlined rule line: ${line}`).not.toContain(line);
  });

  it("AC-DCS2-6: dist/lore finds the shipped file from a directory outside the repository, and a rebuilt copy with a changed file prints the change", async () => {
    const slug = await approvedTask(plan, "code");
    expect(existsSync(BINARY)).toBe(true);
    expect(fixture.dir.startsWith(REPO_ROOT)).toBe(false);
    const original = spawnBinary(BINARY, fixture.dir, ["dispatch", slug]);
    expect(original.exitCode, original.text).toBe(0);
    expect(original.stdout).toContain(rulesText());

    // A copy of the manifest source (the build inputs), with the shipped rules changed, rebuilt into its own binary.
    const copy = join(scratch, "rebuild-copy");
    mkdirSync(copy, { recursive: true });
    for (const dir of ["assets", "scripts", "packages/core", "packages/lore", "packages/dashboard"]) {
      mkdirSync(join(copy, dir), { recursive: true });
      execFileSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", "/tests", "--exclude", ".git", `${join(REPO_ROOT, dir)}/`, `${join(copy, dir)}/`]);
    }
    // vitest.node-files.ts: scripts/changed-tests.ts imports it, and the build step of the copy loads that script
    for (const file of ["package.json", "tsconfig.json", "tsconfig.base.json", "bun.lock", "bunfig.toml", "vitest.node-files.ts"]) {
      if (existsSync(join(REPO_ROOT, file))) copyFileSync(join(REPO_ROOT, file), join(copy, file));
    }
    symlinkSync(join(REPO_ROOT, "node_modules"), join(copy, "node_modules"));
    for (const pkg of ["core", "lore", "dashboard"]) {
      const nm = join(REPO_ROOT, "packages", pkg, "node_modules");
      if (existsSync(nm)) symlinkSync(nm, join(copy, "packages", pkg, "node_modules"));
    }
    const changedMarker = "CHANGED-RULE-MARKER: report to a file named dcs2-changed.md";
    writeFileSync(join(copy, "assets", "dispatch-standing-rules.md"), `${rulesText()}\n- ${changedMarker}\n`);
    execFileSync("git", ["init", "-q"], { cwd: copy });
    execFileSync("git", ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "commit", "-q", "--allow-empty", "-m", "copy"], { cwd: copy });
    const built = spawnSync("bun", ["scripts/build.ts", "--skip-dashboard"], { cwd: copy, encoding: "utf8", timeout: 540_000 });
    expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
    const rebuilt = spawnBinary(join(copy, "dist", "lore"), fixture.dir, ["dispatch", slug]);
    expect(rebuilt.exitCode, rebuilt.text).toBe(0);
    expect(rebuilt.stdout).toContain(changedMarker);
    expect(rebuilt.stdout).not.toBe(original.stdout);
    // The repository's own binary and file are untouched by the copy.
    expect(spawnBinary(BINARY, fixture.dir, ["dispatch", slug]).stdout).not.toContain(changedMarker);
    expect(rulesText()).not.toContain(changedMarker);
  });
});
