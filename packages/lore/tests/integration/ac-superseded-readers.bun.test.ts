/**
 * @spec_ref spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-15 (D15, BR-163)
 * @task task-skill-fix-a-superseded-criterion-is-still-counted-by
 *
 * DC2-15 made `lore verify` skip a superseded criterion. This file pins the OTHER readers of the same
 * mark: `ac list` coverage, the `lore done` declared-ac_scope floor, and the MCP `lore_ac_supersede` writer.
 * Throwaway corpus only (mkdtemp + `lore init`); never the repo's own `.lore/`.
 *
 * Coverage: HAPPY (a coverage `superseded`, b floor satisfied + named line, c MCP mark), NEGATIVE (floor still
 * refuses a scope that holds a LIVE id; a live criterion is never `superseded`), STATE (c: MCP mark == CLI mark
 * shape, spec not demoted), REGRESSION (b control: before supersession the same task is refused by the floor).
 */
import { appendFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AC_COVERAGE_GLYPH_ALPHABET,
  AC_COVERAGE_STATES,
  computeAcCoverage,
  deriveAcCoverageState,
  projectAcCoverageGlyph,
} from "@lore/core";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { loosenOverrideClasses } from "./fixtures/autonomy-override-helpers.js";
import { liveAmbient, liveInvocation, liveWriteContext } from "../live-invocation.js";
import { createApp } from "../../src/app.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";

let dir = "";
let specS = "";
let specS2 = "";
let plan = "";
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

interface CriterionJson {
  readonly id: string;
  readonly superseded_by?: { spec: string; ac: string; reason: string; by: string; at: string };
}

async function criteriaOf(slug: string): Promise<CriterionJson[]> {
  const parsed = JSON.parse(await must(["ac", "list", slug, "--json"])) as { data?: { criteria?: CriterionJson[] } };
  return parsed.data?.criteria ?? [];
}

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
  const slug = slugOf(
    await must([
      "create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body",
      ...scope.flatMap((id) => ["--ac-scope", id]),
    ]),
  );
  // An attested pass clears the attested-pass floor, so only the ac_scope floor is under test.
  await must(["evidence", slug, "--oracle", "test", "--command", "true", "--result", "pass", "--capture"]);
  return slug;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-ac-superseded-readers-"));
  await must(["init"]);
  await loosenOverrideClasses(dir, ["override-judgment"]);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
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
  const prd = slugOf(await must(["create", "prd", "--title", "SR PRD", "--content", "root", "--no-ai"]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "SR Root"]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "SR Branch"]));
  const leaf = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "SR Leaf"]));
  const rule = await must(["rule", "add", leaf, "--statement", "a live rule to cite", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"]);
  citedRule = rule.match(/\bBR-\d+\b/)?.[0] ?? "";
  if (citedRule === "") throw new Error(`no rule id in: ${rule}`);
  specS = slugOf(await must(["create", "spec", "--title", "SR Spec S", "--content", "body", "--no-ai"]));
  specS2 = slugOf(await must(["create", "spec", "--title", "SR Spec S2", "--content", "body", "--no-ai"]));
  await addScriptAc(specS, "AC-1");
  await addScriptAc(specS, "AC-2");
  await addScriptAc(specS, "AC-3");
  await addScriptAc(specS2, "AC-9");
  plan = slugOf(await must(["create", "plan", "--title", "SR Plan", "--parent", specS, "--no-ai", "--content", "body"]));
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
  it("control: before supersession AC-1 is not `superseded` and the done floor demands a red run", async () => {
    const states = await coverageStates(specS);
    expect(states["AC-1"]).not.toBe("superseded");
    const refused = await lore(["done", taskOnlyAc1]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("extra.ac_scope (AC-1)");
  }, 120_000);

  it("(1) ac list coverage reads `superseded` for the superseded criterion only", async () => {
    await must(["ac", "supersede", specS, "AC-1", "--by", `${specS2}:AC-9`, "--reason", "replaced by S2 AC-9"]);
    const states = await coverageStates(specS);
    expect(states["AC-1"]).toBe("superseded");
    expect(states["AC-2"]).toBe("none");
    expect(states["AC-3"]).toBe("none");
    // the human table renders the same state: the retired badge on AC-1 only
    const table = await must(["ac", "list", specS]);
    expect(table).toMatch(/⊖ AC-1/);
    expect(table).not.toMatch(/⊖ AC-2/);
  }, 120_000);

  it("(2) a task scoped to only the superseded id passes the ac_scope floor and the output names the supersession", async () => {
    const done = await lore(["done", taskOnlyAc1]);
    expect(done.exitCode, done.stderr).toBe(0);
    expect(done.stdout).toMatch(/AC-1.*supersed/i);
    // the mark stores the superseding spec's document id, so the line names `<spec id>:AC-9`
    expect(done.stdout).toMatch(/superseded by \S+:AC-9/);
  }, 120_000);

  it("(2b) negative: a scope that still holds a LIVE id is refused by the floor", async () => {
    const refused = await lore(["done", taskAc1AndAc2]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("extra.ac_scope");
  }, 120_000);

  it("(3) the MCP lore_ac_supersede tool stores the same mark as the CLI", async () => {
    const app = createApp(join(dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    const server = new McpServer({ name: "lore", version: "0.0.0-test" });
    registerTools(server, app, undefined, liveInvocation());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);
    try {
      const result = (await client.callTool({
        name: "lore_ac_supersede",
        arguments: { spec: specS, ac_id: "AC-2", by_spec: specS2, by_ac: "AC-9", reason: "replaced via MCP" },
      })) as unknown as { isError?: boolean; content: { text: string }[] };
      expect(result.isError ?? false, result.content.map((c) => c.text).join("\n")).toBe(false);
    } finally {
      await client.close();
      app.close();
    }
    const criteria = await criteriaOf(specS);
    const viaCli = criteria.find((c) => c.id === "AC-1")?.superseded_by;
    const viaMcp = criteria.find((c) => c.id === "AC-2")?.superseded_by;
    expect(viaMcp).toBeDefined();
    expect(Object.keys(viaMcp ?? {}).sort()).toEqual(Object.keys(viaCli ?? {}).sort());
    expect(viaMcp).toMatchObject({ ac: "AC-9", reason: "replaced via MCP" });
    expect(viaMcp?.spec).toBe(viaCli?.spec);
    expect(viaMcp?.by).toBeTruthy();
    expect((await coverageStates(specS))["AC-2"]).toBe("superseded");
  }, 120_000);
});
