// @spawns packages/lore/src/index.ts
/**
 * `lore migrate spec-parents` — preview / --apply / --revert (BR-1009, BR-798, BR-801; AC-BLS3B-7).
 *
 * A throwaway corpus (`mkdtemp` + `lore init`) holds a PRD and three parented specs, one of them approved.
 * The migration clears every spec `parent_id`, writing exactly one audit entry per spec that names the old
 * parent — no version row, no status change. Preview writes nothing; a second apply writes nothing; revert
 * restores every parent from those entries.
 *
 * Dimensions: HAPPY (apply/revert), NEGATIVE (unknown action exit 2), BOUNDARY (preview writes nothing),
 * STATE (approved stays approved), REGRESSION (idempotent second apply / second revert).
 * The repo's own `.lore/` is never touched.
 *
 * @spec_ref AC-BLS3B-7
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:migrate-spec-parents-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface DocState {
  readonly parent_id: string | null;
  readonly status: string;
  readonly version: number;
  readonly versionRows: number;
  readonly migrateAudits: number;
  readonly revertAudits: number;
  readonly oldParents: string[];
}

/** Reads one spec's observable state straight from the throwaway DB (opened and closed per call). */
async function stateOf(slug: string): Promise<DocState> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const doc = await store.findBySlug(slug);
    if (!doc.ok || doc.value === null) throw new Error(`no doc ${slug}`);
    const versions = await store.findVersions(doc.value.id);
    const audit = await store.queryAudit({ doc_id: doc.value.id });
    if (!versions.ok || !audit.ok) throw new Error("store read failed");
    const migrate = audit.value.filter((e) => e.action === "migrate_spec_parent");
    return {
      parent_id: doc.value.parent_id,
      status: doc.value.status,
      version: doc.value.version,
      versionRows: versions.value.length,
      migrateAudits: migrate.length,
      revertAudits: audit.value.filter((e) => e.action === "revert_spec_parent").length,
      oldParents: migrate.map((e) => String((e.details as { old_parent_id?: unknown }).old_parent_id)),
    };
  } finally {
    store.close();
  }
}

/**
 * A spec cannot be created with a parent any more (BR-2), so the LEGACY state this migration clears is seeded
 * straight through the store: write `parent_id` on an already-created, parentless spec.
 */
async function forceLegacyParent(slug: string, parentSlug: string): Promise<void> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const doc = await store.findBySlug(slug);
    const parent = await store.findBySlug(parentSlug);
    if (!doc.ok || doc.value === null || !parent.ok || parent.value === null) throw new Error(`no doc ${slug} / ${parentSlug}`);
    const r = await store.update(doc.value.id, { parent_id: parent.value.id });
    if (!r.ok) throw new Error("legacy parent seed failed");
  } finally {
    store.close();
  }
}

async function forceApproved(slug: string): Promise<void> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const doc = await store.findBySlug(slug);
    if (!doc.ok || doc.value === null) throw new Error(`no doc ${slug}`);
    const r = await store.update(doc.value.id, { status: "approved" });
    if (!r.ok) throw new Error("status seed failed");
  } finally {
    store.close();
  }
}

const SKELETON = "## Overview\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx\n";

let dir = "";
let prdSlug = "";
let prdId = "";
const specs: string[] = [];

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "specparents-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "sp@example.invalid"]);
  git(["config", "user.name", "spec parents"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  prdSlug = slugOf(mustRun(["create", "prd", "--title", "Parents PRD", "--content", "root", "--no-ai"]).stdout);
  for (const title of ["Spec Alpha", "Spec Beta", "Spec Gamma"]) {
    const slug = slugOf(mustRun(["create", "spec", "--title", title, "--content", SKELETON, "--no-ai"]).stdout);
    await forceLegacyParent(slug, prdSlug);
    specs.push(slug);
  }
  await forceApproved(specs[0] as string);
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const prd = await store.findBySlug(prdSlug);
    if (!prd.ok || prd.value === null) throw new Error("prd missing");
    prdId = prd.value.id;
  } finally {
    store.close();
  }
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("lore migrate spec-parents (AC-BLS3B-7, BR-1009)", () => {
  let before: DocState[] = [];

  it("BOUNDARY: preview lists N parented specs and writes nothing", async () => {
    before = await Promise.all(specs.map(stateOf));
    expect(before.every((s) => s.parent_id === prdId)).toBe(true);
    const r = runLore(["migrate", "spec-parents", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; data: { applied: boolean; count: number; slugs: string[] } };
    expect(out.data.applied).toBe(false);
    expect(out.data.count).toBe(3);
    expect([...out.data.slugs].sort()).toEqual([...specs].sort());
    expect(await Promise.all(specs.map(stateOf))).toEqual(before);
    const text = runLore(["migrate", "spec-parents"]);
    expect(text.stdout).toContain("3");
    for (const s of specs) expect(text.stdout).toContain(s);
  });

  it("HAPPY+STATE: --apply clears every parent, one audit entry each naming the old parent, no version row, no status change", async () => {
    const r = runLore(["migrate", "spec-parents", "--apply", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { data: { applied: boolean; count: number } };
    expect(out.data.applied).toBe(true);
    expect(out.data.count).toBe(3);
    const after = await Promise.all(specs.map(stateOf));
    after.forEach((s, i) => {
      const b = before[i] as DocState;
      expect(s.parent_id).toBeNull();
      expect(s.migrateAudits).toBe(1);
      expect(s.oldParents).toEqual([prdId]);
      expect(s.versionRows).toBe(b.versionRows);
      expect(s.version).toBe(b.version);
      expect(s.status).toBe(b.status);
    });
    expect(after[0]?.status).toBe("approved");
  });

  it("REGRESSION: a second --apply writes nothing", async () => {
    const mid = await Promise.all(specs.map(stateOf));
    const r = runLore(["migrate", "spec-parents", "--apply", "--json"]);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { count: number } }).data.count).toBe(0);
    expect(await Promise.all(specs.map(stateOf))).toEqual(mid);
  });

  it("HAPPY: --revert restores every parent_id from the audit entries; a second --revert writes nothing", async () => {
    const r = runLore(["migrate", "spec-parents", "--revert", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { data: { reverted: boolean; count: number } };
    expect(out.data.reverted).toBe(true);
    expect(out.data.count).toBe(3);
    const restored = await Promise.all(specs.map(stateOf));
    for (const s of restored) {
      expect(s.parent_id).toBe(prdId);
      expect(s.revertAudits).toBe(1);
    }
    expect(restored[0]?.status).toBe("approved");
    const again = runLore(["migrate", "spec-parents", "--revert", "--json"]);
    expect((JSON.parse(again.stdout) as { data: { count: number } }).data.count).toBe(0);
    expect(await Promise.all(specs.map(stateOf))).toEqual(restored);
  });

  it("NEGATIVE: an unknown action exits 2 and lists spec-parents among the supported actions", () => {
    const r = runLore(["migrate", "no-such-action"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("spec-parents");
  });

  it("NEGATIVE: --apply together with --revert is a usage error (exit 2)", () => {
    const r = runLore(["migrate", "spec-parents", "--apply", "--revert"]);
    expect(r.exitCode).toBe(2);
  });
});
