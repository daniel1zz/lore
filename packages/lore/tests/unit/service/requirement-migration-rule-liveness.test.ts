// @spawns packages/lore/src/index.ts
// @layer service-requirement-migration AC-BLS3-4
/**
 * Tests for rule liveness in requirement-from-citation coverage and the migrate verb
 * (baseline slice 3a, BR-983) — task-implement-c-requirement-coverage-from-citations.
 *
 * Orchestrator decision: once the corpus holds baseline docs, a `migrated_to` rule that is
 * deprecated, retired or absent from every baseline leaf covers nothing (consistent with the
 * citation gate); `lore requirement migrate` / `add --migrated-to` refuse a non-live rule.
 *
 * Dimensions: HAPPY (live rule covers), NEGATIVE (deprecated/retired/absent -> uncovered; migrate
 * refused), BOUNDARY (no baseline docs -> citations alone decide), STATE (migrate flips the
 * requirement into the migrated group), ERROR (unknown requirement, non-PRD).
 *
 * @spec_ref AC-BLS3-4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RequirementService } from "../../../src/service/requirement-service.js";

function harness() {
  const store = new InMemoryStore();
  return {
    store,
    cs: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    ac: new AcService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    reqs: new RequirementService(store, false),
  };
}
type H = ReturnType<typeof harness>;

async function addLeaf(h: H, rules: Array<{ id: string; lifecycle: string }>): Promise<void> {
  const now = new Date().toISOString();
  const doc = {
    id: ulid() as DocId,
    type: "baseline",
    slug: "leaf-under-test",
    title: "leaf",
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {
      node: "leaf",
      rules: rules.map((r) => ({
        ...r,
        statement: `statement of ${r.id}`,
        confidence: "established",
        enforced_by: "both",
        examples: ["example"],
      })),
    },
    role: DOC_TYPE_ROLE_MAP["baseline"],
  } as DocRecord;
  const r = await h.store.insert(doc);
  if (!r.ok) throw new Error(`leaf insert failed: ${JSON.stringify(r.error)}`);
}

async function makePrdWithCitingSpec(h: H, migratedTo: string): Promise<DocRecord> {
  const prd = await h.cs.create({
    type: "prd",
    title: "Root PRD",
    content: "# PRD",
    extra: { requirements: [{ id: "R-1", statement: "user can log in", priority: "P0", migrated_to: migratedTo }] },
  } as CreateDocInput);
  if (!prd.ok) throw new Error(JSON.stringify(prd.error));
  const spec = await h.cs.create({
    type: "spec",
    title: "Spec",
    content: "## Overview\n\nbody",
    extra: { spec_kind: "feature" },
  } as CreateDocInput);
  if (!spec.ok) throw new Error(JSON.stringify(spec.error));
  const added = await h.ac.addCriterion(spec.value.id, {
    id: "AC-X-1",
    statement: "Does the thing",
    verify: { mode: "script", oracle: "test", command: "bun test x" },
    cites: [migratedTo],
  } as never);
  if (!added.ok) throw new Error(JSON.stringify(added.error));
  return prd.value;
}

async function coveredIds(h: H, prd: DocRecord): Promise<{ covered: string[]; uncovered_p0: string[] }> {
  const r = await h.cs.computeRequirementCoverageForPrd(prd.id);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe("requirement coverage — rule liveness once the corpus has baseline docs", () => {
  it("HAPPY: a live rule cited by a script criterion covers the migrated requirement", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle: "live" }]);
    const prd = await makePrdWithCitingSpec(h, "BR-5");
    expect((await coveredIds(h, prd)).covered).toEqual(["R-1"]);
  });

  it.each(["deprecated", "retired"])("NEGATIVE: a %s rule covers nothing even when cited", async (lifecycle) => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle }]);
    const prd = await makePrdWithCitingSpec(h, "BR-5");
    const c = await coveredIds(h, prd);
    expect(c.covered).toEqual([]);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("NEGATIVE: a rule absent from every baseline leaf covers nothing", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-1", lifecycle: "live" }]);
    const prd = await makePrdWithCitingSpec(h, "BR-5");
    expect((await coveredIds(h, prd)).uncovered_p0).toEqual(["R-1"]);
  });

  it("BOUNDARY: with no baseline docs at all, the citation alone decides", async () => {
    const h = harness();
    const prd = await makePrdWithCitingSpec(h, "BR-5");
    expect((await coveredIds(h, prd)).covered).toEqual(["R-1"]);
  });
});

describe("RequirementService.migrateRequirement", () => {
  async function prdWithRequirement(h: H): Promise<DocRecord> {
    const prd = await h.cs.create({
      type: "prd",
      title: "Root PRD",
      content: "# PRD",
      extra: { requirements: [{ id: "R-1", statement: "user can log in", priority: "P0" }] },
    } as CreateDocInput);
    if (!prd.ok) throw new Error(JSON.stringify(prd.error));
    return prd.value;
  }

  it("HAPPY: sets migrated_to to a live rule", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle: "live" }]);
    const prd = await prdWithRequirement(h);
    const m = await h.reqs.migrateRequirement(prd.id, "R-1", "BR-5");
    expect(m.ok && m.value[0]?.migrated_to).toBe("BR-5");
    const list = await h.reqs.listRequirements(prd.id);
    expect(list.ok && list.value[0]?.migrated_to).toBe("BR-5");
  });

  it.each(["deprecated", "retired"])("NEGATIVE: refuses a %s rule with VALIDATION_ERROR and stores nothing", async (lifecycle) => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle }]);
    const prd = await prdWithRequirement(h);
    const m = await h.reqs.migrateRequirement(prd.id, "R-1", "BR-5");
    expect(!m.ok && m.error.code).toBe("VALIDATION_ERROR");
    const list = await h.reqs.listRequirements(prd.id);
    expect(list.ok && list.value[0]?.migrated_to).toBeUndefined();
  });

  it("NEGATIVE: refuses a rule absent from every leaf", async () => {
    const h = harness();
    const prd = await prdWithRequirement(h);
    const m = await h.reqs.migrateRequirement(prd.id, "R-1", "BR-5");
    expect(!m.ok && m.error.code).toBe("VALIDATION_ERROR");
  });

  it("NEGATIVE: refuses a malformed rule id", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle: "live" }]);
    const prd = await prdWithRequirement(h);
    const m = await h.reqs.migrateRequirement(prd.id, "R-1", "AS-5");
    expect(!m.ok && m.error.code).toBe("VALIDATION_ERROR");
  });

  it("ERROR: an unknown requirement id is refused", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle: "live" }]);
    const prd = await prdWithRequirement(h);
    const m = await h.reqs.migrateRequirement(prd.id, "R-9", "BR-5");
    expect(!m.ok && m.error.code).toBe("VALIDATION_ERROR");
  });

  it("STATE: re-migrating to another live rule replaces migrated_to", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle: "live" }, { id: "BR-6", lifecycle: "live" }]);
    const prd = await prdWithRequirement(h);
    await h.reqs.migrateRequirement(prd.id, "R-1", "BR-5");
    const m = await h.reqs.migrateRequirement(prd.id, "R-1", "BR-6");
    expect(m.ok && m.value[0]?.migrated_to).toBe("BR-6");
  });

  it("addRequirement with requireLiveRule refuses a non-live migrated_to; without it only the schema applies", async () => {
    const h = harness();
    await addLeaf(h, [{ id: "BR-5", lifecycle: "deprecated" }]);
    const prd = await prdWithRequirement(h);
    const cand = { id: "R-2", statement: "user can log out", priority: "P1", migrated_to: "BR-5" };
    const strict = await h.reqs.addRequirement(prd.id, cand, { requireLiveRule: true });
    expect(!strict.ok && strict.error.code).toBe("VALIDATION_ERROR");
    const lax = await h.reqs.addRequirement(prd.id, cand);
    expect(lax.ok).toBe(true);
  });
});

// ─── CLI: lore requirement migrate / add --migrated-to ───────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1", LORE_ACTOR: "agent:implementer-3a-C" },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

describe("lore requirement migrate / add --migrated-to — exit codes", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("refuses a rule that exists in no baseline leaf with exit 4, for both verbs, and stores nothing", () => {
    dir = join(tmpdir(), `lore-req-mig-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    expect(runLore(["init"], dir).exitCode).toBe(0);
    const created = runLore(["create", "prd", "--title", "prd fixture", "--no-ai", "--content", "body"], dir);
    const slug = created.stdout.match(/Slug:\s+(\S+)/)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${created.stdout}${created.stderr}`);
    const addR1 = ["requirement", "add", slug, "R-1", "--statement", "user can log in", "--priority", "P0"];
    expect(runLore(addR1, dir).exitCode).toBe(0);

    expect(runLore(["requirement", "migrate", slug, "R-1", "BR-99"], dir).exitCode).toBe(4);
    const addR2 = ["requirement", "add", slug, "R-2", "--statement", "user can log out", "--priority", "P1", "--migrated-to", "BR-99"];
    expect(runLore(addR2, dir).exitCode).toBe(4);

    const list = runLore(["requirement", "list", slug, "--json"], dir);
    const data = (JSON.parse(list.stdout) as { data: Array<{ id: string; migrated_to?: string }> }).data;
    expect(data.map((r) => r.id)).toEqual(["R-1"]);
    expect(data[0]?.migrated_to).toBeUndefined();
  }, 120_000);
});
