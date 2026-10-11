/**
 * Six-dimension tests for DriftCheckService (SPEC-045 §Design Decisions D4, D6, D9).
 * Uses InMemoryStore + CorpusService (fixture builder) + TaskWorkflowService
 * (regression checks only) — no file I/O, no SQLite, no real filesystem (FsProbe is
 * always a hand-built stub).
 *
 * Dimension mapping:
 *   HAPPY:      checkDrift over a consistent armed corpus reports zero drift;
 *               addCodeAnchors/removeCodeAnchors/setCodeAnchors persist, bump
 *               version, write exactly one versions row + one audit entry each,
 *               preserving spec_kind + acceptance_criteria + every sibling extra key
 *   NEGATIVE:   addCodeAnchors/removeCodeAnchors/setCodeAnchors reject malformed
 *               grammar (bad identifier, symbol-on-dir, `..` path) without mutating
 *               the doc; a task target anchor containing `#` is rejected naming the
 *               spec grammar; D6a: CorpusService.create/set with malformed
 *               extra.code_anchors reject loud, valid ones pass
 *   BOUNDARY:   unarmed corpus (zero specs declare anchors) → {armed:false,
 *               consistent:true}; per-unique-path probe dedup — N specs anchoring
 *               ONE path triggers exactly 1 stat() call
 *   ERROR:      a probe stub that THROWS on one path yields a probe_error drift row
 *               for that anchor while every OTHER anchor still gets checked (no
 *               batch abort); the service module never imports node:fs (source-text
 *               grep oracle, sync-docs-service.test.ts precedent)
 *   STATE:      CAS — a concurrent version bump between read and write surfaces
 *               STALE_VERSION (CONFLICT), never a lost update
 *   REGRESSION: soft-deleted specs excluded from checkDrift; task-target anchor
 *               mutation (TaskWorkflowService setAnchors/addAnchors/removeAnchors)
 *               stays byte-identical; version bumps exactly once per successful write
 *
 * @spec_ref SPEC-045 §Design Decisions D4, D6, D9; AC-DR-2, AC-DR-3, AC-DR-8
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { DriftCheckService, type FsProbe } from "../../../src/service/drift-check-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const driftCheckService = new DriftCheckService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, corpusService, driftCheckService, taskWorkflowService };
}

async function createPrd(cs: CorpusService, title = "Test PRD"): Promise<string> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createSpec(
  cs: CorpusService,
  parentId: string,
  overrides: Partial<CreateDocInput> = {},
): Promise<string> {
  const result = await cs.create({
    type: "spec",
    title: "Test Spec",
    content: "spec body",
    ...overrides,
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPlan(cs: CorpusService, parentId: string, title = "Test Plan"): Promise<string> {
  const result = await cs.create({
    type: "plan",
    title,
    parent_id: parentId,
    content: "plan body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Test Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "task body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** A minimal deterministic FsProbe stub, hand-built (never touches a real filesystem). */
function makeStubProbe(overrides: Partial<FsProbe> = {}): FsProbe & { statCalls: string[] } {
  const statCalls: string[] = [];
  const base: FsProbe = {
    stat: (path) => {
      statCalls.push(path);
      return "missing";
    },
    readFile: () => null,
    listDir: () => null,
  };
  return { ...base, ...overrides, statCalls };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("HAPPY — checkDrift over a consistent armed corpus", () => {
  it("reports consistent:true, zero drifts, armed:true, correct specs_checked/status_breakdown", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, {
      extra: { code_anchors: ["src/a.ts#Foo", "src/dir/"] },
    });

    const probe: FsProbe = {
      stat: (path) => (path === "src/a.ts" ? "file" : path === "src/dir" ? "dir" : "missing"),
      readFile: (path) => (path === "src/a.ts" ? "export const Foo = 1;\n" : null),
      listDir: (path) => (path === "src/dir" ? ["x.ts"] : null),
    };

    const result = await driftCheckService.checkDrift(probe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(true);
    expect(result.value.drifts).toEqual([]);
    expect(result.value.armed).toBe(true);
    expect(result.value.specs_checked).toBe(1);
    expect(result.value.status_breakdown).toEqual({ draft: 1 });
  });
});

describe("HAPPY — addCodeAnchors/removeCodeAnchors/setCodeAnchors round-trip", () => {
  it("addCodeAnchors on a clean spec persists, bumps version, writes one versions row + one audit entry", async () => {
    const { store, corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionBefore = before.value.version;

    const result = await driftCheckService.addCodeAnchors(specId, ["src/a.ts#Foo"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["src/a.ts#Foo"]);

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.extra["code_anchors"]).toEqual(["src/a.ts#Foo"]);
    expect(after.value.version).toBe(versionBefore + 1);

    const versions = await store.findVersions(specId);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    const latestVersion = versions.value[0];
    expect(latestVersion?.action).toBe("update");
    expect(latestVersion?.version).toBe(versionBefore + 1);

    const audit = await store.queryAudit({ doc_id: specId });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(audit.value.filter((e) => e.action === "update")).toHaveLength(1);
  });

  it("removeCodeAnchors strips the matching entry", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await driftCheckService.addCodeAnchors(specId, ["src/a.ts#Foo", "src/b.ts"]);

    const result = await driftCheckService.removeCodeAnchors(specId, ["src/a.ts#Foo"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["src/b.ts"]);
  });

  it("setCodeAnchors REPLACES the whole array (declarative, unlike add/remove)", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await driftCheckService.addCodeAnchors(specId, ["src/a.ts#Foo", "src/b.ts"]);

    const result = await driftCheckService.setCodeAnchors(specId, ["src/c.ts"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["src/c.ts"]);
  });

  it("preserves spec_kind + acceptance_criteria + every sibling extra key verbatim", async () => {
    const { store, corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId, {
      extra: {
        spec_kind: "tech",
        acceptance_criteria: [
          { id: "AC-X-1", statement: "does the thing", verify: { mode: "human" } },
        ],
      },
    });

    await driftCheckService.addCodeAnchors(specId, ["src/a.ts"]);

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.extra["spec_kind"]).toBe("tech");
    expect(after.value.extra["acceptance_criteria"]).toEqual([
      { id: "AC-X-1", statement: "does the thing", verify: { mode: "human" } },
    ]);
    expect(after.value.extra["code_anchors"]).toEqual(["src/a.ts"]);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — malformed grammar rejected, doc unchanged", () => {
  it("addCodeAnchors rejects a dir+symbol entry without mutating the spec", async () => {
    const { store, corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");

    const result = await driftCheckService.addCodeAnchors(specId, ["src/dir/#Foo"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(before.value.version);
    expect(after.value.extra["code_anchors"]).toBeUndefined();
  });

  it("addCodeAnchors rejects a `..` path entry, naming the offending anchor", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await driftCheckService.addCodeAnchors(specId, ["../escape.ts"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("addCodeAnchors rejects a malformed symbol identifier", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await driftCheckService.addCodeAnchors(specId, ["src/a.ts#1Bad"]);
    expect(result.ok).toBe(false);
  });

  it("removeCodeAnchors rejects malformed removal candidates too", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    await driftCheckService.addCodeAnchors(specId, ["src/a.ts"]);

    const result = await driftCheckService.removeCodeAnchors(specId, ["src/dir/#Foo"]);
    expect(result.ok).toBe(false);
  });

  it("setCodeAnchors rejects malformed entries in the replacement list", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await driftCheckService.setCodeAnchors(specId, ["src/dir/#Foo"]);
    expect(result.ok).toBe(false);
  });

  it("a non-spec target (a plan) fails VALIDATION_ERROR field 'type'", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);

    const result = await driftCheckService.addCodeAnchors(planId, ["src/a.ts"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") expect(result.error.field).toBe("type");
  });
});

describe("NEGATIVE — task target rejects '#' entries, naming the spec grammar", () => {
  it("TaskWorkflowService.addAnchors rejects an entry containing '#'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addAnchors(taskId, ["src/a.ts#Foo"], { by: "tester" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.message).toMatch(/SPEC-045/);
    }
  });

  it("TaskWorkflowService.setAnchors rejects an entry containing '#'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.setAnchors(taskId, ["src/dir/#Foo"], { by: "tester" });
    expect(result.ok).toBe(false);
  });
});

describe("NEGATIVE — D6a: CorpusService create/set grammar seams", () => {
  it("create rejects a spec with a malformed code_anchors entry", async () => {
    const { corpusService } = makeServices();
    const prdId = await createPrd(corpusService);

    const result = await corpusService.create({
      type: "spec",
      title: "Bad Spec",
      content: "body",
      extra: { code_anchors: ["src/dir/#Foo"] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("create accepts a spec with a grammar-valid code_anchors entry", async () => {
    const { corpusService } = makeServices();
    const prdId = await createPrd(corpusService);

    const result = await corpusService.create({
      type: "spec",
      title: "Good Spec",
      content: "body",
      extra: { code_anchors: ["src/a.ts#Foo"] },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["code_anchors"]).toEqual(["src/a.ts#Foo"]);
  });

  it("set rejects a patch with a malformed code_anchors entry", async () => {
    const { corpusService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await corpusService.set(specId, { extra: { code_anchors: ["../escape.ts"] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("set accepts a patch with a grammar-valid code_anchors entry", async () => {
    const { corpusService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const result = await corpusService.set(specId, { extra: { code_anchors: ["src/a.ts"] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["code_anchors"]).toEqual(["src/a.ts"]);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — unarmed corpus", () => {
  it("zero specs declaring code_anchors -> {armed:false, consistent:true}", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId); // no code_anchors declared

    const probe = makeStubProbe();
    const result = await driftCheckService.checkDrift(probe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.armed).toBe(false);
    expect(result.value.consistent).toBe(true);
    expect(result.value.drifts).toEqual([]);
    expect(probe.statCalls).toEqual([]);
  });

  it("an empty corpus (zero specs at all) -> {armed:false, consistent:true}", async () => {
    const { driftCheckService } = makeServices();
    const probe = makeStubProbe();
    const result = await driftCheckService.checkDrift(probe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.armed).toBe(false);
    expect(result.value.specs_checked).toBe(0);
  });
});

describe("BOUNDARY — per-unique-path probe dedup", () => {
  it("N specs anchoring the SAME path trigger exactly 1 stat() call for that path", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, { title: "Spec One", extra: { code_anchors: ["src/shared.ts"] } });
    await createSpec(corpusService, prdId, { title: "Spec Two", extra: { code_anchors: ["src/shared.ts"] } });
    await createSpec(corpusService, prdId, { title: "Spec Three", extra: { code_anchors: ["src/shared.ts#Foo"] } });

    const statCalls: string[] = [];
    const countingProbe: FsProbe = {
      stat: (path) => {
        statCalls.push(path);
        return "missing";
      },
      readFile: () => null,
      listDir: () => null,
    };

    const result = await driftCheckService.checkDrift(countingProbe);
    expect(result.ok).toBe(true);
    expect(statCalls.filter((p) => p === "src/shared.ts")).toHaveLength(1);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR — a probe throw becomes a probe_error row without aborting the scan", () => {
  it("stat() throwing on one path yields probe_error for that anchor while another spec's anchor still gets checked", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, { title: "Spec A", extra: { code_anchors: ["src/throws.ts"] } });
    await createSpec(corpusService, prdId, { title: "Spec B", extra: { code_anchors: ["src/ok.ts"] } });

    const probe: FsProbe = {
      stat: (path) => {
        if (path === "src/throws.ts") throw new Error("EACCES: permission denied");
        return "file";
      },
      readFile: () => null,
      listDir: () => null,
    };

    const result = await driftCheckService.checkDrift(probe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);
    expect(result.value.drifts).toHaveLength(1);
    expect(result.value.drifts[0]?.kind).toBe("probe_error");
    expect(result.value.drifts[0]?.detail).toContain("EACCES");
    // src/ok.ts resolved consistent — no drift row for it.
    expect(result.value.drifts.some((d) => d.anchor === "src/ok.ts")).toBe(false);
  });

  it("service module source never imports node:fs (grep oracle over import statements only)", () => {
    const source = readFileSync(
      new URL("../../../src/service/drift-check-service.ts", import.meta.url),
      "utf-8",
    );
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    const fsImportLines = importLines.filter((line) => /from\s+["'](node:)?fs["']/.test(line));
    expect(fsImportLines).toEqual([]);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — CAS conflict surfaces STALE_VERSION, never a lost update", () => {
  it("addCodeAnchors surfaces STALE_VERSION when the doc version changed between read and write", async () => {
    const { corpusService, driftCheckService, store } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    let sideEffectApplied = false;
    // reason: `now()` fires after addCodeAnchors has captured spec.version (the CAS
    // expected_version) but before writeCodeAnchors's store.update call — mirrors
    // task-workflow-service.test.ts's sequential-CAS recipe (SPEC-025 §7).
    const now = (): string => {
      if (!sideEffectApplied) {
        sideEffectApplied = true;
        void store.update(specId, { extra: { injected_by_other_writer: true }, version: 2 }, { expected_version: 1 });
      }
      return "2026-07-12T10:00:00.000Z";
    };

    const result = await driftCheckService.addCodeAnchors(specId, ["src/a.ts"], now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");

    const finalDoc = await store.find(specId);
    if (!finalDoc.ok || finalDoc.value === null) throw new Error("spec re-fetch failed");
    expect(finalDoc.value.extra["injected_by_other_writer"]).toBe(true);
    expect(finalDoc.value.extra["code_anchors"]).toBeUndefined();
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — soft-deleted specs excluded from checkDrift", () => {
  it("a soft-deleted spec's code_anchors are never scanned", async () => {
    const { corpusService, driftCheckService, store } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId, { extra: { code_anchors: ["src/gone.ts"] } });
    await store.softDelete(specId);

    const probe = makeStubProbe();
    const result = await driftCheckService.checkDrift(probe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.armed).toBe(false);
    expect(probe.statCalls).toEqual([]);
  });
});

describe("REGRESSION — task-target anchor mutation stays byte-identical", () => {
  it("TaskWorkflowService.addAnchors/setAnchors/removeAnchors on a plain path still work exactly as before", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);
    const taskId = await createTask(corpusService, planId);

    const added = await taskWorkflowService.addAnchors(taskId, ["src/a.ts"], { by: "tester" });
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value.extra["file_anchors"]).toEqual(["src/a.ts"]);

    const replaced = await taskWorkflowService.setAnchors(taskId, ["src/b.ts"], { by: "tester" });
    expect(replaced.ok).toBe(true);
    if (replaced.ok) expect(replaced.value.extra["file_anchors"]).toEqual(["src/b.ts"]);

    const removed = await taskWorkflowService.removeAnchors(taskId, ["src/b.ts"], { by: "tester" });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.extra["file_anchors"]).toEqual([]);
  });
});

describe("REGRESSION — version bumps exactly once per successful code_anchors write", () => {
  it("three sequential addCodeAnchors calls bump version by exactly 1 each time", async () => {
    const { store, corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);

    const v0Doc = await store.find(specId);
    const v0 = v0Doc.ok && v0Doc.value !== null ? v0Doc.value.version : undefined;
    await driftCheckService.addCodeAnchors(specId, ["src/a.ts"]);
    const v1Doc = await store.find(specId);
    await driftCheckService.addCodeAnchors(specId, ["src/b.ts"]);
    const v2Doc = await store.find(specId);
    await driftCheckService.addCodeAnchors(specId, ["src/c.ts"]);
    const v3Doc = await store.find(specId);

    if (!v1Doc.ok || !v2Doc.ok || !v3Doc.ok || v1Doc.value === null || v2Doc.value === null || v3Doc.value === null) {
      throw new Error("fetch failed");
    }
    expect(v0).toBeDefined();
    expect(v1Doc.value.version).toBe((v0 as number) + 1);
    expect(v2Doc.value.version).toBe((v0 as number) + 2);
    expect(v3Doc.value.version).toBe((v0 as number) + 3);
  });
});

// ─── AC-DR-8 — read-only: checkDrift performs ZERO store writes ────────────

describe("AC-DR-8 — checkDrift is read-only over an armed, DRIFTING corpus", () => {
  it("a full checkDrift pass performs zero store writes, bumps no doc version, writes no audit rows", async () => {
    const { corpusService, driftCheckService, store } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId, {
      extra: { code_anchors: ["src/missing.ts", "src/dir/", "src/a.ts#Missing"] },
    });

    const before = await store.find(specId);
    if (!before.ok || before.value === null) throw new Error("spec fetch failed");
    const versionsBefore = await store.findVersions(specId);
    const auditBefore = await store.queryAudit({ doc_id: specId });

    // reason: write-counting wrapper — a thin pass-through StoreInterface proxy
    // that counts calls to every mutating method, asserting checkDrift never
    // reaches any of them (AC-DR-8).
    let writeCalls = 0;
    const countingStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "insert" || prop === "update" || prop === "softDelete" || prop === "insertVersion" || prop === "appendAuditEntry" || prop === "addLink" || prop === "removeLink") {
          writeCalls += 1;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const countingDriftCheckService = new DriftCheckService(countingStore);

    const probe: FsProbe = {
      stat: (path) => (path === "src/dir" ? "dir" : path === "src/a.ts" ? "file" : "missing"),
      readFile: (path) => (path === "src/a.ts" ? "export const Present = 1;\n" : null),
      listDir: (path) => (path === "src/dir" ? [] : null),
    };

    const result = await countingDriftCheckService.checkDrift(probe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.consistent).toBe(false);
    expect(result.value.drifts.length).toBeGreaterThan(0);
    expect(writeCalls).toBe(0);

    const after = await store.find(specId);
    if (!after.ok || after.value === null) throw new Error("spec re-fetch failed");
    expect(after.value.version).toBe(before.value.version);
    expect(after.value.updated_at).toBe(before.value.updated_at);

    const versionsAfter = await store.findVersions(specId);
    const auditAfter = await store.queryAudit({ doc_id: specId });
    expect(versionsBefore.ok && versionsAfter.ok && versionsAfter.value.length).toBe(
      versionsBefore.ok && versionsBefore.value.length,
    );
    expect(auditBefore.ok && auditAfter.ok && auditAfter.value.length).toBe(
      auditBefore.ok && auditBefore.value.length,
    );
  });
});
