// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part A; AC-LG-1..AC-LG-4; BR-1366, BR-1367)
 *
 * `lore bulk <archive|deprecate|close|done>`: preview then apply, rows that fail alone, draft -> deprecated,
 * and MCP parity (`lore_bulk` / `lore_done` / `lore_reject`) over a real McpServer + Client. Everything runs on a
 * throwaway corpus (`mkdtemp` + `lore init`, git tree kept clean) — never the repo's own `.lore/`.
 *
 * Dimensions: HAPPY (preview exit 3, apply exit 0), NEGATIVE (usage exits 2, unknown id), BOUNDARY (none selected
 * exits 0), ERROR (stale + gated rows exit 1), STATE (nothing written by a preview, nothing partial by a failed
 * row), REGRESSION (`archive --apply` exits 1 on a failed candidate; archived -> deprecated stays invalid).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { docTypeSchema, getAllowedTransitions, isValidTransition } from "@lore/core";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { archivePlanWithoutCascade } from "../helpers/archive-plan-legacy.js";
import { liveInvocation, liveAmbient, actedStore, liveWriteContext } from "../live-invocation.js";
import { createApp, type App } from "../../src/app.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): RunResult {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:bulk-lifecycle-test" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status ?? 1 };
}

interface BulkRow {
  id: string;
  slug: string;
  type: string;
  status?: string;
  version?: number;
  target?: string;
  outcome?: string;
  from_status?: string | null;
  to_status?: string | null;
  code?: string | null;
  rule?: string | null;
  reason?: string;
}

function bulkJson(args: string[], cwd: string): { exitCode: number; mode: string; rows: BulkRow[] } {
  const r = runLore(["bulk", ...args, "--json"], cwd);
  const payload = JSON.parse(r.stdout) as { data: { mode: string; rows: BulkRow[] } };
  return { exitCode: r.exitCode, mode: payload.data.mode, rows: payload.data.rows };
}

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in create output: ${stdout}`);
  return slug;
}

function statusOf(slug: string, cwd: string): string {
  const r = runLore(["get", slug, "--json"], cwd);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { status: string } }; status?: string };
  return parsed.data?.doc?.status ?? parsed.status ?? `unreadable: ${r.stdout.slice(0, 200)}`;
}

function versionOf(slug: string, cwd: string): number {
  const r = runLore(["get", slug, "--json"], cwd);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { version: number } }; version?: number };
  return parsed.data?.doc?.version ?? parsed.version ?? -1;
}

let tmpDir: string;
let planSlug: string;
let prdSlug: string;
let counter = 0;

function createTask(title: string): string {
  counter += 1;
  const r = runLore(
    ["create", "task", "--title", `${title} ${counter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"],
    tmpDir,
  );
  expect(r.exitCode).toBe(0);
  return slugOf(r.stdout);
}

function addAttestedPass(taskSlug: string): void {
  const r = runLore(
    ["evidence", taskSlug, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"],
    tmpDir,
  );
  expect(r.exitCode).toBe(0);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-bulk-lifecycle-test-"));
  makeCleanTreeRepo(tmpDir);
  expect(runLore(["init"], tmpDir).exitCode).toBe(0);
  patchLoreConfig(tmpDir, "workflow:\n  review:\n    judgment_required_types: []\n");
  const prd = runLore(["create", "prd", "--title", "Bulk PRD", "--content", "root", "--no-ai"], tmpDir);
  expect(prd.exitCode).toBe(0);
  prdSlug = slugOf(prd.stdout);
  const plan = runLore(["create", "plan", "--title", "Bulk Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir);
  expect(plan.exitCode).toBe(0);
  planSlug = slugOf(plan.stdout);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("bulk lifecycle: preview then apply", () => {
  it("preview then apply: ids preview exits 3 writing nothing, apply writes each row once with the reason on its audit", () => {
    const [a, b, c] = [createTask("Alpha"), createTask("Beta"), createTask("Gamma")] as [string, string, string];
    // archive goes through the same `lore done` floors as every other write: an archived task holds an attested pass.
    for (const slug of [a, b, c]) addAttestedPass(slug);
    const versionsBefore = [a, b, c].map((s) => versionOf(s, tmpDir));

    const preview = bulkJson(["archive", a, b, c], tmpDir);
    expect(preview.exitCode).toBe(3);
    expect(preview.mode).toBe("preview");
    expect(preview.rows.map((r) => r.slug).sort()).toEqual([a, b, c].sort());
    expect(preview.rows.every((r) => r.target === "archived" && r.status === "draft")).toBe(true);
    // STATE: a preview writes nothing.
    expect([a, b, c].map((s) => statusOf(s, tmpDir))).toEqual(["draft", "draft", "draft"]);
    expect([a, b, c].map((s) => versionOf(s, tmpDir))).toEqual(versionsBefore);

    // --where selects the same rows through the lore list filters.
    const byWhere = bulkJson(["archive", "--where", "type=task,status=draft"], tmpDir);
    expect(byWhere.exitCode).toBe(3);
    expect(byWhere.rows.map((r) => r.slug).sort()).toEqual([a, b, c].sort());
    // BOUNDARY: nothing matches -> exit 0.
    expect(bulkJson(["archive", "--where", "type=task,status=active"], tmpDir).exitCode).toBe(0);
    // older-than keeps only rows older than N days: every fixture row is minutes old.
    expect(bulkJson(["archive", "--where", "type=task,older-than=30d"], tmpDir).exitCode).toBe(0);

    // NEGATIVE: usage errors are exactly 2 and write nothing.
    expect(runLore(["bulk", "archive", a, "--apply"], tmpDir).exitCode).toBe(2);
    expect(runLore(["bulk", "archive", a, "--where", "type=task", "--apply", "--reason", "x"], tmpDir).exitCode).toBe(2);
    expect(runLore(["bulk", "archive", "--apply", "--reason", "x"], tmpDir).exitCode).toBe(2);
    expect(runLore(["bulk", "nuke", a], tmpDir).exitCode).toBe(2);
    expect(runLore(["bulk", "archive", "--where", "colour=red"], tmpDir).exitCode).toBe(2);
    expect(statusOf(a, tmpDir)).toBe("draft");

    const apply = bulkJson(["archive", a, b, c, "--apply", "--reason", "sprint cleanup"], tmpDir);
    expect(apply.exitCode).toBe(0);
    expect(apply.mode).toBe("apply");
    expect(apply.rows.map((r) => r.outcome)).toEqual(["OK", "OK", "OK"]);
    expect([a, b, c].map((s) => statusOf(s, tmpDir))).toEqual(["archived", "archived", "archived"]);
    // one write per row: exactly one version bump each.
    expect([a, b, c].map((s) => versionOf(s, tmpDir))).toEqual(versionsBefore.map((v) => v + 1));
    for (const slug of [a, b, c]) {
      const audit = runLore(["audit", slug, "--json"], tmpDir);
      expect(audit.stdout).toContain("sprint cleanup");
    }

    // Re-applying skips what is already at the target: SKIPPED, exit 0, no further write.
    const again = bulkJson(["archive", a, "--apply", "--reason", "again"], tmpDir);
    expect(again.exitCode).toBe(0);
    expect(again.rows[0]?.outcome).toBe("SKIPPED");
    expect(versionOf(a, tmpDir)).toBe((versionsBefore[0] ?? 0) + 1);

    // ERROR: an unknown id refuses the preview with DOC_NOT_FOUND (exit 3) and is a FAILED row in an apply.
    expect(runLore(["bulk", "archive", "task-no-such-doc"], tmpDir).exitCode).toBe(3);
    const missing = bulkJson(["archive", "task-no-such-doc", "--apply", "--reason", "x"], tmpDir);
    expect(missing.exitCode).toBe(1);
    expect(missing.rows[0]?.outcome).toBe("FAILED");
    expect(missing.rows[0]?.code).toBe("DOC_NOT_FOUND");
  });

  it("preview then apply: close archives a plan with no open tasks and skips a task; open-tasks=0 selects only such plans", () => {
    const busyTask = createTask("Open work");
    const emptyPlan = runLore(["create", "plan", "--title", "Empty Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir);
    const emptySlug = slugOf(emptyPlan.stdout);
    expect(runLore(["set", emptySlug, "--status", "approved"], tmpDir).exitCode).toBe(0);
    expect(runLore(["set", planSlug, "--status", "approved"], tmpDir).exitCode).toBe(0);

    const selected = bulkJson(["close", "--where", "type=plan,open-tasks=0"], tmpDir);
    expect(selected.exitCode).toBe(3);
    expect(selected.rows.map((r) => r.slug)).toEqual([emptySlug]);

    const applied = bulkJson(["close", emptySlug, busyTask, "--apply", "--reason", "milestone over"], tmpDir);
    const byslug = new Map(applied.rows.map((r) => [r.slug, r]));
    expect(byslug.get(busyTask)?.outcome).toBe("SKIPPED");
    expect(byslug.get(busyTask)?.reason).toContain("close applies to plans");
    expect(byslug.get(emptySlug)?.outcome, JSON.stringify(byslug.get(emptySlug))).toBe("OK");
    expect(statusOf(emptySlug, tmpDir)).toBe("archived");
    expect(applied.exitCode).toBe(0);
  });

  it("preview then apply: --where plan=<slug|id> selects exactly that plan's tasks; an unknown plan exits 2 naming it", () => {
    const own = [createTask("Own one"), createTask("Own two")];
    const other = runLore(["create", "plan", "--title", "Other Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir);
    const otherSlug = slugOf(other.stdout);
    const foreign = runLore(
      ["create", "task", "--title", "Foreign", "--parent", otherSlug, "--plan-id", otherSlug, "--content", "x", "--no-ai"],
      tmpDir,
    );
    const foreignSlug = slugOf(foreign.stdout);

    const bySlug = bulkJson(["deprecate", "--where", `type=task,plan=${planSlug}`], tmpDir);
    expect(bySlug.exitCode).toBe(3);
    expect(bySlug.rows.map((r) => r.slug).sort()).toEqual([...own].sort());
    expect(bySlug.rows.map((r) => r.slug)).not.toContain(foreignSlug);

    const planId = (JSON.parse(runLore(["get", planSlug, "--json"], tmpDir).stdout) as { data: { doc: { id: string } } }).data.doc.id;
    const byId = bulkJson(["deprecate", "--where", `type=task,plan=${planId}`], tmpDir);
    expect(byId.rows.map((r) => r.slug).sort()).toEqual([...own].sort());

    // NEGATIVE: an unknown plan is a usage error naming it, never an empty selection.
    const unknown = runLore(["bulk", "deprecate", "--where", "type=task,plan=plan-no-such-plan"], tmpDir);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout + unknown.stderr).toContain("plan-no-such-plan");
  });

  it("preview then apply: an archived or deprecated document is never a candidate for any verb", () => {
    const mk = (title: string): string =>
      slugOf(runLore(["create", "plan", "--title", title, "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir).stdout);
    const live = [mk("Live A"), mk("Live B")];
    const archived = [mk("Gone A"), mk("Gone B")];
    const deprecated = mk("Dead C");
    for (const s of [...live, ...archived]) expect(runLore(["set", s, "--status", "approved"], tmpDir).exitCode).toBe(0);
    for (const s of archived) expect(runLore(["set", s, "--status", "archived"], tmpDir).exitCode).toBe(0);
    expect(runLore(["set", deprecated, "--status", "deprecated"], tmpDir).exitCode).toBe(0);
    expect(runLore(["set", planSlug, "--status", "deprecated"], tmpDir).exitCode).toBe(0);

    const preview = bulkJson(["close", "--where", "type=plan"], tmpDir);
    expect(preview.exitCode).toBe(3);
    expect(preview.rows.map((r) => r.slug).sort()).toEqual([...live].sort());
    for (const verb of ["archive", "deprecate"]) {
      expect(bulkJson([verb, "--where", "type=plan"], tmpDir).rows.map((r) => r.slug).sort()).toEqual([...live].sort());
    }
  });
});

describe("bulk lifecycle: row fails alone", () => {
  it("row fails alone: a stale row and a gate-refused row FAIL, the third is written, exit 1", () => {
    const [ok, stale, gated] = [createTask("Fine"), createTask("Moves"), createTask("NoEvidence")] as [string, string, string];
    addAttestedPass(ok);
    addAttestedPass(stale);

    // The preview the apply is pinned to.
    const preview = bulkJson(["done", ok, stale, gated], tmpDir);
    expect(preview.exitCode).toBe(3);
    const pinned = new Map(preview.rows.map((r) => [r.slug, r.version]));

    // `stale` changes after the preview: its version moves.
    expect(runLore(["set", stale, "--title", "Moved after preview"], tmpDir).exitCode).toBe(0);
    const staleVersionNow = versionOf(stale, tmpDir);
    expect(staleVersionNow).toBeGreaterThan(pinned.get(stale) ?? 0);

    const apply = bulkJson(
      ["done", `${ok}@${pinned.get(ok)}`, `${stale}@${pinned.get(stale)}`, `${gated}@${pinned.get(gated)}`, "--apply"],
      tmpDir,
    );
    expect(apply.exitCode).toBe(1);
    const rows = new Map(apply.rows.map((r) => [r.slug, r]));
    expect(rows.get(ok)?.outcome).toBe("OK");
    expect(rows.get(stale)?.outcome).toBe("FAILED");
    expect(rows.get(stale)?.code).toBe("STALE_VERSION");
    expect(rows.get(stale)?.rule).toBe("STALE_VERSION");
    expect(rows.get(gated)?.outcome).toBe("FAILED");
    expect(rows.get(gated)?.code).toBe("VALIDATION_ERROR");
    expect(rows.get(gated)?.rule).toBe("BR-1292");
    expect(rows.get(gated)?.reason).toContain("attested-pass");

    // The failed rows wrote nothing: statuses unchanged and the stale row kept only the title edit's version.
    expect(statusOf(ok, tmpDir)).toBe("archived");
    expect(statusOf(stale, tmpDir)).toBe("draft");
    expect(statusOf(gated, tmpDir)).toBe("draft");
    expect(versionOf(stale, tmpDir)).toBe(staleVersionNow);
    // No retry: asking again does not rescue the stale row (its pinned version is still behind).
    const retry = bulkJson(["done", `${stale}@${pinned.get(stale)}`, "--apply"], tmpDir);
    expect(retry.exitCode).toBe(1);
    expect(retry.rows[0]?.code).toBe("STALE_VERSION");
  });
});

describe("bulk lifecycle: draft can be abandoned", () => {
  it("draft can be abandoned: draft -> deprecated is valid for every doc type, archived -> deprecated is not", () => {
    const types = docTypeSchema.options;
    expect(types.length).toBeGreaterThan(5); // not vacuous
    for (const type of types) {
      expect(isValidTransition("draft", "deprecated", type), `draft -> deprecated for ${type}`).toBe(true);
    }
    expect(getAllowedTransitions("draft")).toContain("deprecated");
    expect(getAllowedTransitions("archived")).toEqual([]);
    for (const type of types) {
      expect(isValidTransition("archived", "deprecated", type), `archived -> deprecated for ${type}`).toBe(false);
      expect(isValidTransition("deprecated", "archived", type), `deprecated -> archived for ${type}`).toBe(false);
    }
  });

  it("draft can be abandoned: bulk deprecate writes deprecated with the reason on a draft plan and a draft task", () => {
    const task = createTask("Abandon me");
    const plan = slugOf(
      runLore(["create", "plan", "--title", "Abandoned Plan", "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir).stdout,
    );
    const applied = bulkJson(["deprecate", plan, task, "--apply", "--reason", "no longer wanted"], tmpDir);
    expect(applied.exitCode).toBe(0);
    expect(applied.rows.map((r) => r.outcome)).toEqual(["OK", "OK"]);
    expect(statusOf(plan, tmpDir)).toBe("deprecated");
    expect(statusOf(task, tmpDir)).toBe("deprecated");
    expect(runLore(["audit", plan, "--json"], tmpDir).stdout).toContain("no longer wanted");
  });

  it("draft can be abandoned: archived -> deprecated is INVALID_TRANSITION (set exits 4, bulk row FAILED, exit 1)", () => {
    const task = createTask("Already archived");
    addAttestedPass(task);
    expect(bulkJson(["archive", task, "--apply", "--reason", "done with it"], tmpDir).exitCode).toBe(0);
    expect(runLore(["set", task, "--status", "deprecated"], tmpDir).exitCode).toBe(4);
    const bulk = bulkJson(["deprecate", task, "--apply", "--reason", "too late"], tmpDir);
    expect(bulk.exitCode).toBe(1);
    expect(bulk.rows[0]?.outcome).toBe("FAILED");
    expect(bulk.rows[0]?.code).toBe("INVALID_TRANSITION");
    expect(statusOf(task, tmpDir)).toBe("archived");
  });
});

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}
const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join("\n");

describe("bulk lifecycle: mcp parity", () => {
  let app: App | undefined;
  let client: Client | undefined;
  const RUN = "cc:session-bulk-parity-run";

  async function openMcp(): Promise<Client> {
    const dbPath = join(tmpDir, ".lore", "lore.db");
    const store = actedStore(new SQLiteStore(dbPath)) as unknown as {
      insertRun: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
      close?: () => void;
    };
    try {
      const inserted = await store.insertRun({
        id: RUN,
        kind: "main",
        harness: "claude-code",
        sessionRef: RUN.replace(/^cc:/, ""),
        agentRef: null,
        agentType: null,
        parentRunId: null,
        branch: "main",
        composition: { schemaVersion: 1, fragments: [{ id: "frag-1", sha256: "a".repeat(64) }] },
        registeredAt: "2026-10-08T00:00:00.000Z",
      });
      if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
    } finally {
      store.close?.();
    }
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    const server = new McpServer({ name: "lore", version: "0.0.0-test" });
    registerTools(server, app, undefined, liveInvocation());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);
    return client;
  }

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (client === undefined) throw new Error("mcp client not open");
    return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  }

  afterEach(async () => {
    await client?.close();
    app?.close();
    client = undefined;
    app = undefined;
  });

  /** Normalised view of rows: what must be identical between the CLI and MCP for equivalent fixtures. */
  const shape = (rows: BulkRow[]): unknown[] =>
    rows.map((r) => ({ type: r.type, status: r.status, target: r.target, outcome: r.outcome, from: r.from_status, to: r.to_status, code: r.code, rule: r.rule, reason: r.slug === undefined ? r.reason : r.reason?.split(r.slug).join("<slug>") }));

  it("mcp parity: tools are listed, and lore_bulk previews and applies the same rows as the CLI", async () => {
    const setA = [createTask("Parity A1"), createTask("Parity A2")];
    const setB = [createTask("Parity B1"), createTask("Parity B2")];
    for (const slug of [...setA, ...setB]) addAttestedPass(slug);
    const cliPreview = bulkJson(["archive", ...setA], tmpDir);
    expect(cliPreview.exitCode).toBe(3);

    const mcp = await openMcp();
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    for (const name of ["lore_bulk", "lore_done", "lore_reject"]) expect(names).toContain(name);

    // Same corpus, same selector: same rows (preview is read-only on both sides).
    const mcpPreview = JSON.parse(textOf(await call("lore_bulk", { verb: "archive", ids: setA, harness_run: RUN }))) as {
      mode: string;
      rows: BulkRow[];
    };
    expect(mcpPreview.mode).toBe("preview");
    expect(mcpPreview.rows).toEqual(cliPreview.rows);
    const mcpWhere = JSON.parse(textOf(await call("lore_bulk", { verb: "archive", where: "type=task,status=draft", harness_run: RUN }))) as {
      rows: BulkRow[];
    };
    expect(mcpWhere.rows.map((r) => r.slug).sort()).toEqual([...setA, ...setB].sort());

    // Selector errors and a missing reason are refused, writing nothing.
    const both = await call("lore_bulk", { verb: "archive", ids: setA, where: "type=task", harness_run: RUN });
    expect(both.isError).toBe(true);
    const noReason = await call("lore_bulk", { verb: "archive", ids: setB, apply: true, harness_run: RUN });
    expect(noReason.isError).toBe(true);
    expect(textOf(noReason)).toContain("reason");
    expect(statusOf(setB[0] as string, tmpDir)).toBe("draft");

    // Apply: MCP on set B, the CLI on set A (equivalent fixtures): same per-row result shape.
    const mcpApply = JSON.parse(
      textOf(await call("lore_bulk", { verb: "archive", ids: setB, apply: true, reason: "parity", harness_run: RUN })),
    ) as { mode: string; rows: BulkRow[] };
    const cliApply = bulkJson(["archive", ...setA, "--apply", "--reason", "parity"], tmpDir);
    expect(mcpApply.mode).toBe("apply");
    expect(shape(mcpApply.rows)).toEqual(shape(cliApply.rows));
    expect(mcpApply.rows.map((r) => r.outcome)).toEqual(["OK", "OK"]);
    expect(setB.map((s) => statusOf(s, tmpDir))).toEqual(["archived", "archived"]);
  });

  it("mcp parity: lore_done enforces the same floor as the CLI and lore_reject records its reason", async () => {
    const withEvidence = createTask("Done via MCP");
    const without = createTask("Refused via MCP");
    const toReject = createTask("Rejected via MCP");
    addAttestedPass(withEvidence);

    const mcp = await openMcp();
    expect(mcp).toBeDefined();
    const done = await call("lore_done", { id_or_slug: withEvidence, harness_run: RUN });
    expect(done.isError).not.toBe(true);
    expect(statusOf(withEvidence, tmpDir)).toBe("archived");

    const refused = await call("lore_done", { id_or_slug: without, harness_run: RUN });
    expect(refused.isError).toBe(true);
    const refusal = JSON.parse(textOf(refused)) as { code: string; rule: string };
    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.rule).toBe("BR-1292");
    expect(statusOf(without, tmpDir)).toBe("draft");
    // The CLI refuses the same task for the same rule.
    const cliRefusal = runLore(["done", without], tmpDir);
    expect(cliRefusal.exitCode).toBe(4);
    expect(cliRefusal.stderr).toContain("[floor: attested-pass]");

    const rejected = await call("lore_reject", { id_or_slug: toReject, reason: "wrong approach", harness_run: RUN });
    expect(rejected.isError).not.toBe(true);
    expect(runLore(["audit", toReject, "--json"], tmpDir).stdout).toContain("wrong approach");
    const unknown = await call("lore_reject", { id_or_slug: "task-no-such-doc", harness_run: RUN });
    expect(unknown.isError).toBe(true);
  });

  it("mcp parity: lore archive --apply exits 1 when a candidate failed (INVALID_TRANSITION), 0 when none did", () => {
    patchLoreConfig(tmpDir, 'workflow:\n  gates:\n    "plan-close":\n      enabled: false\n');
    expect(runLore(["set", planSlug, "--status", "approved"], tmpDir).exitCode).toBe(0);
    // An open task under an archived plan is an R4 candidate; in-review -> archived is not a legal step. BR-1379 no
    // longer lets the write path create it under an archived plan, so the plan is archived directly afterwards.
    const straggler = createTask("Straggler in review");
    addAttestedPass(straggler);
    expect(runLore(["set", straggler, "--status", "in-review"], tmpDir).exitCode).toBe(0);
    archivePlanWithoutCascade(tmpDir, planSlug);
    expect(runLore(["archive", "--sweep"], tmpDir).exitCode).toBe(3);

    const apply = runLore(["archive", "--apply"], tmpDir);
    expect(apply.exitCode).toBe(1);
    expect(apply.stdout).toContain("FAILED");
    expect(apply.stdout).toContain(straggler);
    expect(statusOf(straggler, tmpDir)).toBe("in-review");

    // Control: a corpus whose candidates all succeed still exits 0.
    expect(runLore(["set", straggler, "--status", "draft"], tmpDir).exitCode).toBe(0);
    const ok = runLore(["archive", "--apply"], tmpDir);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("OK");
  });
});
