/**
 * @spec_ref AC-RID-9
 * @task task-skill-test-red-attested-claimed-rendering-and-status (RED; paired impl =
 *       task-skill-implement-get-log-attested-claimed-rendering)
 * Spec: spec-run-identity-slice-1-harness-attested-runs-attested (D4, D9, D11; BR-1037)
 *
 * `lore get` (document view) and `lore log` (version history), in text and in --json, show for the SAME
 * write `attested: <run | unattested>` and `claimed: <name> (<source>)`, identically on both surfaces.
 * A version written before migration 016 shows `attested: unattested` with its stored name.
 * CorpusService writes no literal "system" author for create / set / delete.
 *
 * ── Seed (directly through the store in a mkdtemp corpus; the CLI cannot yet produce attested writes) ─
 *   doc W  : v1 create attested cc:attr-run-1, claimed agent:alice (flag)
 *            v2 update attested cc:attr-run-2, claimed agent:bob   (env)     <- latest write
 *   doc L  : v1 written by the BARE store (no harness_run, exactly a pre-016 row), author agent:legacy-writer
 *   doc U  : v1 written with an identity that has no run (harnessRun null), claimed agent:carol (os)
 * Attested rows go through fixtures/run-seeder.ts (pinned `withWriteContext` decorator when present, else raw
 * `harness_run` stamping); author fields are
 * set to the claimed name, as D4 states ("claimed lands in the existing author fields").
 *
 * ── JSON shape is NOT pinned by the spec; these tests deliberately assert only what it states ──
 * (the run id / the word "unattested" and the claimed name appear on the write's own JSON record, on both
 * surfaces), not key names.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { RunSeeder } from "./fixtures/run-seeder.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}
const SESSION_ACTOR_PREFIX = "agent:session-";
/**
 * BR-1055: LORE_ACTOR is ignored, so a writer is named through the session tier. `actor` is the
 * `agent:session-<id8>` name wanted; the matching session id is injected. `null` = no identity at all.
 */
function lore(args: string[], cwd: string, actor: string | null = "agent:session-4e17de01"): Run {
  const env: Record<string, string | undefined> = { ...process.env, HOME: cwd, CLAUDECODE: "1" };
  delete env.LORE_ACTOR;
  delete env.CLAUDE_SESSION_ID;
  if (actor === null) delete env.CLAUDE_CODE_SESSION_ID;
  else {
    if (!actor.startsWith(SESSION_ACTOR_PREFIX)) throw new Error(`fixture actor must be ${SESSION_ACTOR_PREFIX}<id8>: ${actor}`);
    env.CLAUDE_CODE_SESSION_ID = `${actor.slice(SESSION_ACTOR_PREFIX.length)}-aaaa-bbbb-cccc`;
  }
  const p = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env: env as Record<string, string> });
  return { stdout: p.stdout.toString(), stderr: p.stderr.toString(), exitCode: p.exitCode ?? 1 };
}
function mustLore(args: string[], cwd: string, actor: string | null = "agent:session-4e17de01"): Run {
  const r = lore(args, cwd, actor);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

const RUN_1 = "cc:attr-run-1";
const RUN_2 = "cc:attr-run-2";
const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-02T10:00:00.000Z";
const SLUG_W = "knowledge-attr-w";
const SLUG_L = "knowledge-attr-legacy";
const SLUG_U = "knowledge-attr-unattested";

function docRecord(id: string, slug: string, version: number, author: string, at: string): DocRecord {
  return {
    id,
    slug,
    type: "knowledge",
    role: "knowledge",
    title: `Title ${slug}`,
    status: "draft",
    priority: "medium",
    content: `content of ${slug} v${version}`,
    parent_id: null,
    extra: { sub_type: "reference" },
    tags: [],
    version,
    created_at: T1,
    updated_at: at,
    created_by: author,
    deleted_at: null,
    ordinal: null,
  } as unknown as DocRecord;
}
function versionRecord(id: string, slug: string, n: number, action: string, author: string, at: string): VersionRecord {
  return {
    doc_id: id,
    version: n,
    content: `content of ${slug} v${n}`,
    extra: { sub_type: "reference" },
    status: "draft",
    title: `Title ${slug}`,
    action,
    created_at: at,
    created_by: author,
    slug,
  } as unknown as VersionRecord;
}
function auditRecord(id: string, action: string, author: string, at: string): AuditEntry {
  return { timestamp: at, actor: author, session_id: "s-seed", action, doc_id: id, details: { type: "knowledge", surface: "agent" } } as AuditEntry;
}
async function must<T extends { ok: boolean }>(p: Promise<T>, what: string): Promise<void> {
  const r = await p;
  if (!r.ok) throw new Error(`seed ${what} failed: ${JSON.stringify((r as unknown as { error: unknown }).error)}`);
}

async function writeVersion(
  store: StoreInterface,
  id: string,
  slug: string,
  n: number,
  action: "create" | "update",
  author: string,
  at: string,
): Promise<void> {
  await must(store.insertVersion(versionRecord(id, slug, n, action, author, at)), `version ${slug} v${n}`);
  await must(store.appendAuditEntry(auditRecord(id, action === "create" ? "create" : "update", author, at)), `audit ${slug} v${n}`);
}

const scratch: string[] = [];
let dir = "";

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "attr-render-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(dir);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  mustLore(["init"], dir);

  const seeder = await RunSeeder.open(join(dir, ".lore", "lore.db"));
  const store = seeder.store;
  try {
    const idW = "01HATTRW000000000000000001";
    const idL = "01HATTRL000000000000000001";
    const idU = "01HATTRU000000000000000001";
    // W: two attested versions by two different runs/names
    await must(store.insert(docRecord(idW, SLUG_W, 2, "agent:alice", T2)), "doc W");
    await writeVersion(seeder.as({ harnessRun: RUN_1, claimed: "agent:alice", claimedSource: "flag" }), idW, SLUG_W, 1, "create", "agent:alice", T1);
    await writeVersion(seeder.as({ harnessRun: RUN_2, claimed: "agent:bob", claimedSource: "env" }), idW, SLUG_W, 2, "update", "agent:bob", T2);
    // L: bare store = no harness_run, the same row shape migration 016 leaves on pre-existing rows
    await must(store.insert(docRecord(idL, SLUG_L, 1, "agent:legacy-writer", T1)), "doc L");
    await writeVersion(seeder.as(null), idL, SLUG_L, 1, "create", "agent:legacy-writer", T1);
    // U: identity with NO run
    await must(store.insert(docRecord(idU, SLUG_U, 1, "agent:carol", T1)), "doc U");
    await writeVersion(seeder.as({ harnessRun: null, claimed: "agent:carol", claimedSource: "os" }), idU, SLUG_U, 1, "create", "agent:carol", T1);
  } finally {
    seeder.finish();
  }
});
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function attestedLabel(text: string): string | undefined {
  return text.match(/attested:\s*(\S+)/)?.[1];
}
function claimedLabel(text: string): string | undefined {
  return text.match(/claimed:\s*(\S+(?: \([a-z]+\))?)/)?.[1];
}
interface LogEntry {
  version: number;
  [k: string]: unknown;
}
function logEntries(slug: string): LogEntry[] {
  const r = mustLore(["log", slug, "--json"], dir);
  return (JSON.parse(r.stdout) as { data: { entries: LogEntry[] } }).data.entries;
}
function logRow(slug: string, v: number): string {
  const r = mustLore(["log", slug], dir);
  const row = r.stdout.split("\n").find((l) => new RegExp(`^\\s*v${v}\\b`).test(l));
  if (!row) throw new Error(`no v${v} row in log text:\n${r.stdout}`);
  return row;
}

describe("AC-RID-9 lore get / lore log render attested and claimed (BR-1037, D9, D11)", () => {
  it("HAPPY: lore get text shows the latest write's run and claimed name with source", () => {
    const out = mustLore(["get", SLUG_W], dir).stdout;
    expect(out).toContain(`attested: ${RUN_2}`);
    expect(out).toContain("claimed: agent:bob (env)");
  });

  it("HAPPY: lore log text shows each version's own run and claimed name with source", () => {
    expect(logRow(SLUG_W, 2)).toContain(`attested: ${RUN_2}`);
    expect(logRow(SLUG_W, 2)).toContain("claimed: agent:bob (env)");
    expect(logRow(SLUG_W, 1)).toContain(`attested: ${RUN_1}`);
    expect(logRow(SLUG_W, 1)).toContain("claimed: agent:alice (flag)");
  });

  it("STATE: the same write reads identically on get and log in text (labels extracted from both)", () => {
    const get = mustLore(["get", SLUG_W], dir).stdout;
    const row = logRow(SLUG_W, 2);
    expect(attestedLabel(get)).toBe(RUN_2);
    expect(attestedLabel(row)).toBe(attestedLabel(get));
    expect(claimedLabel(row)).toBe("agent:bob (env)");
    expect(claimedLabel(row)).toBe(claimedLabel(get));
  });

  it("HAPPY: lore log --json carries run and name on each version's own record", () => {
    const entries = logEntries(SLUG_W);
    const v2 = JSON.stringify(entries.find((e) => e.version === 2));
    const v1 = JSON.stringify(entries.find((e) => e.version === 1));
    expect(v2).toContain(RUN_2);
    expect(v2).toContain("agent:bob");
    expect(v2).not.toContain(RUN_1);
    expect(v1).toContain(RUN_1);
    expect(v1).toContain("agent:alice");
  });

  it("HAPPY: lore get --json carries the latest write's run and claimed name", () => {
    const out = mustLore(["get", SLUG_W, "--json"], dir).stdout;
    expect(out).toContain(RUN_2);
    expect(out).toContain("agent:bob");
  });

  it("STATE: get --json and log --json agree on the run recorded for the latest write", () => {
    const getJson = mustLore(["get", SLUG_W, "--json"], dir).stdout;
    const v2 = JSON.stringify(logEntries(SLUG_W).find((e) => e.version === 2));
    // Both surfaces name the same run and the same claimed name for the same write.
    expect(getJson.includes(RUN_2) && v2.includes(RUN_2)).toBe(true);
    expect(getJson.includes("agent:bob") && v2.includes("agent:bob")).toBe(true);
  });

  it("NEGATIVE: a write with no run shows 'attested: unattested', never a run id, and keeps its claimed name", () => {
    const get = mustLore(["get", SLUG_U], dir).stdout;
    expect(attestedLabel(get)).toBe("unattested");
    expect(claimedLabel(get)).toBe("agent:carol (os)");
    const row = logRow(SLUG_U, 1);
    expect(attestedLabel(row)).toBe("unattested");
    expect(claimedLabel(row)).toBe("agent:carol (os)");
  });

  it("REGRESSION: a version from before migration 016 shows attested unattested with its stored name (get text)", () => {
    const get = mustLore(["get", SLUG_L], dir).stdout;
    expect(attestedLabel(get)).toBe("unattested");
    expect(get).toContain("claimed: agent:legacy-writer");
  });

  it("REGRESSION: the pre-016 version reads the same on log text and log --json", () => {
    const row = logRow(SLUG_L, 1);
    expect(attestedLabel(row)).toBe("unattested");
    expect(row).toContain("claimed: agent:legacy-writer");
    const rec = JSON.stringify(logEntries(SLUG_L).find((e) => e.version === 1));
    expect(rec).toContain("unattested");
    expect(rec).toContain("agent:legacy-writer");
  });

  it("REGRESSION: get --json for the pre-016 doc says unattested, not a run id", () => {
    const out = mustLore(["get", SLUG_L, "--json"], dir).stdout;
    expect(out).toContain("unattested");
    expect(out).toContain("agent:legacy-writer");
    expect(out).not.toContain("cc:");
  });
});

describe("AC-RID-9 CorpusService writes no literal 'system' author (D4)", () => {
  function versionAuthors(cwd: string, slug: string): { action: string; created_by: string }[] {
    const db = new Database(join(cwd, ".lore", "lore.db"), { readonly: true });
    try {
      return db
        .query("SELECT v.action AS action, v.created_by AS created_by FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version")
        .all(slug) as { action: string; created_by: string }[];
    } finally {
      db.close();
    }
  }

  function lifecycle(cwd: string, actor: string | null, slug: string, title: string): void {
    mustLore(["create", "knowledge", "--title", title, "--sub-type", "reference", "--no-ai", "--content", "first body"], cwd, actor);
    mustLore(["set", slug, "--content", "second body"], cwd, actor);
    mustLore(["delete", slug, "--confirm"], cwd, actor);
  }

  let cwd = "";
  beforeAll(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), "attr-system-")));
    scratch.push(cwd);
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd });
    mustLore(["init"], cwd);
  });

  it("HAPPY: create, set and delete under session actor creator-x record that name on every version, never 'system'", () => {
    lifecycle(cwd, "agent:session-c0ea7e01", "knowledge-sys-one", "Sys One");
    const rows = versionAuthors(cwd, "knowledge-sys-one");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.created_by)).toEqual(rows.map(() => "agent:session-c0ea7e01"));
  });

  it("HAPPY: a different actor is recorded as that actor (not a constant)", () => {
    lifecycle(cwd, "agent:session-c0ea7e02", "knowledge-sys-two", "Sys Two");
    const rows = versionAuthors(cwd, "knowledge-sys-two");
    expect(rows.map((r) => r.created_by)).toEqual(rows.map(() => "agent:session-c0ea7e02"));
  });

  it("NEGATIVE: with no session id and no --by, the author is the resolved fallback name, never the literal 'system'", () => {
    mustLore(["create", "knowledge", "--title", "Sys Three", "--sub-type", "reference", "--no-ai", "--content", "body"], cwd, null);
    const rows = versionAuthors(cwd, "knowledge-sys-three");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.created_by).not.toBe("system");
      expect(r.created_by.trim().length).toBeGreaterThan(0);
    }
  });

  it("REGRESSION: lore get on a freshly created doc no longer says 'by system'", () => {
    mustLore(["create", "knowledge", "--title", "Sys Four", "--sub-type", "reference", "--no-ai", "--content", "body"], cwd, "agent:session-c0ea7e03");
    const out = mustLore(["get", "knowledge-sys-four"], cwd, "agent:session-c0ea7e03").stdout;
    expect(out).not.toMatch(/by system\b/);
    expect(out).toContain("agent:session-c0ea7e03");
  });
});
