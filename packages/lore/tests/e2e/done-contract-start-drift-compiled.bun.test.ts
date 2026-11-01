// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-start-drift-compiled.bun.test.ts — `lore start` checks the drift since approve and never drops an oracle
 * (spec-integrate-proves-and-lands-evidence-at-landing-the-merge), observed through the `lore` command tree
 * (`runLoreInProcess`, the function the binary's entry calls) on a throwaway repository and corpus.
 *
 * Each test name starts with `AC-DCS2-<n>:` (with the colon), so `-t 'AC-DCS2-1:'` never matches AC-DCS2-16.
 *
 *   Task "lore start checks drift since approve and never drops an oracle":
 *     AC-DCS2-16  a stale falsifier literal or any recompile cause exits 4 naming each cause and creates and stores nothing;
 *                 otherwise the diff is printed, a changed recompile is stored once (old oracles and added_oracles kept) with
 *                 a drift entry, and an unchanged one stores and logs nothing
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 * Every test owns one falsifier criterion (`AC-DR-<n>`), one source file (`src/dr-<n>.ts`) and one task, so tests never share state.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { DECIDED_FLAGS_OWN_REASON } from "../helpers/decision-flags";
import { dropLoreConfigKey, patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let fixture: DoneContractFixture;
let scratch = "";
let planMain = "";
let sequence = 0;

const CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" } as const;

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  patchLoreConfig(fixture.dir, { workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } } } });
  for (let n = 1; n <= MAX_TASKS; n += 1) for (const suffix of ["", "b", "ns"] as const) await addFalsifierAc(n, suffix);
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  scratch = mkdtempSync(join(tmpdir(), "dcs2-drift-"));
  planMain = await fixture.createPlan("Drift plan on main");
});

afterAll(() => {
  fixture.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

async function loreIn(cwd: string, args: readonly string[], session: string): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, CLAUDE_CODE_SESSION_ID: session, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

const worktreeList = (): string => fixture.git(["worktree", "list", "--porcelain"]);
const branchList = (): string => fixture.git(["branch", "--list", "--format=%(refname:short)"]);
const worktreePathOf = (slug: string): string => join(fixture.dir, ".claude", "worktrees", slug);
const claimOf = async (slug: string): Promise<unknown> => (await fixture.readTask(slug)).extra["claim"];
const contractOf = async (slug: string): Promise<Record<string, unknown>> => (await fixture.readTask(slug)).extra["done_contract"] as Record<string, unknown>;
const driftEntries = async (slug: string): Promise<{ kind: string; at: string; detail: string }[]> =>
  (((await fixture.readTask(slug)).extra["execution_log"] ?? []) as { kind: string; at: string; detail: string }[]).filter((entry) => entry.kind === "drift");

function commitOnMain(message: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(fixture.dir, path, ".."), { recursive: true });
    writeFileSync(join(fixture.dir, path), content);
  }
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", message]);
  return fixture.git(["rev-parse", "HEAD"]);
}

const literalOf = (n: number): string => `DR_${n}_LITERAL`;
const fileOf = (n: number): string => `src/dr-${n}.ts`;
const acOf = (n: number, suffix = ""): string => `AC-DR-${n}${suffix === "" ? "" : `-${suffix.toUpperCase()}`}`;

const MAX_TASKS = 12;

/**
 * Adds the falsifier criterion `id` over `src/dr-<n>.ts`. An approved spec is locked and a claim needs the spec approved, so every
 * criterion the tests use is declared up front, before the spec is approved: `AC-DR-<n>`, `AC-DR-<n>b` and `AC-DR-<n>ns` (marked new-symbol).
 */
async function addFalsifierAc(n: number, suffix: "" | "b" | "ns"): Promise<void> {
  const id = acOf(n, suffix);
  const flags = ["--falsifier-path", fileOf(n), "--falsifier-find", literalOf(n), "--falsifier-replace", "", "--falsifier-exit-code", "1"];
  await fixture.mustRun([
    "ac", "add", fixture.spec, id, "--statement", `Falsifier criterion ${id}.`, "--mode", "script", "--oracle", "test", "--command", `echo ${id}`,
    ...flags, ...(suffix === "ns" ? ["--falsifier-new-symbol"] : []),
  ]);
}

interface DriftTask {
  readonly n: number;
  readonly slug: string;
  readonly compiledAt: string;
}

/** Commits the literal, adds the falsifier AC(s), creates and approves an anchored code task over them. */
async function approvedDriftTask(options: { extraAcs?: readonly string[]; absent?: boolean; newSymbol?: boolean } = {}): Promise<DriftTask> {
  sequence += 1;
  const n = sequence;
  fixture.setDoneContractConfig(CONFIG);
  commitOnMain(`seed ${n}`, { [fileOf(n)]: options.absent === true ? `// no literal yet ${n}\n` : `export const ${literalOf(n)} = 1;\n` });
  const ids = [acOf(n, options.newSymbol === true ? "ns" : ""), ...(options.extraAcs ?? []).map((suffix) => acOf(n, suffix))];
  const slug = await fixture.createTask({ plan: planMain, kind: "code", title: `Drift task ${n}`, anchors: [fileOf(n)], acScope: ids });
  await fixture.mustRun(["approve", slug, "--red-waiver", "fixture: the drift tests add no test"]);
  const compiledAt = (await contractOf(slug))["compiled_at_commit"] as string;
  return { n, slug, compiledAt };
}

/** Replaces the done contract of `slug` through the service layer (the way a claim's write-set addition stores one). */
async function patchContractThroughStore(slug: string, change: (contract: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const found = await app.corpusService.get(slug);
    if (!found.ok) throw new Error(`seed: ${slug} not found: ${JSON.stringify(found.error)}`);
    const doc = found.value.doc;
    const written = await app.corpusService.writeDoc({
      doc,
      patch: { extra: { ...doc.extra, done_contract: change(doc.extra["done_contract"] as Record<string, unknown>) } },
      action: "update",
      changeSummary: "fixture: a contract with added oracles",
      auditAction: "update",
      auditDetails: { operation: "fixture-added-oracles" },
      lock: "none",
      by: doc.created_by,
      now: new Date().toISOString(),
    });
    if (!written.ok) throw new Error(`seed: contract patch failed: ${JSON.stringify(written.error)}`);
  } finally {
    app.close();
  }
}

/** The `extra` of every stored version row of a task, straight from the throwaway corpus database. */
async function versionExtras(slug: string): Promise<Record<string, unknown>[]> {
  const task = await fixture.readTask(slug);
  const db = new Database(join(fixture.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const rows = db.query("SELECT extra FROM versions WHERE doc_id = ? ORDER BY version").all(task.id) as { extra: string }[];
    return rows.map((row) => JSON.parse(row.extra) as Record<string, unknown>);
  } finally {
    db.close();
  }
}

const start = (slug: string, session: string): Promise<Out> => loreIn(fixture.dir, ["start", slug], session);

interface Snapshot {
  readonly worktrees: string;
  readonly branches: string;
  readonly version: number;
  readonly contract: string;
  readonly claim: unknown;
}

async function snapshot(slug: string): Promise<Snapshot> {
  const task = await fixture.readTask(slug);
  return { worktrees: worktreeList(), branches: branchList(), version: task.version, contract: JSON.stringify(task.extra["done_contract"]), claim: task.extra["claim"] };
}

describe("lore start checks drift since approve and never drops an oracle", () => {
  it("AC-DCS2-16: a falsifier literal missing at the base exits 4 naming the criterion, path and literal; no worktree, no claim, contract and version unchanged; fixing the base lets start through", async () => {
    const t = await approvedDriftTask();
    commitOnMain("remove the literal", { [fileOf(t.n)]: `// the literal was renamed\n` });
    const before = await snapshot(t.slug);

    const out = await start(t.slug, "drift-stale");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("contract-drift");
    expect(out.text).toContain(acOf(t.n));
    expect(out.text).toContain(fileOf(t.n));
    expect(out.text).toContain(literalOf(t.n));
    expect(await snapshot(t.slug)).toEqual(before);
    expect(existsSync(worktreePathOf(t.slug))).toBe(false);
    expect(await claimOf(t.slug)).toBeUndefined();
    expect(await driftEntries(t.slug)).toEqual([]);

    // the stored contract stays until the causes are fixed: restoring the literal at the base lets the same task start
    commitOnMain("restore the literal", { [fileOf(t.n)]: `export const ${literalOf(t.n)} = 2;\n` });
    const fixed = await start(t.slug, "drift-stale-fixed");
    expect(fixed.exitCode, fixed.text).toBe(0);
    expect(existsSync(worktreePathOf(t.slug))).toBe(true);
    expect(JSON.stringify(await contractOf(t.slug))).toBe(before.contract);
    expect(await driftEntries(t.slug)).toEqual([]);
  });

  it("AC-DCS2-16: a falsifier file deleted at the base is a missing literal: exit 4, nothing created", async () => {
    const t = await approvedDriftTask();
    fixture.git(["rm", "-q", fileOf(t.n)]);
    fixture.git(["commit", "-q", "-m", "delete the falsifier file"]);
    const before = await snapshot(t.slug);
    const out = await start(t.slug, "drift-deleted");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("contract-drift");
    expect(out.text).toContain(fileOf(t.n));
    expect(await snapshot(t.slug)).toEqual(before);
  });

  it("AC-DCS2-16: every cause is named in one message: two stale literals and a recompile cause (no typecheck command) together", async () => {
    const t = await approvedDriftTask({ extraAcs: ["b"] });
    // both criteria share src/dr-<n>.ts and one literal, so one commit makes both stale
    commitOnMain("remove the literal", { [fileOf(t.n)]: `// gone\n` });
    dropLoreConfigKey(fixture.dir, ["workflow", "done_contract", "typecheck"]);
    const before = await snapshot(t.slug);
    const out = await start(t.slug, "drift-every-cause");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain(acOf(t.n));
    expect(out.text).toContain(acOf(t.n, "b"));
    expect(out.text).toContain("no-typecheck");
    expect(await snapshot(t.slug)).toEqual(before);
    fixture.setDoneContractConfig(CONFIG);
  });

  it("AC-DCS2-16: a recompile cause alone (the config lost its test command) exits 4 naming it, creating and storing nothing", async () => {
    const t = await approvedDriftTask();
    dropLoreConfigKey(fixture.dir, ["workflow", "done_contract", "test_file"]);
    const before = await snapshot(t.slug);
    const out = await start(t.slug, "drift-recompile-cause");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("no-test-command");
    expect(await snapshot(t.slug)).toEqual(before);
    expect(existsSync(worktreePathOf(t.slug))).toBe(false);
    fixture.setDoneContractConfig(CONFIG);
  });

  it("AC-DCS2-16: a literal still absent but marked new-symbol is not drift; start exits 0 and logs nothing", async () => {
    const t = await approvedDriftTask({ absent: true, newSymbol: true });
    expect((await contractOf(t.slug))["new_symbols"]).toEqual([acOf(t.n, "ns")]);
    commitOnMain("touch the anchored file", { [fileOf(t.n)]: `// still no literal ${t.n}\n// more\n` });
    const out = await start(t.slug, "drift-new-symbol");
    expect(out.exitCode, out.text).toBe(0);
    expect(await driftEntries(t.slug)).toEqual([]);
  });

  it("AC-DCS2-16: nothing changed since approve: start exits 0, the contract is byte-identical, no drift entry, and only the claim writes (one version)", async () => {
    const t = await approvedDriftTask();
    const before = await snapshot(t.slug);
    const out = await start(t.slug, "drift-unchanged");
    expect(out.exitCode, out.text).toBe(0);
    const after = await fixture.readTask(t.slug);
    expect(JSON.stringify(after.extra["done_contract"])).toBe(before.contract);
    expect(await driftEntries(t.slug)).toEqual([]);
    expect(after.extra["execution_log"]).toBeUndefined();
    expect(after.version).toBe(before.version + 1);
  });

  it("AC-DCS2-16: the base moved but only unrelated files changed: the contract is unchanged and no drift entry is written", async () => {
    const t = await approvedDriftTask();
    commitOnMain("unrelated change", { "docs/unrelated.md": "unrelated\n" });
    const before = await snapshot(t.slug);
    const out = await start(t.slug, "drift-unrelated");
    expect(out.exitCode, out.text).toBe(0);
    const after = await fixture.readTask(t.slug);
    expect(JSON.stringify(after.extra["done_contract"])).toBe(before.contract);
    expect(await driftEntries(t.slug)).toEqual([]);
    expect(after.version).toBe(before.version + 1);
  });

  it("AC-DCS2-16: a changed anchored file is printed as a diff, and a changed recompile is stored in ONE write that keeps every old oracle and added_oracles and appends one drift entry with old and new values", async () => {
    const t = await approvedDriftTask({ extraAcs: ["b"] });
    const added = [{ id: "test:tests/added-by-claim.test.ts", command: "echo Ran 1 tests in tests/added-by-claim.test.ts" }];
    await patchContractThroughStore(t.slug, (contract) => ({ ...contract, added_oracles: added }));
    const stored = await contractOf(t.slug);
    const oldIds = (stored["oracles"] as { id: string }[]).map((oracle) => oracle.id);
    expect(oldIds).toContain(`ac:${acOf(t.n)}`);
    expect(oldIds).toContain(`ac:${acOf(t.n, "b")}`);

    // the criterion b is superseded by the first one (so a recompile has no oracle for it) and the typecheck command changed
    const superseded = await loreIn(fixture.dir, ["ac", "supersede", fixture.spec, acOf(t.n, "b"), "--by", `${fixture.spec}:${acOf(t.n)}`, "--reason", "replaced by the first criterion", ...DECIDED_FLAGS_OWN_REASON], "drift-supersede");
    expect(superseded.exitCode, superseded.text).toBe(0);
    fixture.setDoneContractConfig({ ...CONFIG, typecheck: "echo typecheck-v2" });
    // the anchored file changes on main, keeping the literal
    commitOnMain("edit the anchored file", { [fileOf(t.n)]: `export const ${literalOf(t.n)} = 1;\nexport const ANCHORED_EDIT_MARKER = 2;\n` });

    const versionBefore = (await fixture.readTask(t.slug)).version;
    const out = await start(t.slug, "drift-changed");
    expect(out.exitCode, out.text).toBe(0);
    // the diff of the anchored file is printed
    expect(out.stdout).toContain("ANCHORED_EDIT_MARKER");
    expect(out.stdout).toContain(fileOf(t.n));

    const after = await fixture.readTask(t.slug);
    const contract = after.extra["done_contract"] as { oracles: { id: string; command?: string }[]; added_oracles: unknown[]; compiled_at_commit: string };
    // no oracle was dropped: every old id is still there, including the superseded criterion's
    for (const id of oldIds) expect(contract.oracles.map((oracle) => oracle.id), id).toContain(id);
    expect(contract.oracles.find((oracle) => oracle.id === "typecheck")?.command).toBe("echo typecheck-v2");
    expect(contract.added_oracles).toEqual(added);
    expect(contract.compiled_at_commit).toBe(fixture.git(["rev-parse", "main"]));

    // exactly one drift entry, holding the old and the new value
    const entries = await driftEntries(t.slug);
    expect(entries.length, JSON.stringify(entries)).toBe(1);
    // typed old and new values (no string to parse): the changed contract fields, read back and compared with the contract before and after
    const entry = entries[0] as unknown as { detail: string; old: Record<string, unknown>; new: Record<string, unknown> };
    expect(typeof entry.detail).toBe("string");
    expect(entry.detail.length).toBeGreaterThan(0);
    const typecheckBefore = (stored["oracles"] as { id: string }[]).find((oracle) => oracle.id === "typecheck");
    const typecheckAfter = contract.oracles.find((oracle) => oracle.id === "typecheck");
    expect(typecheckBefore).toEqual({ id: "typecheck", command: "echo typecheck-ok" });
    expect(Object.keys(entry.old)).toEqual(["oracles.typecheck"]);
    expect(Object.keys(entry.new)).toEqual(["oracles.typecheck"]);
    expect(entry.old["oracles.typecheck"]).toEqual(typecheckBefore);
    expect(entry.new["oracles.typecheck"]).toEqual(typecheckAfter);
    expect(typecheckAfter).toEqual({ id: "typecheck", command: "echo typecheck-v2" });
    // one write for contract + entry, then the claim's own write: two versions, and no version holds one without the other
    expect(after.version).toBe(versionBefore + 2);
    for (const extra of await versionExtras(t.slug)) {
      const contractHere = extra["done_contract"] as { compiled_at_commit: string } | undefined;
      const entryHere = ((extra["execution_log"] ?? []) as { kind: string }[]).some((entry) => entry.kind === "drift");
      expect(entryHere, `a version holding the recompiled contract (${contractHere?.compiled_at_commit}) holds the drift entry`).toBe(contractHere?.compiled_at_commit === contract.compiled_at_commit);
    }
    expect(existsSync(worktreePathOf(t.slug))).toBe(true);
    fixture.setDoneContractConfig(CONFIG);
  });

  it("AC-DCS2-16: a task held by another run still exits 5 first, even when the contract is stale", async () => {
    const t = await approvedDriftTask();
    expect((await start(t.slug, "drift-holder")).exitCode).toBe(0);
    commitOnMain("remove the literal", { [fileOf(t.n)]: `// gone\n` });
    const out = await start(t.slug, "drift-other-run");
    expect(out.exitCode, out.text).toBe(5);
  });
});
