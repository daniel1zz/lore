/**
 * RED tests for requirement coverage from citations (baseline slice 3a, BL-6 step 4) —
 * task-red-c-requirement-coverage-from-citations.
 *
 * Spec: spec-baseline-slice-3a-architecture-tree-baseline-root, Design "Requirements (BL-6 4)":
 *   `extra.requirements[i].migrated_to: BR-n`; coverage of a migrated requirement = the rule has a
 *   live script-mode citing criterion; unmigrated as today; report lists both.
 * Rule BR-983: a requirement marked as migrated to a baseline rule is covered exactly when that
 *   rule has a live script-mode citing criterion; a requirement not yet migrated is counted as
 *   before; the report lists migrated and unmigrated requirements separately.
 *
 * CONTRACT (interface choices where the spec is open; simplest consistent with the Design text):
 *   C1. `requirementSchema` gains OPTIONAL `migrated_to`, grammar `BR-<n>` with n >= 1 (the same
 *       grammar as a criterion's `cites[]` entry). AS-n / AD-n / R-n / lower-case are refused.
 *   C2. Pure `computeRequirementCoverage(requirements, refs, citedRuleIds?)` takes a THIRD optional
 *       argument: the ids of rules that have a live script-mode citing criterion. A requirement WITH
 *       `migrated_to` is covered iff `migrated_to` is in `citedRuleIds` (its `refs` membership is
 *       irrelevant); a requirement WITHOUT it is covered iff its id is in `refs`, exactly as before.
 *   C3. `RequirementCoverage` keeps `total/covered/uncovered/uncovered_p0` across BOTH groups (so the
 *       exit-3 derivation is unchanged) and gains `migrated: string[]` and `unmigrated: string[]`:
 *       the requirement ids of each group, in declaration order, together partitioning the inventory.
 *   C4. A "live script-mode citing criterion" = an acceptance criterion with `verify.mode === "script"`
 *       whose `cites` contains the rule id, on a spec whose status is neither `archived` nor
 *       `deprecated`. The citing spec is looked up corpus-wide (NOT only among the PRD's children:
 *       slice 3b re-parents specs under baseline leaves). The PRD's own children are covered too.
 *   C5. `lore status --check-requirements --json` per-PRD entries carry `migrated` and `unmigrated`
 *       id arrays (same meaning as C3) next to the existing `slug/total/uncovered/uncovered_p0`.
 *   C6. `RequirementService.addRequirement` persists `migrated_to` and refuses an invalid one.
 *
 * Dimensions: HAPPY (cited -> covered), NEGATIVE (ai/human/archived/deprecated/uncited -> uncovered;
 * migrated ignores requirement_refs), BOUNDARY (other rule cited, shared rule, empty inputs),
 * STATE (removing the cite flips coverage back; exit code 3 -> 0 -> 3), REGRESSION (unmigrated
 * counted exactly as before, byte-for-byte same fields).
 *
 * @spec_ref AC-BLS3-4
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRequirementCoverage, requirementCoverageExitCode, requirementSchema } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RequirementService } from "../../../src/service/requirement-service.js";

// ─── Loosely typed view of the (not yet extended) pure API ────────────────────

interface Req {
  id: string;
  statement: string;
  priority: "P0" | "P1" | "P2";
  migrated_to?: string;
}
interface Cov {
  total: number;
  covered: string[];
  uncovered: string[];
  uncovered_p0: string[];
  migrated?: string[];
  unmigrated?: string[];
}
const coverage = computeRequirementCoverage as unknown as (
  requirements: Req[],
  refs: string[],
  citedRuleIds?: string[],
) => Cov;

const req = (id: string, priority: Req["priority"], migrated_to?: string): Req => ({
  id,
  statement: `statement of ${id}`,
  priority,
  ...(migrated_to !== undefined ? { migrated_to } : {}),
});

// ─── Pure: schema ─────────────────────────────────────────────────────────────

describe("requirement coverage from citations (BL-6) — requirement schema", () => {
  it("accepts migrated_to BR-<n> and keeps the field", () => {
    const parsed = requirementSchema.safeParse(req("R-1", "P0", "BR-12"));
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data as Req).migrated_to).toBe("BR-12");
  });

  it("still accepts a requirement with no migrated_to (field optional)", () => {
    expect(requirementSchema.safeParse(req("R-2", "P1")).success).toBe(true);
  });

  it.each(["AS-3", "AD-3", "R-1", "BR-0", "BR-", "br-1", "BR-1x", ""])(
    "refuses migrated_to %j (only BR-<n>, n >= 1)",
    (bad) => {
      expect(requirementSchema.safeParse(req("R-3", "P0", bad)).success).toBe(false);
    },
  );
});

// ─── Pure: computeRequirementCoverage ─────────────────────────────────────────

describe("requirement coverage from citations (BL-6) — pure coverage", () => {
  it("HAPPY: a migrated requirement is covered when its rule has a live script citing criterion", () => {
    const cov = coverage([req("R-1", "P0", "BR-5")], [], ["BR-5"]);
    expect(cov.covered).toEqual(["R-1"]);
    expect(cov.uncovered).toEqual([]);
    expect(cov.uncovered_p0).toEqual([]);
  });

  it("NEGATIVE: a migrated P0 whose rule has no citing criterion is uncovered and P0-uncovered", () => {
    const cov = coverage([req("R-1", "P0", "BR-5")], [], []);
    expect(cov.covered).toEqual([]);
    expect(cov.uncovered).toEqual(["R-1"]);
    expect(cov.uncovered_p0).toEqual(["R-1"]);
    expect(requirementCoverageExitCode(cov)).toBe(3);
  });

  it("NEGATIVE: citation of a DIFFERENT rule does not cover (different inputs, different outputs)", () => {
    const cov = coverage([req("R-1", "P0", "BR-5"), req("R-2", "P0", "BR-6")], [], ["BR-6"]);
    expect(cov.covered).toEqual(["R-2"]);
    expect(cov.uncovered_p0).toEqual(["R-1"]);
  });

  it("NEGATIVE (iff): a migrated requirement is NOT covered by a requirement_refs hit alone", () => {
    const cov = coverage([req("R-1", "P0", "BR-5")], ["R-1"], []);
    expect(cov.covered).toEqual([]);
    expect(cov.uncovered_p0).toEqual(["R-1"]);
  });

  it("NEGATIVE: an unmigrated requirement is NOT covered by a rule being cited", () => {
    const cov = coverage([req("R-1", "P0")], [], ["BR-5", "R-1"]);
    expect(cov.covered).toEqual([]);
    expect(cov.uncovered_p0).toEqual(["R-1"]);
  });

  it("REGRESSION: an unmigrated requirement is covered by requirement_refs exactly as before", () => {
    const cov = coverage([req("R-1", "P0"), req("R-2", "P0")], ["R-2"], []);
    expect(cov.covered).toEqual(["R-2"]);
    expect(cov.uncovered).toEqual(["R-1"]);
    expect(cov.uncovered_p0).toEqual(["R-1"]);
  });

  it("REGRESSION: the two-argument call still works and counts every requirement as unmigrated", () => {
    const cov = coverage([req("R-1", "P0"), req("R-2", "P2")], ["R-1"]);
    expect(cov).toMatchObject({ total: 2, covered: ["R-1"], uncovered: ["R-2"], uncovered_p0: [] });
  });

  it("BOUNDARY: two requirements migrated to one rule are both covered by one citation", () => {
    const cov = coverage([req("R-1", "P0", "BR-5"), req("R-2", "P1", "BR-5")], [], ["BR-5"]);
    expect(cov.covered).toEqual(["R-1", "R-2"]);
  });

  it("BOUNDARY: a migrated P1/P2 that is uncovered is not P0-uncovered, so the exit code stays 0", () => {
    const cov = coverage([req("R-1", "P1", "BR-5"), req("R-2", "P2", "BR-6")], [], []);
    expect(cov.uncovered).toEqual(["R-1", "R-2"]);
    expect(requirementCoverageExitCode(cov)).toBe(0);
  });

  it("BOUNDARY: empty inventory stays vacuous with empty migrated/unmigrated lists", () => {
    const cov = coverage([], [], ["BR-1"]);
    expect(cov).toMatchObject({ total: 0, covered: [], uncovered: [], uncovered_p0: [] });
    expect(cov.migrated).toEqual([]);
    expect(cov.unmigrated).toEqual([]);
  });

  it("REPORT: migrated and unmigrated ids are listed separately and together partition the inventory", () => {
    const cov = coverage(
      [req("R-1", "P0", "BR-5"), req("R-2", "P0"), req("R-3", "P1", "BR-9"), req("R-4", "P2")],
      ["R-2"],
      ["BR-5"],
    );
    expect(cov.migrated).toEqual(["R-1", "R-3"]);
    expect(cov.unmigrated).toEqual(["R-2", "R-4"]);
    expect(cov.total).toBe(4);
    expect(cov.covered).toEqual(["R-1", "R-2"]);
    expect(cov.uncovered).toEqual(["R-3", "R-4"]);
  });

  it("REPORT: a different mix yields different lists (defeats a hardcoded partition)", () => {
    const cov = coverage([req("R-7", "P0"), req("R-8", "P0", "BR-2")], [], []);
    expect(cov.migrated).toEqual(["R-8"]);
    expect(cov.unmigrated).toEqual(["R-7"]);
  });
});

// ─── Corpus service (InMemoryStore) ───────────────────────────────────────────

const AC = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  statement: "Does the thing",
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  ...extra,
});

function harness() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store);
  const ac = new AcService(store);
  const reqs = new RequirementService(store, false);
  return { store, cs, ac, reqs };
}
type H = ReturnType<typeof harness>;

async function makePrd(h: H, requirements: Req[]): Promise<DocRecord> {
  const r = await h.cs.create({
    type: "prd",
    title: "Root PRD",
    content: "# PRD",
    extra: { requirements },
  } as CreateDocInput);
  if (!r.ok) throw new Error(`prd create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function makeSpec(h: H, parent: DocRecord, title = "Spec"): Promise<DocRecord> {
  const r = await h.cs.create({
    type: "spec",
    title,
    content: "## Overview\n\nbody",
    extra: { spec_kind: "feature" },
  } as CreateDocInput);
  if (!r.ok) throw new Error(`spec create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function addAc(h: H, spec: DocRecord, criterion: Record<string, unknown>): Promise<void> {
  const r = await h.ac.addCriterion(spec.id, criterion as never);
  if (!r.ok) throw new Error(`addCriterion failed: ${JSON.stringify(r.error)}`);
}

async function setStatus(h: H, spec: DocRecord, status: DocRecord["status"]): Promise<void> {
  const r = await h.store.update(spec.id as DocId, { status });
  if (!r.ok) throw new Error(`status update failed: ${JSON.stringify(r.error)}`);
}

async function cov(h: H, prd: DocRecord): Promise<Cov> {
  const r = await h.cs.computeRequirementCoverageForPrd(prd.id);
  if (!r.ok) throw new Error(`coverage failed: ${JSON.stringify(r.error)}`);
  return r.value as unknown as Cov;
}

describe("requirement coverage from citations (BL-6) — corpus service", () => {
  it("precondition: migrated_to survives PRD creation (schema carries the field)", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const got = await h.cs.get(prd.id);
    expect(got.ok).toBe(true);
    const stored = got.ok ? (got.value.doc.extra["requirements"] as Req[]) : [];
    expect(stored[0]?.migrated_to).toBe("BR-5");
  });

  it("HAPPY: a migrated P0 is covered by a live script criterion citing its rule", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { cites: ["BR-5"] }));
    const c = await cov(h, prd);
    expect(c.covered).toEqual(["R-1"]);
    expect(c.uncovered_p0).toEqual([]);
  });

  it("NEGATIVE: a migrated P0 with no citing criterion at all is uncovered", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1"));
    const c = await cov(h, prd);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("NEGATIVE: a criterion citing a different rule does not cover it", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { cites: ["BR-6"] }));
    const c = await cov(h, prd);
    expect(c.covered).toEqual([]);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("NEGATIVE: an ai-mode criterion citing the rule is not a script-mode citation", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, {
      id: "AC-X-1",
      statement: "Judged",
      verify: { mode: "ai", rubric: "Pass only if the behaviour holds" },
      cites: ["BR-5"],
    });
    const c = await cov(h, prd);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("NEGATIVE: a human-mode criterion citing the rule is not a script-mode citation", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, {
      id: "AC-X-1",
      statement: "Signed off",
      verify: { mode: "human" },
      cites: ["BR-5"],
    });
    const c = await cov(h, prd);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it.each(["archived", "deprecated"] as const)(
    "NEGATIVE: a script criterion on a %s spec is not live, so it does not cover",
    async (status) => {
      const h = harness();
      const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
      const spec = await makeSpec(h, prd);
      await addAc(h, spec, AC("AC-X-1", { cites: ["BR-5"] }));
      await setStatus(h, spec, status);
      const c = await cov(h, prd);
      expect(c.uncovered_p0).toEqual(["R-1"]);
    },
  );

  it("BOUNDARY: a draft spec's script citation is live (only archived/deprecated are excluded)", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { cites: ["BR-5"] }));
    await setStatus(h, spec, "approved");
    const c = await cov(h, prd);
    expect(c.covered).toEqual(["R-1"]);
  });

  it("NEGATIVE (iff): a migrated P0 is not rescued by an AC --covers requirement_refs hit", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { requirement_refs: ["R-1"] }));
    const c = await cov(h, prd);
    expect(c.covered).toEqual([]);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("HAPPY: a citing spec that is NOT a child of the PRD still covers (slice 3b re-parents specs)", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const otherPrd = await makePrd(h, []);
    const elsewhere = await makeSpec(h, otherPrd, "Elsewhere");
    await addAc(h, elsewhere, AC("AC-Y-1", { cites: ["BR-5"] }));
    const c = await cov(h, prd);
    expect(c.covered).toEqual(["R-1"]);
  });

  it("REGRESSION: an unmigrated requirement is covered by requirement_refs and uncovered without", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0"), req("R-2", "P0"), req("R-3", "P1")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { requirement_refs: ["R-1"] }));
    const c = await cov(h, prd);
    expect(c.total).toBe(3);
    expect(c.covered).toEqual(["R-1"]);
    expect(c.uncovered).toEqual(["R-2", "R-3"]);
    expect(c.uncovered_p0).toEqual(["R-2"]);
  });

  it("REGRESSION: an unmigrated requirement is not covered by some rule being cited", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { cites: ["BR-1", "BR-5"] }));
    const c = await cov(h, prd);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("REPORT: migrated and unmigrated requirements are listed separately in a mixed PRD", async () => {
    const h = harness();
    const prd = await makePrd(h, [
      req("R-1", "P0", "BR-5"),
      req("R-2", "P0"),
      req("R-3", "P1", "BR-9"),
    ]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { cites: ["BR-5"], requirement_refs: ["R-2"] }));
    const c = await cov(h, prd);
    expect(c.migrated).toEqual(["R-1", "R-3"]);
    expect(c.unmigrated).toEqual(["R-2"]);
    expect(c.covered).toEqual(["R-1", "R-2"]);
    expect(c.uncovered).toEqual(["R-3"]);
    expect(c.uncovered_p0).toEqual([]);
  });

  it("STATE: removing the citation flips a migrated P0 back to uncovered", async () => {
    const h = harness();
    const prd = await makePrd(h, [req("R-1", "P0", "BR-5")]);
    const spec = await makeSpec(h, prd);
    await addAc(h, spec, AC("AC-X-1", { cites: ["BR-5"] }));
    expect((await cov(h, prd)).covered).toEqual(["R-1"]);

    const rm = await h.ac.citeCriterion(spec.id, "AC-X-1", ["BR-5"], { remove: true });
    expect(rm.ok).toBe(true);
    expect((await cov(h, prd)).uncovered_p0).toEqual(["R-1"]);
  });

  it("ERROR: a non-PRD target is still refused with VALIDATION_ERROR", async () => {
    const h = harness();
    const prd = await makePrd(h, []);
    const spec = await makeSpec(h, prd);
    const r = await h.cs.computeRequirementCoverageForPrd(spec.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("requirement coverage from citations (BL-6) — RequirementService", () => {
  it("persists migrated_to through addRequirement", async () => {
    const h = harness();
    const prd = await makePrd(h, []);
    const add = await h.reqs.addRequirement(prd.id, {
      id: "R-1",
      statement: "user can log in",
      priority: "P0",
      migrated_to: "BR-7",
    } as never);
    expect(add.ok).toBe(true);
    const list = await h.reqs.listRequirements(prd.id);
    expect(list.ok && (list.value[0] as Req).migrated_to).toBe("BR-7");
  });

  it("refuses an invalid migrated_to and stores nothing", async () => {
    const h = harness();
    const prd = await makePrd(h, []);
    const add = await h.reqs.addRequirement(prd.id, {
      id: "R-1",
      statement: "user can log in",
      priority: "P0",
      migrated_to: "AS-7",
    } as never);
    expect(add.ok).toBe(false);
    const list = await h.reqs.listRequirements(prd.id);
    expect(list.ok && list.value).toEqual([]);
  });
});

// ─── CLI: lore status --check-requirements exit code ──────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const LOADER_TS = join(PACKAGE_ROOT, "src", "adapters", "cli", "loader.ts");

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runLore(args: string[], cwd: string): Run {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1", LORE_ACTOR: "agent:tester-3a-C" },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

function mustRun(args: string[], cwd: string): Run {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

/** Writes `requirements` (incl. migrated_to) onto the PRD through the real CorpusService in a bun subprocess. */
function seedRequirements(cwd: string, prdSlug: string, requirements: Req[]): void {
  const script = `
    import { loadLoreApp } from ${JSON.stringify(LOADER_TS)};
    const { app } = loadLoreApp();
    try {
      const got = await app.corpusService.get(${JSON.stringify(prdSlug)});
      if (!got.ok) throw new Error(JSON.stringify(got.error));
      const set = await app.corpusService.set(got.value.doc.id, { extra: { ...got.value.doc.extra, requirements: ${JSON.stringify(requirements)} } });
      if (!set.ok) throw new Error(JSON.stringify(set.error));
    } finally { app.close(); }
  `;
  const r = spawnSync("bun", ["-e", script], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:tester-3a-C" },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}${r.stdout}`);
}

function createDoc(cwd: string, type: string, extra: string[]): string {
  const r = mustRun(["create", type, "--title", `${type} fixture`, "--no-ai", "--content", "body", ...extra], cwd);
  const slug = r.stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`no slug in: ${r.stdout}`);
  return slug;
}

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir !== undefined) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

function freshCorpus(): { dir: string; prd: string; spec: string } {
  const dir = join(tmpdir(), `lore-req-cov-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tmpDir = dir;
  mustRun(["init"], dir);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    ["workflow:", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", ""].join("\n"),
  );
  const prd = createDoc(dir, "prd", []);
  const spec = createDoc(dir, "spec", ["--kind", "feature"]);
  return { dir, prd, spec };
}

describe("requirement coverage from citations (BL-6) — lore status --check-requirements", () => {
  it("exits 3 for a migrated P0 with no citing criterion, then 0 once a script AC cites the rule, then 3 again after the cite is removed", () => {
    const { dir, prd, spec } = freshCorpus();
    seedRequirements(dir, prd, [req("R-1", "P0", "BR-5")]);

    const before = runLore(["status", "--check-requirements"], dir);
    expect(before.exitCode).toBe(3);

    mustRun(["ac", "add", spec, "AC-X-1", "--statement", "x holds", "--mode", "script", "--oracle", "other", "--command", "true", "--cite", "BR-5"], dir);
    const after = runLore(["status", "--check-requirements"], dir);
    expect(after.exitCode).toBe(0);

    mustRun(["ac", "cite", spec, "AC-X-1", "BR-5", "--remove"], dir);
    const removed = runLore(["status", "--check-requirements"], dir);
    expect(removed.exitCode).toBe(3);
  }, 120_000);

  it("a migrated P0 is not rescued by --covers alone, while an unmigrated P0 still is (unchanged path)", () => {
    const { dir, prd, spec } = freshCorpus();
    seedRequirements(dir, prd, [req("R-1", "P0", "BR-5"), req("R-2", "P0")]);
    mustRun(["ac", "add", spec, "AC-X-1", "--statement", "x holds", "--mode", "script", "--oracle", "other", "--command", "true", "--covers", "R-1", "--covers", "R-2"], dir);

    const r = runLore(["status", "--check-requirements", "--json"], dir);
    expect(r.exitCode).toBe(3);
    const parsed = JSON.parse(r.stdout) as {
      data: { requirements: { prds: Array<{ slug: string; uncovered_p0: string[]; migrated?: string[]; unmigrated?: string[] }> } };
    };
    const entry = parsed.data.requirements.prds.find((p) => p.slug === prd);
    expect(entry?.uncovered_p0).toEqual(["R-1"]);
    expect(entry?.migrated).toEqual(["R-1"]);
    expect(entry?.unmigrated).toEqual(["R-2"]);
  }, 120_000);

  it("REGRESSION: a PRD with only unmigrated requirements keeps the old verdict (uncovered P0 -> exit 3, covered -> 0)", () => {
    const { dir, prd, spec } = freshCorpus();
    seedRequirements(dir, prd, [req("R-1", "P0")]);
    expect(runLore(["status", "--check-requirements"], dir).exitCode).toBe(3);
    mustRun(["ac", "add", spec, "AC-X-1", "--statement", "x holds", "--mode", "script", "--oracle", "other", "--command", "true", "--covers", "R-1"], dir);
    expect(runLore(["status", "--check-requirements"], dir).exitCode).toBe(0);
  }, 120_000);
});
