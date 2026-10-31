// @spawns packages/lore/src/index.ts
/**
 * RED — write attribution matrix (spec-run-identity-slice-1-harness-attested-runs-attested,
 * D1 / D3 / D4 / D11; rules BR-1032, BR-1036).
 *
 * Contract under test (AC-RID-5):
 *   With an invocation identity carrying harness run R and claimed name N from source S, every
 *   write kind — create, set, link, unlink, claim, release, evidence, ac add, rule add, handoff,
 *   done — leaves
 *     - an audit row with harness_run R and author N with source S, and
 *     - every version row it writes carries harness_run R,
 *   on SQLiteStore AND InMemoryStore, because the stamp is applied at ONE store chokepoint
 *   (`withWriteContext(store, ctx)`, a StoreInterface decorator), not inside each service.
 *
 * Expected-behaviour table (written from the spec before the implementation was read):
 *   - audit row of a write made through a decorated store: `harness_run === R`, `actor === N`
 *   - version row(s) of that write: `harness_run === R`
 *   - the SOURCE S of the name is stored with the author; the spec fixes WHAT is stored (name with
 *     its source) but not WHICH field, so the source is asserted as "present in the stored audit
 *     row" (serialised row contains the exact source token) — see SPEC GAP in the report.
 *   - a different identity (R2, N2, S2) yields different stamps (defeats a hardcoded stamp).
 *   - the same services over an UNDECORATED store stamp nothing (control; passes today and must
 *     keep passing).
 *
 * Dimensions: HAPPY (11 kinds x 2 stores), STATE (two identities on one store; batch), REGRESSION
 * (undecorated control, CLI e2e chokepoint), NEGATIVE (undecorated write is not attested).
 *
 * Every store/service below is real; the only injected thing is the run record, registered through
 * the store's own `insertRun` (AC-RID-4 interface) because no CLI registration exists yet.
 * MOCK RISK: none — no mocks.
 *
 * Fixture validity is proven by the control tests: they run the same write drivers over an
 * undecorated store and pass today, so a RED result in the matrix is missing stamping, not a
 * broken fixture.
 *
 * @spec_ref AC-RID-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoOpTelemetry } from "@lore/core";
import type { AuditEntry, CreateDocInput, RunId, VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { sessionEnvFor } from "../../helpers/session-actor";
import { registerTestRun } from "../../helpers/test-run-identity";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

// ─── Identities ──────────────────────────────────────────────────────────────

interface Identity {
  readonly harnessRun: string;
  readonly claimed: string;
  readonly claimedSource: string;
}

// reason: an agent run's name is DERIVED from its session (`agent:session-<8>`), so the two identities use two distinct
// 8-character session prefixes and the expected names are the derived ones (BR-1055, nameOfAgentRun).
const ID_A: Identity = { harnessRun: "cc:aaaaaaaa-matrix-a", claimed: "agent:session-aaaaaaaa", claimedSource: "run" };
const ID_B: Identity = { harnessRun: "cc:bbbbbbbb-matrix-b:agent-7", claimed: "agent:session-bbbbbbbb", claimedSource: "run" };

function runRecord(identity: Identity): Record<string, unknown> {
  const parts = identity.harnessRun.split(":");
  const sessionRef = parts[1] ?? "unknown";
  const agentRef = parts[2] ?? null;
  return {
    id: identity.harnessRun,
    kind: agentRef === null ? "main" : "subagent",
    harness: "claude-code",
    sessionRef,
    agentRef,
    agentType: null,
    parentRunId: agentRef === null ? null : `cc:${sessionRef}`,
    branch: null,
    composition: { schemaVersion: 1, fragments: [] },
    registeredAt: new Date().toISOString(),
  };
}

/** Registers a run through the store's own AC-RID-4 interface; fails loud when the interface is absent. */
async function registerRun(store: StoreInterface, identity: Identity): Promise<void> {
  const insertRun = (store as unknown as { insertRun?: (r: unknown) => Promise<{ ok: boolean; error?: unknown }> }).insertRun;
  if (typeof insertRun !== "function") throw new Error("StoreInterface.insertRun is missing (AC-RID-4 interface not implemented)");
  const r = await insertRun.call(store, runRecord(identity));
  if (r.ok === false) throw new Error(`insertRun refused: ${JSON.stringify(r.error)}`);
}

async function decorate(store: StoreInterface, identity: Identity): Promise<StoreInterface> {
  const mod = (await import("../../../src/store/write-context-store.js")) as {
    withWriteContext: (s: StoreInterface, ctx: { identity: Identity }) => StoreInterface;
  };
  return mod.withWriteContext(store, { identity });
}

// ─── Store factories (both required stores) ──────────────────────────────────

interface StoreHandle {
  readonly store: StoreInterface;
  readonly dispose: () => void;
}

const scratch: string[] = [];

type StoreKind = "SQLiteStore" | "InMemoryStore";

function makeStore(kind: StoreKind): StoreHandle {
  if (kind === "InMemoryStore") {
    const store = actedStore(new InMemoryStore());
    return { store, dispose: () => undefined };
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "attr-matrix-sqlite-")));
  scratch.push(dir);
  const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
  return { store, dispose: () => store.close() };
}

// ─── Services over a given store ─────────────────────────────────────────────

/** `gitCwd` makes the task service's git facts read that repository (the `done` kind needs a real commit to bind its pass to). */
function services(store: StoreInterface, gitCwd?: string) {
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const twf = new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe(gitCwd === undefined ? {} : { currentWorkingDirectory: () => gitCwd }));
  twf.setOverrideDecisionPort(alwaysAutoOverridePort()); // AU-T7: explicit test port; no port = override refused
  return {
    corpus,
    twf,
    ac: new AcService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    rules: new RuleService(store, corpus.create.bind(corpus)),
    session: new SessionService(store, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: corpus.createHandoffDoc.bind(corpus),
    }),
  };
}

type Svc = ReturnType<typeof services>;

function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): T {
  if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

async function mkDoc(s: Svc, input: Record<string, unknown>, by: string): Promise<{ id: string; slug: string }> {
  // reason: knowledge, decision and plan records need a parent (spec-documents-that-need-a-parent-are-refused-without-one-an-ad
  // D6); the fixture's requirements document is written by the same `by` so the attribution under test stays the caller's.
  const needsParent = ["knowledge", "adr", "plan"].includes(String(input["type"])) && input["parent_id"] === undefined;
  const parented = needsParent
    ? {
        ...input,
        parent_id: await ensureRequirementsDocId({
          list: (filter) => s.corpus.list(filter),
          create: (doc) => s.corpus.create(doc, { by }),
        }),
      }
    : input;
  const r = await s.corpus.create(parented as unknown as CreateDocInput, { by });
  return must(r as never, `create ${String(input["type"])}`) as { id: string; slug: string };
}

// ─── Row capture (multiset delta of audit and version rows) ──────────────────

async function auditRows(store: StoreInterface): Promise<AuditEntry[]> {
  const r = await store.queryAudit({ limit: 100_000 });
  return must(r as never, "queryAudit");
}

async function versionRows(store: StoreInterface): Promise<VersionRecord[]> {
  const r = await store.listAllVersions();
  return must(r as never, "listAllVersions");
}

function delta<T>(before: readonly T[], after: readonly T[]): T[] {
  const seen = new Map<string, number>();
  for (const row of before) seen.set(JSON.stringify(row), (seen.get(JSON.stringify(row)) ?? 0) + 1);
  const out: T[] = [];
  for (const row of after) {
    const key = JSON.stringify(row);
    const n = seen.get(key) ?? 0;
    if (n > 0) seen.set(key, n - 1);
    else out.push(row);
  }
  return out;
}

interface Captured {
  readonly audit: AuditEntry[];
  readonly versions: VersionRecord[];
}

async function capture(store: StoreInterface, act: () => Promise<void>): Promise<Captured> {
  const a0 = await auditRows(store);
  const v0 = await versionRows(store);
  await act();
  return { audit: delta(a0, await auditRows(store)), versions: delta(v0, await versionRows(store)) };
}

const harnessRunOf = (row: unknown): unknown => (row as { harness_run?: unknown }).harness_run;

// ─── Write kinds ─────────────────────────────────────────────────────────────

interface Fixture {
  readonly s: Svc;
  /** Same services built over the (possibly decorated) store under test. */
  readonly w: Svc;
  readonly by: string;
  /** The run the fixture's identity carries: a claim names the run that took it, and a release or done is the holder's own (BR-1040). */
  readonly run: RunId;
  readonly ids: Record<string, string>;
}

interface WriteKind {
  readonly name: string;
  /** Setup done through the RAW store as the test author (never counted). */
  readonly setup: (f: { s: Svc; by: string }) => Promise<Record<string, string>>;
  /** Optional preparation performed through the store under test (same identity) but excluded from the capture. */
  readonly prepare?: (f: Fixture) => Promise<void>;
  /** The one write under test, performed through services over the store under test. */
  readonly act: (f: Fixture) => Promise<void>;
  /** A doc-mutating kind must write at least one version row (guards against a vacuous version check). */
  readonly writesVersion: boolean;
  /** The task service of the write under test reads the repository this test runs in (its git facts), not the unit-test fake. */
  readonly readsRepository?: boolean;
}

const SETUP_BY = "agent:matrix-setup";
const RULE = { confidence: "established", enforced_by: "guaranteed", examples: ["e.g. one"] } as const;

async function planAndTask(s: Svc): Promise<{ planId: string; taskSlug: string; taskId: string }> {
  const plan = await mkDoc(s, { type: "plan", title: "Matrix plan", content: "body" }, SETUP_BY);
  const task = await mkDoc(
    s,
    { type: "task", title: "Matrix task", parent_id: plan.id, content: "body", extra: { kind: "code", plan_id: plan.id } },
    SETUP_BY,
  );
  return { planId: plan.id, taskSlug: task.slug, taskId: task.id };
}

const KINDS: readonly WriteKind[] = [
  {
    name: "create",
    writesVersion: true,
    setup: async () => ({}),
    act: async (f) => {
      await mkDoc(f.w, { type: "knowledge", title: "Created under attribution", content: "body", extra: { sub_type: "reference" } }, f.by);
    },
  },
  {
    name: "set",
    writesVersion: true,
    setup: async ({ s, by }) => ({ slug: (await mkDoc(s, { type: "knowledge", title: "Set target", content: "v1", extra: { sub_type: "reference" } }, by)).slug }),
    act: async (f) => {
      must((await f.w.corpus.set(f.ids["slug"] as string, { content: "v2 changed" }, { by: f.by })) as never, "set");
    },
  },
  {
    name: "link",
    writesVersion: false,
    setup: async ({ s, by }) => ({
      a: (await mkDoc(s, { type: "knowledge", title: "Link from", content: "a", extra: { sub_type: "reference" } }, by)).slug,
      b: (await mkDoc(s, { type: "knowledge", title: "Link to", content: "b", extra: { sub_type: "reference" } }, by)).slug,
    }),
    act: async (f) => {
      must((await f.w.corpus.link(f.ids["a"] as string, f.ids["b"] as string, "relates-to", { by: f.by })) as never, "link");
    },
  },
  {
    name: "unlink",
    writesVersion: false,
    setup: async ({ s, by }) => {
      const a = (await mkDoc(s, { type: "knowledge", title: "Unlink from", content: "a", extra: { sub_type: "reference" } }, by)).slug;
      const b = (await mkDoc(s, { type: "knowledge", title: "Unlink to", content: "b", extra: { sub_type: "reference" } }, by)).slug;
      must((await s.corpus.link(a, b, "relates-to", { by })) as never, "setup link");
      return { a, b };
    },
    act: async (f) => {
      must((await f.w.corpus.unlink(f.ids["a"] as string, f.ids["b"] as string, { by: f.by })) as never, "unlink");
    },
  },
  {
    name: "claim",
    writesVersion: false,
    setup: async ({ s }) => ({ task: (await planAndTask(s)).taskSlug }),
    act: async (f) => {
      // reason: a code task is claimed on its own branch (AC-DCS1-14); the name is all this store-level fixture needs.
      must((await f.w.twf.claim(f.ids["task"] as string, { by: f.by, harnessRun: f.run, worktree: "wt-matrix-claim" })) as never, "claim");
    },
  },
  {
    name: "release",
    writesVersion: false,
    setup: async ({ s }) => ({ task: (await planAndTask(s)).taskSlug }),
    // The claim is placed by the SAME identity through the store under test, so the measured write is the holder's own release.
    prepare: async (f) => {
      must((await f.w.twf.claim(f.ids["task"] as string, { by: f.by, harnessRun: f.run, worktree: "wt-matrix-release" })) as never, "claim before release");
    },
    act: async (f) => {
      must((await f.w.twf.release(f.ids["task"] as string, { by: f.by, harnessRun: f.run })) as never, "release");
    },
  },
  {
    name: "evidence",
    // reason: evidence, claim and release are working-state writes: no versions row (their audit rows carry the run).
    writesVersion: false,
    setup: async ({ s }) => ({ task: (await planAndTask(s)).taskSlug }),
    act: async (f) => {
      must(
        (await f.w.twf.addEvidence(f.ids["task"] as string, {
          oracle: "test",
          command: "bun test attribution-fixture",
          result: "expected-fail",
          recorded_by: f.by,
          capture_source: "self-report",
          output_tail: "red fixture row",
        } as never)) as never,
        "evidence",
      );
    },
  },
  {
    name: "ac add",
    writesVersion: true,
    setup: async ({ s, by }) => ({ spec: (await mkDoc(s, { type: "spec", title: "Matrix spec", content: "## Overview\nbody" }, by)).slug }),
    act: async (f) => {
      must(
        (await f.w.ac.addCriterion(
          f.ids["spec"] as string,
          {
            id: "AC-MTX-1",
            statement: "The fixture command exits 0 and prints exactly 1 PASS line.",
            verify: { mode: "script", oracle: "test", command: "echo 'AC-MTX-1 PASS: fixture'" },
          },
          { by: f.by, allowMissingPath: "attribution matrix fixture declares no oracle file" },
        )) as never,
        "ac add",
      );
    },
  },
  {
    name: "rule add",
    writesVersion: true,
    setup: async ({ s, by }) => {
      const prd = await mkDoc(s, { type: "prd", title: "Matrix PRD", content: "root" }, by);
      const root = must((await s.rules.addNode(prd.slug, { node: "root", label: "biz", title: "Biz Root", content: "root" }, { by })) as never, "root node") as { slug: string };
      const leaf = must((await s.rules.addNode(root.slug, { node: "leaf", label: "leaf", title: "Biz Leaf", content: "leaf" }, { by })) as never, "leaf node") as { slug: string };
      return { leaf: leaf.slug };
    },
    act: async (f) => {
      must((await f.w.rules.addRule(f.ids["leaf"] as string, { statement: "A rule written under attribution", ...RULE, examples: [...RULE.examples] }, { by: f.by })) as never, "rule add");
    },
  },
  {
    name: "handoff",
    writesVersion: true,
    setup: async ({ s }) => ({ plan: (await planAndTask(s)).planId }),
    act: async (f) => {
      must(
        (await f.w.session.writeHandoff({
          by: f.by,
          plan_ref: f.ids["plan"] as string,
          task_refs: [],
          modified_files: [],
          key_decisions: [],
          next_steps: ["continue the attribution work"],
        } as never)) as never,
        "handoff",
      );
    },
  },
  {
    name: "done",
    writesVersion: true,
    // reason: `lore done` judges the stored contract (AC-DCS1-7) and a code task needs a landing, so the task is a corpus task (never
    // claimed, lands nothing, AC-DCS1-19) holding the stored contract of a corpus task with no oracle; its one runner-attested pass
    // (the evidence floor the retired attestation override used to waive) is recorded in `prepare` on a commit of the repository this
    // test runs in, which contains the contract's compile commit (the rule for a corpus task). The write under test is the same
    // archive walk, attributed to the same run.
    readsRepository: true,
    prepare: async (f) => {
      const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      must(
        (await f.w.twf.recordVerifiedEvidence(
          f.ids["task"] as string,
          { oracle: "test", command: "echo matrix-done-pass", result: "pass", recorded_by: f.by, capture_source: "runner", attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, head_sha: head } },
          new Date().toISOString(),
        )) as never,
        "attested pass before done",
      );
    },
    setup: async ({ s }) => {
      const root = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).trim().split("\n").pop() ?? "";
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
      const plan = await mkDoc(s, { type: "plan", title: "Matrix done plan", content: "body" }, SETUP_BY);
      const task = await mkDoc(
        s,
        {
          type: "task",
          title: "Matrix done task",
          parent_id: plan.id,
          content: "body",
          extra: {
            kind: "corpus",
            plan_id: plan.id,
            done_contract: {
              compiled_at_commit: root,
              kind: "corpus",
              base_branch: branch,
              oracles: [],
              red_required: false,
              landing_route: "none",
              new_symbols: [],
              added_oracles: [],
            },
          },
        },
        SETUP_BY,
      );
      return { task: task.slug };
    },
    act: async (f) => {
      must(
        (await f.w.twf.done(f.ids["task"] as string, {
          by: f.by,
          harnessRun: f.run,
        } as never)) as never,
        "done",
      );
    },
  },
];

async function runKind(
  kind: WriteKind,
  storeKind: StoreKind,
  identity: Identity,
  mode: "decorated" | "plain",
): Promise<Captured> {
  const handle = makeStore(storeKind);
  try {
    const raw = services(handle.store);
    const ids = await kind.setup({ s: raw, by: identity.claimed });
    let target = handle.store;
    if (mode === "decorated") {
      await registerRun(handle.store, identity);
      target = await decorate(handle.store, identity);
    }
    const f: Fixture = { s: raw, w: services(target, kind.readsRepository === true ? process.cwd() : undefined), by: identity.claimed, run: identity.harnessRun as RunId, ids };
    if (kind.prepare !== undefined) await kind.prepare(f);
    return await capture(handle.store, () => kind.act(f));
  } finally {
    handle.dispose();
  }
}

// ─── The matrix ──────────────────────────────────────────────────────────────

const STORES: readonly StoreKind[] = ["SQLiteStore", "InMemoryStore"];

describe("control: the write drivers are valid and unattested without the decorator (passes before and after)", () => {
  for (const storeKind of STORES) {
    for (const kind of KINDS) {
      it(`${storeKind}: ${kind.name} writes audit rows by the claimed name and no harness_run on an undecorated store`, async () => {
        const got = await runKind(kind, storeKind, ID_A, "plain");
        expect(got.audit.length).toBeGreaterThan(0);
        for (const row of got.audit) {
          // handoff is the one kind whose audit actor is NOT the payload's `by` today (createHandoffDoc is called
          // without it, so the row is attributed to the ambient actor). The matrix below pins the spec'd author N.
          if (kind.name !== "handoff") expect(row.actor).toBe(ID_A.claimed);
          expect(harnessRunOf(row) ?? null).toBeNull();
        }
      });
    }
  }
});

describe("AC-RID-5 matrix: every write kind is stamped with harness run R and name N (source S) at the store chokepoint", () => {
  for (const storeKind of STORES) {
    for (const kind of KINDS) {
      it(`${storeKind}: ${kind.name} -> every audit row has harness_run R and author N with source S`, async () => {
        const got = await runKind(kind, storeKind, ID_A, "decorated");
        expect(got.audit.length).toBeGreaterThan(0);
        for (const row of got.audit) {
          expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
          expect(row.actor).toBe(ID_A.claimed);
          expect(JSON.stringify(row)).toContain(ID_A.claimedSource);
        }
      });

      it(`${storeKind}: ${kind.name} -> every version row it writes has harness_run R`, async () => {
        const got = await runKind(kind, storeKind, ID_A, "decorated");
        if (kind.writesVersion) expect(got.versions.length).toBeGreaterThan(0);
        for (const row of got.versions) {
          expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
        }
      });
    }
  }
});

describe("a second identity gets its own stamps (a hardcoded stamp cannot pass both)", () => {
  for (const storeKind of STORES) {
    for (const name of ["create", "claim", "evidence"]) {
      it(`${storeKind}: ${name} under run B carries B, its name and its source, never A's`, async () => {
        const kind = KINDS.find((k) => k.name === name) as WriteKind;
        const got = await runKind(kind, storeKind, ID_B, "decorated");
        expect(got.audit.length).toBeGreaterThan(0);
        for (const row of got.audit) {
          expect(harnessRunOf(row)).toBe(ID_B.harnessRun);
          expect(row.actor).toBe(ID_B.claimed);
          expect(JSON.stringify(row)).toContain(ID_B.claimedSource);
          expect(JSON.stringify(row)).not.toContain(ID_A.harnessRun);
        }
        for (const row of got.versions) expect(harnessRunOf(row)).toBe(ID_B.harnessRun);
      });
    }
  }
});

describe("one decorated store, two consecutive writes: both stamped, none leaked to the raw store", () => {
  for (const storeKind of STORES) {
    it(`${storeKind}: writes through the decorator carry R while a write through the raw store afterwards carries none`, async () => {
      const handle = makeStore(storeKind);
      try {
        await registerRun(handle.store, ID_A);
        const wrapped = await decorate(handle.store, ID_A);
        const viaWrapped = await capture(handle.store, async () => {
          await mkDoc(services(wrapped), { type: "knowledge", title: "Via wrapper", content: "x", extra: { sub_type: "reference" } }, ID_A.claimed);
        });
        const viaRaw = await capture(handle.store, async () => {
          await mkDoc(services(handle.store), { type: "knowledge", title: "Via raw", content: "x", extra: { sub_type: "reference" } }, ID_A.claimed);
        });
        expect(viaWrapped.audit.length).toBeGreaterThan(0);
        for (const row of viaWrapped.audit) expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
        expect(viaRaw.audit.length).toBeGreaterThan(0);
        for (const row of viaRaw.audit) expect(harnessRunOf(row) ?? null).toBeNull();
        for (const row of viaRaw.versions) expect(harnessRunOf(row) ?? null).toBeNull();
      } finally {
        handle.dispose();
      }
    });
  }
});

// ─── CLI end to end on a real SQLite corpus (chokepoint wired at the composition root) ───

function vcs(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDECODE: "1", ...extra };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) if (!(k in extra)) delete env[k];
  return env;
}

function lore(args: string[], cwd: string, extra: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number } {
  const env = cleanEnv({ HOME: cwd, ...extra });
  // reason: every write needs a known party; the spawn shim (scripts/test-known-party-spawn.ts) gives the child the run of the session its env names.
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[], cwd: string, extra: Record<string, string> = {}): { stdout: string; stderr: string } {
  const r = lore(args, cwd, extra);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function corpusDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  if (d.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(d);
  vcs(d, ["init", "-q", "-b", "main"]);
  vcs(d, ["config", "user.email", "matrix@example.invalid"]);
  vcs(d, ["config", "user.name", "matrix test"]);
  writeFileSync(join(d, "README.md"), "fixture\n");
  vcs(d, ["add", "."]);
  vcs(d, ["commit", "-q", "-m", "init"]);
  mustLore(["init"], d, sessionEnvFor("agent:matrix-setup"));
  mustLore(["create", "prd", "--title", "Matrix Root", "--content", "root", "--no-ai"], d, sessionEnvFor("agent:matrix-setup"));
  return d;
}

async function registerInCorpus(dir: string, identity: Identity): Promise<void> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    await registerRun(store, identity);
  } finally {
    store.close();
  }
  // reason: the per-call run value is verified by process ancestry, so this test process becomes the run's harness.
  registerTestRun(dir, identity.harnessRun);
}

async function auditSince(dir: string, since: string): Promise<AuditEntry[]> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    return (await auditRows(store)).filter((r) => r.timestamp >= since);
  } finally {
    store.close();
  }
}

describe("CLI chokepoint: `LORE_HARNESS_RUN=R lore <write>` (name N from the session tier) stamps the audit row at the composition root", () => {
  /** The writer name ID_A's run derives — the only way a CLI write is named (BR-1055). */
  const NAME_A = ID_A.claimed;

  let dir = "";
  let task = "";

  beforeAll(() => {
    dir = corpusDir("attr-matrix-cli-");
    task = JSON.parse(
      mustLore(["create", "task", "--kind", "code", "--adhoc", "--title", "Matrix CLI task", "--ac-scope", "", "--json"], dir, sessionEnvFor("agent:matrix-setup")).stdout,
    ).data.slug as string;
  });

  it("claim named through the session tier leaves an audit row with harness_run R, author N and the source session", async () => {
    await registerInCorpus(dir, ID_A);
    const since = new Date().toISOString();
    mustLore(["claim", task, "--worktree", dir], dir, { ...sessionEnvFor(ID_A.claimed), LORE_HARNESS_RUN: ID_A.harnessRun });
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === NAME_A);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
      expect((row.details as Record<string, unknown> | undefined)?.["name_source"]).toBe("run");
    }
  });

  it("the run value is consumed by the entry: it never reaches the command as an argument or unknown flag", () => {
    const r = lore(["get", task, "--json"], dir, { ...sessionEnvFor("agent:matrix-reader"), LORE_HARNESS_RUN: ID_A.harnessRun });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Unknown flag");
  });

  it("an evidence write named through the session tier, under R, stamps the row and its version row", async () => {
    await registerInCorpus(dir, ID_A);
    // The evidence guard refuses a `pass` while the claim's recorded worktree has uncommitted changes: commit the fixture.
    // Corpus state (.lore/) and the HOME-redirect scratch (Library/) are not source: ignore them, commit the rest.
    writeFileSync(join(dir, ".gitignore"), ".lore/\nLibrary/\n");
    vcs(dir, ["add", ".gitignore"]);
    vcs(dir, ["commit", "-q", "-m", "fixture state"]);
    const since = new Date().toISOString();
    mustLore(
      ["evidence", task, "--oracle", "manual", "--command", "inspect fixture", "--result", "pass", "--output-tail", "1 passed"],
      dir,
      { ...sessionEnvFor(ID_A.claimed), LORE_HARNESS_RUN: ID_A.harnessRun },
    );
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === NAME_A);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
    const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
    try {
      // reason: an evidence write is a working-state write and adds no versions row; any row it did write must carry R.
      const versions = (await versionRows(store)).filter((v) => v.created_by === NAME_A && v.created_at >= since);
      for (const v of versions) expect(harnessRunOf(v)).toBe(ID_A.harnessRun);
    } finally {
      store.close();
    }
  });
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
