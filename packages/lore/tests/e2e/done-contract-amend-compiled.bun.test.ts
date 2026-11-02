// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * done-contract-amend-compiled.bun.test.ts — a stored contract changes only through ONE audited amendment
 * (spec-done-contract-corrections-amendment-absent-anchors-landed, AC-DCF-2, BR-1548 as amended), observed through the `lore`
 * command tree (`runLoreInProcess`) on a throwaway repository and corpus.
 *
 *   AC-DCF-2  (a) `lore set <task> --correction "<reason>"` recompiles in place: status and claim kept, the oracle whose source left
 *                 by `anchor rm` leaves, one audit row holds the reason and the old and new oracle ids and commands; a re-run
 *                 writes nothing; an empty reason exits 2
 *             (b) a config change alters one existing oracle's command; the oracle id set is unchanged
 *             (c) a falsifier literal absent exits exactly 4 done-contract-uncompilable and writes nothing
 *             (d) two corrections held together: exactly one exits 0, the other exactly 5, one version written
 *             (e) `lore start` after `anchor add` recompiles with reason start-drift naming the file, adds the oracle, writes one
 *                 audit row and drops no oracle although an anchor was removed
 *             (f) `lore convert` keeps an approved, claimed task approved with its claim and contract; a task left in draft
 *                 holding a contract by an older convert returns to approved through `set --correction`, and `lore claim` works
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 *
 * Coverage: HAPPY (a, b, e, f) / NEGATIVE (empty reason, c) / BOUNDARY (re-run writes nothing) / ERROR (c exit 4, d exit 5) /
 *   STATE (status, claim, versions) / REGRESSION (start keeps every oracle)
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { templatedFill } from "../helpers/templated-create";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let fixture: DoneContractFixture;
let scratch = "";
let plan = "";
let sequence = 0;

const CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" } as const;
const FALSIFIER_AC = "AC-AM-1";
const FALSIFIER_FILE = "src/am-falsifier.ts";
const FALSIFIER_LITERAL = "AM_LITERAL";

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

async function loreIn(args: readonly string[], session: string): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd: fixture.dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, CLAUDE_CODE_SESSION_ID: session, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

function commitOnMain(message: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(fixture.dir, path, ".."), { recursive: true });
    writeFileSync(join(fixture.dir, path), content);
  }
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "--allow-empty", "-m", message]);
}

interface OracleShape {
  readonly id: string;
  readonly command?: string;
}
interface ContractShape {
  readonly oracles: OracleShape[];
  readonly compiled_at_commit: string;
}
const contractOf = async (slug: string): Promise<ContractShape> => (await fixture.readTask(slug)).extra["done_contract"] as ContractShape;
const idsOf = (contract: ContractShape): string[] => contract.oracles.map((oracle) => oracle.id);

interface AuditRow {
  readonly action: string;
  readonly details: Record<string, unknown>;
}

function dbRun<T>(body: (db: Database) => T): T {
  const db = new Database(join(fixture.dir, ".lore", "lore.db"));
  try {
    return body(db);
  } finally {
    db.close();
  }
}

async function auditRows(slug: string): Promise<AuditRow[]> {
  const task = await fixture.readTask(slug);
  return dbRun((db) => (db.query("SELECT action, details FROM audit WHERE doc_id = ? ORDER BY id").all(task.id) as { action: string; details: string }[]).map((row) => ({ action: row.action, details: JSON.parse(row.details) as Record<string, unknown> })));
}

/** The audit rows of the one amendment route (every caller writes `operation: contract-amendment`). */
async function amendmentRows(slug: string): Promise<AuditRow[]> {
  return (await auditRows(slug)).filter((row) => row.details["operation"] === "contract-amendment");
}

const oraclesIn = (value: unknown): OracleShape[] => (Array.isArray(value) ? (value as OracleShape[]) : []);

/** A fresh approved code task anchoring the test files given (each committed first), with the claim of `lore start` when asked. */
async function approvedTask(options: { tests: readonly string[]; scope?: readonly string[]; claim?: boolean }): Promise<string> {
  sequence += 1;
  fixture.setDoneContractConfig(CONFIG);
  const files: Record<string, string> = {};
  for (const file of options.tests) files[file] = `// ${file}\n`;
  commitOnMain(`seed ${sequence}`, files);
  const slug = await fixture.createTask({ plan, kind: "code", title: `Amend task ${sequence}`, anchors: [...options.tests], acScope: options.scope ?? [] });
  await fixture.mustRun(["approve", slug, "--red-waiver", "fixture: the amend tests add no test"]);
  if (options.claim === true) {
    const started = await loreIn(["start", slug], `amend-${sequence}`);
    expect(started.exitCode, started.text).toBe(0);
  }
  return slug;
}

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  patchLoreConfig(fixture.dir, { workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } } } });
  await fixture.mustRun([
    "ac", "add", fixture.spec, FALSIFIER_AC, "--statement", "Falsifier criterion AC-AM-1.", "--mode", "script", "--oracle", "test", "--command", "echo am1",
    "--falsifier-path", FALSIFIER_FILE, "--falsifier-find", FALSIFIER_LITERAL, "--falsifier-replace", "", "--falsifier-exit-code", "1",
  ]);
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  scratch = mkdtempSync(join(tmpdir(), "dcf-amend-"));
  // the stub provider of `lore convert`: prints the filled task template
  const answer = join(scratch, "answer.json");
  writeFileSync(answer, JSON.stringify(templatedFill("task")));
  const stub = join(scratch, "stub.sh");
  writeFileSync(stub, `#!/bin/sh\ncat > /dev/null\ncat "${answer}"\n`);
  chmodSync(stub, 0o755);
  patchLoreConfig(fixture.dir, { ai: { provider: "claude-cli", providers: { "claude-cli": { command: stub, args: [], timeout_ms: 30_000 } } } });
  commitOnMain("falsifier file", { [FALSIFIER_FILE]: `export const ${FALSIFIER_LITERAL} = 1;\n` });
  plan = await fixture.createPlan("Amend plan");
});

afterAll(() => {
  fixture.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

describe("a stored contract changes only through one audited amendment", () => {
  it("AC-DCF-2: set --correction after anchor rm drops that oracle only then, keeps status and claim, and writes one audit row; a re-run writes nothing; an empty reason exits 2", async () => {
    const file = "tests/am-a.test.ts";
    const slug = await approvedTask({ tests: [file], claim: true });
    const stored = await contractOf(slug);
    expect(idsOf(stored)).toContain(`test:${file}`);
    const claimBefore = (await fixture.readTask(slug)).extra["claim"];
    expect(claimBefore).toBeDefined();

    await fixture.mustRun(["anchor", "rm", slug, file]);
    expect(idsOf(await contractOf(slug)), "anchor rm alone never changes the contract").toContain(`test:${file}`);

    const empty = await loreIn(["set", slug, "--correction", "  "], "amend-a-empty");
    expect(empty.exitCode, empty.text).toBe(2);
    expect(await amendmentRows(slug)).toEqual([]);

    const done = await loreIn(["set", slug, "--correction", "am-a test deleted in C"], "amend-a");
    expect(done.exitCode, done.text).toBe(0);
    const after = await fixture.readTask(slug);
    expect(after.status).toBe("approved");
    expect(after.extra["claim"]).toEqual(claimBefore);
    const contract = after.extra["done_contract"] as ContractShape;
    expect(idsOf(contract)).not.toContain(`test:${file}`);
    expect(idsOf(contract)).toContain("typecheck");

    const rows = await amendmentRows(slug);
    expect(rows.length, JSON.stringify(rows)).toBe(1);
    const details = rows[0]!.details;
    expect(JSON.stringify(details)).toContain("am-a test deleted in C");
    expect(oraclesIn(details["old_oracles"]).map((oracle) => oracle.id)).toEqual(idsOf(stored));
    expect(oraclesIn(details["old_oracles"]).find((oracle) => oracle.id === `test:${file}`)?.command).toBeDefined();
    expect(oraclesIn(details["new_oracles"])).toEqual(contract.oracles);

    const again = await loreIn(["set", slug, "--correction", "am-a test deleted in C"], "amend-a-again");
    expect(again.exitCode, again.text).toBe(0);
    expect((await fixture.readTask(slug)).version).toBe(after.version);
    expect((await amendmentRows(slug)).length).toBe(1);
  });

  it("AC-DCF-2: a config change alters the command of an existing oracle; the oracle id set is unchanged and the audit row lists the command change", async () => {
    const file = "tests/am-b.test.ts";
    const slug = await approvedTask({ tests: [file] });
    const stored = await contractOf(slug);
    fixture.setDoneContractConfig({ ...CONFIG, typecheck: "echo typecheck-v2" });
    const done = await loreIn(["set", slug, "--correction", "typecheck command changed"], "amend-b");
    expect(done.exitCode, done.text).toBe(0);
    const contract = await contractOf(slug);
    expect(idsOf(contract)).toEqual(idsOf(stored));
    expect(contract.oracles.find((oracle) => oracle.id === "typecheck")?.command).toBe("echo typecheck-v2");
    const rows = await amendmentRows(slug);
    expect(rows.length).toBe(1);
    expect(oraclesIn(rows[0]!.details["old_oracles"]).find((oracle) => oracle.id === "typecheck")?.command).toBe("echo typecheck-ok");
    expect(oraclesIn(rows[0]!.details["new_oracles"]).find((oracle) => oracle.id === "typecheck")?.command).toBe("echo typecheck-v2");
    expect(JSON.stringify(rows[0]!.details["changes"])).toContain("oracles.typecheck");
    fixture.setDoneContractConfig(CONFIG);
  });

  it("AC-DCF-2: an absent falsifier literal exits exactly 4 done-contract-uncompilable naming the criterion, and writes nothing", async () => {
    const slug = await approvedTask({ tests: [], scope: [FALSIFIER_AC] });
    const before = await fixture.readTask(slug);
    commitOnMain("remove the literal", { [FALSIFIER_FILE]: "// renamed\n" });
    const out = await loreIn(["set", slug, "--correction", "should not compile"], "amend-c");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("done-contract-uncompilable");
    expect(out.text).toContain(FALSIFIER_AC);
    const after = await fixture.readTask(slug);
    expect(after.version).toBe(before.version);
    expect(JSON.stringify(after.extra["done_contract"])).toBe(JSON.stringify(before.extra["done_contract"]));
    expect(await amendmentRows(slug)).toEqual([]);
    commitOnMain("restore the literal", { [FALSIFIER_FILE]: `export const ${FALSIFIER_LITERAL} = 2;\n` });
  });

  it("AC-DCF-2: two corrections held together: exactly one exits 0, the other exactly 5, and one version is written", async () => {
    const file = "tests/am-d.test.ts";
    const slug = await approvedTask({ tests: [file] });
    // reason: whether the second call reads before or after the first one's write is the scheduler's choice; a call that reads
    // after it finds nothing left to amend and exits 0. Every round therefore must end in one of the two legal outcomes with ONE
    // version written, and some round must show the lost race (exit 5); the rounds alternate the pending change (anchor rm / add).
    let sawLostRace = false;
    for (let round = 0; round < 12 && !sawLostRace; round += 1) {
      const present = idsOf(await contractOf(slug)).includes(`test:${file}`);
      await fixture.mustRun(present ? ["anchor", "rm", slug, file] : ["anchor", "add", slug, file]);
      const before = await fixture.readTask(slug);
      const rowsBefore = (await amendmentRows(slug)).length;
      const [one, two] = await Promise.all([
        loreIn(["set", slug, "--correction", `first writer ${round}`], `amend-d-1-${round}`),
        loreIn(["set", slug, "--correction", `second writer ${round}`], `amend-d-2-${round}`),
      ]);
      const exits = [one.exitCode, two.exitCode].sort();
      expect([[0, 0], [0, 5]], `${one.text}\n${two.text}`).toContainEqual(exits);
      expect((await fixture.readTask(slug)).version).toBe(before.version + 1);
      expect((await amendmentRows(slug)).length).toBe(rowsBefore + 1);
      if (exits[1] === 5) sawLostRace = true;
    }
    expect(sawLostRace, "two corrections held together never produced the lost-race exit 5").toBe(true);
  });

  it("AC-DCF-2: start after anchor add recompiles with reason start-drift naming the file, adds its oracle, writes one audit row and drops no oracle even when an anchor was removed", async () => {
    const removed = "tests/am-e1.test.ts";
    const added = "tests/am-e2.test.ts";
    const slug = await approvedTask({ tests: [removed] });
    commitOnMain("the file to anchor", { [added]: "// e2\n" });
    await fixture.mustRun(["anchor", "rm", slug, removed]);
    await fixture.mustRun(["anchor", "add", slug, added]);
    const started = await loreIn(["start", slug], "amend-e");
    expect(started.exitCode, started.text).toBe(0);
    const ids = idsOf(await contractOf(slug));
    expect(ids).toContain(`test:${added}`);
    expect(ids, "the removal waits for set --correction").toContain(`test:${removed}`);
    const rows = await amendmentRows(slug);
    expect(rows.length, JSON.stringify(rows)).toBe(1);
    const reason = JSON.stringify(rows[0]!.details);
    expect(reason).toContain("start-drift");
    expect(reason).toContain(added);
  });

  it("AC-DCF-2: convert of an approved, claimed, untemplated task keeps it approved with the same claim and contract; a draft stranded with a contract returns to approved through set --correction and can be claimed", async () => {
    const file = "tests/am-f.test.ts";
    const slug = await approvedTask({ tests: [file], claim: true });
    dbRun((db) => db.query("UPDATE docs SET extra = json_remove(extra, '$.template_ref', '$.fields', '$.dimensions') WHERE slug = ?").run(slug));
    const before = await fixture.readTask(slug);
    expect(before.extra["template_ref"]).toBeUndefined();
    const auditBefore = (await auditRows(slug)).length;

    const converted = await loreIn(["convert", slug], "amend-f");
    expect(converted.exitCode, converted.text).toBe(0);
    const after = await fixture.readTask(slug);
    expect(after.status).toBe("approved");
    expect(after.extra["claim"]).toEqual(before.extra["claim"]);
    expect(after.extra["done_contract"]).toEqual(before.extra["done_contract"]);
    expect(typeof after.extra["template_ref"]).toBe("string");
    expect((await auditRows(slug)).length - auditBefore).toBe(1);

    // an approved task nobody claimed yet is kept approved too, with its contract
    const unclaimed = await approvedTask({ tests: ["tests/am-f3.test.ts"] });
    dbRun((db) => db.query("UPDATE docs SET extra = json_remove(extra, '$.template_ref', '$.fields', '$.dimensions') WHERE slug = ?").run(unclaimed));
    const unclaimedBefore = await fixture.readTask(unclaimed);
    const convertedUnclaimed = await loreIn(["convert", unclaimed], "amend-f3");
    expect(convertedUnclaimed.exitCode, convertedUnclaimed.text).toBe(0);
    const unclaimedAfter = await fixture.readTask(unclaimed);
    expect(unclaimedAfter.status).toBe("approved");
    expect(unclaimedAfter.extra["done_contract"]).toEqual(unclaimedBefore.extra["done_contract"]);
    expect(typeof unclaimedAfter.extra["template_ref"]).toBe("string");

    // an older convert left a task in draft holding its contract
    const stranded = await approvedTask({ tests: ["tests/am-f2.test.ts"] });
    dbRun((db) => db.query("UPDATE docs SET status = 'draft' WHERE slug = ?").run(stranded));
    const storedContract = (await fixture.readTask(stranded)).extra["done_contract"];
    expect((await fixture.readTask(stranded)).status).toBe("draft");
    const back = await loreIn(["set", stranded, "--correction", "returned from the draft an older convert left"], "amend-f2");
    expect(back.exitCode, back.text).toBe(0);
    const restored = await fixture.readTask(stranded);
    expect(restored.status).toBe("approved");
    expect(restored.extra["done_contract"]).toEqual(storedContract);
    expect((await amendmentRows(stranded)).length).toBe(1);
    fixture.git(["branch", `task/${stranded}`, "main"]);
    const claimed = await loreIn(["claim", stranded, "--worktree", `task/${stranded}`], "amend-f2-claim");
    expect(claimed.exitCode, claimed.text).toBe(0);
  });
});
