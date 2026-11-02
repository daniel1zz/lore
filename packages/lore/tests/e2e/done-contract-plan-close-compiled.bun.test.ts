// @reads assets/project/lore-config-template.yaml
// @reads assets/templates/**
// @reads assets/project/reference-transaction
// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-plan-close-compiled.bun.test.ts — plan close is automatic: one close function behind `lore plan close`, the trigger
 * of the last archive and the review batch; rule apply of every linked spec; human-mode criteria counted by a recorded verdict; the
 * close holds its own plan lease and never blocks a landing
 * (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-11, AC-DCS2-12, AC-DCS2-18, AC-DCS2-20; ledger D41),
 * observed through the `lore` command tree on a throwaway repository and corpus with REAL branches and worktrees. The repository's
 * own `.lore/` is never touched.
 *
 * Each test name starts with `AC-<id>:` (with the colon), so `-t 'AC-DCS2-1:'` never matches AC-DCS2-11 or AC-DCS2-12.
 *
 *   AC-DCS2-11  the plan closes itself when its last task archives: the landing returns before the assess double starts, a non-last
 *               archive starts no batch, the batch runs under a review-batch child run, three plans end open / archived with defects /
 *               open on a missing P0 UAT
 *   AC-DCS2-12  `lore plan close` refuses a plan with an open task naming each one (exit 4, nothing written) and closes a plan whose
 *               tasks are all archived or deprecated
 *   AC-DCS2-18  rule apply counts a human-mode criterion only through the newest accepting UAT verdict of the plan that owns it
 *   AC-DCS2-20  the close holds a plan-scoped lease: a second close of the plan exits 75 plan-close-busy, a dead or pid-reused holder is
 *               taken over, a landing started while a close is held proceeds at once, a close of another plan is not blocked
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository, the shipped main-ref guard installed. The AI of `lore
 * assess` is a shell-script double (a claude-cli provider command): it answers per plan from a marker in the prompt, records one line per
 * call and can be held. `gh` is a stub first on PATH. Every command that archives a task (finish, land, integrate, done) is a REAL
 * spawned `lore` process, because its batch is a real detached process.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { approveFixtureNodes, citeSpecViaAsyncCli, ensureLiveRuleViaAsyncCli } from "../helpers/cli-live-rule";
import { DECIDED_FLAGS, DECIDED_FLAGS_OWN_REASON } from "../helpers/decision-flags";
import { dropLoreConfigKey, patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { planFieldsArgs, templatedFieldsArgs } from "../helpers/templated-create";
import { fileAnswerShellLines, withFilesShell } from "../helpers/ai-double-file-answers";
import { installShippedGuard } from "../integration/support/main-guard-repo";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(PROJECT_ROOT, "packages", "lore", "src", "index.ts");

const PASS_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" };

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

/** The environment of a lore run: the test's, with a session naming the writer. */
function envOf(session: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  return { ...env, CLAUDE_CODE_SESSION_ID: session, ...extra, HOME: FIXTURE_HOME_OUTSIDE_REPO };
}

/** Runs `lore <args>` in-process (the command tree the binary's entry calls). Never for a command that archives a task. */
async function inProcess(cwd: string, args: readonly string[], session: string, extra: Record<string, string> = {}): Promise<Out> {
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: envOf(session, extra) });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

/** A real `lore` process (`bun run packages/lore/src/index.ts`): the test process is its harness, so its run verifies by ancestry. */
function spawned(cwd: string, args: readonly string[], session: string, extra: Record<string, string> = {}): Promise<Out> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", ENTRY, ...args], { cwd, env: envOf(session, extra), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1, text: `${stdout}\n${stderr}` }));
  });
}

const gitIn = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function eventually<T>(read: () => T | null | undefined | false, what: string, milliseconds = 120_000): Promise<T> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ───────────────────────────── AC-DCS2-18: human-mode criteria by verdict ─────────────────────────────

const PROPOSAL = ["--statement", "A rule the spec introduces and the baseline takes only when it lands", "--example", "when X then Y", "--enforced-by", "both"] as const;

/** One throwaway corpus for the rule-apply cases: PRD -> baseline root/branch/leaf with one live rule, citation gate enforcing. */
class RuleWorld {
  readonly dir = mkdtempSync(join(tmpdir(), "dcs2-uat-"));
  private leaf = "";
  private liveRule = "";
  private counter = 0;

  async run(args: string[]): Promise<Out> {
    return await inProcess(this.dir, args, "dcs2-pc-uat", { HOME: this.dir });
  }

  async must(args: string[]): Promise<string> {
    const out = await this.run(args);
    if (out.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${out.exitCode}): ${out.text}`);
    return out.stdout;
  }

  async slug(args: string[]): Promise<string> {
    const out = await this.must(args);
    const slug = out.match(/Slug:\s+(\S+)/)?.[1] ?? out.match(/Created baseline \w+ (\S+) \(/)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${out}`);
    return slug;
  }

  async init(): Promise<this> {
    await this.must(["init"]);
    const prd = await this.slug(["create", "prd", "--title", "UAT PRD", ...templatedFieldsArgs("prd"), "--no-ai"]);
    const root = await this.slug(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "UAT Root", ...templatedFieldsArgs("baseline", { kind: "root" })]);
    const branch = await this.slug(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "UAT Branch", ...templatedFieldsArgs("baseline", { kind: "branch" })]);
    this.leaf = await this.slug(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "UAT Leaf", ...templatedFieldsArgs("baseline", { kind: "leaf" })]);
    const added = await this.must(["rule", "add", this.leaf, "--statement", "A live rule that already describes the product", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e1"]);
    const liveRule = added.match(/\bBR-\d+\b/)?.[0];
    if (liveRule === undefined) throw new Error(`no rule id in: ${added}`);
    this.liveRule = liveRule;
    patchLoreConfig(this.dir, {
      workflow: { gates: { "ac-cite": { mode: "enforce", armed_branches: [branch] }, "plan-close": { enabled: false } }, review: { judgment_required_types: [] } },
    });
    dropLoreConfigKey(this.dir, ["workflow", "verification_profiles"]);
    await this.must(["approve", this.leaf]);
    return this;
  }

  /** A spec proposing one rule, with the named criteria citing it, approved; a plan under it; a task of the plan scoping `scope`. */
  async specWithPlan(label: string, criteria: ReadonlyArray<{ id: string; mode: "human" | "script"; cites: boolean }>, scope: readonly string[]): Promise<{ spec: string; plan: string; rule: string }> {
    this.counter += 1;
    const spec = await this.slug(["create", "spec", "--title", `UAT spec ${label} ${this.counter}`, "--kind", "tech", ...templatedFieldsArgs("spec", { kind: "tech", refTarget: this.leaf }), "--no-ai"]);
    const out = await this.must(["rule", "propose", spec, "add", "--leaf", this.leaf, ...PROPOSAL]);
    const rule = out.match(/\bBR-\d+\b/)?.[0];
    if (rule === undefined) throw new Error(`no reserved id in: ${out}`);
    for (const criterion of criteria) {
      const mode = criterion.mode === "human" ? ["--mode", "human", "--note", "A person checks."] : ["--mode", "script", "--oracle", "other", "--command", "true"];
      // the citation gate wants a rule on every criterion: one that does not touch the change set cites the already-live rule
      await this.must(["ac", "add", spec, criterion.id, "--statement", `criterion ${criterion.id} holds`, ...mode, "--cite", criterion.cites ? rule : this.liveRule]);
    }
    await this.must(["approve", spec]);
    const plan = await this.planOf(spec, label, scope);
    return { spec, plan, rule };
  }

  /** A plan under `spec` with one task scoping `scope`. */
  async planOf(spec: string, label: string, scope: readonly string[]): Promise<string> {
    this.counter += 1;
    const plan = await this.slug(["create", "plan", "--title", `UAT plan ${label} ${this.counter}`, "--parent", spec, ...planFieldsArgs(spec), "--no-ai"]);
    const scopeArgs = scope.length === 0 ? ["--ac-scope", ""] : scope.flatMap((id) => ["--ac-scope", id]);
    await this.must(["create", "task", "--title", `UAT task ${label} ${this.counter}`, "--plan-id", plan, "--kind", "check", ...scopeArgs, ...templatedFieldsArgs("task"), "--no-ai"]);
    return plan;
  }

  /** `lore uat record <plan>` with a verdict listing `accepted` ({spec, ac} pairs). */
  async record(plan: string, verdict: "accept" | "reject" | "accept_with_conditions", accepted: ReadonlyArray<{ spec: string; ac: string }>): Promise<Out> {
    this.counter += 1;
    const file = join(this.dir, `verdict-${this.counter}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        verdict,
        tier_results: [{ tier: "P0", accepted: verdict === "reject" ? 0 : 1, rejected: 0, unverified: 0 }],
        requirement_coverage: { total: 1, covered: 1, uncovered_p0: [] },
        uiux: { blocker_count: 0, min_dimension_score: 4 },
        run_meta: { at: new Date().toISOString(), by: "agent:uat-fixture" },
        accepted_criteria: accepted.map((pair) => ({ spec: pair.spec, ac: pair.ac, observation: `observed ${pair.ac}` })),
      }),
    );
    return await this.run(["uat", "record", plan, "--json-file", file]);
  }

  liveRuleId(): string {
    return this.liveRule;
  }

  async ruleState(id: string): Promise<string> {
    return (JSON.parse(await this.must(["rule", "show", id, "--json"])) as { data: { state: string } }).data.state;
  }

  async uatDocCount(): Promise<number> {
    const listed = JSON.parse(await this.must(["list", "--type", "knowledge", "--json", "--limit", "200"])) as { data: { docs: Array<{ slug: string }> } };
    return listed.data.docs.filter((doc) => doc.slug.startsWith("knowledge-uat")).length;
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

describe("AC-DCS2-18: a human-mode criterion counts only through a recorded verdict of its owning plan", () => {
  let world: RuleWorld;
  beforeAll(async () => {
    world = await new RuleWorld().init();
  });
  afterAll(() => world.dispose());

  it("AC-DCS2-18: with no verdict, apply exits 4 naming the criterion and the remedy `lore uat record`; the rule stays proposed (a human criterion is never met by being skipped)", async () => {
    const { spec, rule } = await world.specWithPlan("none", [{ id: "AC-NV-1", mode: "human", cites: true }], ["AC-NV-1"]);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(4);
    expect(applied.stderr).toContain("AC-NV-1");
    expect(applied.stderr).toContain("lore uat record");
    expect(await world.ruleState(rule)).toBe("proposed");
  });

  it("AC-DCS2-18: an accept verdict of the owning plan listing the criterion lets apply land the change set; a second apply is a no-op", async () => {
    const { spec, plan, rule } = await world.specWithPlan("accept", [{ id: "AC-OK-1", mode: "human", cites: true }], ["AC-OK-1"]);
    const recorded = await world.record(plan, "accept", [{ spec, ac: "AC-OK-1" }]);
    expect(recorded.exitCode, recorded.text).toBe(0);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(0);
    expect(await world.ruleState(rule)).toBe("live");
    const again = await world.run(["rule", "apply", spec]);
    expect(again.exitCode, again.text).toBe(0);
  });

  it("AC-DCS2-18: a reject verdict listing the criterion does not count: exit 4 naming it", async () => {
    const { spec, plan, rule } = await world.specWithPlan("reject", [{ id: "AC-RJ-1", mode: "human", cites: true }], ["AC-RJ-1"]);
    const recorded = await world.record(plan, "reject", [{ spec, ac: "AC-RJ-1" }]);
    expect(recorded.exitCode, recorded.text).toBe(0);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(4);
    expect(applied.stderr).toContain("AC-RJ-1");
    expect(await world.ruleState(rule)).toBe("proposed");
  });

  it("AC-DCS2-18: the verdict is read per criterion: a verdict listing another criterion of the spec does not count for the one citing the rule", async () => {
    const { spec, plan, rule } = await world.specWithPlan(
      "other",
      [
        { id: "AC-PC-1", mode: "human", cites: true },
        { id: "AC-PC-2", mode: "human", cites: false },
      ],
      ["AC-PC-1", "AC-PC-2"],
    );
    const recorded = await world.record(plan, "accept", [{ spec, ac: "AC-PC-2" }]);
    expect(recorded.exitCode, recorded.text).toBe(0);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(4);
    expect(applied.stderr).toContain("AC-PC-1");
    expect(applied.stderr).not.toContain("AC-PC-2");
    expect(await world.ruleState(rule)).toBe("proposed");
  });

  it("AC-DCS2-18: a verdict recorded on an unrelated plan that implements the same spec counts for nothing", async () => {
    const { spec, rule } = await world.specWithPlan("owner", [{ id: "AC-UP-1", mode: "human", cites: true }], ["AC-UP-1"]);
    const unrelated = await world.planOf(spec, "unrelated", []);
    const recorded = await world.record(unrelated, "accept", [{ spec, ac: "AC-UP-1" }]);
    expect(recorded.exitCode, recorded.text).toBe(0);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(4);
    expect(applied.stderr).toContain("AC-UP-1");
    expect(await world.ruleState(rule)).toBe("proposed");
  });

  it("AC-DCS2-18: a criterion no task lists has no owning plan and is not met, whoever recorded a verdict for it", async () => {
    const { spec, plan, rule } = await world.specWithPlan("unowned", [{ id: "AC-UO-1", mode: "human", cites: true }], []);
    const recorded = await world.record(plan, "accept", [{ spec, ac: "AC-UO-1" }]);
    expect(recorded.exitCode, recorded.text).toBe(0);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(4);
    expect(applied.stderr).toContain("AC-UO-1");
    expect(await world.ruleState(rule)).toBe("proposed");
  });

  it("AC-DCS2-18: only the NEWEST verdict of the owning plan counts: accept then reject refuses, reject then accept lands", async () => {
    const refused = await world.specWithPlan("newest-reject", [{ id: "AC-NW-1", mode: "human", cites: true }], ["AC-NW-1"]);
    expect((await world.record(refused.plan, "accept", [{ spec: refused.spec, ac: "AC-NW-1" }])).exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await world.record(refused.plan, "reject", [{ spec: refused.spec, ac: "AC-NW-1" }])).exitCode).toBe(0);
    const stale = await world.run(["rule", "apply", refused.spec]);
    expect(stale.exitCode, stale.text).toBe(4);
    expect(stale.stderr).toContain("AC-NW-1");

    const landed = await world.specWithPlan("newest-accept", [{ id: "AC-NW-2", mode: "human", cites: true }], ["AC-NW-2"]);
    expect((await world.record(landed.plan, "reject", [{ spec: landed.spec, ac: "AC-NW-2" }])).exitCode).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await world.record(landed.plan, "accept", [{ spec: landed.spec, ac: "AC-NW-2" }])).exitCode).toBe(0);
    const applied = await world.run(["rule", "apply", landed.spec]);
    expect(applied.exitCode, applied.text).toBe(0);
    expect(await world.ruleState(landed.rule)).toBe("live");
  });

  it("AC-DCS2-18: a script-mode criterion has no verdict route: recording it is refused (exit 4, nothing stored) and apply still names it", async () => {
    const { spec, plan, rule } = await world.specWithPlan("script", [{ id: "AC-SC-1", mode: "script", cites: true }], ["AC-SC-1"]);
    const before = await world.uatDocCount();
    const recorded = await world.record(plan, "accept", [{ spec, ac: "AC-SC-1" }]);
    expect(recorded.exitCode, recorded.text).toBe(4);
    expect(recorded.stderr).toContain("AC-SC-1");
    expect(await world.uatDocCount(), "a refused verdict stores nothing").toBe(before);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(4);
    expect(applied.stderr).toContain("AC-SC-1");
    expect(await world.ruleState(rule)).toBe("proposed");
  });

  it("AC-DCS2-18: a verdict naming a criterion the spec does not declare is refused (exit 4, nothing stored)", async () => {
    const { spec, plan } = await world.specWithPlan("undeclared", [{ id: "AC-UD-1", mode: "human", cites: true }], ["AC-UD-1"]);
    const before = await world.uatDocCount();
    const recorded = await world.record(plan, "accept", [{ spec, ac: "AC-NOPE-9" }]);
    expect(recorded.exitCode, recorded.text).toBe(4);
    expect(recorded.stderr).toContain("AC-NOPE-9");
    expect(await world.uatDocCount()).toBe(before);
  });

  it("AC-DCS2-18: a superseded criterion citing a changed rule with no run does not block the apply", async () => {
    const { spec, plan, rule } = await world.specWithPlan(
      "superseded",
      [
        { id: "AC-SS-1", mode: "human", cites: true },
        { id: "AC-SS-OLD", mode: "script", cites: true },
      ],
      ["AC-SS-1"],
    );
    // the superseding criterion lives in another spec; a superseded criterion is immutable and skipped by every reader
    const other = await world.slug(["create", "spec", "--title", "UAT superseding spec", "--kind", "tech", ...templatedFieldsArgs("spec", { kind: "tech", refTarget: spec }), "--no-ai"]);
    await world.must(["ac", "add", other, "AC-SS-NEW", "--statement", "the superseding criterion", "--mode", "human", "--note", "A person checks.", "--cite", world.liveRuleId()]);
    const superseded = await world.run(["ac", "supersede", spec, "AC-SS-OLD", "--by", `${other}:AC-SS-NEW`, "--reason", "replaced by the newer criterion", ...DECIDED_FLAGS_OWN_REASON]);
    expect(superseded.exitCode, superseded.text).toBe(0);
    // the live criterion is accepted by verdict; the superseded one has no run at all
    expect((await world.record(plan, "accept", [{ spec, ac: "AC-SS-1" }])).exitCode).toBe(0);
    const applied = await world.run(["rule", "apply", spec]);
    expect(applied.exitCode, applied.text).toBe(0);
    expect(await world.ruleState(rule)).toBe("live");
  });
});

// ───────────────────────────── AC-DCS2-12: lore plan close ─────────────────────────────

let fixture: DoneContractFixture;
let scratch = "";
let sequence = 0;

/** The shell double of the AI of `lore assess`; see {@link writeAiDouble}. */
let aiLog = "";
let hold = "";
let ghState = "";

/**
 * The AI double: a claude-cli provider command. It answers from a marker in the prompt (`SECFAIL`: security fails; `DESFAIL`:
 * design_necessity fails; otherwise every judged dimension passes), appends `<epoch ms> <marker-or-plain>` to the call log, and waits
 * while the hold file exists (the test holds an assess open, or keeps it from starting, by creating it) unless the prompt carries
 * `FREEPASS` (a plan whose assess must never be held).
 */
function writeAiDouble(path: string): void {
  const dimension = (verdict: string, cites: boolean): string =>
    `{"verdict":"${verdict}","reason":"${verdict} by the double","reference":"Google engineering code review guide"${cites ? ',"cites":["src/double.ts"]' : ""}}`;
  const answer = (security: string, design: string): string =>
    `{"dimensions":{"spec_conformance":${dimension("pass", false)},"design_necessity":${dimension(design, design === "fail")},"concurrency_safety":${dimension("pass", false)},"security":${dimension(security, security === "fail")}},"criteria":[]}`;
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `prompt=$(cat)`,
      `case "$prompt" in *FREEPASS*) ;; *) while [ -e '${hold}' ]; do sleep 0.2; done;; esac`,
      `marker=plain`,
      `case "$prompt" in *SECFAIL*) marker=secfail;; esac`,
      `case "$prompt" in *DESFAIL*) marker=desfail;; esac`,
      `echo "$(date +%s)$(perl -MTime::HiRes=time -e 'printf("%03d", (time - int(time)) * 1000)') $marker" >> '${aiLog}'`,
      // reason: BR-1535 — a review call answers per changed file as well (`files`); the double passes every file the prompt marks ASK.
      ...fileAnswerShellLines(),
      `case "$marker" in`,
      "  secfail)",
      ...withFilesShell(answer("fail", "pass")).map((line) => `    ${line}`),
      "  ;;",
      "  desfail)",
      ...withFilesShell(answer("pass", "fail")).map((line) => `    ${line}`),
      "  ;;",
      "  *)",
      ...withFilesShell(answer("pass", "pass")).map((line) => `    ${line}`),
      "  ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  chmodSync(path, 0o755);
}

/**
 * A `gh` stub first on PATH: it serves the issue API the batch's issue filing reads and writes, keeping its state in a JSON file, so
 * a test reads the issues that were filed and none leaves the machine.
 */
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
      `const one = /^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)(\\?.*)?$/.exec(path);`,
      `if (one && method === "GET") { const hit = state.issues.find((i) => i.number === Number(one[1])); if (hit) out(entry(hit)); process.stderr.write("stub gh: no such issue " + one[1] + "\\n"); process.exit(1); }`,
      `process.stderr.write("stub gh: unrecognised call: " + argv.join(" ") + "\\n"); process.exit(99);`,
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "gh"), `#!/bin/sh\nexec bun ${JSON.stringify(join(dir, "gh.js"))} "$@"\n`, { mode: 0o755 });
  chmodSync(join(dir, "gh"), 0o755);
}

const filedIssues = (): Array<{ number: number; title: string; body: string }> => (JSON.parse(readFileSync(ghState, "utf8")) as { issues: Array<{ number: number; title: string; body: string }> }).issues;

let dbPath = "";
const withDb = <T>(body: (db: Database) => T): T => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return body(db);
  } finally {
    db.close();
  }
};
const statusOf = (slug: string): string => withDb((db) => (db.query("SELECT status FROM docs WHERE slug = ?").get(slug) as { status: string } | null)?.status ?? "missing");
const reviewBatchRuns = (): Array<{ id: string; parent_run_id: string | null; harness_pid: number | null; ended_at: string | null }> =>
  withDb((db) => db.query("SELECT id, parent_run_id, harness_pid, ended_at FROM runs WHERE agent_type = 'review-batch'").all() as Array<{ id: string; parent_run_id: string | null; harness_pid: number | null; ended_at: string | null }>);

const OWNER = "dcs2-pc-owner";

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "dcs2-pc-"));
  aiLog = join(scratch, "ai-calls.log");
  hold = join(scratch, "ai-hold");
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
  // the suite the assess batch measures on main in a throwaway worktree: the project's own scripts, here two that pass
  writeFileSync(join(fixture.dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { "check:plan-close": "echo Ran 1 tests", test: "echo Ran 1 tests", "test:file": "echo Ran 1 tests" } }));
  fixture.git(["add", "package.json"]);
  fixture.git(["commit", "-q", "-m", "fixture package scripts"]);
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  // every plan close files its milestone review from the corpus's approved knowledge/milestone-review template
  await fixture.mustRun(["migrate", "templates", "--apply"]);
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs2-pc-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
});

afterAll(() => {
  fixture?.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

/** Environment with the `gh` stub first on PATH. */
const withGh = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: `${join(scratch, "gh-bin")}:${process.env["PATH"] ?? ""}`, ...extra });

/** A plan under the fixture spec, approved (a plan archives only from an approved or active status). */
const approvedPlan = async (title: string): Promise<string> => {
  const plan = await fixture.createPlan(title);
  await fixture.mustRun(["approve", plan]);
  return plan;
};

const planDoc = async (slug: string): Promise<{ status: string; version: number }> => {
  const doc = (JSON.parse(await fixture.mustRun(["get", slug, "--json"])) as { data: { doc?: { status: string; version: number }; status: string; version: number } }).data;
  const view = doc.doc ?? doc;
  return { status: view.status, version: view.version };
};

describe("AC-DCS2-12: lore plan close refuses a plan with an open task and closes one whose tasks are all terminal", () => {
  it("AC-DCS2-12: a plan with open tasks exits 4 plan-open-tasks naming each open task and its status, and writes nothing", async () => {
    const plan = await approvedPlan("Plan close open tasks");
    const approved = await fixture.createTask({ plan, kind: "check", title: "Open approved check", acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", approved]);
    const draft = await fixture.createTask({ plan, kind: "corpus", title: "Open draft corpus" });
    const planBefore = await planDoc(plan);
    const approvedBefore = await fixture.readTask(approved);
    const draftBefore = await fixture.readTask(draft);

    const out = await inProcess(fixture.dir, ["plan", "close", plan], OWNER, withGh());
    expect(out.exitCode, out.text).toBe(4);
    expect(out.stderr).toContain("plan-open-tasks");
    expect(out.stderr.split("\n").find((line) => line.includes(approved))).toContain("approved");
    expect(out.stderr.split("\n").find((line) => line.includes(draft))).toContain("draft");
    expect(await planDoc(plan), "nothing was written").toEqual(planBefore);
    expect(await fixture.readTask(approved)).toEqual(approvedBefore);
    expect(await fixture.readTask(draft)).toEqual(draftBefore);
    expect(readFileSync(aiLog, "utf8"), "no assess ran").toBe("");
  });

  it("AC-DCS2-12: a deprecated and an archived task are not open: the command runs the close and archives the plan", async () => {
    // one code task archived by its landing and one corpus task deprecated (see closablePlan)
    const plan = await closablePlan("Plan close terminal tasks", "pc12a");
    const states = withDb((db) => db.query("SELECT status FROM docs WHERE type = 'task' AND json_extract(extra, '$.plan_id') = (SELECT id FROM docs WHERE slug = ?)").all(plan) as Array<{ status: string }>);
    expect(states.map((row) => row.status).sort()).toEqual(["archived", "deprecated"]);

    const out = await inProcess(fixture.dir, ["plan", "close", plan], OWNER, withGh());
    expect(out.exitCode, out.text).toBe(0);
    expect((await planDoc(plan)).status).toBe("archived");
    expect(readFileSync(aiLog, "utf8").length, "the close ran the assess").toBeGreaterThan(0);
    const again = await inProcess(fixture.dir, ["plan", "close", plan], OWNER, withGh());
    expect(again.exitCode, "a close of a closed plan is idempotent").toBe(0);
  });
});

// ───────────────────────────── the world of AC-DCS2-11 and AC-DCS2-20 ─────────────────────────────

interface Tree {
  readonly branch: string;
  readonly path: string;
}

interface Finished {
  readonly slug: string;
  readonly tree: Tree;
}

function addWorktree(label: string): Tree {
  sequence += 1;
  const branch = `dcs2-pc-${label}-${sequence}`;
  const path = join(scratch, `${label}-${sequence}`);
  fixture.git(["worktree", "add", "-q", "-b", branch, path, "main"]);
  return { branch, path };
}

/** A code task (red waived) claimed on a fresh worktree, its work committed and finished: ready for `lore land`. */
async function finishedCodeTask(plan: string, label: string): Promise<Finished> {
  const anchor = `tests/${label}.test.ts`;
  const slug = await fixture.createTask({ plan, kind: "code", title: `Close ${label}`, anchors: [anchor], acScope: ["AC-FX-1"] });
  await fixture.mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  const tree = addWorktree(label);
  const claimed = await inProcess(fixture.dir, ["claim", slug, "--worktree", tree.branch], OWNER);
  expect(claimed.exitCode, claimed.text).toBe(0);
  gitIn(tree.path, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(tree.path, ["config", "user.name", "fixture"]);
  mkdirSync(join(tree.path, "tests"), { recursive: true });
  mkdirSync(join(tree.path, "src"), { recursive: true });
  writeFileSync(join(tree.path, anchor), `// ${label}\n`);
  writeFileSync(join(tree.path, "src", `${label}.ts`), `export const ${label} = 1;\n`);
  gitIn(tree.path, ["add", "-A"]);
  gitIn(tree.path, ["commit", "-q", "-m", `work ${label}`]);
  const finished = await inProcess(tree.path, ["finish", slug], OWNER);
  expect(finished.exitCode, finished.text).toBe(0);
  return { slug, tree };
}

/** `lore land <task>` as a real process, with the `gh` stub on PATH. */
const landTask = (task: string): Promise<Out> => spawned(fixture.dir, ["land", task], OWNER, withGh());

/**
 * A plan ready to close by hand: one code task landed (its landing is what the assess measures: a plan with no landing has no measured
 * diff, so its regression and security are not measured) and one corpus task deprecated. The landing is not the last archive (the corpus
 * task is still open then), so it starts no batch, and nothing closes the plan before the test does.
 */
async function closablePlan(title: string, label: string): Promise<string> {
  const plan = await approvedPlan(title);
  const code = await finishedCodeTask(plan, label);
  const open = await fixture.createTask({ plan, kind: "corpus", title: `${label} open corpus task` });
  const landed = await landTask(code.slug);
  expect(landed.exitCode, landed.text).toBe(0);
  const deprecated = await inProcess(fixture.dir, ["set", open, "--status", "deprecated", "--reason", "fixture: a deprecated task is not open"], OWNER);
  expect(deprecated.exitCode, deprecated.text).toBe(0);
  return plan;
}

const batchLog = (): string => (existsSync(join(fixture.dir, ".lore", "review-batch.log")) ? readFileSync(join(fixture.dir, ".lore", "review-batch.log"), "utf8") : "");
const aiCalls = (): string[] => readFileSync(aiLog, "utf8").split("\n").filter((line) => line !== "");
const planLeaseDir = (): string => join(fixture.dir, ".git", "lore-plan-close");
const planLeaseFiles = (): string[] => (existsSync(planLeaseDir()) ? readdirSync(planLeaseDir()).filter((name) => name.endsWith(".lease")) : []);
const queueTickets = (): string[] => {
  const dir = join(fixture.dir, ".git", "lore-integrate-queue");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".ticket")) : [];
};

/** Waits until every review-batch run of the corpus has ended (the detached batch finished). */
async function batchesEnded(count: number): Promise<void> {
  await eventually(() => {
    const runs = reviewBatchRuns();
    return runs.length >= count && runs.every((run) => run.ended_at !== null);
  }, `${count} review batch(es) to end`);
}

// ───────────────────────────── AC-DCS2-11 ─────────────────────────────

describe("AC-DCS2-11: the plan closes itself when its last task archives", () => {
  it("AC-DCS2-11: a non-last archive starts no batch; the last landing returns before the assess starts, with no close line in its phase table; the plan archives afterwards under a review-batch child run", async () => {
    const plan = await approvedPlan("Close main plan");
    const a = await finishedCodeTask(plan, "pc11a");
    const b = await finishedCodeTask(plan, "pc11b");
    const runsBefore = reviewBatchRuns().length;
    const callsBefore = aiCalls().length;

    // the first landing leaves a task open: its archive is not the last one, so no batch starts and nothing is assessed
    const first = await landTask(a.slug);
    expect(first.exitCode, first.text).toBe(0);
    expect(statusOf(a.slug)).toBe("archived");
    expect(reviewBatchRuns().length, "a non-last archive starts no batch").toBe(runsBefore);
    expect(aiCalls().length).toBe(callsBefore);
    expect(statusOf(plan)).not.toBe("archived");

    // the second landing archives the last task; the assess double is held, so it can only start after the landing returned
    writeFileSync(hold, "held\n");
    const second = await landTask(b.slug);
    const returnedAt = Date.now();
    expect(second.exitCode, second.text).toBe(0);
    expect(statusOf(b.slug)).toBe("archived");
    expect(statusOf(plan), "the landing returned while the plan is still open").not.toBe("archived");
    const phaseLines = second.stdout.split("\n").filter((line) => /^phase /.test(line));
    expect(phaseLines.length, "the landing prints its phase table").toBeGreaterThan(0);
    for (const line of phaseLines) expect(line, "no close time in the phase table").not.toMatch(/close|assess|apply|verify/i);
    expect(aiCalls().length, "the assess has not started when the landing returned").toBe(callsBefore);

    // the batch is a detached process under its own child run, registered by the landing's verified run
    const run = await eventually(() => reviewBatchRuns()[runsBefore], "the review batch's child run");
    expect(run.parent_run_id, "the child run is delegated by the landing's run").toMatch(/^cc:/);
    expect(run.harness_pid, "the batch is its own harness").not.toBeNull();
    expect(run.harness_pid).not.toBe(process.pid);
    expect(reviewBatchRuns().length, "one batch").toBe(runsBefore + 1);

    rmSync(hold, { force: true });
    const releasedAt = Date.now();
    await eventually(() => statusOf(plan) === "archived", "the plan to archive after the batch");
    const calls = aiCalls();
    expect(calls.length, "the assess double ran after the landing returned").toBeGreaterThan(callsBefore);
    const firstStart = Number.parseInt((calls[callsBefore] as string).split(" ")[0] as string, 10);
    expect(firstStart, "the assess double records its start after the landing returned").toBeGreaterThanOrEqual(releasedAt - 1000);
    expect(firstStart).toBeGreaterThan(returnedAt);
    await batchesEnded(runsBefore + 1);
    expect(batchLog(), "the batch reports no error").not.toMatch(/\bERROR\b/);
  });

  it("AC-DCS2-11: three plans through the assess double: a failed security gate stays open with its issue filed; only a non-gate failure archives with known defects; a missing P0 UAT stays open naming the gate", async () => {
    const issuesBefore = filedIssues().length;
    const runsBefore = reviewBatchRuns().length;

    const gatePlan = await approvedPlan("Close gate plan SECFAIL");
    const gateTask = await finishedCodeTask(gatePlan, "pc11g");
    expect((await landTask(gateTask.slug)).exitCode).toBe(0);
    await batchesEnded(runsBefore + 1);
    expect(statusOf(gatePlan), "a failed gate keeps the plan open").not.toBe("archived");
    const afterGate = filedIssues();
    expect(afterGate.length, "the failed gate's issue is filed").toBe(issuesBefore + 1);
    expect(afterGate[issuesBefore]?.title).toContain("security");
    expect(batchLog()).toContain("gate");

    const defectPlan = await approvedPlan("Close defect plan DESFAIL");
    const defectTask = await finishedCodeTask(defectPlan, "pc11d");
    expect((await landTask(defectTask.slug)).exitCode).toBe(0);
    await eventually(() => statusOf(defectPlan) === "archived", "the plan with only a non-gate failure to archive");
    await batchesEnded(runsBefore + 2);
    const afterDefect = filedIssues();
    expect(afterDefect.length, "the non-gate failure's issue is filed").toBe(issuesBefore + 2);
    expect(afterDefect[issuesBefore + 1]?.title).toContain("design_necessity");
    expect(withDb((db) => (db.query("SELECT COUNT(*) AS n FROM audit WHERE action = 'plan-close-accepted-with-known-defects'").get() as { n: number }).n), "known defects are recorded").toBeGreaterThan(0);

    const uatPlan = (await fixture.mustRun(["create", "plan", "--title", "Close uat plan", "--parent", fixture.spec, ...planFieldsArgs(fixture.spec), "--no-ai", "--requires-uat"])).match(/Slug:\s+(\S+)/)?.[1] as string;
    await fixture.mustRun(["approve", uatPlan]);
    const uatTask = await finishedCodeTask(uatPlan, "pc11u");
    expect((await landTask(uatTask.slug)).exitCode).toBe(0);
    await batchesEnded(runsBefore + 3);
    expect(statusOf(uatPlan), "a missing P0 UAT keeps the plan open").not.toBe("archived");
    expect(batchLog(), "the batch names the gate").toMatch(/uat/i);
    expect(filedIssues().length, "no issue is filed for a missing UAT").toBe(issuesBefore + 2);

    // the two plans that stay open are complete: left in place they would be in the trigger set of every later landing of this file
    for (const plan of [gatePlan, uatPlan]) {
      const deprecated = await inProcess(fixture.dir, ["set", plan, "--status", "deprecated"], OWNER);
      expect(deprecated.exitCode, deprecated.text).toBe(0);
    }
  });
});

describe("AC-DCS2-11: the close runs rule apply for every spec of the plan", () => {
  it("AC-DCS2-11: the change set of a spec the plan only IMPLEMENTS lands when the plan closes in the background (a retire needs no evidence); a plan with no change set applies nothing", async () => {
    const liveRule = await ensureLiveRuleViaAsyncCli((args) => fixture.mustRun(args), fixture.dir);
    const baseline = JSON.parse(await fixture.mustRun(["list", "--type", "baseline", "--json", "--limit", "100"])) as { data: { docs: Array<{ slug: string; title: string }> } };
    const leaf = baseline.data.docs.find((doc) => doc.title === "Fixture Leaf")?.slug;
    expect(leaf, "the fixture leaf").toBeDefined();
    // a live rule that nothing cites: only the implemented spec retires it
    const added = await fixture.mustRun(["rule", "add", leaf as string, "--statement", "A live rule only the implemented spec retires", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "e1", ...DECIDED_FLAGS]);
    const rule = added.match(/\bBR-\d+\b/)?.[0] as string;
    approveFixtureNodes(fixture.dir, "all");
    const ruleState = async (): Promise<string> => (JSON.parse(await fixture.mustRun(["rule", "show", rule, "--json"])) as { data: { state: string } }).data.state;
    expect(await ruleState()).toBe("live");

    const implemented = (await fixture.mustRun(["create", "spec", "--title", "Close implemented spec", "--kind", "tech", ...templatedFieldsArgs("spec", { kind: "tech", refTarget: fixture.spec }), "--no-ai"])).match(/Slug:\s+(\S+)/)?.[1] as string;
    await fixture.mustRun(["ac", "add", implemented, "AC-IM-1", "--statement", "A script criterion.", "--mode", "script", "--oracle", "test", "--command", "echo im1", "--cite", liveRule]);
    const proposed = await fixture.run(["rule", "propose", implemented, "retire", rule, "--note", "retired by the spec the plan implements"]);
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    await fixture.mustRun(["approve", implemented]);

    const plan = await approvedPlan("Close implements plan");
    await fixture.mustRun(["link", plan, implemented, "--type", "implements"]);
    const code = await finishedCodeTask(plan, "pc11i");
    const runsBefore = reviewBatchRuns().length;
    // the plan has one task: its landing is the last archive, so the close runs in the background and applies the implemented spec
    expect((await landTask(code.slug)).exitCode).toBe(0);
    expect(await ruleState(), "the landing did not apply the change set").toBe("live");
    await eventually(() => statusOf(plan) === "archived", "the plan to archive");
    await batchesEnded(runsBefore + 1);
    expect(await ruleState(), "the close applied the change set of the spec the plan implements").toBe("retired");
  });
});

// ───────────────────────────── AC-DCS2-20 ─────────────────────────────

describe("AC-DCS2-20: plan close holds its own plan-scoped lease and never blocks a landing", () => {
  // reason: the AI double's hold file and the lease directory are shared by every test of this file; a test that fails while it holds the
  // double must not leave it held, or every later close waits on it and fails for a reason that is not its own
  afterEach(() => {
    rmSync(hold, { force: true });
  });

  it("AC-DCS2-20: a landing started while a close holds its plan lease exits 0 at once with no queue wait; a second close of the plan exits 75 plan-close-busy naming the holder; a close of another plan is not blocked", async () => {
    const holdPlan = await approvedPlan("Close hold plan HOLDME");
    const holdTask = await finishedCodeTask(holdPlan, "pc20h");
    const runsBefore = reviewBatchRuns().length;
    writeFileSync(hold, "held\n");
    expect((await landTask(holdTask.slug)).exitCode).toBe(0);
    // the detached batch now holds the plan lease inside its assess, which is held
    const leaseFile = await eventually(() => planLeaseFiles()[0], "the plan lease file");
    const lease = JSON.parse(readFileSync(join(planLeaseDir(), leaseFile), "utf8")) as { pid: number; start_time: string };
    expect(Number.isInteger(lease.pid)).toBe(true);
    expect(lease.start_time).not.toBe("");
    expect(reviewBatchRuns().length).toBe(runsBefore + 1);
    expect(queueTickets(), "the close takes no landing ticket").toEqual([]);
    const callsAtHold = aiCalls().length;

    // a landing meanwhile: exit 0, within seconds, no queue wait, while the close is still held
    const other = await approvedPlan("Close landing meanwhile plan");
    const otherTask = await finishedCodeTask(other, "pc20o");
    const started = Date.now();
    const landing = await landTask(otherTask.slug);
    const took = Date.now() - started;
    expect(landing.exitCode, landing.text).toBe(0);
    expect(landing.text).not.toMatch(/queued:|queue-wait|queue ticket|timeout/);
    expect(statusOf(otherTask.slug)).toBe("archived");
    // reason: since BR-1511 every landing starts a batch, which takes a plan lease for the landed plan; the AC is about the HELD plan's lease
    expect(planLeaseFiles(), "the held plan's lease file is still there when the landing returned").toContain(leaseFile);
    expect(JSON.parse(readFileSync(join(planLeaseDir(), leaseFile), "utf8")), "the held plan's lease still names the original holder").toMatchObject({ pid: lease.pid, start_time: lease.start_time });
    expect(aiCalls().length, "the held close did not run its assess a second time").toBe(callsAtHold);
    expect(took, "the landing did not wait for the held close").toBeLessThan(240_000);

    // a second close of the held plan exits 75 plan-close-busy naming the holder
    const busy = await spawned(fixture.dir, ["plan", "close", holdPlan], OWNER, withGh());
    expect(busy.exitCode, busy.text).toBe(75);
    expect(busy.stderr).toContain("plan-close-busy");
    expect(busy.stderr).toContain(String(lease.pid));

    // a close of another plan is not blocked by the held one
    const knownRuns = new Set(reviewBatchRuns().map((run) => run.id));
    const free = await closablePlan("Close free plan FREEPASS", "pc20f");
    // reason: BR-1532 — one review batch runs per machine. The batch of the held plan is still running (its assess is held), so it holds
    // `batch:<machine>` and the landing that made this plan closable starts NO batch of its own: the running batch re-reads the plans that
    // need review when its pass ends and covers this one. The by-hand close of this plan therefore finds no batch holding its plan lease.
    expect(
      reviewBatchRuns().filter((run) => !knownRuns.has(run.id)),
      "a landing under the live batch starts no batch",
    ).toEqual([]);
    expect(planLeaseFiles(), "the first close still holds its lease").toContain(leaseFile);
    const closedFree = await spawned(fixture.dir, ["plan", "close", free], OWNER, withGh());
    expect(closedFree.exitCode, closedFree.text).toBe(0);
    expect(statusOf(free)).toBe("archived");

    // the holder ends: release the double and the plan closes
    rmSync(hold, { force: true });
    await eventually(() => statusOf(holdPlan) === "archived", "the held plan to archive");
    // ONE batch ran (BR-1532): the held plan's. The landings that went through meanwhile started none; it covered their plans on its re-read
    await batchesEnded(runsBefore + 1);
    expect(reviewBatchRuns().length, "no landing under the live batch started a second one").toBe(runsBefore + 1);
    expect(planLeaseFiles(), "every lease is removed when the closes end").toEqual([]);

    // the plan of the landing that went through meanwhile is complete: close it, so no later landing of this file has a plan waiting
    const closedOther = await spawned(fixture.dir, ["plan", "close", other], OWNER, withGh());
    expect(closedOther.exitCode, closedOther.text).toBe(0);
    expect(statusOf(other)).toBe("archived");
  });

  it("AC-DCS2-20: two closes of one plan never overlap: exactly one runs and the other exits 75 plan-close-busy", async () => {
    const plan = await closablePlan("Close two plan HOLDME", "pc20t");
    writeFileSync(hold, "held\n");
    const callsBefore = aiCalls().length;
    const finished: Out[] = [];
    const first = spawned(fixture.dir, ["plan", "close", plan], OWNER, withGh()).then((out) => (finished.push(out), out));
    const second = spawned(fixture.dir, ["plan", "close", plan], OWNER, withGh()).then((out) => (finished.push(out), out));
    // while the assess is held, exactly one close has returned: the loser, with 75; the winner still holds the lease
    await eventually(() => finished.length >= 1, "the second close to return while the first is held");
    expect(finished.length, "only the loser has returned").toBe(1);
    expect(finished[0]?.exitCode, finished[0]?.text).toBe(75);
    expect(finished[0]?.stderr).toContain("plan-close-busy");
    expect(planLeaseFiles().length, "the winner still holds the lease").toBe(1);
    expect(aiCalls().length, "the held assess has not answered").toBe(callsBefore);
    rmSync(hold, { force: true });
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map((out) => out.exitCode).sort((x, y) => x - y), outcomes.map((out) => out.text).join("\n---\n")).toEqual([0, 75]);
    expect(statusOf(plan)).toBe("archived");
    expect(aiCalls().length, "the assess ran once").toBeGreaterThan(callsBefore);
  });

  it("AC-DCS2-20: a lease whose holder is gone, or whose pid was reused by another process, is taken over", async () => {
    // a dead holder: a process that has exited
    const deadPlan = await closablePlan("Close dead holder plan", "pc20d");
    const gone = spawn("sh", ["-c", "exit 0"]);
    await new Promise((resolve) => gone.on("close", resolve));
    mkdirSync(planLeaseDir(), { recursive: true });
    writeFileSync(join(planLeaseDir(), `${deadPlan}.lease`), `${JSON.stringify({ pid: gone.pid, start_time: "2026-01-01T00:00:00.000Z", plan: deadPlan, since: "2026-01-01T00:00:00.000Z" })}\n`);
    const takenOver = await spawned(fixture.dir, ["plan", "close", deadPlan], OWNER, withGh());
    expect(takenOver.exitCode, takenOver.text).toBe(0);
    expect(statusOf(deadPlan)).toBe("archived");

    // a reused pid: the pid is alive (this test process) but its start time is not the recorded one
    const reusedPlan = await closablePlan("Close reused pid plan", "pc20r");
    writeFileSync(join(planLeaseDir(), `${reusedPlan}.lease`), `${JSON.stringify({ pid: process.pid, start_time: "2001-01-01T00:00:00.000Z", plan: reusedPlan, since: "2001-01-01T00:00:00.000Z" })}\n`);
    const reused = await spawned(fixture.dir, ["plan", "close", reusedPlan], OWNER, withGh());
    expect(reused.exitCode, reused.text).toBe(0);
    expect(statusOf(reusedPlan)).toBe("archived");
    expect(planLeaseFiles()).toEqual([]);
  });
});
