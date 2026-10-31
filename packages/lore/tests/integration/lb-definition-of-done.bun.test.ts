// @spawns packages/lore/src/index.ts
// @reads assets/project/lore-config-template.yaml
/**
 * AC-LB-5 (spec-landing-does-the-bookkeeping-claims-start-from-main-parked, BR-1357): `lore claim` prints the
 * definition of done, and it is computed by the SAME predicates `lore done` uses.
 *
 * Fixture: a throwaway corpus (mkdtemp + `lore init`). Task T anchors tests/a.test.ts, tests/b.test.ts, src/c.ts and the symbol anchor src/d.ts#Foo and
 * declares ac_scope AC-X-1 of a spec whose AC-X-1 is script-mode; task U declares neither an ac_scope nor a test anchor.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a hand-written list naming every anchor gets the counts right only when
 * src/c.ts is included; the tests assert src/c.ts is ABSENT from unfiltered_pass_files.
 * Made red once by listing all anchors.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractFileAnchors, isTestFileAnchor, type DocRecord } from "@lore/core";
import { makeCleanTreeRepo } from "../helpers/clean-tree-repo";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import {
  definitionOfDone,
  findMissingUnfilteredTestFileRuns,
} from "../../src/service/task-workflow-service.js";

const TEST_TIMEOUT_MS = 120_000;

let dir = "";
let spec = "";
let plan = "";
let taskT = "";
let taskU = "";

async function lore(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await runLoreInProcess(args, {
    cwd: dir,
    home: dir,
    env: { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:lb-dod-test" },
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

async function must(args: readonly string[]): Promise<string> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${r.exitCode}: ${r.stderr}`);
  return r.stdout;
}

const slugOf = (stdout: string): string => {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
};

interface DodJson {
  readonly unfiltered_pass_files: string[];
  readonly red_required: boolean;
  readonly verify_acs: string[];
}

interface StoredContract {
  readonly kind: string;
  readonly red_required: boolean;
  readonly red_waiver_reason?: string;
  readonly oracles: { id: string; command?: string }[];
}

/** `lore claim --json` of an APPROVED task: it prints the contract fixed at approve (AC-DCS1-1), not a recomputation. */
async function claimJson(task: string): Promise<{ contract: StoredContract; stdout: string }> {
  const stdout = await must(["claim", task, "--worktree", `lb-dod-${task}`, "--json"]);
  const parsed = JSON.parse(stdout) as { ok: boolean; data: { done_contract?: StoredContract; definition_of_done?: DodJson } };
  expect(parsed.data.done_contract, stdout).toBeDefined();
  // the recomputed definition is only the fallback of a task approved before contracts existed
  expect(parsed.data.definition_of_done).toBeUndefined();
  return { contract: parsed.data.done_contract as StoredContract, stdout };
}

const testFilesOf = (contract: StoredContract): string[] => contract.oracles.filter((o) => o.id.startsWith("test:")).map((o) => o.id.slice("test:".length));
const acIdsOf = (contract: StoredContract): string[] => contract.oracles.filter((o) => o.id.startsWith("ac:")).map((o) => o.id.slice("ac:".length));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-lb-dod-"));
  // reason: approve compiles the contract at a commit of the repository, so the corpus lives in one
  makeCleanTreeRepo(dir);
  await must(["init"]);
  patchLoreConfig(
    dir,
    [
      "workflow:", "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"',
      "  gates:",
      "    spec-create:", "      enabled: false",
      "    spec-promote:", "      enabled: false",
      "    plan-promote:", "      enabled: false",
      "    task-claim:", "      enabled: false",
      '    "task-create":', "      enabled: false",
      "",
    ].join("\n"),
  );
  spec = slugOf(await must(["create", "spec", "--title", "DoD spec", "--content", "body", "--no-ai"]));
  await must(["ac", "add", spec, "AC-X-1", "--statement", "x holds", "--mode", "script", "--oracle", "other", "--command", "echo AC-X-1-ran"]);
  await must(["ac", "add", spec, "AC-X-2", "--statement", "a human judges y", "--mode", "human"]);
  plan = slugOf(await must(["create", "plan", "--title", "DoD plan", "--parent", spec, "--no-ai", "--content", "body"]));
  taskT = slugOf(
    await must([
      "create", "task", "--kind", "code", "--title", "T", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body",
      "--anchor", "tests/a.test.ts", "--anchor", "tests/b.test.ts", "--anchor", "src/c.ts", "--anchor", "src/d.ts#Foo",
      "--ac-scope", "AC-X-1", "--ac-scope", "AC-X-2",
    ]),
  );
  taskU = slugOf(
    await must(["create", "task", "--kind", "code", "--title", "U", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--anchor", "src/d.ts"]),
  );
}, TEST_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-LB-5 claim prints the definition of done", () => {
  it(
    "approved without a waiver, the claim prints the stored contract: exactly the anchored test files, the script-mode ACs and typecheck, red_required true; src/c.ts and the human AC are absent",
    async () => {
      await must(["approve", taskT]);
      const { contract } = await claimJson(taskT);
      expect(testFilesOf(contract)).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
      expect(testFilesOf(contract)).not.toContain("src/c.ts");
      // a symbol-scoped task anchor (path#Symbol) is accepted, stored as written, and is not a test file
      expect(contract.oracles.some((o) => o.id.includes("#") || o.id.includes("src/d.ts"))).toBe(false);
      const got = await must(["get", taskT, "--json"]);
      expect(got).toContain("src/d.ts#Foo");
      expect(contract.red_required).toBe(true);
      expect(contract.red_waiver_reason).toBeUndefined();
      expect(acIdsOf(contract)).toEqual(["AC-X-1"]); // the human AC-X-2 gives no oracle
      expect(contract.oracles.map((o) => o.id)).toContain("typecheck");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "approved with a red waiver, a task with no ac_scope and no test anchors prints red_required false and typecheck as its only oracle",
    async () => {
      await must(["approve", taskU, "--red-waiver", "this fixture task needs no red run"]);
      const { contract } = await claimJson(taskU);
      expect(contract.oracles.map((o) => o.id)).toEqual(["typecheck"]);
      expect(contract.red_required).toBe(false);
      expect(contract.red_waiver_reason).toBe("this fixture task needs no red run");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the human claim output prints the same contract",
    async () => {
      const human = await must(["claim", taskT, "--worktree", `lb-dod-${taskT}`]);
      expect(human).toContain("Done contract");
      expect(human).toContain("test:tests/a.test.ts");
      expect(human).toContain("test:tests/b.test.ts");
      expect(human).toContain("ac:AC-X-1");
      expect(human).toContain("a runner-produced red run on record: yes");
      expect(human).not.toContain("src/c.ts");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the contract's lists are the ones the recomputed definition of done derives from the same task (the compile reads that function)",
    async () => {
      const criteria = (JSON.parse(await must(["ac", "list", spec, "--json"])) as { data: { criteria: never[] } }).data.criteria;
      for (const slug of [taskT, taskU]) {
        const doc = (JSON.parse(await must(["get", slug, "--json"])) as { data: { doc: DocRecord } }).data.doc;
        const dod = definitionOfDone(doc, criteria);
        const contract = doc.extra["done_contract"] as StoredContract;
        expect(testFilesOf(contract)).toEqual(dod.unfiltered_pass_files);
        expect(acIdsOf(contract)).toEqual(dod.verify_acs);
        expect(dod.unfiltered_pass_files).toEqual(findMissingUnfilteredTestFileRuns(doc, [], undefined));
        expect(dod.unfiltered_pass_files).toEqual([...new Set(extractFileAnchors(doc).filter(isTestFileAnchor))]);
        // a code task's default is the red run; the waiver given at approve is the only thing that lowers the stored value
        expect(dod.red_required).toBe(doc.extra["kind"] === "code");
        expect(contract.red_required).toBe(slug === taskT);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
