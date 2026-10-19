// @spawns packages/lore/src/index.ts
/**
 * The `lore outline` command family is removed (task-remove-the-retired-outline-write-verbs-instead-of-keeping).
 *
 * A throwaway corpus (`mkdtemp` + `lore init`) holds one PRD carrying a stored `extra.outline` and one without.
 *   - `lore outline <anything>` is the CLI's ordinary unknown-command refusal: same exit code as a made-up command,
 *     and no bespoke "retired" / `lore baseline add` text.
 *   - `lore migrate outline-sections` previews by default (writes nothing, exit 0), `--apply` removes the key (exit 0),
 *     a second `--apply` clears nothing.
 *   - `lore migrate prd-to-outline` (an outline writer) is an unknown migration action (exit 2).
 * The repo's own `.lore/` is never touched.
 *
 * Dimensions: NEGATIVE (unknown command / action), BOUNDARY (preview writes nothing), HAPPY (apply), REGRESSION (idempotent).
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
const ACTOR = "agent:outline-family-removed-test";
const OUTLINE = [{ section: "distribution", title: "Distribution", tier: "domain", direction: "ship via npm" }];

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

async function seedOutline(slug: string): Promise<void> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    const doc = await store.findBySlug(slug);
    if (!doc.ok || doc.value === null) throw new Error(`no doc ${slug}`);
    const r = await store.update(doc.value.id, { extra: { ...doc.value.extra, outline: OUTLINE, keep_me: true } });
    if (!r.ok) throw new Error("outline seed failed");
  } finally {
    store.close();
  }
}

let dir = "";
let carrier = "";

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "outline-removed-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "ol@example.invalid"]);
  git(["config", "user.name", "outline removed"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  carrier = slugOf(mustRun(["create", "prd", "--title", "Carrier Prd", "--content", "body", "--no-ai"]).stdout);
  mustRun(["create", "prd", "--title", "Plain Prd", "--content", "body", "--no-ai"]);
  await seedOutline(carrier);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("lore outline is an unknown command", () => {
  const control = (): RunResult => runLore(["no-such-command-xyzzy", "list", carrier]);
  for (const argv of [["list"], ["set", "--section", "s", "--title", "T"], ["rm", "s"], ["exempt", "--reason", "r"]]) {
    it(`NEGATIVE: \`lore outline ${argv[0]}\` exits like any unknown command, with no retired-verb refusal text`, () => {
      const r = runLore(["outline", ...argv.slice(0, 1), carrier, ...argv.slice(1)]);
      const c = control();
      expect(c.exitCode).not.toBe(0);
      expect(r.exitCode).toBe(c.exitCode);
      expect(r.stderr + r.stdout).not.toMatch(/retired/i);
      expect(r.stderr + r.stdout).not.toContain("lore baseline add");
    });
  }
});

describe("lore migrate outline-sections", () => {
  it("BOUNDARY: preview lists exactly the carrier at exit 0 and writes nothing", async () => {
    const r = runLore(["migrate", "outline-sections", "--json"]);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; data: { applied: boolean; count: number; slugs: string[] } };
    expect(out.data).toMatchObject({ applied: false, count: 1, slugs: [carrier] });
    expect((await extraOf(carrier))["outline"]).toEqual(OUTLINE);
  });

  it("HAPPY: --apply removes the key at exit 0 and keeps the PRD's other extra keys", async () => {
    const r = runLore(["migrate", "outline-sections", "--apply", "--json"]);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { applied: boolean; count: number } }).data).toMatchObject({ applied: true, count: 1 });
    const extra = await extraOf(carrier);
    expect("outline" in extra).toBe(false);
    expect(extra["keep_me"]).toBe(true);
  });

  it("REGRESSION: a second --apply clears nothing", () => {
    const r = runLore(["migrate", "outline-sections", "--apply", "--json"]);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { count: number } }).data.count).toBe(0);
  });

  it("NEGATIVE: the outline writer action prd-to-outline is an unknown migration action (exit 2)", () => {
    const r = runLore(["migrate", "prd-to-outline", "--prd", carrier, "--section", "x"]);
    expect(r.exitCode).toBe(2);
  });
});
