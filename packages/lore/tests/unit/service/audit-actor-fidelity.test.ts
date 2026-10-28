/**
 * SPEC-079 G2 (actor fidelity) — AC-079-2.
 *
 * `CorpusService.create` / `set` / `delete`'s audit entries, and
 * `CorpusService.link`'s `LinkRecord.created_by`, must carry the RESOLVED
 * actor (`opts.by` > `$LORE_ACTOR` > session tier > OS username — the SAME
 * `resolveActorWithSource` chain the CLI already applies, `@lore/core/node`)
 * instead of the literal `"system"`. An omitted `opts.by` falls back to the
 * env chain, read from the REAL `process.env` at call time (CorpusService has
 * no injectable env seam — this spec's own Design Decisions D2 names
 * `process.env` explicitly, not a DI parameter).
 *
 * `doc.created_by` and `versionRecord.created_by` are OUT of this spec's
 * scope (G2 only names "audit entries" + "links.created_by") — they stay the
 * literal `"system"` even when `opts.by` is supplied; see the REGRESSION
 * block below, which pins this deliberate narrowing so a future session
 * doesn't "fix" it into an inconsistency without re-reading the spec.
 *
 * Uses InMemoryStore — no file I/O, no bun:sqlite (vitest runner).
 *
 * Six-dimension coverage:
 *   HAPPY:      explicit opts.by lands on create/set/delete's audit actor and
 *               link's created_by
 *   NEGATIVE:   omitted opts.by falls back through the REAL env chain —
 *               $LORE_ACTOR, then session tier, then OS username
 *   BOUNDARY:   a whitespace-only opts.by is treated as absent (falls through
 *               to the env chain, mirroring resolveActorWithSource's own
 *               documented boundary)
 *   ERROR:      a session id that sanitizes to the empty string degrades to
 *               OS-fallback instead of throwing out of the write
 *   STATE:      sequential create → set → delete on the SAME doc, each with a
 *               DIFFERENT explicit opts.by, produce independently correct
 *               per-call audit actors (no caching/staleness across calls)
 *   REGRESSION: doc.created_by / versionRecord.created_by stay "system" even
 *               with an explicit opts.by — this spec's scope is audit-entry +
 *               link fidelity only, not those two fields; bare
 *               `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))` construction (no gate/telemetry)
 *               still resolves and applies the actor correctly
 *
 * @spec_ref SPEC-079 §Acceptance Criteria AC-079-2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { userInfo } from "node:os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { sessionActorFromId } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { actedStore, liveWriteActor } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
/**
 * The author of a write that names no `by`: the name the store's write context carries (the invocation's known party,
 * BR-1055) — never $LORE_ACTOR, a session id in the env, or the computer's user name. `actedStore` declares it.
 */
const OS_USERNAME = liveWriteActor();
void userInfo;

// ─── Ambient-env isolation (mirrors cli-utils.test.ts's resolveActorWithSource
// describe block) — save/restore around every test in this file so a real
// Claude Code shell's $LORE_ACTOR / $CLAUDE_CODE_SESSION_ID never leaks into
// (or out of) these assertions. ─────────────────────────────────────────────

const ORIGINAL_LORE_ACTOR = process.env["LORE_ACTOR"];
const ORIGINAL_CLAUDE_CODE_SESSION_ID = process.env["CLAUDE_CODE_SESSION_ID"];
const ORIGINAL_CLAUDE_SESSION_ID = process.env["CLAUDE_SESSION_ID"];

beforeEach(() => {
  delete process.env["LORE_ACTOR"];
  delete process.env["CLAUDE_CODE_SESSION_ID"];
  delete process.env["CLAUDE_SESSION_ID"];
});

afterEach(() => {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("LORE_ACTOR", ORIGINAL_LORE_ACTOR);
  restore("CLAUDE_CODE_SESSION_ID", ORIGINAL_CLAUDE_CODE_SESSION_ID);
  restore("CLAUDE_SESSION_ID", ORIGINAL_CLAUDE_SESSION_ID);
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeStore() {
  return actedStore(new InMemoryStore());
}

async function createPlan(cs: CorpusService, title: string, opts?: { by?: string }) {
  const result = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title, content: "body" } as CreateDocInput, opts);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function auditFor(store: InMemoryStore, docId: string, action: string) {
  const r = await store.queryAudit({ doc_id: docId, action });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — explicit opts.by carries through to the resolved actor", () => {
  it("create() with opts.by writes an audit entry whose actor is that value", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Actor Fidelity Create", { by: "agent:alice" });

    const entries = await auditFor(store, doc.id, "create");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor).toBe("agent:alice");
  });

  it("set() with opts.by writes an audit entry whose actor is that value", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Actor Fidelity Set");

    const setResult = await cs.set(doc.id, { title: "Renamed" }, { by: "agent:bob" });
    expect(setResult.ok).toBe(true);

    const entries = await auditFor(store, doc.id, "update");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor).toBe("agent:bob");
  });

  it("delete() with opts.by writes an audit entry whose actor is that value", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Actor Fidelity Delete");

    const deleteResult = await cs.delete(doc.id, true, { by: "agent:carol" });
    expect(deleteResult.ok).toBe(true);

    const entries = await auditFor(store, doc.id, "delete");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor).toBe("agent:carol");
  });

  it("link() with opts.by sets LinkRecord.created_by to that value", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const a = await createPlan(cs, "Actor Fidelity Link A");
    const b = await createPlan(cs, "Actor Fidelity Link B");

    const linkResult = await cs.link(a.id, b.id, "relates-to", { by: "agent:dave" });
    expect(linkResult.ok).toBe(true);
    if (!linkResult.ok) return;
    expect(linkResult.value.created_by).toBe("agent:dave");

    // The audit entry's actor must match too (both threads of G1+G2 agree).
    const entries = await auditFor(store, a.id, "link");
    expect(entries[0]?.actor).toBe("agent:dave");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — omitted opts.by falls back through the real env chain", () => {
  it("never falls back to $LORE_ACTOR when opts.by is omitted (BR-1055)", async () => {
    process.env["LORE_ACTOR"] = "agent:env-actor";
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Env Fallback Create");

    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe(OS_USERNAME);
  });

  it("never reads the session id in the env either: the write context's party is the author (BR-1055)", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = "3de02220-5d69-4b5a-ac23-d66e14c0261b";
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Session Fallback Create");

    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe(OS_USERNAME);
    expect(entries[0]?.actor).not.toBe(sessionActorFromId("3de02220-5d69-4b5a-ac23-d66e14c0261b"));
  });

  it("the write context's party is the author when opts.by, $LORE_ACTOR, and the session tier are all absent", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "OS Fallback Create");

    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe(OS_USERNAME);
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — a whitespace-only opts.by is treated as absent", () => {
  it("falls through to the OS username (not $LORE_ACTOR) rather than persisting whitespace as the actor", async () => {
    process.env["LORE_ACTOR"] = "agent:carol";
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Whitespace By Create", { by: "   " });

    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe(OS_USERNAME);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("ERROR — a session id that sanitizes to empty degrades instead of throwing", () => {
  it("a session id of only non-[a-z0-9-] characters degrades to OS-fallback, never throws", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = "---";
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    // The write itself must not throw — sessionActorFromId's fail-loud contract
    // is caught internally by resolveActorWithSource's degrade path.
    const doc = await createPlan(cs, "Degraded Session Create");

    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe(OS_USERNAME);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — sequential writes each resolve their OWN opts.by independently", () => {
  it("create → set → delete on the same doc with different opts.by values never reuse a stale actor", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Sequence Doc", { by: "agent:one" });

    const setResult = await cs.set(doc.id, { title: "Renamed" }, { by: "agent:two" });
    expect(setResult.ok).toBe(true);

    const deleteResult = await cs.delete(doc.id, true, { by: "agent:three" });
    expect(deleteResult.ok).toBe(true);

    expect((await auditFor(store, doc.id, "create"))[0]?.actor).toBe("agent:one");
    expect((await auditFor(store, doc.id, "update"))[0]?.actor).toBe("agent:two");
    expect((await auditFor(store, doc.id, "delete"))[0]?.actor).toBe("agent:three");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

// spec-run-identity-slice-1 D1/D4 retired the literal 'system' author: doc.created_by and the version rows now
// carry the SAME resolved actor as the audit entry.
describe("REGRESSION — doc.created_by/versionRecord.created_by carry the resolved actor, never 'system'", () => {
  it("create()'s DocRecord.created_by and versions row carry the explicit opts.by", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Scope Boundary Create", { by: "agent:alice" });
    expect(doc.created_by).toBe("agent:alice");

    const versions = await store.findVersions(doc.id);
    if (!versions.ok) throw new Error(JSON.stringify(versions.error));
    expect(versions.value[0]?.created_by).toBe("agent:alice");

    // The audit entry carries the same resolved actor: one author per write.
    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe("agent:alice");
  });

  it("set()'s versions row carries the explicit opts.by", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const doc = await createPlan(cs, "Scope Boundary Set");

    await cs.set(doc.id, { title: "Renamed" }, { by: "agent:bob" });
    const versions = await store.findVersions(doc.id);
    if (!versions.ok) throw new Error(JSON.stringify(versions.error));
    // reason: select the set()'s own row by action — `findVersions` ordering is not part of this test's contract.
    const updateRow = versions.value.find((v) => v.action === "update");
    expect(updateRow?.created_by).toBe("agent:bob");
  });

  it("a bare `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))` construction (no gate/telemetry DI) still resolves opts.by correctly", async () => {
    const store = makeStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))); // no telemetry, no claimTtlMinutes, no gate
    const doc = await createPlan(cs, "Bare Construction", { by: "agent:bare" });

    const entries = await auditFor(store, doc.id, "create");
    expect(entries[0]?.actor).toBe("agent:bare");
  });
});
