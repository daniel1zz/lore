// @spawns packages/lore/src/index.ts
/**
 * spec-defect-clusters-round-2-part-a-sessions-seats-setup-init#AC-DC2-6 (D6; reports #70 #83 #86 #295;
 * BR-290, BR-740, BR-741) — a soft-deleted document is not addressable by any verb, deletion writes a real
 * version N+1, and `lore undelete` reverses it inside the recovery window.
 *
 * Root cause under test: `resolveDoc` returned deleted docs on every branch, so approve / reject / set /
 * invalidate / link / `baseline set-label` acted on them; delete wrote a version-0 sentinel; nothing cleared
 * `deleted_at`.
 *
 * One throwaway repo + corpus (mkdtemp, HOME in the temp dir; never the repo's own `.lore/`). Every verb is
 * addressed BY SLUG on a DRAFT doc, and a second doc that was approved BEFORE its delete proves the refusal is
 * the deletion, not an INVALID_TRANSITION (the green-but-broken case).
 *
 * Dimensions: HAPPY (undelete restores, then approve works), NEGATIVE (every verb exit 3 naming `deleted` and
 * `lore undelete`; undelete of a live doc), BOUNDARY (the recovery window's last instant vs one ms after),
 * ERROR (undelete after the window exits 4), STATE (audit count and docs unchanged by refused verbs; versions
 * 1,2,3 with no 0), REGRESSION (history verbs `log`/`audit` still read a deleted doc; list hides it).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createApp } from "../../src/app.js";
import { exitCode } from "../../src/adapters/cli/utils.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";
import { computeRecoverableUntil } from "../../src/service/soft-delete-window.js";
import { liveAmbient, liveInvocation, liveWriteContext, LIVE_TEST_RUN } from "../live-invocation.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const AC = "spec-defect-clusters-round-2-part-a-sessions-seats-setup-init#AC-DC2-6";
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";
let dbPath = "";
let draftSlug = "";
let approvedSlug = "";
let liveSlug = "";
let leafSlug = "";
let auditCountAfterDelete = 0;

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, "xdg"), CLAUDECODE: "1", LORE_ACTOR: "agent:dc2-6" };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function newKnowledge(title: string): string {
  return slugOf(mustRun(["create", "knowledge", "--sub-type", "reference", "--title", title, "--content", "body", "--no-ai"]).stdout);
}

interface LogEntry {
  readonly version: number;
  readonly action: string;
}

function logOf(slug: string): LogEntry[] {
  const parsed = JSON.parse(mustRun(["log", slug, "--json"]).stdout) as { data: { entries: LogEntry[] } };
  return parsed.data.entries;
}

function auditCount(slug: string): number {
  const parsed = JSON.parse(mustRun(["audit", slug, "--json"]).stdout) as { data: { total: number } };
  return parsed.data.total;
}

function expectDeletedRefusal(r: RunResult): void {
  expect(r.exitCode).toBe(3);
  expect(r.stderr).toContain("deleted");
  expect(r.stderr).toContain("lore undelete");
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "dc2-6-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  mustRun(["init"]);
  dbPath = join(dir, ".lore", "lore.db");

  draftSlug = newKnowledge("DC2-6 draft doc");
  approvedSlug = newKnowledge("DC2-6 approved doc");
  liveSlug = newKnowledge("DC2-6 live doc");
  mustRun(["approve", approvedSlug]);

  const prd = slugOf(mustRun(["create", "prd", "--title", "DC2-6 PRD", "--content", "root", "--no-ai"]).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "DC2-6 Root"]).stdout);
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "DC2-6 Branch"]).stdout);
  leafSlug = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "DC2-6 Leaf"]).stdout);

  mustRun(["delete", draftSlug, "--confirm"]);
  mustRun(["delete", approvedSlug, "--confirm"]);
  mustRun(["delete", leafSlug, "--confirm"]);
  auditCountAfterDelete = auditCount(draftSlug);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("AC-DC2-6 a deleted document is not addressable", () => {
  const verbs: ReadonlyArray<readonly [string, () => string[]]> = [
    ["approve", () => ["approve", draftSlug]],
    ["reject", () => ["reject", draftSlug]],
    ["set", () => ["set", draftSlug, "--title", "x"]],
    ["invalidate", () => ["invalidate", draftSlug, "--reason", "no longer true"]],
    ["link (deleted as target)", () => ["link", liveSlug, draftSlug, "--type", "relates-to"]],
    ["link (deleted as source)", () => ["link", draftSlug, liveSlug, "--type", "relates-to"]],
    ["get", () => ["get", draftSlug]],
    ["baseline set-label (rule-service route)", () => ["baseline", "set-label", leafSlug, "Y"]],
    ["delete again", () => ["delete", draftSlug, "--confirm"]],
  ];

  it.each(verbs)(`${AC}: \`lore %s\` by slug exits 3 naming the deletion and lore undelete`, (_name, args) => {
    expectDeletedRefusal(runLore(args()));
  });

  it(`${AC}: approve of a doc that was APPROVED before its delete is refused for the deletion, not as a transition`, () => {
    const r = runLore(["approve", approvedSlug]);
    expectDeletedRefusal(r);
    expect(r.stderr).not.toContain("INVALID_TRANSITION");
  });

  it(`${AC}: the full id resolves no further than the slug does`, () => {
    const parsed = JSON.parse(mustRun(["audit", draftSlug, "--json"]).stdout) as { data: { entries: { doc_id: string }[] } };
    const id = parsed.data.entries[0]?.doc_id;
    if (id === undefined) throw new Error("no audit entry for the deleted doc");
    expectDeletedRefusal(runLore(["approve", id]));
  });

  it(`${AC}: the refused calls wrote nothing (audit count unchanged, doc still deleted)`, () => {
    expect(auditCount(draftSlug)).toBe(auditCountAfterDelete);
    expect(logOf(draftSlug).map((e) => e.version)).toEqual([2, 1]);
  });

  it(`${AC}: delete wrote version N+1 with action delete and no version 0`, () => {
    const entries = logOf(draftSlug);
    expect(entries.find((e) => e.version === 2)?.action).toBe("delete");
    expect(entries.some((e) => e.version === 0)).toBe(false);
  });

  it(`${AC}: a deleted doc is hidden from lore list`, () => {
    expect(mustRun(["list", "--json"]).stdout).not.toContain(draftSlug);
  });
});

describe("AC-DC2-6 undelete", () => {
  it(`${AC}: undelete of a live doc is refused (exit 4) and writes nothing`, () => {
    const before = logOf(liveSlug).length;
    const r = runLore(["undelete", liveSlug]);
    expect(r.exitCode).toBe(4);
    expect(logOf(liveSlug).length).toBe(before);
  });

  it(`${AC}: undelete restores the doc, lists it, logs version 3 undelete, and approve then behaves as for any draft`, () => {
    const r = runLore(["undelete", draftSlug]);
    expect(r.exitCode).toBe(0);
    expect(mustRun(["list", "--json"]).stdout).toContain(draftSlug);
    const entries = logOf(draftSlug);
    expect(entries.find((e) => e.version === 3)?.action).toBe("undelete");
    expect(entries.map((e) => e.version)).toEqual([3, 2, 1]);
    const approved = runLore(["approve", draftSlug]);
    expect(approved.exitCode).toBe(0);
  });

  it(`${AC}: undelete restores a deleted baseline leaf, so set-label addresses it again`, () => {
    expect(runLore(["undelete", leafSlug]).exitCode).toBe(0);
    expect(runLore(["baseline", "set-label", leafSlug, "Y"]).exitCode).toBe(0);
  });

  it(`${AC}: undelete after recoverable_until exits 4 and leaves the doc deleted (CLI, backdated deleted_at)`, () => {
    const slug = newKnowledge("DC2-6 expired doc");
    mustRun(["delete", slug, "--confirm"]);
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE docs SET deleted_at = ? WHERE slug = ?").run("2020-01-01T00:00:00.000Z", slug);
    } finally {
      db.close();
    }
    const r = runLore(["undelete", slug]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("recovery window");
    expect(logOf(slug).map((e) => e.action)).toEqual(["delete", "create"]);
    expectDeletedRefusal(runLore(["get", slug]));
  });
});

describe("AC-DC2-6 recovery window boundary and the MCP route (in-process, clock seam)", () => {
  it(`${AC}: undelete succeeds at the window's last instant and fails one millisecond later`, async () => {
    const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    try {
      const make = async (title: string): Promise<string> => {
        const created = await app.corpusService.create({ type: "knowledge", title, content: "b", extra: { sub_type: "reference" } });
        if (!created.ok) throw new Error(JSON.stringify(created.error));
        const deleted = await app.corpusService.delete(created.value.slug, true);
        if (!deleted.ok) throw new Error(JSON.stringify(deleted.error));
        return created.value.slug;
      };
      const edge = await make("DC2-6 edge doc");
      const late = await make("DC2-6 late doc");
      const deletedAt = (id: string): string => {
        const db = new Database(dbPath, { readonly: true });
        try {
          return (db.prepare("SELECT deleted_at FROM docs WHERE slug = ?").get(id) as { deleted_at: string }).deleted_at;
        } finally {
          db.close();
        }
      };
      const until = (slug: string): number => Date.parse(computeRecoverableUntil(deletedAt(slug)));

      const ok = await app.corpusService.undelete(edge, { now: new Date(until(edge)).toISOString() });
      expect(ok.ok).toBe(true);

      const refused = await app.corpusService.undelete(late, { now: new Date(until(late) + 1).toISOString() });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(exitCode(refused.error)).toBe(4);
    } finally {
      app.close();
    }
  });

  it(`${AC}: over MCP, lore_get refuses a deleted doc naming lore undelete and lore_undelete restores it`, async () => {
    const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    try {
      const mcp = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(mcp, app, undefined, liveInvocation());
      const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: (a: Record<string, unknown>, e: unknown) => Promise<CallToolResult> }> })._registeredTools;
      const call = async (name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> => {
        const tool = tools[name];
        if (tool === undefined) throw new Error(`tool not registered: ${name}`);
        const res = await tool.handler({ harness_run: LIVE_TEST_RUN, ...args }, {});
        const first = res.content[0];
        if (first === undefined || first.type !== "text") throw new Error("expected text content");
        return { isError: res.isError === true, text: first.text };
      };
      const created = await app.corpusService.create({ type: "knowledge", title: "DC2-6 mcp doc", content: "b", extra: { sub_type: "reference" } });
      if (!created.ok) throw new Error(JSON.stringify(created.error));
      const slug = created.value.slug;
      expect((await call("lore_delete", { id_or_slug: slug, confirm: true })).isError).toBe(false);

      const refused = await call("lore_get", { id_or_slug: slug });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("lore undelete");

      expect((await call("lore_undelete", { id_or_slug: slug })).isError).toBe(false);
      expect((await call("lore_get", { id_or_slug: slug })).isError).toBe(false);
    } finally {
      app.close();
    }
  });
});
