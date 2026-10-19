// @spawns packages/lore/src/index.ts
/**
 * `lore migrate plan-outline-exempt` — preview / --apply (BL-D2, BR-250).
 *
 * A throwaway corpus (`mkdtemp` + `lore init`) holds one plan carrying the legacy `extra.prd_sync_exempt` and one
 * plain plan. Preview lists exactly the carrier and writes nothing (exit 0); `--apply` removes the key (exit 0);
 * a second `--apply` clears nothing (exit 0); `lore status` no longer prints an "Exempt plans" section; an unknown
 * migration action still exits 2. The repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (apply), NEGATIVE (unknown action exit 2), BOUNDARY (preview writes nothing),
 * STATE (other extra keys kept), REGRESSION (idempotent second apply, status listing gone).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:migrate-plan-outline-exempt-test";
const LEGACY = { reason: "legacy", by: "agent:old", at: "2026-07-26T00:00:00.000Z" };

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

async function extraOf(slug: string): Promise<Record<string, unknown>> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    const doc = await store.findBySlug(slug);
    if (!doc.ok || doc.value === null) throw new Error(`no doc ${slug}`);
    return doc.value.extra;
  } finally {
    store.close();
  }
}

async function seedLegacyExemption(slug: string): Promise<void> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    const doc = await store.findBySlug(slug);
    if (!doc.ok || doc.value === null) throw new Error(`no doc ${slug}`);
    const r = await store.update(doc.value.id, { extra: { ...doc.value.extra, prd_sync_exempt: LEGACY, keep_me: true } });
    if (!r.ok) throw new Error("legacy exemption seed failed");
  } finally {
    store.close();
  }
}

let dir = "";
let carrier = "";
let plain = "";

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "planexempt-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "pe@example.invalid"]);
  git(["config", "user.name", "plan exempt"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  carrier = slugOf(mustRun(["create", "plan", "--title", "Carrier Plan", "--content", "body", "--no-ai"]).stdout);
  plain = slugOf(mustRun(["create", "plan", "--title", "Plain Plan", "--content", "body", "--no-ai"]).stdout);
  await seedLegacyExemption(carrier);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("lore migrate plan-outline-exempt (BL-D2, BR-250)", () => {
  it("BOUNDARY: preview lists exactly the carrier at exit 0 and writes nothing", async () => {
    const r = runLore(["migrate", "plan-outline-exempt", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; data: { applied: boolean; count: number; slugs: string[] } };
    expect(out.data).toMatchObject({ applied: false, count: 1, slugs: [carrier] });
    expect((await extraOf(carrier))["prd_sync_exempt"]).toEqual(LEGACY);
    expect(plain).not.toBe(carrier);
  });

  it("HAPPY+STATE: --apply removes the key at exit 0 and keeps the plan's other extra keys", async () => {
    const r = runLore(["migrate", "plan-outline-exempt", "--apply", "--json"]);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { applied: boolean; count: number } }).data).toMatchObject({ applied: true, count: 1 });
    const extra = await extraOf(carrier);
    expect("prd_sync_exempt" in extra).toBe(false);
    expect(extra["keep_me"]).toBe(true);
  });

  it("REGRESSION: a second --apply clears nothing, and `lore status` prints no Exempt plans section", () => {
    const r = runLore(["migrate", "plan-outline-exempt", "--apply", "--json"]);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { count: number } }).data.count).toBe(0);
    expect(runLore(["status"]).stdout).not.toContain("Exempt plans");
  });

  it("NEGATIVE: an unknown migration action exits 2 naming the supported list", () => {
    const r = runLore(["migrate", "no-such-action"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("plan-outline-exempt");
  });
});
