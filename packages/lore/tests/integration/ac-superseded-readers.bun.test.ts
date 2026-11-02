// @reads assets/project/lore-config-template.yaml
/**
 * @spec_ref spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-15 (D15, BR-163)
 * @task task-skill-fix-a-superseded-criterion-is-still-counted-by
 *
 * DC2-15 made `lore verify` skip a superseded criterion. This file pins the OTHER readers of the same
 * mark: `ac list` coverage and the contract compile of `lore approve` (the declared-ac_scope floor of `lore done` it used to pin is
 * retired by AC-DCS1-7; a superseded criterion gives no `ac:` oracle, AC-DCS1-1).
 * Throwaway corpus only (mkdtemp + `lore init`); never the repo's own `.lore/`.
 *
 * Coverage: HAPPY (a coverage `superseded`, b floor satisfied + named line), NEGATIVE (floor still
 * refuses a scope that holds a LIVE id; a live criterion is never `superseded`),
 * REGRESSION (b control: before supersession the same task is refused by the floor).
 */
import { mkdtempSync, rmSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AC_COVERAGE_GLYPH_ALPHABET,
  AC_COVERAGE_STATES,
  computeAcCoverage,
  deriveAcCoverageState,
  projectAcCoverageGlyph,
} from "@lore/core";
import { makeCleanTreeRepo } from "../helpers/clean-tree-repo";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { actedStore } from "../live-invocation.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { approvePending } from "../helpers/approve-baseline.js";
import { DECIDED_FLAGS_OWN_REASON } from "../helpers/decision-flags.js";
import { planFieldsArgs, templatedFieldsArgs } from "../helpers/templated-create.js";

let dir = "";
let specS = "";
let specS2 = "";
let plan = "";
let taskControl = "";
let taskOnlyAc1 = "";
let taskAc1AndAc2 = "";
let citedRule = "";

async function lore(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await runLoreInProcess(args, {
    cwd: dir,
    home: dir,
    env: { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:superseded-readers-test" },
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

async function must(args: readonly string[]): Promise<string> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${r.exitCode}: ${r.stderr}`);
  return r.stdout;
}

const slugOf = (stdout: string): string => {
  const slug = (stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/))?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
};

async function coverageStates(slug: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await must(["ac", "list", slug, "--json"])) as {
    data?: { coverage?: { ac_id: string; state: string }[] | null };
  };
  const states: Record<string, string> = {};
  for (const fact of parsed.data?.coverage ?? []) states[fact.ac_id] = fact.state;
  return states;
}

async function addScriptAc(spec: string, acId: string): Promise<void> {
  await must([
    "ac", "add", spec, acId, "--statement", `criterion ${acId} holds`, "--mode", "script", "--oracle", "other",
    "--command", `echo ${acId}-ran`, "--cite", citedRule,
  ]);
}

async function createTask(title: string, scope: readonly string[]): Promise<string> {
  return slugOf(
    await must([
      "create", "task", "--kind", "code", "--title", title, "--parent", plan, "--plan-id", plan, "--no-ai", ...templatedFieldsArgs("task"),
      ...scope.flatMap((id) => ["--ac-scope", id]),
    ]),
  );
}

/** The oracle ids of the done contract `lore approve` stored on `task`. */
async function contractOracleIds(task: string): Promise<string[]> {
  const got = JSON.parse(await must(["get", task, "--json"])) as {
    data: { doc?: { extra: Record<string, unknown> }; extra?: Record<string, unknown> };
  };
  const extra = got.data.doc?.extra ?? got.data.extra ?? {};
  const contract = extra["done_contract"] as { oracles: { id: string }[] } | undefined;
  if (contract === undefined) throw new Error(`task ${task} holds no done contract after approve`);
  return contract.oracles.map((oracle) => oracle.id);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-ac-superseded-readers-"));
  // reason: approve compiles the task's done contract at a commit of the repository, so the corpus lives in a git repository.
  makeCleanTreeRepo(dir);
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
      "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"',
      "",
    ].join("\n"),
  );
  const prd = slugOf(await must(["create", "prd", "--title", "SR PRD", "--no-ai", ...templatedFieldsArgs("prd")]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "SR Root", ...templatedFieldsArgs("baseline", { kind: "root" })]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "SR Branch", ...templatedFieldsArgs("baseline", { kind: "branch" })]));
  const leaf = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "SR Leaf", ...templatedFieldsArgs("baseline", { kind: "leaf" })]));
  const rule = await must(["rule", "add", leaf, "--statement", "a live rule to cite", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"]);
  citedRule = rule.match(/\bBR-\d+\b/)?.[0] ?? "";
  if (citedRule === "") throw new Error(`no rule id in: ${rule}`);
  // a direct add is a pending add: the rule is citable (live) only once its leaf is approved
  const side = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    await approvePending(side, leaf);
  } finally {
    side.close();
  }
  specS =slugOf(await must(["create", "spec", "--title", "SR Spec S", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature", refTarget: prd })]));
  specS2 = slugOf(await must(["create", "spec", "--title", "SR Spec S2", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature", refTarget: prd })]));
  await addScriptAc(specS, "AC-1");
  await addScriptAc(specS, "AC-2");
  await addScriptAc(specS, "AC-3");
  await addScriptAc(specS2, "AC-9");
  plan = slugOf(await must(["create", "plan", "--title", "SR Plan", "--parent", specS, "--no-ai", ...planFieldsArgs(specS)]));
  taskControl = await createTask("SR control task AC-1", ["AC-1"]);
  taskOnlyAc1 = await createTask("SR task only AC-1", ["AC-1"]);
  taskAc1AndAc2 = await createTask("SR task AC-1 and AC-2", ["AC-1", "AC-2"]);
  await must(["approve", specS, "--override-no-judgment"]);
  await must(["approve", specS2, "--override-no-judgment"]);
}, 180_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("superseded is its own coverage state in the one derivation (pure)", () => {
  const evidenceHeavyFact = {
    ac_id: "AC-X",
    mode: "script" as const,
    pass: 3,
    fail: 2,
    refs: [],
    attested_pass: 3,
    attested_fail: 1,
    falsified: 2,
  };
  const mark = { spec: "S2", ac: "AC-9", reason: "r", by: "agent:t", at: "2026-10-19T00:00:00.000Z" };

  it("a superseded fact is `superseded` whatever evidence it holds, never fail/pass/none", () => {
    expect(deriveAcCoverageState({ ...evidenceHeavyFact, superseded_by: mark })).toBe("superseded");
    expect(deriveAcCoverageState({ ...evidenceHeavyFact, pass: 0, fail: 0, attested_pass: 0, superseded_by: mark })).toBe("superseded");
    // negative: the same evidence without the mark is NOT superseded
    expect(deriveAcCoverageState(evidenceHeavyFact)).not.toBe("superseded");
  });

  it("computeAcCoverage carries the mark from the criterion onto the fact", () => {
    const criterion = {
      id: "AC-X",
      statement: "s",
      verify: { mode: "human", note: "n" },
      superseded_by: mark,
    } as unknown as Parameters<typeof computeAcCoverage>[0][number];
    const [fact] = computeAcCoverage([criterion], []);
    expect(fact?.superseded_by).toEqual(mark);
    expect(deriveAcCoverageState(fact as NonNullable<typeof fact>)).toBe("superseded");
  });

  it("its glyph is distinct from every other state's (rendering stays injective)", () => {
    expect(AC_COVERAGE_STATES).toContain("superseded");
    expect(new Set(AC_COVERAGE_GLYPH_ALPHABET).size).toBe(AC_COVERAGE_STATES.length);
    expect(projectAcCoverageGlyph("superseded")).not.toBe(projectAcCoverageGlyph("fail_superseded"));
  });
});

describe("a superseded criterion is read as superseded by every coverage and floor reader", () => {
  it("control: before supersession AC-1 is not `superseded` and the contract compiled at approve holds its oracle ac:AC-1", async () => {
    const states = await coverageStates(specS);
    expect(states["AC-1"]).not.toBe("superseded");
    await must(["approve", taskControl]);
    expect(await contractOracleIds(taskControl)).toContain("ac:AC-1");
  }, 120_000);

  it("(1) ac list coverage reads `superseded` for the superseded criterion only", async () => {
    await must(["ac", "supersede", specS, "AC-1", "--by", `${specS2}:AC-9`, "--reason", "replaced by S2 AC-9", ...DECIDED_FLAGS_OWN_REASON]);
    const states = await coverageStates(specS);
    expect(states["AC-1"]).toBe("superseded");
    expect(states["AC-2"]).toBe("none");
    expect(states["AC-3"]).toBe("none");
    // the human table renders the same state: the retired badge on AC-1 only
    const table = await must(["ac", "list", specS]);
    expect(table).toMatch(/⊖ AC-1/);
    expect(table).not.toMatch(/⊖ AC-2/);
  }, 120_000);

  // reason: the declared-ac_scope floor of `lore done` is retired (AC-DCS1-7): the contract compiled at approve (AC-DCS1-1) is what
  // done judges, and a superseded criterion gives no oracle there. The two readers of the mark below are therefore asserted at approve.
  it("(2) a task scoped to only the superseded id is approved with no ac oracle for it", async () => {
    const approved = await lore(["approve", taskOnlyAc1]);
    expect(approved.exitCode, approved.stderr).toBe(0);
    expect(await contractOracleIds(taskOnlyAc1)).not.toContain("ac:AC-1");
  }, 120_000);

  it("(2b) negative: a scope that still holds a LIVE id keeps that id's oracle and still drops the superseded one", async () => {
    const approved = await lore(["approve", taskAc1AndAc2]);
    expect(approved.exitCode, approved.stderr).toBe(0);
    const oracles = await contractOracleIds(taskAc1AndAc2);
    expect(oracles).toContain("ac:AC-2");
    expect(oracles).not.toContain("ac:AC-1");
  }, 120_000);
});
