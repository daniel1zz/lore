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
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import {
  definitionOfDone,
  findMissingUnfilteredTestFileRuns,
  readRedFirstDeclared,
  requiresNoNewTestsDeclaration,
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

async function claimJson(task: string): Promise<{ dod: DodJson; stdout: string }> {
  const stdout = await must(["claim", task, "--worktree", `lb-dod-${task}`, "--json"]);
  const parsed = JSON.parse(stdout) as { ok: boolean; data: { definition_of_done?: DodJson } };
  expect(parsed.data.definition_of_done, stdout).toBeDefined();
  return { dod: parsed.data.definition_of_done as DodJson, stdout };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-lb-dod-"));
  await must(["init"]);
  patchLoreConfig(
    dir,
    [
      "workflow:", "  gates:",
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
      "create", "task", "--title", "T", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body",
      "--anchor", "tests/a.test.ts", "--anchor", "tests/b.test.ts", "--anchor", "src/c.ts", "--anchor", "src/d.ts#Foo",
      "--ac-scope", "AC-X-1", "--ac-scope", "AC-X-2",
    ]),
  );
  taskU = slugOf(
    await must(["create", "task", "--title", "U", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--anchor", "src/d.ts"]),
  );
}, TEST_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-LB-5 claim prints the definition of done", () => {
  it(
    "names exactly the anchored test files, red_required true and the script-mode ACs; src/c.ts and the human AC are absent",
    async () => {
      const { dod } = await claimJson(taskT);
      expect(dod.unfiltered_pass_files).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
      expect(dod.unfiltered_pass_files).not.toContain("src/c.ts");
      // a symbol-scoped task anchor (path#Symbol) is accepted, stored as written, and is not a test file
      expect(dod.unfiltered_pass_files).not.toContain("src/d.ts#Foo");
      expect(dod.unfiltered_pass_files.some((f) => f.includes("#"))).toBe(false);
      const got = await must(["get", taskT, "--json"]);
      expect(got).toContain("src/d.ts#Foo");
      expect(dod.red_required).toBe(true);
      expect(dod.verify_acs).toEqual(["AC-X-1"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "prints empty lists and red_required false for a task with no ac_scope and no test anchors",
    async () => {
      const { dod } = await claimJson(taskU);
      expect(dod).toEqual({ unfiltered_pass_files: [], red_required: false, verify_acs: [] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the human claim output and `lore feed task-start` carry the same definition",
    async () => {
      const human = await must(["claim", taskT, "--worktree", `lb-dod-${taskT}`]);
      expect(human).toContain("Definition of done");
      expect(human).toContain("tests/a.test.ts");
      expect(human).toContain("tests/b.test.ts");
      expect(human).toContain("AC-X-1");
      expect(human).not.toContain("src/c.ts");

      const feed = JSON.parse(await must(["feed", "task-start", taskT, "--json"])) as {
        data?: { definition_of_done?: DodJson };
        definition_of_done?: DodJson;
      };
      const fed = feed.data?.definition_of_done ?? feed.definition_of_done;
      expect(fed).toEqual({ unfiltered_pass_files: ["tests/a.test.ts", "tests/b.test.ts"], red_required: true, verify_acs: ["AC-X-1"] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same lists come from the lore done floor predicates, fed the same task",
    async () => {
      const criteria = (JSON.parse(await must(["ac", "list", spec, "--json"])) as { data: { criteria: never[] } }).data.criteria;
      for (const slug of [taskT, taskU]) {
        const doc = (JSON.parse(await must(["get", slug, "--json"])) as { data: { doc: DocRecord } }).data.doc;
        const dod = definitionOfDone(doc, criteria);
        // floor 3 (unfiltered-test-file): with no evidence every anchored test file is still missing
        expect(dod.unfiltered_pass_files).toEqual(findMissingUnfilteredTestFileRuns(doc, [], undefined));
        expect(dod.unfiltered_pass_files).toEqual([...new Set(extractFileAnchors(doc).filter(isTestFileAnchor))]);
        // floors 2 and 4 (red-first / no-new-tests): red is owed iff either floor arms with no evidence
        expect(dod.red_required).toBe(readRedFirstDeclared(doc) || requiresNoNewTestsDeclaration(doc, []));
      }
    },
    TEST_TIMEOUT_MS,
  );
});
