// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/integration/cli/fixtures/frozen-clock.preload.ts
/**
 * @spec_ref AC-RID-11
 * @task task-skill-test-red-attested-claimed-rendering-and-status (RED; paired impl =
 *       task-skill-implement-get-log-attested-claimed-rendering)
 * Spec: spec-run-identity-slice-1-harness-attested-runs-attested (D3, D4, BR-1039)
 *
 * `lore status` reports how many claim / evidence / handoff writes in the 14 days ending now carry an
 * attested run: `--json` -> `data.harness_run_attribution { window_days, total, attested, share }`,
 * and the SAME numbers in text.
 *
 * ── Clock mechanism (stated, since status has no existing clock injection) ───────────────
 * `lore status` reads wall-clock time, and there is no env/flag injection point. The spawned process is
 * therefore started as `bun --preload fixtures/frozen-clock.preload.ts run <entry>` with
 * `LORE_TEST_FROZEN_NOW=<FROZEN_NOW>`: Date.now()/new Date() are pinned for that process only, so the
 * "exactly at the window start" write is hit to the millisecond whatever clock seam the impl uses.
 *
 * ── Seed (directly through the store in a mkdtemp corpus; the live .lore is never touched) ──
 * Inside the window [now-14d, now] (start instant INCLUDED):
 *   - 7 claim writes (audit action "claim"), one at exactly the window start,
 *   - 7 evidence writes (audit action "evidence"),
 *   - 6 handoff writes (a knowledge doc carrying extra.handoff; audit action "create", exactly how
 *     `lore handoff` writes them today), 5 attested + 1 UNATTESTED  (the only unattested one),
 * Outside / not counted:
 *   - 5 claim/evidence/handoff writes BEFORE the window start (one 1 ms before it; two unattested),
 *   - 4 attested ordinary document writes (create of a non-handoff doc) inside the window.
 * Attested rows are written through fixtures/run-seeder.ts (the pinned `withWriteContext` decorator when it
 * exists, else raw `harness_run` stamping); unattested through the bare store.
 * Expected: total 20, attested 19, share 0.95, window_days 14.
 * Hardcoded-return defence: other corpora with different mixes must report their own numbers.
 */

import { afterAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { RunSeeder } from "./fixtures/run-seeder.js";
import { registerTestRun } from "../../helpers/test-run-identity.js";

/** The agent run this suite's `lore` spawns write as. */
const TEST_RUN = "cc:status-share-test";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const PRELOAD = new URL("./fixtures/frozen-clock.preload.ts", import.meta.url).pathname;

const FROZEN_NOW = "2026-10-11T12:00:00.000Z";
const NOW_MS = new Date(FROZEN_NOW).getTime();
const DAY = 86_400_000;
const WINDOW_START_MS = NOW_MS - 14 * DAY;
const iso = (ms: number): string => new Date(ms).toISOString();

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}
function lore(args: string[], cwd: string, frozen = true): Run {
  const env: Record<string, string | undefined> = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:status-share-test" };
  if (frozen) env.LORE_TEST_FROZEN_NOW = FROZEN_NOW;
  // reason: every write needs a known party; this suite's writer is a registered agent run (the `init` that creates the corpus has none to register yet).
  registerTestRun(cwd, TEST_RUN);
  const argv = frozen ? ["bun", "run", "--preload", PRELOAD, ENTRY, "--harness-run", TEST_RUN, ...args] : ["bun", "run", ENTRY, "--harness-run", TEST_RUN, ...args];
  const p = Bun.spawnSync(argv, { cwd, env: env as Record<string, string> });
  return { stdout: p.stdout.toString(), stderr: p.stderr.toString(), exitCode: p.exitCode ?? 1 };
}

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function newCorpus(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "status-share-")));
  if (d.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(d);
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: d });
  const init = lore(["init"], d, false);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  return d;
}

let seq = 0;
function doc(type: string, slug: string, extra: Record<string, unknown>, atMs: number): DocRecord {
  seq += 1;
  return {
    id: `01HSHARE${String(seq).padStart(10, "0")}`,
    slug,
    type,
    role: type === "task" ? "plan" : type,
    title: `Title ${slug}`,
    status: "draft",
    priority: "medium",
    content: `content ${slug}`,
    parent_id: null,
    extra,
    tags: [],
    version: 1,
    created_at: iso(atMs),
    updated_at: iso(atMs),
    created_by: "agent:seed",
    deleted_at: null,
    ordinal: null,
  } as unknown as DocRecord;
}

function version(d: DocRecord, action: string, atMs: number): VersionRecord {
  return {
    doc_id: d.id,
    version: d.version,
    content: d.content,
    extra: d.extra,
    status: d.status,
    title: d.title,
    action,
    created_at: iso(atMs),
    created_by: "agent:seed",
  } as unknown as VersionRecord;
}

function audit(d: DocRecord, action: string, atMs: number, details: Record<string, unknown>): AuditEntry {
  return { timestamp: iso(atMs), actor: "agent:seed", session_id: "s-seed", action, doc_id: d.id, details: { surface: "agent", ...details } } as AuditEntry;
}

type Kind = "claim" | "evidence" | "handoff" | "document";
interface Spec {
  kind: Kind;
  atMs: number;
  run: string | null;
}

/** Write one logical write (doc + version + audit) through `store` (wrapped when attested). */
async function writeOne(store: StoreInterface, kind: Kind, atMs: number, tag: string): Promise<void> {
  let d: DocRecord;
  let action: string;
  let details: Record<string, unknown> = {};
  if (kind === "claim" || kind === "evidence") {
    d = doc("task", `task-${tag}`, {}, atMs);
    action = kind;
    details = { by: "agent:seed" };
  } else if (kind === "handoff") {
    d = doc("knowledge", `knowledge-handoff-${tag}`, { sub_type: "handoff", handoff: { by: "agent:seed" } }, atMs);
    action = "create";
    details = { type: "knowledge", slug: d.slug, version: 1 };
  } else {
    d = doc("knowledge", `knowledge-note-${tag}`, { sub_type: "reference" }, atMs);
    action = "create";
    details = { type: "knowledge", slug: d.slug, version: 1 };
  }
  const ins = await store.insert(d);
  if (!ins.ok) throw new Error(`seed insert failed: ${JSON.stringify(ins.error)}`);
  const v = await store.insertVersion(version(d, kind === "claim" || kind === "evidence" ? "update" : "create", atMs));
  if (!v.ok) throw new Error(`seed version failed: ${JSON.stringify(v.error)}`);
  const a = await store.appendAuditEntry(audit(d, action, atMs, details));
  if (!a.ok) throw new Error(`seed audit failed: ${JSON.stringify(a.error)}`);
}

async function seed(dir: string, specs: Spec[]): Promise<void> {
  const seeder = await RunSeeder.open(join(dir, ".lore", "lore.db"));
  try {
    let i = 0;
    for (const s of specs) {
      i += 1;
      const target = seeder.as(s.run === null ? null : { harnessRun: s.run, claimed: "agent:seed", claimedSource: "flag" });
      await writeOne(target, s.kind, s.atMs, `${s.kind}-${i}`);
    }
  } finally {
    seeder.finish();
  }
}

const R = (n: number): string => `cc:share-run-${n}`;

function acSeed(): Spec[] {
  const out: Spec[] = [];
  // 7 claims inside the window, one exactly at the window start (all attested)
  out.push({ kind: "claim", atMs: WINDOW_START_MS, run: R(1) });
  for (let i = 0; i < 6; i++) out.push({ kind: "claim", atMs: NOW_MS - (i + 1) * DAY, run: R(1) });
  // 7 evidence inside the window (all attested), the last exactly "now"
  for (let i = 0; i < 6; i++) out.push({ kind: "evidence", atMs: NOW_MS - (i + 2) * 3_600_000, run: R(2) });
  out.push({ kind: "evidence", atMs: NOW_MS, run: R(2) });
  // 6 handoffs inside the window: 5 attested, 1 unattested (the only unattested one)
  for (let i = 0; i < 5; i++) out.push({ kind: "handoff", atMs: NOW_MS - (i + 1) * 2 * DAY, run: R(3) });
  out.push({ kind: "handoff", atMs: NOW_MS - 3 * DAY, run: null });
  // 5 writes BEFORE the window start (must not count): one 1 ms before, two unattested
  out.push({ kind: "claim", atMs: WINDOW_START_MS - 1, run: null });
  out.push({ kind: "evidence", atMs: WINDOW_START_MS - DAY, run: R(4) });
  out.push({ kind: "handoff", atMs: WINDOW_START_MS - 5 * DAY, run: null });
  out.push({ kind: "claim", atMs: WINDOW_START_MS - 20 * DAY, run: R(4) });
  out.push({ kind: "evidence", atMs: WINDOW_START_MS - 40 * DAY, run: R(4) });
  // 4 attested ordinary document writes inside the window (must not count)
  for (let i = 0; i < 4; i++) out.push({ kind: "document", atMs: NOW_MS - (i + 1) * 3 * 3_600_000, run: R(5) });
  return out;
}

interface Share {
  window_days: number;
  total: number;
  attested: number;
  share: number;
}
function shareOf(r: Run): Share {
  expect(r.exitCode).toBe(0);
  const data = (JSON.parse(r.stdout) as { data: { harness_run_attribution?: Share } }).data;
  const block = data.harness_run_attribution;
  if (!block) throw new Error("MISSING BEHAVIOUR: `lore status --json` has no data.harness_run_attribution");
  return block;
}

let acDir = "";
async function acCorpus(): Promise<string> {
  if (acDir) return acDir;
  acDir = newCorpus();
  await seed(acDir, acSeed());
  return acDir;
}

describe("AC-RID-11 lore status attribution share (BR-1039)", () => {
  it("HAPPY: --json reports total 20, attested 19, share 0.95 over a 14-day window", async () => {
    const dir = await acCorpus();
    expect(shareOf(lore(["status", "--json"], dir))).toEqual({ window_days: 14, total: 20, attested: 19, share: 0.95 });
  });

  it("HAPPY: text status prints the same numbers (19, 20, 0.95, 14 days) on one attribution line", async () => {
    const dir = await acCorpus();
    const r = lore(["status"], dir);
    expect(r.exitCode).toBe(0);
    const line = r.stdout.split("\n").find((l) => /attribut/i.test(l));
    if (!line) throw new Error("MISSING BEHAVIOUR: text status has no attribution line");
    expect(line).toMatch(/\b19\b/);
    expect(line).toMatch(/\b20\b/);
    expect(line).toContain("0.95");
    expect(line).toMatch(/\b14\b/);
  });

  it("BOUNDARY: the write exactly at the window start is counted, the one 1 ms earlier is not", async () => {
    const dir = newCorpus();
    await seed(dir, [
      { kind: "claim", atMs: WINDOW_START_MS, run: R(1) },
      { kind: "claim", atMs: WINDOW_START_MS - 1, run: null },
    ]);
    expect(shareOf(lore(["status", "--json"], dir))).toEqual({ window_days: 14, total: 1, attested: 1, share: 1 });
  });

  it("NEGATIVE: attested ordinary document writes never enter the counts", async () => {
    const dir = newCorpus();
    await seed(dir, [
      { kind: "document", atMs: NOW_MS - DAY, run: R(5) },
      { kind: "document", atMs: NOW_MS - 2 * DAY, run: R(5) },
      { kind: "claim", atMs: NOW_MS - DAY, run: null },
    ]);
    expect(shareOf(lore(["status", "--json"], dir))).toEqual({ window_days: 14, total: 1, attested: 0, share: 0 });
  });

  it("HARDCODED-DEFENCE: a different mix (4 writes, 3 attested) reports 4 / 3 / 0.75", async () => {
    const dir = newCorpus();
    await seed(dir, [
      { kind: "claim", atMs: NOW_MS - DAY, run: R(1) },
      { kind: "evidence", atMs: NOW_MS - DAY, run: R(1) },
      { kind: "handoff", atMs: NOW_MS - DAY, run: R(1) },
      { kind: "handoff", atMs: NOW_MS - 2 * DAY, run: null },
    ]);
    expect(shareOf(lore(["status", "--json"], dir))).toEqual({ window_days: 14, total: 4, attested: 3, share: 0.75 });
  });

  it("BOUNDARY: a corpus with no counted writes reports total 0 and a finite share (no NaN)", async () => {
    const dir = newCorpus();
    const block = shareOf(lore(["status", "--json"], dir));
    expect(block.total).toBe(0);
    expect(block.attested).toBe(0);
    expect(Number.isFinite(block.share)).toBe(true);
  });
});
