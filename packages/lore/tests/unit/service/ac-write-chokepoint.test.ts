/**
 * RED tests for the AC write chokepoint (baseline slice 2a §C3, closes #36 for ACs) —
 * task-skill-test-red-ac-write-chokepoint-on-every-entry-point-ac. Paired impl: C3.
 *
 * SPEC (C3): every write that changes `extra.acceptance_criteria` passes through ONE service
 * function. The sanctioned paths are the AcService verbs, create (inline criteria are additions,
 * validated + wording-gated), restore and v1 import. A WHOLESALE set (CLI / HTTP
 * PATCH) that changes the array is refused with `AC_WRITE_NOT_VIA_AC_VERB` unless byte-identical.
 * Re-baselined per spec Amendment log (2026-10-08): create is sanctioned, no longer refused.
 *
 * PINNED CONTRACT for C3 (the implementer must satisfy exactly this surface):
 *  1. Refusal code string is `AC_WRITE_NOT_VIA_AC_VERB`, returned as `Result.error.code` by
 *     `CorpusService.set`; surfaced verbatim by HTTP PATCH `/api/docs/:id`
 *     (`{ ok: false, error: { code } }`). A refused write leaves the doc (extra, version,
 *     status) byte-for-byte unchanged.
 *  2. "Byte-identical" = the `acceptance_criteria` value in the patch/extra serialises
 *     (JSON.stringify) identically to the stored one; other `extra` keys may change freely.
 *  3. AcService verbs accept the calling actor as `opts.by` (add/set: 3rd/4th arg opts;
 *     cite: 5th arg opts) and write that string as the audit row's `actor` instead of the
 *     hard-coded "system".
 *
 * Dimensions: HAPPY (identical array accepted; verbs accepted), NEGATIVE (the wholesale entry
 * points refuse; create gated by the wording check), BOUNDARY (reordered / one-char-changed / removed array is a change),
 * STATE (refused write leaves the doc untouched), REGRESSION (the stale comment claim).
 *
 * @spec_ref AC-BLS2-1
 */

import { actedStore } from "../../live-invocation.js";
import { recordLockGateOff } from "../../helpers/record-lock-gate-off.js";
import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { VersionService } from "../../../src/service/version-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { applyAcChange } from "../../../src/service/ac-write-chokepoint.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApiRoute } from "../../../src/adapters/http/routes.js";
import type { App } from "../../../src/app.js";
import type { ActorContext } from "../../../src/adapters/http/auth.js";

const REFUSAL = "AC_WRITE_NOT_VIA_AC_VERB";
const CALLER = "agent:chokepoint-caller";

const AC = (id: string, statement = "Does the thing") => ({
  id,
  statement,
  verify: { mode: "script", oracle: "test", command: "bun test x" },
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function setup() {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, recordLockGateOff(store));
  const ac = new AcService(store, recordLockGateOff(store));
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const spec = await cs.create({
    type: "spec",
    title: "S",
    content: "body",
  } as CreateDocInput);
  if (!spec.ok) throw new Error("spec");
  const specId = spec.value.id;
  for (const c of [AC("AC-W-1"), AC("AC-W-2", "Second thing")]) {
    const added = await ac.addCriterion(specId, c);
    if (!added.ok) throw new Error(`seed ac: ${JSON.stringify(added.error)}`);
  }
  const approved = await store.update(specId, { status: "approved" });
  if (!approved.ok) throw new Error("approve");
  return { store, cs, ac, specId };
}

async function stored(store: InMemoryStore, specId: string) {
  const d = await store.find(specId as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  return d.value;
}

/** Serialised snapshot of everything a refused write must not touch. */
async function fingerprint(store: InMemoryStore, specId: string): Promise<string> {
  const d = await stored(store, specId);
  const v = await store.findVersions(specId as DocId);
  if (!v.ok) throw new Error("versions");
  return JSON.stringify({ extra: d.extra, version: d.version, status: d.status, versions: v.value.length });
}

const CHANGED = [AC("AC-W-1", "A different statement"), AC("AC-W-2", "Second thing")];

// ─── HTTP harness (same wiring as http/routes.test.ts) ──

function appFor(cs: CorpusService): App {
  // MOCK RISK: every service other than corpusService is a null-cast stub; PATCH only
  // reach corpusService, so this hides nothing about the path under test.
  return {
    corpusService: cs,
    telemetry: new NoOpTelemetry(),
    callerSurface: "cli" as const,
    resolveAiDefault: () => ({ ai: false, source: "cli_flag" as const }),
    close: () => undefined,
  } as unknown as App;
}

const HTTP_ACTOR: ActorContext = { name: "http-agent", session_id: "s" };

async function httpPatch(cs: CorpusService, id: string, body: unknown) {
  const url = new URL(`http://localhost/api/docs/${id}`);
  const req = new Request(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleApiRoute(req, url, appFor(cs), HTTP_ACTOR);
  if (res === null) throw new Error("route not handled");
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: { code?: string } } };
}

// ─── NEGATIVE: every non-verb entry point refuses a changed AC array ─────────

describe("AC write chokepoint — refusals (AC-BLS2-1)", () => {
  it("CorpusService.set with wholesale extra holding changed criteria is refused with AC_WRITE_NOT_VIA_AC_VERB", async () => {
    const { store, cs, specId } = await setup();
    const res = await cs.set(specId, { extra: { acceptance_criteria: CHANGED } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe(REFUSAL);
  });

  it("a refused CorpusService.set leaves extra, version, status and version log unchanged", async () => {
    const { store, cs, specId } = await setup();
    const before = await fingerprint(store, specId);
    await cs.set(specId, { extra: { acceptance_criteria: CHANGED } });
    expect(await fingerprint(store, specId)).toBe(before);
  });

  it("HTTP PATCH /api/docs/:id with changed criteria is refused with the same code", async () => {
    const { cs, specId } = await setup();
    const res = await httpPatch(cs, specId, { extra: { acceptance_criteria: CHANGED } });
    expect(res.body.ok).toBe(false);
    expect(res.body.error?.code).toBe(REFUSAL);
  });

  it("a refused HTTP PATCH leaves the spec unchanged", async () => {
    const { store, cs, specId } = await setup();
    const before = await fingerprint(store, specId);
    await httpPatch(cs, specId, { extra: { acceptance_criteria: CHANGED } });
    expect(await fingerprint(store, specId)).toBe(before);
  });

  // Re-baseline per spec Amendment log (2026-10-08): create is a SANCTIONED path — its inline
  // criteria are additions validated by the chokepoint and by the spec-create wording gate
  // (baseline rule BR-5). The two former "create refused" scenarios are replaced by the three
  // below (HAPPY accepted + attributed, NEGATIVE vague criterion refused by the live gate,
  // STATE the refused create leaves no doc behind).
  it("CorpusService.create with valid inline criteria is accepted, stores them, and attributes the version and audit rows to the caller", async () => {
    const { store, cs } = await setup();
    const prd = await cs.create({ type: "prd", title: "P2", content: "root" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd");
    const res = await cs.create(
      {
        type: "spec",
        title: "Born with ACs",
        content: "body",
        extra: { acceptance_criteria: [AC("AC-N-1")] },
      } as CreateDocInput,
      { by: CALLER, attributeCreatedBy: true },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = await stored(store, res.value.id);
    expect(JSON.stringify(doc.extra["acceptance_criteria"])).toBe(JSON.stringify([AC("AC-N-1")]));
    const audit = await store.queryAudit({ doc_id: res.value.id });
    if (!audit.ok) throw new Error("audit");
    expect(audit.value.map((e) => e.actor)).toContain(CALLER);
    const versions = await store.findVersions(res.value.id);
    if (!versions.ok) throw new Error("versions");
    expect(versions.value.some((v) => v.created_by === CALLER)).toBe(true);
  });

  it("CorpusService.create with a vague human-mode criterion is refused by the spec-create wording check (the gate is live through the chokepoint)", async () => {
    const store = actedStore(new InMemoryStore());
    const cs = new CorpusService(store, recordLockGateOff(store), undefined, undefined, new GateEnforcer(undefined));
    const prd = await cs.create({ type: "prd", title: "P4", content: "root" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd");
    const res = await cs.create({
      type: "spec",
      title: "Vague Spec",
      content: "## Overview\n\nBody.",
      extra: {
        acceptance_criteria: [{ id: "AC-V-1", statement: "the dashboard loads fast", verify: { mode: "human" } }],
      },
    } as CreateDocInput);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(JSON.stringify(res.error)).toContain("AC-V-1");
    const listed = await store.findMany({ type: "spec" });
    if (!listed.ok) throw new Error("list");
    expect(listed.value.some((d) => d.title === "Vague Spec")).toBe(false);
  });
});

// ─── BOUNDARY: what counts as "changed" ──────────────────────────────────────

describe("AC write chokepoint — change detection boundaries (AC-BLS2-1)", () => {
  it("a reordered criteria array is a change and is refused", async () => {
    const { cs, specId } = await setup();
    const d = await cs.set(specId, {
      extra: { acceptance_criteria: [AC("AC-W-2", "Second thing"), AC("AC-W-1")] },
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.code).toBe(REFUSAL);
  });

  it("dropping all criteria via wholesale extra is a change and is refused", async () => {
    const { cs, specId } = await setup();
    const d = await cs.set(specId, { extra: { acceptance_criteria: [] } });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.code).toBe(REFUSAL);
  });

  it("appending a criterion via wholesale extra is a change and is refused", async () => {
    const { cs, specId } = await setup();
    const d = await cs.set(specId, {
      extra: { acceptance_criteria: [AC("AC-W-1"), AC("AC-W-2", "Second thing"), AC("AC-W-3")] },
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.code).toBe(REFUSAL);
  });
});

// ─── HAPPY: byte-identical array is accepted ─────────────────────────────────

describe("AC write chokepoint — byte-identical criteria accepted (AC-BLS2-1)", () => {
  it("set carrying the stored criteria byte-identically plus another changed key is accepted and persists that key", async () => {
    const { store, cs, specId } = await setup();
    const current = (await stored(store, specId)).extra["acceptance_criteria"];
    const res = await cs.set(specId, { extra: { acceptance_criteria: current, ac_scope: ["packages/lore"] } });
    expect(res.ok).toBe(true);
    const after = await stored(store, specId);
    expect(after.extra["ac_scope"]).toEqual(["packages/lore"]);
  });

  it("the accepted byte-identical write leaves the criteria array exactly as stored", async () => {
    const { store, cs, specId } = await setup();
    const current = (await stored(store, specId)).extra["acceptance_criteria"];
    await cs.set(specId, { extra: { acceptance_criteria: current, ac_scope: ["x"] } });
    const after = await stored(store, specId);
    expect(JSON.stringify(after.extra["acceptance_criteria"])).toBe(JSON.stringify(current));
  });
});

// ─── HAPPY / STATE: the verbs are the accepted path, attributed to the caller ──

async function acAuditActors(store: InMemoryStore, specId: string, operation: string): Promise<string[]> {
  const a = await store.queryAudit({ doc_id: specId });
  if (!a.ok) throw new Error("audit");
  return a.value
    .filter((e) => (e.details as Record<string, unknown>)["operation"] === operation)
    .map((e) => e.actor);
}

describe("AC write chokepoint — verbs accepted, actor attributed (AC-BLS2-1)", () => {
  it("ac add is accepted and its audit row carries the calling actor, not 'system'", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.addCriterion(specId, AC("AC-W-3"), { by: CALLER } as never);
    expect(res.ok).toBe(true);
    expect(await acAuditActors(store, specId, "add")).toContain(CALLER);
  });

  it("ac add audit rows never fall back to 'system' when an actor is supplied", async () => {
    const { store, ac, specId } = await setup();
    await ac.addCriterion(specId, AC("AC-W-3"), { by: CALLER } as never);
    const actors = await acAuditActors(store, specId, "add");
    expect(actors.filter((a) => a === "system")).toEqual([]);
  });

  it("ac set is accepted and its audit row carries the calling actor", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.setCriterion(specId, "AC-W-1", { statement: "Reworded statement" }, {
      by: CALLER,
    } as never);
    expect(res.ok).toBe(true);
    expect(await acAuditActors(store, specId, "set")).toContain(CALLER);
  });

  it("ac cite is accepted and its audit row carries the calling actor", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.citeCriterion(specId, "AC-W-1", ["BR-1"], {}, { by: CALLER });
    expect(res.ok).toBe(true);
    expect(await acAuditActors(store, specId, "cite")).toContain(CALLER);
  });

  it("two different callers produce two different audit actors (not a hardcoded value)", async () => {
    const { store, ac, specId } = await setup();
    await ac.addCriterion(specId, AC("AC-W-3"), { by: "agent:alpha" } as never);
    await ac.addCriterion(specId, AC("AC-W-4"), { by: "agent:beta" } as never);
    const actors = await acAuditActors(store, specId, "add");
    expect(actors).toEqual(expect.arrayContaining(["agent:alpha", "agent:beta"]));
  });

  it("the verb path still changes the criteria array (the chokepoint admits it)", async () => {
    const { store, ac, specId } = await setup();
    await ac.addCriterion(specId, AC("AC-W-3"), { by: CALLER } as never);
    const after = await stored(store, specId);
    expect((after.extra["acceptance_criteria"] as unknown[]).length).toBe(3);
  });
});

// ─── Sanctioned non-verb paths: restore and v1 import (GitHub #54) ───────────

describe("AC write chokepoint — restore and import are sanctioned, validated paths (AC-BLS2-1, #54)", () => {
  it("VersionService.restore of a valid historical criteria array is accepted and the criteria come back", async () => {
    const { store, ac, specId } = await setup();
    await ac.addCriterion(specId, AC("AC-W-3"), { by: CALLER } as never);
    // setup() wrote 2 criteria (v2,v3 + approve) — find the version holding exactly 2 criteria.
    const versions = await store.findVersions(specId as DocId);
    if (!versions.ok) throw new Error("versions");
    const twoAcs = versions.value.find(
      (v) => Array.isArray(v.extra["acceptance_criteria"]) && (v.extra["acceptance_criteria"] as unknown[]).length === 2,
    );
    if (!twoAcs) throw new Error("fixture: no 2-criteria version");
    const res = await new VersionService(store, recordLockGateOff(store)).restore(specId, twoAcs.version, { by: CALLER });
    expect(res.ok).toBe(true);
    expect(((await stored(store, specId)).extra["acceptance_criteria"] as unknown[]).length).toBe(2);
  });

  it("VersionService.restore of a version whose criteria array is malformed is refused and leaves the doc untouched", async () => {
    const { store, specId } = await setup();
    const doc = await stored(store, specId);
    const dup = [AC("AC-D-1"), AC("AC-D-1")];
    const ins = await store.insertVersion({
      doc_id: doc.id,
      version: 500,
      content: doc.content,
      extra: { ...doc.extra, acceptance_criteria: dup },
      status: doc.status,
      title: doc.title,
      action: "update",
      created_at: new Date().toISOString(),
      created_by: "test",
      change_summary: "malformed history row",
      slug: doc.slug,
    });
    if (!ins.ok) throw new Error("insertVersion");
    const before = await fingerprint(store, specId);
    const res = await new VersionService(store, recordLockGateOff(store)).restore(specId, 500);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_ERROR");
    // fingerprint counts versions; the injected row is already in `before`.
    expect(await fingerprint(store, specId)).toBe(before);
  });

  it("MigrationService v1 import never writes frontmatter acceptance_criteria into extra", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-chokepoint-import-"));
    try {
      writeFileSync(
        join(dir, "a.md"),
        `---\nid: "v1-a"\ntype: prd\nstatus: published\npriority: high\ncreated: "2025-01-01"\nupdated: "2025-06-01"\ntags: []\nlinks: []\nacceptance_criteria:\n  - id: AC-X-1\n    statement: smuggled\n---\n\n# Smuggle\n`,
      );
      const store = actedStore(new InMemoryStore());
      const res = await new MigrationService(store).execute(dir, { dryRun: false, skipSecretScan: true } as never);
      expect(res.ok).toBe(true);
      const all = await store.findMany({});
      if (!all.ok) throw new Error("list");
      expect(all.value.length).toBeGreaterThan(0);
      expect(all.value.every((d) => d.extra["acceptance_criteria"] === undefined)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applyAcChange('import') admits a valid array and refuses a malformed one with VALIDATION_ERROR", () => {
    expect(applyAcChange("import", undefined, { acceptance_criteria: [AC("AC-I-1")] }).ok).toBe(true);
    const bad = applyAcChange("import", undefined, { acceptance_criteria: [AC("AC-I-1"), AC("AC-I-1")] });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe("VALIDATION_ERROR");
  });
});
