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
 *   One MCP `lore_batch` call with three operations stamps all three with the same R and the same N.
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
 * MOCK RISK: none — no mocks. The MCP leg drives the real `lore --mcp-server` over stdio.
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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { NoOpTelemetry } from "@lore/core";
import type { AuditEntry, CreateDocInput, VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { sessionActorFor, sessionEnvFor } from "../../helpers/session-actor";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

// ─── Identities ──────────────────────────────────────────────────────────────

interface Identity {
  readonly harnessRun: string;
  readonly claimed: string;
  readonly claimedSource: string;
}

const ID_A: Identity = { harnessRun: "cc:matrix-session-a", claimed: "agent:matrix-writer-a", claimedSource: "worktree" };
const ID_B: Identity = { harnessRun: "cc:matrix-session-b:agent-7", claimed: "agent:matrix-writer-b", claimedSource: "os" };

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
    const store = new InMemoryStore();
    return { store, dispose: () => undefined };
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "attr-matrix-sqlite-")));
  scratch.push(dir);
  const store = new SQLiteStore(join(dir, "lore.db"));
  return { store, dispose: () => store.close() };
}

// ─── Services over a given store ─────────────────────────────────────────────

function services(store: StoreInterface) {
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const twf = new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 });
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
  const r = await s.corpus.create(input as unknown as CreateDocInput, { by });
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
}

const SETUP_BY = "agent:matrix-setup";
const RULE = { confidence: "established", enforced_by: "guaranteed", examples: ["e.g. one"] } as const;

async function planAndTask(s: Svc): Promise<{ planId: string; taskSlug: string; taskId: string }> {
  const plan = await mkDoc(s, { type: "plan", title: "Matrix plan", content: "body" }, SETUP_BY);
  const task = await mkDoc(
    s,
    { type: "task", title: "Matrix task", parent_id: plan.id, content: "body", extra: { plan_id: plan.id } },
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
    writesVersion: true,
    setup: async ({ s }) => ({ task: (await planAndTask(s)).taskSlug }),
    act: async (f) => {
      must((await f.w.twf.claim(f.ids["task"] as string, { by: f.by })) as never, "claim");
    },
  },
  {
    name: "release",
    writesVersion: true,
    setup: async ({ s }) => ({ task: (await planAndTask(s)).taskSlug }),
    // The claim is placed by the SAME identity through the store under test, so the measured write is the holder's own release.
    prepare: async (f) => {
      must((await f.w.twf.claim(f.ids["task"] as string, { by: f.by })) as never, "claim before release");
    },
    act: async (f) => {
      must((await f.w.twf.release(f.ids["task"] as string, { by: f.by })) as never, "release");
    },
  },
  {
    name: "evidence",
    writesVersion: true,
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
    setup: async ({ s }) => ({ task: (await planAndTask(s)).taskSlug }),
    // The holder (same identity, through the store under test) finishes its own task.
    prepare: async (f) => {
      must((await f.w.twf.claim(f.ids["task"] as string, { by: f.by })) as never, "claim before done");
    },
    act: async (f) => {
      must(
        (await f.w.twf.done(f.ids["task"] as string, {
          by: f.by,
          overrideReason: "attribution matrix fixture: no runner-attested pass exists for this throwaway task",
          noNewTestsReason: "attribution matrix fixture: throwaway task with no new tests",
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
    const f: Fixture = { s: raw, w: services(target), by: identity.claimed, ids };
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
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env: cleanEnv({ HOME: cwd, ...extra }) });
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
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    await registerRun(store, identity);
  } finally {
    store.close();
  }
}

async function auditSince(dir: string, since: string): Promise<AuditEntry[]> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    return (await auditRows(store)).filter((r) => r.timestamp >= since);
  } finally {
    store.close();
  }
}

describe("CLI chokepoint: `lore --harness-run R <write>` (name N from the session tier) stamps the audit row at the composition root", () => {
  /** The writer name ID_A's fixture session resolves to — the only way a CLI/MCP write is named (BR-1055). */
  const NAME_A = sessionActorFor(ID_A.claimed);

  let dir = "";
  let task = "";

  beforeAll(() => {
    dir = corpusDir("attr-matrix-cli-");
    task = JSON.parse(
      mustLore(["create", "task", "--adhoc", "--title", "Matrix CLI task", "--ac-scope", "", "--json"], dir, sessionEnvFor("agent:matrix-setup")).stdout,
    ).data.slug as string;
  });

  it("claim named through the session tier leaves an audit row with harness_run R, author N and the source session", async () => {
    await registerInCorpus(dir, ID_A);
    const since = new Date().toISOString();
    mustLore(["--harness-run", ID_A.harnessRun, "claim", task, "--worktree", dir], dir, sessionEnvFor(ID_A.claimed));
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === NAME_A);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
      expect(JSON.stringify(row)).toContain("session");
    }
  });

  it("the harness-run flag is consumed by the entry: it never reaches the command as an unknown flag", () => {
    const r = lore(["--harness-run", ID_A.harnessRun, "get", task, "--json"], dir, sessionEnvFor("agent:matrix-reader"));
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
      ["--harness-run", ID_A.harnessRun, "evidence", task, "--oracle", "manual", "--command", "inspect fixture", "--result", "pass", "--output-tail", "1 passed"],
      dir,
      sessionEnvFor(ID_A.claimed),
    );
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === NAME_A);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
    const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
    try {
      const versions = (await versionRows(store)).filter((v) => v.created_by === NAME_A && v.created_at >= since);
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) expect(harnessRunOf(v)).toBe(ID_A.harnessRun);
    } finally {
      store.close();
    }
  });
});

// ─── MCP: one lore_batch call, three operations, one identity ───────────────

describe("MCP lore_batch: three operations in one call carry the same R and the same N (BR-1036)", () => {
  let dir = "";

  beforeAll(() => {
    dir = corpusDir("attr-matrix-mcp-");
  });

  /** The server process runs under `actor`'s session identity — MCP calls carry no name argument (BR-1055). */
  async function withClient<T>(actor: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const env = Object.fromEntries(Object.entries(cleanEnv({ HOME: dir, ...sessionEnvFor(actor) })).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const transport = new StdioClientTransport({ command: "bun", args: ["run", ENTRY, "--mcp-server"], cwd: dir, env });
    const client = new Client({ name: "attribution-matrix", version: "0.0.0" });
    await client.connect(transport);
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  }

  it("create, create and link in ONE batch call -> all audit rows share harness_run R and author N", async () => {
    await registerInCorpus(dir, ID_A);
    const since = new Date().toISOString();
    const NAME_A = sessionActorFor(ID_A.claimed);
    const create = (title: string) => ({ op: "create", args: { type: "knowledge", title, content: "body", extra: { sub_type: "reference" } } });
    const result = await withClient(ID_A.claimed, (c) =>
      c.callTool({
        name: "lore_batch",
        arguments: {
          harness_run: ID_A.harnessRun,
          operations: [
            create("Batch one"),
            create("Batch two"),
            { op: "link", args: { from: "knowledge-batch-one", to: "knowledge-batch-two", type: "relates-to" } },
          ],
        },
      }),
    );
    expect(result.isError ?? false).toBe(false);
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === NAME_A);
    // two creates + one link = at least three audit rows, every one of them attested the same way.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(harnessRunOf(row)).toBe(ID_A.harnessRun);
      expect(JSON.stringify(row)).toContain("session");
    }
    expect(new Set(rows.map((r) => r.actor)).size).toBe(1);
  });

  it("a batch with no harness_run stamps none of its operations (no run is guessed)", async () => {
    const since = new Date().toISOString();
    await withClient("agent:matrix-unattested", (c) =>
      c.callTool({
        name: "lore_batch",
        arguments: {
          operations: [{ op: "create", args: { type: "knowledge", title: "Unattested batch", content: "body", extra: { sub_type: "reference" } } }],
        },
      }),
    );
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === sessionActorFor("agent:matrix-unattested"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(harnessRunOf(row) ?? null).toBeNull();
  });
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
